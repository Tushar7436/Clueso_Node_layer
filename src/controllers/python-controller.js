// Controller for Python AI processing
const PythonService = require("../services/python-service");
const { Logger } = require("../config");
const path = require("path");
const fs = require("fs");

/**
 * Process text with AI (Python service)
 * This controller can be used by recording flow, chat, or any other feature
 * 
 * @param {string} text - Text to process
 * @param {Array} events - DOM events from extension (optional for chat)
 * @param {object} metadata - Session metadata
 * @param {object} deepgramResponse - Full Deepgram JSON response (optional)
 * @param {string} sessionId - Session ID for broadcasting
 * @param {string} audioPath - Path to raw audio file (optional)
 * @returns {Promise<object|null>} Python response or null if failed
 */
exports.processWithAI = async (text, events = [], metadata = {}, deepgramResponse = null, sessionId = null, audioPath = null) => {
    try {
        if (!text || text.trim().length === 0) {
            Logger.warn(`[Python Controller] Text is empty, skipping AI processing`);
            return null;
        }

        Logger.info(`[Python Controller] Processing with AI:`);
        Logger.info(`[Python Controller] - Text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
        Logger.info(`[Python Controller] - DOM Events: ${events.length}`);
        Logger.info(`[Python Controller] - Has Deepgram Response: ${!!deepgramResponse}`);
        Logger.info(`[Python Controller] - Audio Path: ${audioPath || 'none'}`);
        Logger.info(`[Python Controller] - Session ID: ${sessionId || 'none'}`);

        // Send to Python service
        const pythonResponse = await PythonService.sendTextWithDomEvents(
            deepgramResponse?.raw || deepgramResponse, // Pass raw Deepgram JSON
            events,
            metadata
        );

        Logger.info(`[Python Controller] Successfully received response from Python layer`);
        Logger.info(`[Python Controller] Python response:`, JSON.stringify(pythonResponse));

        // Broadcast results to frontend if sessionId is provided
        if (sessionId) {
            const frontendService = require("../services/frontend-service");

            // 1-3. Consolidate and Broadcast results as a single bulk message
            if (pythonResponse) {
                const consolidatedInstructions = {
                    instructions: pythonResponse.instructions || [],
                    displayEffects: (pythonResponse.displayEffects || []).map(effect => ({ type: 'displayEffect', ...effect })),
                    narrations: pythonResponse.narrations || []
                };

                Logger.info(`[Python Controller] Broadcasting consolidated results to frontend (${consolidatedInstructions.instructions.length} inst, ${consolidatedInstructions.displayEffects.length} effects, ${consolidatedInstructions.narrations.length} narrations)`);

                frontendService.sendInstructions(sessionId, consolidatedInstructions, 'python');
            } else if (events && events.length > 0) {
                // Fallback: Send DOM events as instructions if Python didn't return any
                Logger.info(`[Python Controller] No response from Python, using DOM events as fallback`);
                frontendService.sendInstructions(sessionId, { events }, 'dom');
            }

            // 4. Handle processed audio (audioFile)
            if (pythonResponse && pythonResponse.audioFile) {
                const audioPath = pythonResponse.audioFile.startsWith('/') ? pythonResponse.audioFile : `/${pythonResponse.audioFile}`;
                const audioUrl = `${PythonService.pythonBaseUrl}${audioPath}`;
                Logger.info(`[Python Controller] Broadcasting audio from Python: ${audioUrl}`);

                frontendService.sendAudio(sessionId, {
                    filename: pythonResponse.audioFile,
                    path: audioUrl,
                    text: text,
                    timestamp: new Date().toISOString()
                });
            } else if (audioPath && fs.existsSync(audioPath)) {
                // Fallback to raw audio if Python didn't return one
                Logger.info(`[Python Controller] Using raw audio as fallback`);
                frontendService.sendAudio(sessionId, {
                    filename: path.basename(audioPath),
                    path: `/recordings/${path.basename(audioPath)}`,
                    text: text,
                    timestamp: new Date().toISOString()
                });
            }
        }

        return pythonResponse;
    } catch (pythonError) {
        Logger.error(`[Python Controller] Error processing with AI: ${pythonError}`);

        // Notify frontend of AI failure if sessionId is provided
        if (sessionId) {
            const frontendService = require("../services/frontend-service");
            frontendService.sendInstructions(sessionId, {
                action: "error",
                target: "AI Processing Failed",
                metadata: { error: pythonError.message || "Failed to connect to AI engine" }
            });
        }

        return null;
    }
};

/**
 * Process chat message with AI
 * Simplified wrapper for chat applications
 * 
 * @param {object} req - Express request
 * @param {object} res - Express response
 */
exports.processChatMessage = async (req, res) => {
    try {
        const { text, sessionId, events = [] } = req.body;

        if (!text) {
            return res.status(400).json({ error: "Text is required" });
        }

        if (!sessionId) {
            return res.status(400).json({ error: "Session ID is required" });
        }

        Logger.info(`[Python Controller] Processing chat message for session: ${sessionId}`);

        const metadata = {
            sessionId,
            source: 'chat',
            timestamp: new Date().toISOString(),
            ...req.body.metadata
        };

        const result = await exports.processWithAI(
            text,
            events,
            metadata,
            null, // No Deepgram response for chat
            sessionId,
            null  // No audio for chat
        );

        if (result) {
            return res.status(200).json({
                success: true,
                response: result
            });
        } else {
            return res.status(500).json({
                success: false,
                error: "AI processing failed"
            });
        }
    } catch (err) {
        Logger.error("[Python Controller] Chat message error:", err);
        res.status(500).json({
            error: "Failed to process chat message",
            message: err.message,
        });
    }
};
