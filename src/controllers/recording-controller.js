// Controller - Add to recording-controller.js
const fs = require("fs");
const path = require("path");
const recordingService = require("../services/recording-service");
const DeepgramService = require("../services/deepgram-service");
const pythonController = require("./python-controller");
const { Logger } = require("../config");

// recording-controller.js
exports.uploadVideoChunk = async (req, res) => {
  try {
    const sessionId = req.body.sessionId;
    const sequence = parseInt(req.body.sequence);
    const chunk = req.file.buffer;  // ← From multer

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    Logger.info(`[CONTROLLER] Video chunk - Session: ${sessionId}, Sequence: ${sequence}`);

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
    const chunk = req.file.buffer;  // ← From multer

    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    Logger.info(`[CONTROLLER] Audio chunk - Session: ${sessionId}, Sequence: ${sequence}`);

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

/**
 * Transcribe audio file using Deepgram
 * @param {string} audioPath - Path to audio file
 * @param {string} sessionId - Session ID for broadcasting
 * @param {object} metadata - Session metadata
 * @returns {Promise<{text: string, deepgramResponse: object}|null>} Transcription result or null if failed
 */
exports.transcribeAudio = async (audioPath, sessionId, metadata) => {
  try {
    if (!audioPath || !fs.existsSync(audioPath)) {
      Logger.warn(`[Recording Controller] No audio file found at ${audioPath}, skipping transcription`);
      return null;
    }

    Logger.info(`[Recording Controller] Processing audio file: ${audioPath}`);
    const transcription = await DeepgramService.transcribeFile(audioPath);

    const transcribedText = transcription.text;
    const deepgramFullResponse = transcription; // Full response (text, timeline, metadata, raw)

    Logger.info(`[Recording Controller] Transcribed text from Deepgram:`);
    Logger.info(`[Recording Controller] Text: "${transcribedText}"`);
    Logger.info(`[Recording Controller] Timeline segments: ${transcription.timeline?.length || 0}`);
    Logger.info(`[Recording Controller] Metadata: ${JSON.stringify(transcription.metadata)}`);

    // Broadcast raw audio to frontend (always send raw audio after transcription)
    const frontendService = require("../services/frontend-service");
    frontendService.sendAudio(sessionId, {
      filename: path.basename(audioPath),
      path: `/recordings/${path.basename(audioPath)}`,
      text: transcribedText,
      timestamp: new Date().toISOString()
    });

    return {
      text: transcribedText,
      deepgramResponse: deepgramFullResponse
    };
  } catch (deepgramError) {
    Logger.error(`[Recording Controller] Error processing audio with Deepgram: ${deepgramError}`);

    // Notify frontend of transcription failure
    const frontendService = require("../services/frontend-service");
    frontendService.sendInstructions(sessionId, {
      action: "error",
      target: "Transcription Failed",
      metadata: { error: deepgramError.message }
    });

    // Send raw audio as fallback
    if (audioPath && fs.existsSync(audioPath)) {
      frontendService.sendAudio(sessionId, {
        filename: path.basename(audioPath),
        path: `/recordings/${path.basename(audioPath)}`,
        text: "Transcription failed",
        timestamp: new Date().toISOString()
      });
    }

    return null;
  }
};

exports.processRecording = async (req, res) => {
  try {
    const events = req.body.events ? JSON.parse(req.body.events) : [];
    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};

    const videoPath = req.files?.video?.[0]?.path;
    let audioPath = req.files?.audio?.[0]?.path;

    // Finalize video/audio & save JSON first to ensure files are ready
    const result = await recordingService.processRecording({
      events,
      metadata,
      videoPath,
      audioPath,
    });

    // Validated permanent audio path from service
    const permanentAudioPath = result.audioPath;
    const permanentVideoPath = result.videoPath;

    // Use result.sessionId as it may have been corrected by fallback logic in service
    const actualSessionId = result.sessionId;

    // 1. Broadcast video to frontend IMMEDIATELY (video doesn't need AI processing)
    // DEFENSIVE: Wrap in try-catch so broadcast errors don't block AI processing
    try {
      if (permanentVideoPath) {
        Logger.info(`[Recording Controller] Broadcasting video to frontend session: ${actualSessionId}`);
        const frontendService = require("../services/frontend-service");
        frontendService.sendVideo(actualSessionId, {
          filename: path.basename(permanentVideoPath),
          path: `/recordings/${path.basename(permanentVideoPath)}`,
          metadata: metadata,
          timestamp: new Date().toISOString()
        });
      }
    } catch (broadcastError) {
      // Don't let broadcast errors block AI processing
      Logger.error(`[Recording Controller] Error broadcasting video to frontend (continuing with AI processing):`, broadcastError);
    }

    // 2. Transcribe audio with Deepgram (if audio exists)
    const transcriptionResult = await exports.transcribeAudio(
      permanentAudioPath,
      actualSessionId,
      metadata
    );

    // Store DOM events for fallback (in case Python processing fails)
    try {
      const frontendService = require("../services/frontend-service");
      if (events && events.length > 0) {
        frontendService.storeDomEvents(actualSessionId, events);
        Logger.info(`[Recording Controller] Stored ${events.length} DOM events for potential fallback`);
      }
    } catch (storageError) {
      Logger.error(`[Recording Controller] Error storing DOM events for fallback:`, storageError);
    }

    // 3. Process with AI (if transcription succeeded)
    let pythonResponse = null;
    if (transcriptionResult && transcriptionResult.text) {
      pythonResponse = await pythonController.processWithAI(
        transcriptionResult.text,
        events,
        metadata,
        transcriptionResult.deepgramResponse, // Full Deepgram JSON
        actualSessionId,
        permanentAudioPath // Raw audio path
      );

      // If Python processing failed, trigger fallback to DOM events
      if (!pythonResponse) {
        Logger.warn(`[Recording Controller] Python processing failed, triggering DOM events fallback`);
        try {
          const frontendService = require("../services/frontend-service");
          frontendService.sendDomEventsAsFallback(actualSessionId);
        } catch (fallbackError) {
          Logger.error(`[Recording Controller] Error triggering fallback:`, fallbackError);
        }
      }
    } else {
      // No transcription, use DOM events as fallback
      Logger.warn(`[Recording Controller] No transcription available, triggering DOM events fallback`);
      try {
        const frontendService = require("../services/frontend-service");
        frontendService.sendDomEventsAsFallback(actualSessionId);
      } catch (fallbackError) {
        Logger.error(`[Recording Controller] Error triggering fallback:`, fallbackError);
      }
    }

    // Add transcription info to result
    if (transcriptionResult) {
      result.transcription = {
        text: transcriptionResult.text,
        sentToPython: pythonResponse !== null,
        pythonResponse: pythonResponse,
        deepgramResponse: transcriptionResult.deepgramResponse
      };
    }

    return res.status(200).json(result);
  } catch (err) {
    Logger.error("Process recording error:", err);
    res.status(500).json({
      error: "Failed to process recording",
      message: err.message,
    });
  }
};
