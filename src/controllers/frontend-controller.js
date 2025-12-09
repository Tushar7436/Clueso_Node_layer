const frontendService = require("../services/frontend-service");
const { Logger } = require("../config");

/**
 * Receive instructions from Python layer and forward to frontend
 */
exports.sendInstructions = async (req, res) => {
    try {
        const { sessionId, instructions } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: "Session ID is required"
            });
        }

        if (!instructions) {
            return res.status(400).json({
                success: false,
                error: "Instructions are required"
            });
        }

        Logger.info(`[Frontend Controller] Received instructions for session: ${sessionId}`);
        Logger.debug(`[Frontend Controller] Instructions:`, instructions);

        // Send to frontend via WebSocket
        const sent = frontendService.sendInstructions(sessionId, instructions);

        if (!sent) {
            return res.status(404).json({
                success: false,
                error: `No frontend client connected for session: ${sessionId}`
            });
        }

        return res.status(200).json({
            success: true,
            message: "Instructions sent to frontend",
            sessionId
        });
    } catch (err) {
        Logger.error("[Frontend Controller] Error sending instructions:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to send instructions",
            message: err.message
        });
    }
};

/**
 * Receive audio from Python layer and forward to frontend
 */
exports.sendAudio = async (req, res) => {
    try {
        const { sessionId, text } = req.body;
        const audioFile = req.file;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: "Session ID is required"
            });
        }

        if (!audioFile) {
            return res.status(400).json({
                success: false,
                error: "Audio file is required"
            });
        }

        Logger.info(`[Frontend Controller] Received audio for session: ${sessionId}`);
        Logger.info(`[Frontend Controller] Audio file: ${audioFile.filename}`);
        Logger.info(`[Frontend Controller] Text: ${text}`);

        // Prepare audio data for frontend
        const audioData = {
            filename: audioFile.filename,
            path: `/uploads/${audioFile.filename}`, // URL path for frontend to access
            text: text || "",
            timestamp: new Date().toISOString()
        };

        // Send to frontend via WebSocket
        const sent = frontendService.sendAudio(sessionId, audioData);

        if (!sent) {
            return res.status(404).json({
                success: false,
                error: `No frontend client connected for session: ${sessionId}`
            });
        }

        return res.status(200).json({
            success: true,
            message: "Audio sent to frontend",
            sessionId,
            audioData
        });
    } catch (err) {
        Logger.error("[Frontend Controller] Error sending audio:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to send audio",
            message: err.message
        });
    }
};

/**
 * Receive screen recording video from Python layer and forward to frontend
 */
exports.sendVideo = async (req, res) => {
    try {
        const { sessionId, metadata } = req.body;
        const videoFile = req.file;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: "Session ID is required"
            });
        }

        if (!videoFile) {
            return res.status(400).json({
                success: false,
                error: "Video file is required"
            });
        }

        Logger.info(`[Frontend Controller] Received screen recording for session: ${sessionId}`);
        Logger.info(`[Frontend Controller] Video file: ${videoFile.filename}`);
        Logger.info(`[Frontend Controller] Metadata: ${metadata}`);

        // Prepare video data for frontend
        const videoData = {
            filename: videoFile.filename,
            path: `/recordings/${videoFile.filename}`, // URL path for frontend to access
            metadata: metadata ? JSON.parse(metadata) : {},
            timestamp: new Date().toISOString()
        };

        // Send to frontend via WebSocket
        const sent = frontendService.sendVideo(sessionId, videoData);

        if (!sent) {
            return res.status(404).json({
                success: false,
                error: `No frontend client connected for session: ${sessionId}`
            });
        }

        return res.status(200).json({
            success: true,
            message: "Screen recording sent to frontend",
            sessionId,
            videoData
        });
    } catch (err) {
        Logger.error("[Frontend Controller] Error sending video:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to send video",
            message: err.message
        });
    }
};

/**
 * Check if a session has an active frontend connection
 */
exports.checkSession = async (req, res) => {
    try {
        const { sessionId } = req.params;

        const isActive = frontendService.isSessionActive(sessionId);

        return res.status(200).json({
            success: true,
            sessionId,
            isActive,
            activeSessionCount: frontendService.getActiveSessionCount()
        });
    } catch (err) {
        Logger.error("[Frontend Controller] Error checking session:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to check session",
            message: err.message
        });
    }
};

/**
 * Send demo/test data to frontend for testing purposes
 * Uses existing recording files to avoid needing to record new sessions
 */
