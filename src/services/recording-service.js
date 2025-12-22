// recording-service.js
const fs = require("fs");
const path = require("path");
const { Logger } = require("../config");

const uploadDir = path.join(__dirname, "..", "uploads");
const recordingsDir = path.join(__dirname, "..", "recordings");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(recordingsDir)) fs.mkdirSync(recordingsDir, { recursive: true });

// CHANGED: Per-session file streams
const activeStreams = new Map(); // sessionId -> { videoFile, audioFile, videoBytesWritten, audioBytesWritten }

// NEW: Per-session DOM events and metadata storage
const sessionEvents = new Map(); // sessionId -> events array
const sessionMetadata = new Map(); // sessionId -> metadata object
const sessionEventsFile = new Map(); // sessionId -> file path for incremental event writing
const deepgramStatus = new Map(); // sessionId -> { completed: boolean, text: string, deepgramResponse: object }

const getOrCreateStream = (sessionId, type) => {
  if (!activeStreams.has(sessionId)) {
    activeStreams.set(sessionId, {
      videoFile: null,
      audioFile: null,
      videoFilePath: null,
      audioFilePath: null,
      videoBytesWritten: 0,
      audioBytesWritten: 0,
      videoChunks: [],  // Track chunk order
      audioChunks: []
    });
  }

  const session = activeStreams.get(sessionId);

  if (type === "video" && !session.videoFile) {
    const filename = `video_${sessionId}.webm`;
    session.videoFilePath = path.join(uploadDir, filename);
    session.videoFile = fs.createWriteStream(session.videoFilePath);
    Logger.info(`[SERVICE] Created video stream for session: ${sessionId}`);
  }

  if (type === "audio" && !session.audioFile) {
    const filename = `audio_${sessionId}.webm`;
    session.audioFilePath = path.join(uploadDir, filename);
    session.audioFile = fs.createWriteStream(session.audioFilePath);
    Logger.info(`[SERVICE] Created audio stream for session: ${sessionId}`);
  }

  return session;
};

