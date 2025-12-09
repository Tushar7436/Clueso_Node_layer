// Routes for Python AI processing
const express = require('express');
const router = express.Router();
const pythonController = require('../../controllers/python-controller');

/**
 * POST /api/python/process
 * Process text with AI (can be used by chat or any other feature)
 * 
 * Body:
 * - text: string (required)
 * - sessionId: string (required)
 * - events: array (optional, DOM events)
 * - metadata: object (optional)
 * - deepgramResponse: object (optional, full Deepgram JSON)
 * - audioPath: string (optional, path to raw audio)
 */
router.post('/process', pythonController.processWithAI);

/**
 * POST /api/python/chat
 * Process chat message with AI
 * Simplified endpoint for chat applications
 * 
 * Body:
 * - text: string (required)
 * - sessionId: string (required)
 * - events: array (optional)
 * - metadata: object (optional)
 */
router.post('/chat', pythonController.processChatMessage);

module.exports = router;
