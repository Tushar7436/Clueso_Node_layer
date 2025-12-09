const { Server } = require("socket.io");
const { Logger } = require("../config");

class FrontendService {
    constructor() {
        this.io = null;
        this.sessions = new Map(); // sessionId -> socket
        this.messageQueue = new Map(); // sessionId -> [messages]
        this.sessionDomEvents = new Map(); // sessionId -> DOM events array (for fallback)
        this.pythonInstructionsReceived = new Map(); // sessionId -> boolean (track if Python sent instructions)
    }

    /**
     * Initialize Socket.IO server
     * @param {object} httpServer - HTTP server instance
     */
    initialize(httpServer) {
        this.io = new Server(httpServer, {
            cors: {
                origin: "*", // Configure this based on your frontend URL
                methods: ["GET", "POST"]
            }
        });

        this.io.on("connection", (socket) => {
            Logger.info(`[Frontend Service] Client connected: ${socket.id}`);

            // Handle session registration
            socket.on("register", (sessionId) => {
                if (!sessionId) {
                    Logger.warn(`[Frontend Service] Client ${socket.id} tried to register without sessionId`);
                    socket.emit("error", { message: "Session ID is required" });
                    return;
                }

                // Check if session already has a client
                if (this.sessions.has(sessionId)) {
                    const existingSocket = this.sessions.get(sessionId);
                    Logger.warn(`[Frontend Service] Session ${sessionId} already has a client, disconnecting old client`);
                    existingSocket.disconnect();
                }

                // Register new session
                this.sessions.set(sessionId, socket);
                socket.sessionId = sessionId;
                Logger.info(`[Frontend Service] Client ${socket.id} registered for session: ${sessionId}`);

                socket.emit("registered", { sessionId, message: "Successfully registered" });

                // Flush queued messages
                this._flushQueue(sessionId, socket);

                // Auto-send demo data for test session
                const DEMO_SESSION_ID = 'session_1765089986708_lyv7icnrb';
                if (sessionId === DEMO_SESSION_ID) {
                    Logger.info(`[Frontend Service] Demo session detected, auto-sending demo data...`);

                    // Trigger demo data send after a short delay to ensure client is ready
                    setTimeout(() => {
                        this._sendDemoData(sessionId);
                    }, 500);
                }
            });

            // Handle disconnect
            socket.on("disconnect", () => {
                if (socket.sessionId) {
                    this.sessions.delete(socket.sessionId);
                    Logger.info(`[Frontend Service] Client disconnected and removed from session: ${socket.sessionId}`);
                } else {
                    Logger.info(`[Frontend Service] Unregistered client disconnected: ${socket.id}`);
                }
            });
        });

        Logger.info("[Frontend Service] Socket.IO server initialized");
    }

    /**
     * Send instructions to frontend client
     * @param {string} sessionId - Session ID
     * @param {object} instructions - Instructions data from Python or DOM events
     * @param {string} source - Source of instructions: 'python' or 'dom' (default: 'python')
     */
    sendInstructions(sessionId, instructions, source = 'python') {
        const socket = this.sessions.get(sessionId);

        if (!socket) {
            Logger.warn(`[Frontend Service] No client connected for session: ${sessionId}. Buffering instructions.`);
            this._queueMessage(sessionId, "instructions", instructions);
            return true; // Return true because we buffered it
        }

        // Track if Python instructions were received
        if (source === 'python') {
            this.pythonInstructionsReceived.set(sessionId, true);
            Logger.info(`[Frontend Service] Sending Python-processed instructions to session: ${sessionId}`);
        } else {
            Logger.info(`[Frontend Service] Sending DOM event as instruction to session: ${sessionId} (fallback)`);
        }

        socket.emit("instructions", instructions);
        return true;
    }

    /**
     * Send audio data to frontend client
     * @param {string} sessionId - Session ID
     * @param {object} audioData - Audio data from Python (filename, text, etc.)
     */
    sendAudio(sessionId, audioData) {
        const socket = this.sessions.get(sessionId);

        if (!socket) {
            Logger.warn(`[Frontend Service] No client connected for session: ${sessionId}. Buffering audio.`);
            this._queueMessage(sessionId, "audio", audioData);
            return true;
        }

        Logger.info(`[Frontend Service] Sending audio to session: ${sessionId}`);
        socket.emit("audio", audioData);
        return true;
    }

    /**
     * Send screen recording video to frontend client
     * @param {string} sessionId - Session ID
     * @param {object} videoData - Video data from Python (filename, path, etc.)
     */
    sendVideo(sessionId, videoData) {
        const socket = this.sessions.get(sessionId);

        if (!socket) {
            Logger.warn(`[Frontend Service] No client connected for session: ${sessionId}. Buffering video.`);
            this._queueMessage(sessionId, "video", videoData);
            return true;
        }

        Logger.info(`[Frontend Service] Sending screen recording to session: ${sessionId}`);
        socket.emit("video", videoData);
        return true;
    }

    /**
     * Helper to queue messages
     */
    _queueMessage(sessionId, type, data) {
        if (!this.messageQueue.has(sessionId)) {
            this.messageQueue.set(sessionId, []);
        }
        this.messageQueue.get(sessionId).push({ type, data, timestamp: Date.now() });
        Logger.info(`[Frontend Service] Buffered ${type} message for session: ${sessionId}. Queue size: ${this.messageQueue.get(sessionId).length}`);
    }

