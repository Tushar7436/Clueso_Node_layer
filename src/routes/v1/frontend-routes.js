const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const router = express.Router();
const frontendController = require("../../controllers/frontend-controller");

// Configure multer for audio uploads from Python
const audioStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, "../../../uploads");
        if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, `audio_${Date.now()}.mp3`);
    }
});
const uploadAudio = multer({ storage: audioStorage });

// Configure multer for video uploads (screen recordings) from Python
const videoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const recordingsPath = path.join(__dirname, "../../../recordings");
        if (!fs.existsSync(recordingsPath)) fs.mkdirSync(recordingsPath, { recursive: true });
        cb(null, recordingsPath);
    },
    filename: (req, file, cb) => {
        cb(null, `recording_${Date.now()}.webm`);
    }
});
const uploadVideo = multer({ storage: videoStorage });

/**
 * Python sends instructions to this endpoint
 * Body: { sessionId: string, instructions: object }
 */
router.post("/send-instructions", frontendController.sendInstructions);

/**
 * Python sends audio to this endpoint
 * Form data: sessionId (string), text (string), audio (file)
 */
router.post("/send-audio", uploadAudio.single("audio"), frontendController.sendAudio);

/**
 * Python sends screen recording video to this endpoint
 * Form data: sessionId (string), metadata (JSON string), video (file)
 */
router.post("/send-video", uploadVideo.single("video"), frontendController.sendVideo);

/**
 * Check if a session has an active frontend connection
 */
router.get("/session/:sessionId/status", frontendController.checkSession);

/**
 * Demo endpoint to send test data to frontend
 * GET /api/frontend/demo-data
 * Sends existing recording files to frontend via WebSocket for testing
 */
router.get("/demo-data", frontendController.sendDemoData);

/**
 * Store DOM events for a session (for fallback when Python fails)
 * POST /api/frontend/store-dom-events
 * Body: { sessionId: string, events: Array }
 */
router.post("/store-dom-events", frontendController.storeDomEvents);

/**
 * Trigger fallback to send DOM events as instructions
 * POST /api/frontend/trigger-fallback
 * Body: { sessionId: string }
 */
router.post("/trigger-fallback", frontendController.triggerFallback);

module.exports = router;

