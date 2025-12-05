const express = require("express");
const router = express.Router();
const recordingController = require("../../controllers/recording-controller");

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

router.post("/video-chunk", rawParser, recordingController.uploadVideoChunk);
router.post("/audio-chunk", rawParser, recordingController.uploadAudioChunk);
router.post("/process-recording", upload.fields([
  { name: "events", maxCount: 1 },
  { name: "video", maxCount: 1 },
  { name: "audio", maxCount: 1 },
  { name: "metadata", maxCount: 1 }
]), recordingController.processRecording);

module.exports = router;