    /**
     * Helper to flush queued messages
     */
    _flushQueue(sessionId, socket) {
        if (this.messageQueue.has(sessionId)) {
            const queue = this.messageQueue.get(sessionId);
            if (queue.length > 0) {
                Logger.info(`[Frontend Service] Flushing ${queue.length} buffered messages for session: ${sessionId}`);

                queue.forEach(msg => {
                    Logger.info(`[Frontend Service] Sending buffered ${msg.type} to session: ${sessionId}`);
                    socket.emit(msg.type, msg.data);
                });

                // Clear queue
                this.messageQueue.delete(sessionId);
            }
        }
    }

    /**
     * Check if a session has an active connection
     * @param {string} sessionId - Session ID
     * @returns {boolean}
     */
    isSessionActive(sessionId) {
        return this.sessions.has(sessionId);
    }

    /**
     * Get count of active sessions
     * @returns {number}
     */
    getActiveSessionCount() {
        return this.sessions.size;
    }

    /**
     * Disconnect a specific session
     * @param {string} sessionId - Session ID
     */
    disconnectSession(sessionId) {
        const socket = this.sessions.get(sessionId);
        if (socket) {
            socket.disconnect();
            this.sessions.delete(sessionId);
            // Clean up session data
            this.sessionDomEvents.delete(sessionId);
            this.pythonInstructionsReceived.delete(sessionId);
            Logger.info(`[Frontend Service] Manually disconnected session: ${sessionId}`);
            return true;
        }
        return false;
    }

    /**
     * Store DOM events for a session (for fallback)
     * @param {string} sessionId - Session ID
     * @param {Array} events - Array of DOM events
     */
    storeDomEvents(sessionId, events) {
        if (!events || !Array.isArray(events)) {
            Logger.warn(`[Frontend Service] Invalid events provided for session: ${sessionId}`);
            return false;
        }

        this.sessionDomEvents.set(sessionId, events);
        Logger.info(`[Frontend Service] Stored ${events.length} DOM events for session: ${sessionId}`);
        return true;
    }

    /**
     * Get stored DOM events for a session
     * @param {string} sessionId - Session ID
     * @returns {Array|null} - DOM events or null if not found
     */
    getDomEvents(sessionId) {
        return this.sessionDomEvents.get(sessionId) || null;
    }

    /**
     * Check if Python instructions were received for a session
     * @param {string} sessionId - Session ID
     * @returns {boolean}
     */
    hasPythonInstructions(sessionId) {
        return this.pythonInstructionsReceived.get(sessionId) || false;
    }

    /**
     * Send DOM events as fallback instructions
     * @param {string} sessionId - Session ID
     * @returns {boolean} - True if events were sent, false otherwise
     */
    sendDomEventsAsFallback(sessionId) {
        const domEvents = this.getDomEvents(sessionId);

        if (!domEvents || domEvents.length === 0) {
            Logger.warn(`[Frontend Service] No DOM events available for fallback for session: ${sessionId}`);
            return false;
        }

        // Check if Python instructions were already received
        if (this.hasPythonInstructions(sessionId)) {
            Logger.info(`[Frontend Service] Python instructions already received for session: ${sessionId}, skipping fallback`);
            return false;
        }

        Logger.info(`[Frontend Service] Using DOM events as fallback for session: ${sessionId} (${domEvents.length} events)`);

        // Send each DOM event as an instruction
        domEvents.forEach((event, index) => {
            this.sendInstructions(sessionId, event, 'dom');
        });

        return true;
    }

    /**
     * Send demo data for testing (auto-triggered for demo session)
     * @param {string} sessionId - Session ID
     */
    _sendDemoData(sessionId) {
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

            Logger.info('[Frontend Service] Auto-sending demo data...');

            // Verify files exist
            if (!fs.existsSync(VIDEO_PATH) || !fs.existsSync(AUDIO_PATH) || !fs.existsSync(EVENTS_PATH)) {
                Logger.error('[Frontend Service] Demo files not found');
                return;
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

            // 1. Send Video
            const videoData = {
                filename: TEST_SESSION.videoFile,
                path: `/recordings/${TEST_SESSION.videoFile}`,
                metadata: metadata,
                timestamp: new Date().toISOString()
            };
            this.sendVideo(sessionId, videoData);
            Logger.info('[Frontend Service] Auto-sent video');

            // 2. Send Audio
            const audioData = {
                filename: TEST_SESSION.audioFile,
                path: `/recordings/${TEST_SESSION.audioFile}`,
                text: "Hello, guys. This is Tushar, and this is my website on Vercel.",
                timestamp: new Date().toISOString()
            };
            this.sendAudio(sessionId, audioData);
            Logger.info('[Frontend Service] Auto-sent audio');

            // 3. Send Instructions (Events)
            events.forEach((event) => {
                this.sendInstructions(sessionId, event);
            });
            Logger.info(`[Frontend Service] Auto-sent ${events.length} instructions`);

        } catch (err) {
            Logger.error('[Frontend Service] Error auto-sending demo data:', err);
        }
    }
}

// Export singleton instance
module.exports = new FrontendService();
