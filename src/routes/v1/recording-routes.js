// routes/recording-routes.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const recordingController = require("../../controllers/recording-controller");

// Multer for chunk uploads with FormData
const chunkUpload = multer({
  storage: multer.memoryStorage(),  // Keep in memory
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB per chunk
});

const requestLogger = (req, res, next) => {
  const requestId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  req.requestId = requestId;
  console.log(`[ROUTE] ${new Date().toISOString()} - ${req.method} ${req.path}`);
  console.log(`[ROUTE] Request ID: ${requestId}`);
  next();
};

// CHANGED: Use multer instead of raw parser
router.post("/video-chunk",
  requestLogger,
  chunkUpload.single('chunk'),  // ← Changed
  recordingController.uploadVideoChunk
);

router.post("/audio-chunk",
  requestLogger,
  chunkUpload.single('chunk'),  // ← Changed
  recordingController.uploadAudioChunk
);

router.post("/process-recording",
  multer({
    dest: "uploads/",
    limits: {
      fileSize: 100 * 1024 * 1024,  // 100MB for files
      fieldSize: 50 * 1024 * 1024    // 50MB for field values (events, metadata)
    }
  }).fields([
    { name: "events", maxCount: 1 },
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 },
    { name: "metadata", maxCount: 1 }
  ]),
  recordingController.processRecording
);

module.exports = router;