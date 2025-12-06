// Controller - Add to recording-controller.js
const fs = require("fs");
const recordingService = require("../services/recording-service");
const { DeepgramService, PythonService } = require("../services");
const { Logger } = require("../config");

exports.uploadVideoChunk = async (req, res) => {
  try {
    const chunk = req.body; // <-- this is a Buffer now

    Logger.info(`[CONTROLLER] Video chunk received - Request ID: ${req.requestId}`);
    Logger.info(`[CONTROLLER] Chunk is Buffer: ${Buffer.isBuffer(chunk)}`);
    Logger.info(`[CONTROLLER] Chunk size: ${chunk ? chunk.length : 0} bytes`);
    Logger.info(`[CONTROLLER] Chunk type: ${typeof chunk}`);

    await recordingService.saveChunk({ type: "video", chunk, requestId: req.requestId });

    Logger.info(`[CONTROLLER] Video chunk saved successfully - Request ID: ${req.requestId}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    Logger.error(`[CONTROLLER] Video chunk error - Request ID: ${req.requestId}:`, err);
    res.status(500).json({ error: "Failed to save video chunk" });
  }
};

exports.uploadAudioChunk = async (req, res) => {
  try {
    const chunk = req.body;

    Logger.info(`[CONTROLLER] Audio chunk received - Request ID: ${req.requestId}`);
    Logger.info(`[CONTROLLER] Chunk is Buffer: ${Buffer.isBuffer(chunk)}`);
    Logger.info(`[CONTROLLER] Chunk size: ${chunk ? chunk.length : 0} bytes`);
    Logger.info(`[CONTROLLER] Chunk type: ${typeof chunk}`);

    await recordingService.saveChunk({ type: "audio", chunk, requestId: req.requestId });

    Logger.info(`[CONTROLLER] Audio chunk saved successfully - Request ID: ${req.requestId}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    Logger.error(`[CONTROLLER] Audio chunk error - Request ID: ${req.requestId}:`, err);
    res.status(500).json({ error: "Failed to save audio chunk" });
  }
};

exports.processRecording = async (req, res) => {
  try {
    const events = req.body.events ? JSON.parse(req.body.events) : [];
    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};

    const videoPath = req.files?.video?.[0]?.path;
    let audioPath = req.files?.audio?.[0]?.path;

    if (!audioPath) {
      audioPath = recordingService.getStreamFilePath("audio");
    }

    let transcribedText = null;
    let pythonResponse = null;

    // Deepgram transcription
    if (audioPath && fs.existsSync(audioPath)) {
      try {
        Logger.info(`[Recording Controller] Processing audio file: ${audioPath}`);

        const transcription = await DeepgramService.transcribeAudio(audioPath, {
          model: "nova-2",
          language: "en-US",
          punctuate: true,
        });

        transcribedText = transcription.text;

        Logger.info(`[Recording Controller] Transcribed text from Deepgram:`);
        Logger.info(`[Recording Controller] Text: "${transcribedText}"`);
        Logger.info(`[Recording Controller] Confidence: ${transcription.confidence}`);
        Logger.info(`[Recording Controller] Metadata: ${JSON.stringify(transcription.metadata)}`);

        if (transcribedText.trim().length > 0) {
          try {
            Logger.info(`[Recording Controller] Sending transcribed text to Python layer`);
            pythonResponse = await PythonService.sendTextWithDomEvents(
              transcribedText,
              events,
              metadata
            );
            Logger.info(`[Recording Controller] Successfully sent data to Python layer`);
          } catch (pythonError) {
            Logger.error(`[Recording Controller] Error sending to Python layer: ${pythonError}`);
          }
        } else {
          Logger.warn(`[Recording Controller] Transcribed text is empty, skipping Python layer`);
        }
      } catch (deepgramError) {
        Logger.error(`[Recording Controller] Error processing audio with Deepgram: ${deepgramError}`);
      }
    } else {
      Logger.warn(`[Recording Controller] No audio file found, skipping Deepgram transcription`);
    }

    // Finalize video/audio & save JSON
    const result = await recordingService.processRecording({
      events,
      metadata,
      videoPath,
      audioPath,
    });

    if (transcribedText) {
      result.transcription = {
        text: transcribedText,
        sentToPython: pythonResponse !== null,
      };
    }

    // Note: Files are now managed by the service layer
    // They are moved to the recordings directory with proper naming
    // No need to delete them here

    return res.status(200).json(result);
  } catch (err) {
    Logger.error("Process recording error:", err);
    res.status(500).json({
      error: "Failed to process recording",
      message: err.message,
    });
  }
};
