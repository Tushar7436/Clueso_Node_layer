const fetch = require('node-fetch');
const { Logger } = require('../config');

class PythonService {
  constructor() {
    this.pythonBaseUrl = process.env.PYTHON_LAYER_URL || 'http://localhost:8000';
    this.timeout = parseInt(process.env.PYTHON_SERVICE_TIMEOUT || '60000', 10);
  }

  /**
   * Send only the sessionId (reference ID) to the Python layer.
   * The Python layer is expected to fetch DOM events and Deepgram data from MongoDB 
   * and media files from S3 using this ID.
   * 
   * @param {string} sessionId - The session ID reference
   * @param {object} metadata - Basic metadata
   * @returns {Promise<object>} - Response from Python layer
   */
  async sendSessionReference(sessionId, metadata = {}) {
    try {
      const payload = {
        sessionId: sessionId,
        videoDurationSec: metadata.videoDurationSec || null, // Root level for easy access
        metadata: {
          ...metadata,
          timestamp: new Date().toISOString()
        }
      };

      Logger.info(`[Python Service] Sending session reference ${sessionId} to Python layer`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.pythonBaseUrl}/process-recording`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        Logger.error(`[Python Service] Error response from Python layer: ${response.status} - ${errorText}`);
        throw new Error(`Python layer returned error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      Logger.info('[Python Service] Successfully received response from Python layer');

      return result;
    } catch (error) {
      Logger.error('[Python Service] Error sending data to Python layer:', error);
      throw error;
    }
  }

  // Legacy/Full data method kept for fallback
  async sendTextWithDomEvents(deepgramRaw, domEvents = [], metadata = {}) {
    // Extract duration for Python layer which expects it
    const enrichedMetadata = { ...metadata };
    if (deepgramRaw?.metadata?.duration) {
      enrichedMetadata.videoDurationSec = deepgramRaw.metadata.duration;
    }

    // We'll call the new reference method instead to minimize load
    return this.sendSessionReference(metadata.sessionId, enrichedMetadata);
  }

  async healthCheck() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${this.pythonBaseUrl}/health`, {
        method: 'GET',
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      Logger.warn('[Python Service] Health check failed:', error.message);
      return false;
    }
  }
}

module.exports = new PythonService();