exports.saveChunk = async ({ sessionId, type, chunk, sequence, requestId }) => {
  return new Promise((resolve, reject) => {
    try {
      if (!sessionId) {
        return reject(new Error("sessionId is required"));
      }

      const session = getOrCreateStream(sessionId, type);
      const stream = type === "video" ? session.videoFile : session.audioFile;

      if (!stream) {
        return reject(new Error(`Failed to create ${type} stream`));
      }

      Logger.info(`[SERVICE] Saving ${type} chunk for session ${sessionId}`);
      Logger.info(`[SERVICE] Sequence: ${sequence}, Size: ${chunk.length} bytes`);

      // Store chunk info for ordering verification
      const chunks = type === "video" ? session.videoChunks : session.audioChunks;
      chunks.push({ sequence, size: chunk.length, timestamp: Date.now() });

      stream.write(chunk, (err) => {
        if (err) {
          Logger.error(`[SERVICE] Error writing ${type} chunk:`, err);
          return reject(err);
        }

        if (type === "video") {
          session.videoBytesWritten += chunk.length;
          Logger.info(`[SERVICE] Video bytes written: ${session.videoBytesWritten}`);
        } else {
          session.audioBytesWritten += chunk.length;
          Logger.info(`[SERVICE] Audio bytes written: ${session.audioBytesWritten}`);
        }

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
    if (!activeStreams.has(sessionId)) {
      return resolve(null);
    }

    const session = activeStreams.get(sessionId);

    if (type === "video" && session.videoFile) {
      Logger.info(`[SERVICE] Finalizing video for session ${sessionId}`);
      Logger.info(`[SERVICE] Total chunks: ${session.videoChunks.length}`);
      Logger.info(`[SERVICE] Total bytes: ${session.videoBytesWritten}`);

      session.videoFile.end(() => {
        const path = session.videoFilePath;
        Logger.info(`[SERVICE] Video stream closed: ${path}`);
        resolve(path);
      });
    } else if (type === "audio" && session.audioFile) {
      Logger.info(`[SERVICE] Finalizing audio for session ${sessionId}`);
      Logger.info(`[SERVICE] Total chunks: ${session.audioChunks.length}`);
      Logger.info(`[SERVICE] Total bytes: ${session.audioBytesWritten}`);

      session.audioFile.end(() => {
        const path = session.audioFilePath;
        Logger.info(`[SERVICE] Audio stream closed: ${path}`);
        resolve(path);
      });
    } else {
      resolve(null);
    }
  });
};

exports.processRecording = async ({ events, metadata, videoPath, audioPath }) => {
  try {
    let sessionId = metadata.sessionId;
    Logger.info(`[SERVICE] Processing recording for session: ${sessionId}`);

    // DEBUG: Log active sessions
    Logger.info(`[SERVICE] Active sessions: ${Array.from(activeStreams.keys()).join(', ')}`);
    Logger.info(`[SERVICE] Session exists in activeStreams: ${activeStreams.has(sessionId)}`);

    // WORKAROUND: If requested session doesn't exist, use the most recent one
    if (!activeStreams.has(sessionId) && activeStreams.size > 0) {
      const activeSessions = Array.from(activeStreams.keys());
      const fallbackSession = activeSessions[activeSessions.length - 1];
      Logger.warn(`[SERVICE] SessionId mismatch! Requested: ${sessionId}, Using fallback: ${fallbackSession}`);
      sessionId = fallbackSession;
    }

    // Finalize streams for this session
    let finalAudioPath = audioPath || (await finalizeStream(sessionId, "audio"));
    let finalVideoPath = videoPath || (await finalizeStream(sessionId, "video"));

    // DEBUG: Log what we got
    Logger.info(`[SERVICE] finalAudioPath: ${finalAudioPath}`);
    Logger.info(`[SERVICE] finalVideoPath: ${finalVideoPath}`);

    // Clean up session from active streams
    if (activeStreams.has(sessionId)) {
      const session = activeStreams.get(sessionId);

      // Log chunk statistics
      Logger.info(`[SERVICE] Session ${sessionId} statistics:`);
      Logger.info(`[SERVICE] Video chunks received: ${session.videoChunks.length}`);
      Logger.info(`[SERVICE] Audio chunks received: ${session.audioChunks.length}`);

      // Check for missing sequences
      if (session.videoChunks.length > 0) {
        const videoSequences = session.videoChunks.map(c => c.sequence).sort((a, b) => a - b);
        const missingVideo = [];
        for (let i = 0; i < videoSequences[videoSequences.length - 1]; i++) {
          if (!videoSequences.includes(i)) missingVideo.push(i);
        }
        if (missingVideo.length > 0) {
          Logger.warn(`[SERVICE] Missing video chunks: ${missingVideo.join(', ')}`);
        }
      }

      activeStreams.delete(sessionId);
    }

    // Move files to permanent location
    let permanentVideoPath = null;
    let permanentAudioPath = null;

    if (finalVideoPath && fs.existsSync(finalVideoPath)) {
      permanentVideoPath = path.join(recordingsDir, `recording_${sessionId}_video.webm`);
      fs.copyFileSync(finalVideoPath, permanentVideoPath);
      fs.unlinkSync(finalVideoPath);
      Logger.info(`[SERVICE] Video moved to: ${permanentVideoPath}`);
    }

    if (finalAudioPath && fs.existsSync(finalAudioPath)) {
      permanentAudioPath = path.join(recordingsDir, `recording_${sessionId}_audio.webm`);
      fs.copyFileSync(finalAudioPath, permanentAudioPath);
      fs.unlinkSync(finalAudioPath);
      Logger.info(`[SERVICE] Audio moved to: ${permanentAudioPath}`);
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

    Logger.info(`[SERVICE] Recording saved: ${filename}`);

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

/**
 * Store DOM events incrementally (append to file)
 * @param {string} sessionId - Session ID
 * @param {Array} events - Array of new DOM events to append
 * @param {object} metadata - Session metadata
 */
exports.appendDomEvents = (sessionId, events, metadata = {}) => {
  try {
    if (!events || !Array.isArray(events) || events.length === 0) {
      Logger.warn(`[SERVICE] No events to append for session: ${sessionId}`);
      return false;
    }

    // Initialize events array if not exists
    if (!sessionEvents.has(sessionId)) {
      sessionEvents.set(sessionId, []);
      sessionMetadata.set(sessionId, metadata);

      // Create events file for incremental writing
      const eventsFilePath = path.join(recordingsDir, `events_${sessionId}_temp.json`);
      sessionEventsFile.set(sessionId, eventsFilePath);

      // Write initial structure
      fs.writeFileSync(eventsFilePath, JSON.stringify({ events: [], metadata }, null, 2));

      Logger.info(`[SERVICE] Created events file for session: ${sessionId}`);
    }

    // Append events to in-memory array
    const existingEvents = sessionEvents.get(sessionId);
    existingEvents.push(...events);
    sessionEvents.set(sessionId, existingEvents);

    // Update metadata if provided
    if (metadata && Object.keys(metadata).length > 0) {
      const existingMetadata = sessionMetadata.get(sessionId) || {};
      sessionMetadata.set(sessionId, { ...existingMetadata, ...metadata });
    }

    // Append to file
    const eventsFilePath = sessionEventsFile.get(sessionId);
    const currentData = JSON.parse(fs.readFileSync(eventsFilePath, 'utf8'));
    currentData.events.push(...events);
    currentData.metadata = sessionMetadata.get(sessionId);
    fs.writeFileSync(eventsFilePath, JSON.stringify(currentData, null, 2));

    Logger.info(`[SERVICE] Appended ${events.length} events for session: ${sessionId} (Total: ${existingEvents.length})`);

    // Auto-cleanup after 2 hours
    setTimeout(() => {
      if (sessionEvents.has(sessionId)) {
        exports.clearSessionData(sessionId);
        Logger.warn(`[SERVICE] Auto-cleaned up stale session: ${sessionId}`);
      }
    }, 2 * 60 * 60 * 1000);

    return true;
  } catch (err) {
    Logger.error(`[SERVICE] Error appending events for session ${sessionId}:`, err);
    throw err;
  }
};

/**
 * Get stored DOM events for a session
 * @param {string} sessionId - Session ID
 * @returns {Array} - DOM events array
 */
exports.getEventsForSession = (sessionId) => {
  return sessionEvents.get(sessionId) || [];
};

/**
 * Get stored metadata for a session
 * @param {string} sessionId - Session ID
 * @returns {object} - Metadata object
 */
exports.getMetadataForSession = (sessionId) => {
  return sessionMetadata.get(sessionId) || {};
};

/**
 * Set Deepgram transcription status
 * @param {string} sessionId - Session ID
 * @param {boolean} completed - Whether transcription is complete
 * @param {string} text - Transcribed text
 * @param {object} deepgramResponse - Full Deepgram response
 */
exports.setDeepgramStatus = (sessionId, completed, text = '', deepgramResponse = null) => {
  deepgramStatus.set(sessionId, {
    completed,
    text,
    deepgramResponse,
    timestamp: Date.now()
  });

  Logger.info(`[SERVICE] Deepgram status for ${sessionId}: ${completed ? 'COMPLETED' : 'IN_PROGRESS'}`);
  if (completed && text) {
    Logger.info(`[SERVICE] Deepgram text preview: "${text.substring(0, 100)}..."`);
  }
};

/**
 * Get Deepgram transcription status
 * @param {string} sessionId - Session ID
 * @returns {object|null} - Status object or null
 */
exports.getDeepgramStatus = (sessionId) => {
  return deepgramStatus.get(sessionId) || null;
};

/**
 * Wait for Deepgram transcription to complete
 * @param {string} sessionId - Session ID
 * @param {number} maxWaitMs - Maximum wait time in milliseconds (default: 60000)
 * @returns {Promise<object>} - Deepgram status object
 */
exports.waitForDeepgramCompletion = async (sessionId, maxWaitMs = 60000) => {
  const startTime = Date.now();
  const checkInterval = 500; // Check every 500ms

  return new Promise((resolve, reject) => {
    const checkStatus = () => {
      const status = deepgramStatus.get(sessionId);

      if (status && status.completed) {
        Logger.info(`[SERVICE] Deepgram completed for session: ${sessionId}`);
        resolve(status);
        return;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= maxWaitMs) {
        Logger.error(`[SERVICE] Deepgram timeout for session: ${sessionId} (waited ${elapsed}ms)`);
        reject(new Error(`Deepgram transcription timeout after ${maxWaitMs}ms`));
        return;
      }

      // Check again after interval
      setTimeout(checkStatus, checkInterval);
    };

    checkStatus();
  });
};

/**
 * Clear all session data (events, metadata, Deepgram status)
 * @param {string} sessionId - Session ID
 */
exports.clearSessionData = (sessionId) => {
  sessionEvents.delete(sessionId);
  sessionMetadata.delete(sessionId);
  deepgramStatus.delete(sessionId);

  // Delete temporary events file
  if (sessionEventsFile.has(sessionId)) {
    const filePath = sessionEventsFile.get(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      Logger.info(`[SERVICE] Deleted temporary events file: ${filePath}`);
    }
    sessionEventsFile.delete(sessionId);
  }

  Logger.info(`[SERVICE] Cleared session data for: ${sessionId}`);
};
