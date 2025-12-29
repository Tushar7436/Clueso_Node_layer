const fs = require("fs");
const path = require("path");
const { Logger } = require("../config");
const S3Service = require("./s3-service");

const uploadDir = path.join(__dirname, "..", "uploads");
const recordingsDir = path.join(__dirname, "..", "recordings");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

// Keep local state for session management
const activeSessions = new Map();

const getOrCreateSession = (sessionId) => {
  if (!activeSessions.has(sessionId)) {
    activeSessions.set(sessionId, {
      videoFile: null,
      audioFile: null,
      videoFilePath: null,
      audioFilePath: null,
      events: [],
      metadata: {},
      videoBytesWritten: 0,
      audioBytesWritten: 0,
    });
  }
  return activeSessions.get(sessionId);
};

exports.saveChunk = async ({ sessionId, type, chunk, sequence, requestId }) => {
  return new Promise((resolve, reject) => {
    try {
      if (!sessionId) return reject(new Error("sessionId is required"));

      const session = getOrCreateSession(sessionId);

      if (type === "video" && !session.videoFile) {
        session.videoFilePath = path.join(uploadDir, `video_${sessionId}.webm`);
        session.videoFile = fs.createWriteStream(session.videoFilePath);
      }
      if (type === "audio" && !session.audioFile) {
        session.audioFilePath = path.join(uploadDir, `audio_${sessionId}.webm`);
        session.audioFile = fs.createWriteStream(session.audioFilePath);
      }

      const stream = type === "video" ? session.videoFile : session.audioFile;
      if (!stream) return reject(new Error(`Failed to create ${type} stream`));

      Logger.info(`[SERVICE] Saving ${type} chunk for session ${sessionId}`);

      stream.write(chunk, (err) => {
        if (err) {
          Logger.error(`[SERVICE] Error writing ${type} chunk:`, err);
          return reject(err);
        }
        if (type === "video") session.videoBytesWritten += chunk.length;
        else session.audioBytesWritten += chunk.length;
        resolve();
      });
    } catch (err) {
      Logger.error(`[SERVICE] Error in saveChunk:`, err);
      reject(err);
    }
  });
};

const finalizeStream = (sessionId, type) => {
  return new Promise((resolve) => {
    const session = activeSessions.get(sessionId);
    if (!session) return resolve(null);

    if (type === "video" && session.videoFile) {
      session.videoFile.end(() => resolve(session.videoFilePath));
    } else if (type === "audio" && session.audioFile) {
      session.audioFile.end(() => resolve(session.audioFilePath));
    } else {
      resolve(null);
    }
  });
};

exports.processRecording = async ({ metadata }) => {
  try {
    const sessionId = metadata.sessionId;
    Logger.info(`[SERVICE] Finalizing recording for session (S3 only): ${sessionId}`);

    const session = activeSessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    // Finalize local streams
    const finalAudioPath = await finalizeStream(sessionId, "audio");
    const finalVideoPath = await finalizeStream(sessionId, "video");

    let videoS3Key = null;
    let audioS3Key = null;

    // Upload Media to S3
    if (finalVideoPath && fs.existsSync(finalVideoPath)) {
      const key = `recordings/${sessionId}/video.webm`;
      videoS3Key = await S3Service.uploadToS3(key, fs.createReadStream(finalVideoPath), 'video/webm');
      fs.unlinkSync(finalVideoPath);
    }

    if (finalAudioPath && fs.existsSync(finalAudioPath)) {
      const key = `recordings/${sessionId}/audio.webm`;
      audioS3Key = await S3Service.uploadToS3(key, fs.createReadStream(finalAudioPath), 'audio/webm');
    }

    // Upload Metadata and Events to S3
    const metadataKey = `metadata/${sessionId}.json`;
    await S3Service.uploadToS3(
      metadataKey,
      Buffer.from(JSON.stringify({ ...metadata, videoS3Key, audioS3Key, status: 'processing' }, null, 2)),
      'application/json'
    );

    const eventsKey = `events/${sessionId}.json`;
    await S3Service.uploadToS3(
      eventsKey,
      Buffer.from(JSON.stringify({ events: session.events }, null, 2)),
      'application/json'
    );

    // Clean up temporary S3 events
    await S3Service.deleteFromS3(`temp-events/${sessionId}.json`);

    // activeSessions.delete(sessionId); // Keep for a bit if needed for background AI, or delete now

    return {
      success: true,
      sessionId,
      videoS3Key,
      audioS3Key,
      audioPath: finalAudioPath,
      videoPath: finalVideoPath
    };
  } catch (err) {
    Logger.error("[SERVICE] Error processing recording:", err);
    throw err;
  }
};

exports.appendDomEvents = async (sessionId, events, metadata = {}) => {
  try {
    if (!events || !Array.isArray(events) || events.length === 0) return false;

    const session = getOrCreateSession(sessionId);
    session.events.push(...events);
    session.metadata = { ...session.metadata, ...metadata };

    // Incremental upload to S3 for reliability
    const tempKey = `temp-events/${sessionId}.json`;
    await S3Service.uploadToS3(
      tempKey,
      Buffer.from(JSON.stringify({ events: session.events }, null, 2)),
      'application/json'
    );

    Logger.info(`[SERVICE] Appended ${events.length} events to S3 temp and memory for session: ${sessionId}`);
    return true;
  } catch (err) {
    Logger.error(`[SERVICE] Error appending events for session ${sessionId}:`, err);
    throw err;
  }
};

exports.getEventsForSession = async (sessionId) => {
  const session = activeSessions.get(sessionId);
  return session ? session.events : [];
};

exports.getMetadataForSession = async (sessionId) => {
  const session = activeSessions.get(sessionId);
  return session ? session.metadata : {};
};

exports.setDeepgramStatus = async (sessionId, completed, text = '', deepgramResponse = null, deepgramS3Key = null) => {
  try {
    const session = activeSessions.get(sessionId);
    if (!session) {
      Logger.warn(`[SERVICE] Cannot update Deepgram status: Session ${sessionId} not in memory.`);
      return;
    }

    // Update in-memory metadata
    session.metadata.transcription = {
      text,
      deepgramS3Key,
      completed
    };

    // Extract duration from Deepgram response
    if (deepgramResponse?.metadata?.duration) {
      session.metadata.videoDurationSec = deepgramResponse.metadata.duration;
    }

    // Re-upload updated metadata to S3
    const metadataKey = `metadata/${sessionId}.json`;
    await S3Service.uploadToS3(
      metadataKey,
      Buffer.from(JSON.stringify({ ...session.metadata, status: completed ? 'processing' : 'recording' }, null, 2)),
      'application/json'
    );

    Logger.info(`[SERVICE] Deepgram status and duration updated in S3 for session: ${sessionId}`);
  } catch (error) {
    Logger.error(`[SERVICE] Error updating Deepgram status: ${error.message}`);
  }
};

exports.clearSessionData = (sessionId) => {
  activeSessions.delete(sessionId);
  Logger.info(`[SERVICE] Cleared in-memory session data for: ${sessionId}`);
};