exports.sendDemoData = async (req, res) => {
    try {
        const path = require('path');
        const fs = require('fs');

        // Configuration - Use existing session files
        const TEST_SESSION = {
            sessionId: 'session_1765089986708_lyv7icnrb',
            videoFile: 'recording_session_1765089986708_lyv7icnrb_video.webm',
            audioFile: 'processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm',
            eventsFile: 'recording_session_1765089986708_lyv7icnrb_1765090028574.json'
        };

        // File paths
        const VIDEO_PATH = path.join(__dirname, '../../src/recordings', TEST_SESSION.videoFile);
        const AUDIO_PATH = path.join(__dirname, '../../recordings', TEST_SESSION.audioFile);
        const EVENTS_PATH = path.join(__dirname, '../../src/recordings', TEST_SESSION.eventsFile);

        Logger.info('[Frontend Controller] Sending demo data to frontend');
        Logger.info(`[Frontend Controller] Session ID: ${TEST_SESSION.sessionId}`);

        // Verify files exist
        if (!fs.existsSync(VIDEO_PATH)) {
            Logger.error(`[Frontend Controller] Video file not found: ${VIDEO_PATH}`);
            return res.status(404).json({
                success: false,
                error: 'Video file not found',
                path: VIDEO_PATH
            });
        }
        if (!fs.existsSync(AUDIO_PATH)) {
            Logger.error(`[Frontend Controller] Audio file not found: ${AUDIO_PATH}`);
            return res.status(404).json({
                success: false,
                error: 'Audio file not found',
                path: AUDIO_PATH
            });
        }
        if (!fs.existsSync(EVENTS_PATH)) {
            Logger.error(`[Frontend Controller] Events file not found: ${EVENTS_PATH}`);
            return res.status(404).json({
                success: false,
                error: 'Events file not found',
                path: EVENTS_PATH
            });
        }

        // Load events from JSON file
        const eventsData = JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8'));
        const events = eventsData.events || [];
        const metadata = {
            sessionId: eventsData.sessionId,
            startTime: eventsData.startTime,
            endTime: eventsData.endTime,
            url: eventsData.url,
            viewport: eventsData.viewport
        };

        Logger.info(`[Frontend Controller] Loaded ${events.length} events from JSON`);

        // 1. Send Video
        Logger.info('[Frontend Controller] Sending video to frontend...');
        const videoData = {
            filename: TEST_SESSION.videoFile,
            path: `/recordings/${TEST_SESSION.videoFile}`,
            metadata: metadata,
            timestamp: new Date().toISOString()
        };
        frontendService.sendVideo(TEST_SESSION.sessionId, videoData);

        // 2. Send Audio
        Logger.info('[Frontend Controller] Sending audio to frontend...');
        const audioData = {
            filename: TEST_SESSION.audioFile,
            path: `/recordings/${TEST_SESSION.audioFile}`,
            text: "Hello, guys. This is Tushar, and this is my website on Vercel.",
            timestamp: new Date().toISOString()
        };
        frontendService.sendAudio(TEST_SESSION.sessionId, audioData);

        // 3. Send Instructions (Events)
        Logger.info(`[Frontend Controller] Sending ${events.length} instructions to frontend...`);
        events.forEach((event, index) => {
            frontendService.sendInstructions(TEST_SESSION.sessionId, event);
        });

        Logger.info('[Frontend Controller] Demo data sent successfully');

        return res.status(200).json({
            success: true,
            message: 'Demo data sent to frontend via WebSocket',
            sessionId: TEST_SESSION.sessionId,
            data: {
                video: {
                    filename: TEST_SESSION.videoFile,
                    path: videoData.path,
                    size: `${(fs.statSync(VIDEO_PATH).size / 1024 / 1024).toFixed(2)} MB`
                },
                audio: {
                    filename: TEST_SESSION.audioFile,
                    path: audioData.path,
                    size: `${(fs.statSync(AUDIO_PATH).size / 1024 / 1024).toFixed(2)} MB`,
                    text: audioData.text
                },
                instructions: {
                    count: events.length,
                    types: [...new Set(events.map(e => e.type))]
                }
            },
            note: 'Data sent via WebSocket. Frontend should register with sessionId to receive it.',
            frontendConnection: `socket.emit('register', '${TEST_SESSION.sessionId}')`
        });
    } catch (err) {
        Logger.error("[Frontend Controller] Error sending demo data:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to send demo data",
            message: err.message
        });
    }
};

/**
 * Store DOM events for a session (for fallback when Python fails)
 */
exports.storeDomEvents = async (req, res) => {
    try {
        const { sessionId, events } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: "Session ID is required"
            });
        }

        if (!events || !Array.isArray(events)) {
            return res.status(400).json({
                success: false,
                error: "Events array is required"
            });
        }

        Logger.info(`[Frontend Controller] Storing ${events.length} DOM events for session: ${sessionId}`);

        const stored = frontendService.storeDomEvents(sessionId, events);

        if (!stored) {
            return res.status(500).json({
                success: false,
                error: "Failed to store DOM events"
            });
        }

        return res.status(200).json({
            success: true,
            message: "DOM events stored successfully",
            sessionId,
            eventsCount: events.length
        });
    } catch (err) {
        Logger.error("[Frontend Controller] Error storing DOM events:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to store DOM events",
            message: err.message
        });
    }
};

/**
 * Trigger fallback to send DOM events as instructions
 */
exports.triggerFallback = async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: "Session ID is required"
            });
        }

        Logger.info(`[Frontend Controller] Triggering DOM events fallback for session: ${sessionId}`);

        const sent = frontendService.sendDomEventsAsFallback(sessionId);

        if (!sent) {
            return res.status(404).json({
                success: false,
                error: `No DOM events available or Python instructions already received for session: ${sessionId}`
            });
        }

        return res.status(200).json({
            success: true,
            message: "DOM events sent as fallback instructions",
            sessionId
        });
    } catch (err) {
        Logger.error("[Frontend Controller] Error triggering fallback:", err);
        return res.status(500).json({
            success: false,
            error: "Failed to trigger fallback",
            message: err.message
        });
    }
};


