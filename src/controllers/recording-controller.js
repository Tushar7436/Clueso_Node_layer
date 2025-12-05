// Controller - Add to recording-controller.js
const fs = require("fs");
const recordingService = require("../services/recording-service");
const { DeepgramService, PythonService } = require("../services");
const { Logger } = require("../config");

exports.uploadVideoChunk = async (req, res) => {
  try {
    const chunk = req.body; // <-- this is a Buffer now
    await recordingService.saveChunk({ type: "video", chunk });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Video chunk error:", err);
    res.status(500).json({ error: "Failed to save video chunk" });
  }
};

exports.uploadAudioChunk = async (req, res) => {
  try {
    const chunk = req.body; // raw binary
    await recordingService.saveChunk({
      type: "audio",
      chunk
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Audio chunk error:", err);
    res.status(500).json({ error: "Failed to save audio chunk" });
  }
};

exports.processRecording = async (req, res) => {
  try {
    // Parse events and metadata from form data
    const events = req.body.events ? JSON.parse(req.body.events) : [];
    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};
    
    // Get file paths if video/audio files were uploaded
    const videoPath = req.files?.video?.[0]?.path;
    let audioPath = req.files?.audio?.[0]?.path;
    
    // If no audio path from upload, check if there's a stream file
    if (!audioPath) {
      audioPath = recordingService.getStreamFilePath("audio");
    }
    
    let transcribedText = null;
    let pythonResponse = null;
    
    // If audio file is available, process it with Deepgram
    if (audioPath && fs.existsSync(audioPath)) {
      try {
        Logger.info(`[Recording Controller] Processing audio file: ${audioPath}`);
        
        // Step 1: Transcribe audio using Deepgram
        const transcription = await DeepgramService.transcribeAudio(audioPath, {
          model: 'nova-2',
          language: 'en-US',
          punctuate: true
        });
        
        transcribedText = transcription.text;
        
        // Log the transcribed text
        Logger.info(`[Recording Controller] Transcribed text from Deepgram:`);
        Logger.info(`[Recording Controller] Text: "${transcribedText}"`);
        Logger.info(`[Recording Controller] Confidence: ${transcription.confidence}`);
        Logger.info(`[Recording Controller] Metadata:`, transcription.metadata);
        
        // Step 2: Send transcribed text with DOM events to Python layer
        if (transcribedText && transcribedText.trim().length > 0) {
          try {
            Logger.info(`[Recording Controller] Sending transcribed text to Python layer`);
            pythonResponse = await PythonService.sendTextWithDomEvents(
              transcribedText,
              events,
              metadata
            );
            Logger.info(`[Recording Controller] Successfully sent data to Python layer`);
          } catch (pythonError) {
            Logger.error(`[Recording Controller] Error sending to Python layer:`, pythonError);
            // Don't fail the entire request if Python layer fails
            // Continue with recording processing
          }
        } else {
          Logger.warn(`[Recording Controller] Transcribed text is empty, skipping Python layer`);
        }
      } catch (deepgramError) {
        Logger.error(`[Recording Controller] Error processing audio with Deepgram:`, deepgramError);
        // Don't fail the entire request if Deepgram fails
        // Continue with recording processing
      }
    } else {
      Logger.warn(`[Recording Controller] No audio file found, skipping Deepgram transcription`);
    }
    
    // Process recording through service (finalizes streams and saves recording)
    const result = await recordingService.processRecording({
      events,
      metadata,
      videoPath,
      audioPath
    });
    
    // Add transcription info to result
    if (transcribedText) {
      result.transcription = {
        text: transcribedText,
        sentToPython: pythonResponse !== null
      };
    }
    
    // Clean up uploaded files
    const finalVideoPath = result.videoPath || videoPath;
    if (finalVideoPath && fs.existsSync(finalVideoPath)) {
      fs.unlink(finalVideoPath, (err) => {
        if (err) console.error("[controller] Error deleting video file:", err);
      });
    }
    if (audioPath && fs.existsSync(audioPath)) {
      fs.unlink(audioPath, (err) => {
        if (err) console.error("[controller] Error deleting audio file:", err);
      });
    }
    
    return res.status(200).json(result);
  } catch (err) {
    Logger.error("Process recording error:", err);
    res.status(500).json({ 
      error: "Failed to process recording", 
      message: err.message 
    });
  }
};