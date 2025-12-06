const fs = require("fs");
const path = require("path");
const { Logger } = require("../config");

const uploadDir = path.join(__dirname, "..", "uploads");
const recordingsDir = path.join(__dirname, "..", "recordings");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

let videoFile = null;
let audioFile = null;
let videoFilePath = null;
let audioFilePath = null;
let videoBytesWritten = 0;
let audioBytesWritten = 0;

const getFileStream = (type) => {
  if (type === "video") {
    if (!videoFile) {
      const filename = `video_${Date.now()}.webm`;
      videoFilePath = path.join(uploadDir, filename);
      videoFile = fs.createWriteStream(videoFilePath);
      videoBytesWritten = 0;
      Logger.info("[SERVICE] Created video file:", filename);
      Logger.info("[SERVICE] Video file path:", videoFilePath);
    }
    return videoFile;
  }

  if (type === "audio") {
    if (!audioFile) {
      const filename = `audio_${Date.now()}.webm`;
      audioFilePath = path.join(uploadDir, filename);
      audioFile = fs.createWriteStream(audioFilePath);
      audioBytesWritten = 0;
      Logger.info("[SERVICE] Created audio file:", filename);
      Logger.info("[SERVICE] Audio file path:", audioFilePath);
    }
    return audioFile;
  }
};

const finalizeStream = (type) => {
  return new Promise((resolve) => {
    if (type === "video" && videoFile) {
      Logger.info(`[SERVICE] Finalizing video stream - Total bytes: ${videoBytesWritten}`);
      videoFile.end(() => {
        const p = videoFilePath;
        Logger.info(`[SERVICE] Video stream closed - File: ${p}`);
        if (fs.existsSync(p)) {
          const stats = fs.statSync(p);
          Logger.info(`[SERVICE] Video file size on disk: ${stats.size} bytes`);
        }
        videoFile = null;
        videoFilePath = null;
        videoBytesWritten = 0;
        resolve(p);
      });
    } else if (type === "audio" && audioFile) {
      Logger.info(`[SERVICE] Finalizing audio stream - Total bytes: ${audioBytesWritten}`);
      audioFile.end(() => {
        const p = audioFilePath;
        Logger.info(`[SERVICE] Audio stream closed - File: ${p}`);
        if (fs.existsSync(p)) {
          const stats = fs.statSync(p);
          Logger.info(`[SERVICE] Audio file size on disk: ${stats.size} bytes`);
        }
        audioFile = null;
        audioFilePath = null;
        audioBytesWritten = 0;
        resolve(p);
      });
    } else {
      resolve(null);
    }
  });
};

exports.getStreamFilePath = (type) => {
  if (type === "video" && videoFilePath) return videoFilePath;
  if (type === "audio" && audioFilePath) return audioFilePath;
  return null;
};

exports.saveChunk = async ({ type, chunk, requestId }) => {
  return new Promise((resolve, reject) => {
    try {
      const stream = getFileStream(type);

      Logger.info(`[SERVICE] Saving ${type} chunk - Request ID: ${requestId}`);
      Logger.info(`[SERVICE] Chunk is Buffer: ${Buffer.isBuffer(chunk)}`);
      Logger.info(`[SERVICE] Chunk size: ${chunk ? chunk.length : 0} bytes`);

      // CRITICAL FIX: Don't wrap in Buffer.from() if it's already a Buffer
      // This was causing data corruption and duplication
      const dataToWrite = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);

      Logger.info(`[SERVICE] Writing ${dataToWrite.length} bytes to ${type} stream`);

      stream.write(dataToWrite, (err) => {
        if (err) {
          Logger.error(`[SERVICE] Error writing ${type} chunk:`, err);
          return reject(err);
        }

        // Update byte counters
        if (type === "video") {
          videoBytesWritten += dataToWrite.length;
          Logger.info(`[SERVICE] Total video bytes written: ${videoBytesWritten}`);
        } else if (type === "audio") {
          audioBytesWritten += dataToWrite.length;
          Logger.info(`[SERVICE] Total audio bytes written: ${audioBytesWritten}`);
        }

        Logger.info(`[SERVICE] Successfully wrote ${type} chunk - Request ID: ${requestId}`);
        resolve();
      });
    } catch (err) {
      Logger.error(`[SERVICE] Error in saveChunk for ${type}:`, err);
      reject(err);
    }
  });
};

exports.processRecording = async ({ events, metadata, videoPath, audioPath }) => {
  try {
    Logger.info(
      `[SERVICE] Processing ${events.length} events for session: ${metadata.sessionId}`
    );

    let finalAudioPath = audioPath || (await finalizeStream("audio"));
    let finalVideoPath = videoPath || (await finalizeStream("video"));

    // Move files to recordings directory with proper naming
    let permanentVideoPath = null;
    let permanentAudioPath = null;

    if (finalVideoPath && fs.existsSync(finalVideoPath)) {
      permanentVideoPath = path.join(recordingsDir, `recording_${metadata.sessionId}_video.webm`);
      Logger.info(`[SERVICE] Moving video from ${finalVideoPath} to ${permanentVideoPath}`);
      fs.copyFileSync(finalVideoPath, permanentVideoPath);
      fs.unlinkSync(finalVideoPath); // Delete temp file
      Logger.info(`[SERVICE] Video file moved successfully`);
    }

    if (finalAudioPath && fs.existsSync(finalAudioPath)) {
      permanentAudioPath = path.join(recordingsDir, `recording_${metadata.sessionId}_audio.webm`);
      Logger.info(`[SERVICE] Moving audio from ${finalAudioPath} to ${permanentAudioPath}`);
      fs.copyFileSync(finalAudioPath, permanentAudioPath);
      fs.unlinkSync(finalAudioPath); // Delete temp file
      Logger.info(`[SERVICE] Audio file moved successfully`);
    }

    const recordingData = {
      sessionId: metadata.sessionId,
      startTime: metadata.startTime,
      endTime: metadata.endTime,
      url: metadata.url,
      viewport: metadata.viewport,
      events,
      videoPath: permanentVideoPath || null,
      audioPath: permanentAudioPath || null,
      processedAt: new Date().toISOString(),
    };

    const filename = `recording_${metadata.sessionId}_${Date.now()}.json`;
    const filePath = path.join(recordingsDir, filename);

    fs.writeFileSync(filePath, JSON.stringify(recordingData, null, 2), "utf8");

    Logger.info(`[SERVICE] Saved recording data to: ${filename}`);
    Logger.info(`[SERVICE] Video path: ${permanentVideoPath}`);
    Logger.info(`[SERVICE] Audio path: ${permanentAudioPath}`);

    return {
      success: true,
      sessionId: metadata.sessionId,
      filename,
      eventsProcessed: events.length,
      message: "Recording saved successfully",
      audioPath: permanentAudioPath,
      videoPath: permanentVideoPath,
    };
  } catch (err) {
    Logger.error("[SERVICE] Error processing recording:", err);
    throw err;
  }
};
