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
    const transcription = await DeepgramService.transcribeFile(audioPath, sessionId);

    const transcribedText = transcription.text;
    const deepgramFullResponse = transcription; // Full response (text, timeline, metadata, raw)

    Logger.info(`[Recording Controller] Transcribed text from Deepgram:`);
    Logger.info(`[Recording Controller] Text: "${transcribedText}"`);
    Logger.info(`[Recording Controller] Timeline segments: ${transcription.timeline?.length || 0}`);
    Logger.info(`[Recording Controller] Metadata: ${JSON.stringify(transcription.metadata)}`);

    // ✅ NEW: Set Deepgram completion status
    recordingService.setDeepgramStatus(sessionId, true, transcribedText, deepgramFullResponse);
    Logger.info(`[Recording Controller] ✅ Deepgram transcription completed for session: ${sessionId}`);

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

    // ✅ NEW: Set Deepgram failure status
    recordingService.setDeepgramStatus(sessionId, true, '', null);

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

/**
 * Store DOM events incrementally (called multiple times during recording)
 * Extension sends events in batches (e.g., 5 events at a time)
 */
exports.storeDomEvents = async (req, res) => {
  try {
    const { sessionId, events, metadata } = req.body;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "sessionId is required"
      });
    }

    if (!events || !Array.isArray(events)) {
      return res.status(400).json({
        success: false,
        error: "events array is required"
      });
    }

    Logger.info(`[Recording Controller] 📥 Receiving ${events.length} DOM events for session: ${sessionId}`);

    // Append events to storage (incremental)
    const stored = recordingService.appendDomEvents(sessionId, events, metadata || {});

    if (!stored) {
      return res.status(500).json({
        success: false,
        error: "Failed to store DOM events"
      });
    }

    const totalEvents = recordingService.getEventsForSession(sessionId).length;

    Logger.info(`[Recording Controller] ✅ Stored ${events.length} events (Total: ${totalEvents})`);

    return res.status(200).json({
      success: true,
      sessionId,
      eventsReceived: events.length,
      totalEvents,
      message: "DOM events stored successfully"
    });
  } catch (err) {
    Logger.error("[Recording Controller] Error storing DOM events:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to store DOM events",
      message: err.message
    });
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

/**
 * Finalize recording - NEW endpoint that replaces /process-recording
 * Called by extension after all chunks and events are sent
 * Waits for Deepgram completion, then sends to Python
 */
