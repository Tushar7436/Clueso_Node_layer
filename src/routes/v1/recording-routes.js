const express = require("express");
const router = express.Router();
const recordingController = require("../../controllers/recording-controller");

// Logging middleware to track requests
const requestLogger = (req, res, next) => {
  const requestId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  req.requestId = requestId;

  console.log(`[ROUTE] ${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log(`[ROUTE] Request ID: ${requestId}`);
  console.log(`[ROUTE] Content-Type: ${req.headers['content-type']}`);
  console.log(`[ROUTE] Content-Length: ${req.headers['content-length']} bytes`);

  next();
};

// RAW BINARY PARSER ONLY for these routes
const rawParser = express.raw({ type: "application/octet-stream", limit: "200mb" });

// Multer for multipart/form-data (for DOM events)
const multer = require("multer");
const upload = multer({
  dest: "uploads/",
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit
  }
});

router.post("/video-chunk", requestLogger, rawParser, recordingController.uploadVideoChunk);
router.post("/audio-chunk", requestLogger, rawParser, recordingController.uploadAudioChunk);
router.post("/process-recording", upload.fields([
  { name: "events", maxCount: 1 },
  { name: "video", maxCount: 1 },
  { name: "audio", maxCount: 1 },
  { name: "metadata", maxCount: 1 }
]), recordingController.processRecording);

module.exports = router;

