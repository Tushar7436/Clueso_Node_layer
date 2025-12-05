const fs = require("fs");
const path = require("path");

const uploadDir = path.join(__dirname, "..", "uploads");
const recordingsDir = path.join(__dirname, "..", "recordings");

// Ensure folders exist
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

let videoFile = null;
let audioFile = null;
let videoFilePath = null;
let audioFilePath = null;

const getFileStream = (type) => {
  if (type === "video") {
    if (!videoFile) {
      const filename = `video_${Date.now()}.webm`;
      videoFilePath = path.join(uploadDir, filename);
      videoFile = fs.createWriteStream(videoFilePath);
      console.log("Created video file:", filename);
    }
    return videoFile;
  }

  if (type === "audio") {
    if (!audioFile) {
      const filename = `audio_${Date.now()}.webm`;
      audioFilePath = path.join(uploadDir, filename);
      audioFile = fs.createWriteStream(audioFilePath);
      console.log("Created audio file:", filename);
    }
    return audioFile;
  }
};

/**
 * Finalize and close the stream for a given type
 * Returns the file path if the stream exists
 */
const finalizeStream = (type) => {
  return new Promise((resolve, reject) => {
    if (type === "video" && videoFile) {
      videoFile.end(() => {
        const path = videoFilePath;
        videoFile = null;
        videoFilePath = null;
        resolve(path);
      });
    } else if (type === "audio" && audioFile) {
      audioFile.end(() => {
        const path = audioFilePath;
        audioFile = null;
        audioFilePath = null;
        resolve(path);
      });
    } else {
      resolve(null);
    }
  });
};

/**
 * Get the file path for a stream type without finalizing it
 * Returns the file path if the stream exists
 */
exports.getStreamFilePath = (type) => {
  if (type === "video" && videoFilePath) {
    return videoFilePath;
  } else if (type === "audio" && audioFilePath) {
    return audioFilePath;
  }
  return null;
};

exports.saveChunk = async ({ type, chunk }) => {
  return new Promise((resolve, reject) => {
    try {
      const stream = getFileStream(type);
      stream.write(Buffer.from(chunk), (err) => {
        if (err) return reject(err);
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
};

exports.processRecording = async ({ events, metadata, videoPath, audioPath }) => {
  try {
    console.log(`[recording-service] Processing ${events.length} events for session: ${metadata.sessionId}`);
    
    // If no audio path provided, try to get it from stream
    let finalAudioPath = audioPath;
    if (!finalAudioPath) {
      finalAudioPath = await finalizeStream("audio");
    }
    
    // If no video path provided, try to get it from stream
    let finalVideoPath = videoPath;
    if (!finalVideoPath) {
      finalVideoPath = await finalizeStream("video");
    }
    
    // Create recording data object
    const recordingData = {
      sessionId: metadata.sessionId,
      startTime: metadata.startTime,
      endTime: metadata.endTime,
      url: metadata.url,
      viewport: metadata.viewport,
      events: events,
      videoPath: finalVideoPath || null,
      audioPath: finalAudioPath || null,
      processedAt: new Date().toISOString()
    };
    
    // Save to JSON file
    const filename = `recording_${metadata.sessionId}_${Date.now()}.json`;
    const filePath = path.join(recordingsDir, filename);
    
    fs.writeFileSync(filePath, JSON.stringify(recordingData, null, 2), 'utf8');
    
    console.log(`[recording-service] Saved recording data to: ${filename}`);
    
    // Return success response
    return {
      success: true,
      sessionId: metadata.sessionId,
      filename: filename,
      eventsProcessed: events.length,
      message: "Recording saved successfully",
      audioPath: finalAudioPath,
      videoPath: finalVideoPath
    };
  } catch (err) {
    console.error("[recording-service] Error processing recording:", err);
    throw err;
  }
};