exports.finalizeRecording = async (req, res) => {
  try {
    const { sessionId } = req.body;

    // Validate sessionId
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "sessionId is required"
      });
    }

    Logger.info(`[Recording Controller] 🏁 FINALIZE called for session: ${sessionId}`);

    // Step 1: Retrieve stored DOM events and metadata
    const events = recordingService.getEventsForSession(sessionId);
    const storedMetadata = recordingService.getMetadataForSession(sessionId);

    Logger.info(`[Recording Controller] 📦 Retrieved ${events.length} stored DOM events`);

    if (events.length === 0) {
      Logger.warn(`[Recording Controller] ⚠️ No DOM events found for session: ${sessionId}`);
    }

    // ✅ Extract metadata from events if not provided by extension
    const enrichedMetadata = {
      sessionId: sessionId,
      ...storedMetadata,
      // Extract from first event if not in stored metadata
      url: storedMetadata.url || (events[0]?.url) || (events[0]?.metadata?.url) || "unknown",
      viewport: storedMetadata.viewport || (events[0]?.viewport) || (events[0]?.metadata?.viewport) || { width: 1920, height: 1080 },
      startTime: storedMetadata.startTime || (events[0]?.timestamp),
      endTime: storedMetadata.endTime || (events[events.length - 1]?.timestamp),
    };

    Logger.info(`[Recording Controller] 📋 Enriched Metadata:`, JSON.stringify(enrichedMetadata));

    // Step 2: Finalize audio/video streams to get file paths
    Logger.info(`[Recording Controller] 📁 Finalizing audio/video streams...`);

    const result = await recordingService.processRecording({
      events,
      metadata: enrichedMetadata,
      videoPath: null, // Will be retrieved from activeStreams
      audioPath: null
    });

    const permanentAudioPath = result.audioPath;
    const permanentVideoPath = result.videoPath;

    Logger.info(`[Recording Controller] 📁 Audio path: ${permanentAudioPath}`);
    Logger.info(`[Recording Controller] 📁 Video path: ${permanentVideoPath}`);

    // Step 3: Trigger Deepgram transcription (if audio exists)
    if (permanentAudioPath && fs.existsSync(permanentAudioPath)) {
      Logger.info(`[Recording Controller] 🎤 Starting Deepgram transcription...`);

      // Trigger transcription (this will set Deepgram status when complete)
      const transcriptionPromise = exports.transcribeAudio(
        permanentAudioPath,
        sessionId,
        enrichedMetadata
      );

      // Wait for Deepgram to complete
      Logger.info(`[Recording Controller] ⏳ Waiting for Deepgram transcription to complete...`);

      let deepgramStatus;
      try {
        // Wait for transcription to finish
        await transcriptionPromise;

        // Get the status that was set by transcribeAudio
        deepgramStatus = recordingService.getDeepgramStatus(sessionId);

        if (!deepgramStatus || !deepgramStatus.completed) {
          throw new Error('Deepgram status not set after transcription');
        }

        Logger.info(`[Recording Controller] ✅ Deepgram transcription completed`);
      } catch (deepgramError) {
        Logger.error(`[Recording Controller] ❌ Deepgram transcription failed:`, deepgramError);

        // Try to get partial status
        deepgramStatus = recordingService.getDeepgramStatus(sessionId);

        if (!deepgramStatus || !deepgramStatus.text) {
          // No transcription available, use DOM events fallback
          Logger.warn(`[Recording Controller] ⚠️ No transcription available, using DOM events fallback`);

          try {
            const frontendService = require("../services/frontend-service");
            frontendService.sendDomEventsAsFallback(sessionId);
          } catch (fallbackError) {
            Logger.error(`[Recording Controller] Error sending fallback:`, fallbackError);
          }

          return res.status(500).json({
            success: false,
            error: "Deepgram transcription failed",
            message: deepgramError.message,
            fallbackSent: true
          });
        }

        Logger.warn(`[Recording Controller] ⚠️ Using partial Deepgram result`);
      }

      const transcribedText = deepgramStatus.text;
      const deepgramResponse = deepgramStatus.deepgramResponse;

      // Log the transcribed text
      Logger.info(`[Recording Controller] 📝 Transcribed Text (${transcribedText.length} chars):`);
      Logger.info(`[Recording Controller] "${transcribedText}"`);

      // Step 4: Broadcast video to frontend
      try {
        if (permanentVideoPath) {
          const frontendService = require("../services/frontend-service");
          frontendService.sendVideo(sessionId, {
            filename: path.basename(permanentVideoPath),
            path: `/recordings/${path.basename(permanentVideoPath)}`,
            metadata: enrichedMetadata,
            timestamp: new Date().toISOString()
          });
          Logger.info(`[Recording Controller] ✅ Video broadcasted to frontend`);
        }
      } catch (broadcastError) {
        Logger.error(`[Recording Controller] Error broadcasting video:`, broadcastError);
      }

      // Step 5: Send to Python AI with complete data
      Logger.info(`[Recording Controller] 🤖 Sending to Python AI...`);
      Logger.info(`[Recording Controller] 📊 Data being sent to Python:`);
      Logger.info(`[Recording Controller]    - Text: "${transcribedText.substring(0, 100)}..." (${transcribedText.length} chars)`);
      Logger.info(`[Recording Controller]    - Events: ${events.length} events`);
      Logger.info(`[Recording Controller]    - Deepgram Response: ${deepgramResponse ? 'YES' : 'NO'}`);
      Logger.info(`[Recording Controller]    - Audio Path: ${permanentAudioPath}`);
      Logger.info(`[Recording Controller]    - Metadata:`, JSON.stringify(enrichedMetadata));

      let pythonResponse = null;
      if (transcribedText && transcribedText.length > 0) {
        pythonResponse = await pythonController.processWithAI(
          transcribedText,
          events,
          enrichedMetadata,  // ← Use enriched metadata
          deepgramResponse,
          sessionId,
          permanentAudioPath
        );

        if (pythonResponse) {
          Logger.info(`[Recording Controller] ✅ Python AI processing completed successfully`);
        } else {
          Logger.warn(`[Recording Controller] ⚠️ Python AI processing returned null`);

          // Trigger fallback to DOM events
          try {
            const frontendService = require("../services/frontend-service");
            frontendService.sendDomEventsAsFallback(sessionId);
            Logger.info(`[Recording Controller] 📤 Sent DOM events as fallback to frontend`);
          } catch (fallbackError) {
            Logger.error(`[Recording Controller] Error sending fallback:`, fallbackError);
          }
        }
      } else {
        Logger.warn(`[Recording Controller] ⚠️ No transcribed text available, using DOM events fallback`);

        try {
          const frontendService = require("../services/frontend-service");
          frontendService.sendDomEventsAsFallback(sessionId);
        } catch (fallbackError) {
          Logger.error(`[Recording Controller] Error sending fallback:`, fallbackError);
        }
      }

      // Step 6: Clean up session data
      recordingService.clearSessionData(sessionId);
      Logger.info(`[Recording Controller] 🧹 Cleaned up session data for: ${sessionId}`);

      // Step 7: Return success response
      return res.status(200).json({
        success: true,
        sessionId,
        message: "Recording finalized and processed successfully",
        transcription: {
          text: transcribedText,
          textLength: transcribedText.length,
          hasDeepgramResponse: !!deepgramResponse
        },
        events: {
          count: events.length
        },
        python: {
          processed: !!pythonResponse,
          response: pythonResponse
        },
        files: {
          audio: permanentAudioPath,
          video: permanentVideoPath
        }
      });
    } else {
      // No audio file, use DOM events fallback
      Logger.warn(`[Recording Controller] ⚠️ No audio file found, using DOM events fallback`);

      try {
        const frontendService = require("../services/frontend-service");
        frontendService.sendDomEventsAsFallback(sessionId);
      } catch (fallbackError) {
        Logger.error(`[Recording Controller] Error sending fallback:`, fallbackError);
      }

      return res.status(200).json({
        success: true,
        sessionId,
        message: "Recording finalized without transcription (no audio)",
        events: {
          count: events.length
        },
        files: {
          audio: null,
          video: permanentVideoPath
        },
        fallbackSent: true
      });
    }

  } catch (err) {
    Logger.error("[Recording Controller] ❌ Finalize recording error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to finalize recording",
      message: err.message
    });
  }
};

