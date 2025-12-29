const fs = require("fs");
const path = require("path");
const recordingService = require("../services/recording-service");
const DeepgramService = require("../services/deepgram-service");
const pythonController = require("./python-controller");
const { Logger } = require("../config");
const S3Service = require("../services/s3-service");

exports.uploadVideoChunk = async (req, res) => {
  try {
    const sessionId = req.body.sessionId;
    const sequence = parseInt(req.body.sequence);
    const chunk = req.file.buffer;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    await recordingService.saveChunk({
      sessionId,
      type: "video",
      chunk,
      sequence,
      requestId: req.requestId
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    Logger.error(`[CONTROLLER] Video chunk error:`, err);
    res.status(500).json({ error: "Failed to save video chunk" });
  }
};

exports.uploadAudioChunk = async (req, res) => {
  try {
    const sessionId = req.body.sessionId;
    const sequence = parseInt(req.body.sequence);
    const chunk = req.file.buffer;

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    await recordingService.saveChunk({
      sessionId,
      type: "audio",
      chunk,
      sequence,
      requestId: req.requestId
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    Logger.error(`[CONTROLLER] Audio chunk error:`, err);
    res.status(500).json({ error: "Failed to save audio chunk" });
  }
};

exports.transcribeAudio = async (audioPath, sessionId, metadata) => {
  try {
    if (!audioPath || !fs.existsSync(audioPath)) {
      Logger.warn(`[Recording Controller] No local audio file found for Deepgram, transcription skipped`);
      return null;
    }

    Logger.info(`[Recording Controller] Transcribing audio file for session: ${sessionId}`);
    const transcription = await DeepgramService.transcribeFile(audioPath, sessionId);

    let deepgramS3Key = null;
    if (transcription && transcription.raw) {
      const key = `recordings/${sessionId}/deepgram.json`;
      deepgramS3Key = await S3Service.uploadToS3(
        key,
        Buffer.from(JSON.stringify(transcription.raw, null, 2)),
        'application/json'
      );
    }

    // Save status to MongoDB (now including S3 key)
    await recordingService.setDeepgramStatus(sessionId, true, transcription.text, transcription.raw, deepgramS3Key);

    return {
      text: transcription.text,
      deepgramResponse: transcription.raw,
      deepgramS3Key
    };
  } catch (deepgramError) {
    Logger.error(`[Recording Controller] Deepgram processing error: ${deepgramError}`);
    await recordingService.setDeepgramStatus(sessionId, true, '', null, null);
    return null;
  }
};

exports.storeDomEvents = async (req, res) => {
  try {
    const { sessionId, events, metadata } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

    await recordingService.appendDomEvents(sessionId, events, metadata || {});
    return res.status(200).json({ success: true });
  } catch (err) {
    Logger.error("[Recording Controller] Error storing DOM events:", err);
    return res.status(500).json({ error: "Failed to store DOM events" });
  }
};

exports.finalizeRecording = async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

    Logger.info(`[Recording Controller] 🏁 Finalizing session (Eager Flow): ${sessionId}`);

    // Step 1: Retrieve stored events and metadata from MongoDB
    const events = await recordingService.getEventsForSession(sessionId);
    const storedMetadata = await recordingService.getMetadataForSession(sessionId);

    const enrichedMetadata = {
      sessionId,
      ...storedMetadata,
      url: storedMetadata.url || events[0]?.url || "unknown",
      viewport: storedMetadata.viewport || events[0]?.viewport || { width: 1920, height: 1080 },
    };

    // Step 2: Finalize local streams and upload raw files to S3 immediately
    const result = await recordingService.processRecording({
      metadata: enrichedMetadata
    });

    // Step 3: Generate signed URLs for RAW playback
    const rawVideoUrl = result.videoS3Key ? await S3Service.getPresignedUrl(result.videoS3Key) : null;
    const rawAudioUrl = result.audioS3Key ? await S3Service.getPresignedUrl(result.audioS3Key) : null;

    // Step 4: Broadcast RAW playback to frontend via Socket.IO
    const frontendService = require("../services/frontend-service");
    frontendService.sendVideo(sessionId, {
      filename: `video_${sessionId}.webm`,
      path: rawVideoUrl,
      metadata: enrichedMetadata,
      isRaw: true,
      timestamp: new Date().toISOString()
    });

    if (rawAudioUrl) {
      frontendService.sendAudio(sessionId, {
        filename: `audio_${sessionId}.webm`,
        path: rawAudioUrl,
        metadata: enrichedMetadata,
        isRaw: true,
        timestamp: new Date().toISOString()
      });
    }

    // Step 5: Execute AI processing (Deepgram + Python) in the background
    // We do NOT await this, allowing the response to return to the extension immediately
    handleBackgroundAI(sessionId, enrichedMetadata, events, result.audioPath);

    // Step 6: Return success to extension (Simple response as before)
    return res.status(200).json({
      success: true,
      sessionId,
      message: "Recording finalized successfully."
    });

  } catch (err) {
    Logger.error("[Recording Controller] Finalize error:", err);
    return res.status(500).json({ error: err.message });
  }
};

/**
 * Internal helper to handle transcription and Python AI in background
 */
async function handleBackgroundAI(sessionId, metadata, events, localAudioPath) {
  try {
    Logger.info(`[Recording Controller] 🤖 Starting Background AI Processing for: ${sessionId}`);

    // 1. Transcription (Deepgram)
    let transcriptionResult = null;
    if (localAudioPath && fs.existsSync(localAudioPath)) {
      transcriptionResult = await exports.transcribeAudio(localAudioPath, sessionId, metadata);
    }

    if (!transcriptionResult || !transcriptionResult.text) {
      Logger.warn(`[Recording Controller] No transcription for ${sessionId}, background AI aborted.`);
      return;
    }

    // 2. Python AI Processing (Sending reference)
    const pythonResponse = await pythonController.processWithAI(
      transcriptionResult.text,
      events,
      metadata,
      transcriptionResult.deepgramResponse,
      sessionId,
      localAudioPath
    );

    if (pythonResponse) {
      Logger.info(`[Recording Controller] ✅ Background AI processing completed for session: ${sessionId}`);
      // Note: processWithAI already handles broadcasting the AI results (instructions/audio)
    }

    // Cleanup local file if exists
    if (localAudioPath && fs.existsSync(localAudioPath)) {
      fs.unlinkSync(localAudioPath);
    }

  } catch (error) {
    Logger.error(`[Recording Controller] ❌ Background AI processing error for ${sessionId}:`, error);
    const frontendService = require("../services/frontend-service");
    frontendService.sendInstructions(sessionId, {
      action: "error",
      target: "AI Background Processing Failed",
      metadata: { error: error.message }
    });
  }
}

// LEGACY: Shim for processRecording to prevent crashes with legacy routes
exports.processRecording = async (req, res) => {
  try {
    Logger.info("[CONTROLLER] Legacy processRecording called. Redirecting to finalize logic conceptually.");
    // This is a minimal shim. In a real scenario, you'd extract data and call finalize.
    return res.status(400).json({ error: "Deprecated. Use /finalize endpoint instead." });
  } catch (err) {
    Logger.error("[CONTROLLER] Legacy processRecording error:", err);
    res.status(500).json({ error: err.message });
  }
};
