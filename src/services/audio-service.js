const fs = require('fs');
const path = require('path');
const Logger = require('../utils/logger');

class AudioService {
  constructor(frontendService) {
    this.frontendService = frontendService;
    this.streams = new Map(); // sessionId -> writeStream
    this.chunkSizes = new Map(); // sessionId -> total bytes
    this.chunks = new Map(); // sessionId -> array of chunks for tracking
  }

  /**
   * Get or create audio stream for session
   */
  getOrCreateStream(sessionId, outputPath) {
    if (this.streams.has(sessionId)) {
      return this.streams.get(sessionId);
    }

    const filename = `audio_${sessionId}.webm`;
    const filePath = outputPath || path.join(__dirname, '../uploads', filename);
    
    const stream = fs.createWriteStream(filePath);
    
    this.streams.set(sessionId, stream);
    this.chunkSizes.set(sessionId, 0);
    this.chunks.set(sessionId, []);
    
    Logger.info(`[SERVICE] Created audio stream for session: ${sessionId}`);
    
    return stream;
  }

  /**
   * Save audio chunk
   */
  async saveAudioChunk(sessionId, chunk, sequence, requestId) {
    return new Promise((resolve, reject) => {
      try {
        if (!sessionId || !chunk) {
          return reject(new Error('sessionId and chunk are required'));
        }

        const stream = this.getOrCreateStream(sessionId);

        Logger.info(`[SERVICE] Saving audio chunk for session ${sessionId}`);
        Logger.info(`[SERVICE] Sequence: ${sequence}, Size: ${chunk.length} bytes`);

        // Track chunks for ordering verification
        const chunks = this.chunks.get(sessionId) || [];
        chunks.push({
          sequence,
          size: chunk.length,
          timestamp: Date.now(),
          id: `${sessionId}-audio-${sequence}`
        });
        this.chunks.set(sessionId, chunks);

        // Write chunk to stream
        stream.write(chunk, (err) => {
          if (err) {
            Logger.error(`[SERVICE] Error writing audio chunk: ${err.message}`);
            // Send error to frontend via queue service
            if (this.frontendService) {
              this.frontendService.sendMessage(sessionId, 'audio_error', {
                sequence,
                error: err.message,
                requestId
              });
            }
            return reject(err);
          }

          // Update bytes written
          const currentBytes = this.chunkSizes.get(sessionId) || 0;
          const newBytes = currentBytes + chunk.length;
          this.chunkSizes.set(sessionId, newBytes);

          Logger.info(`[SERVICE] Audio bytes written: ${newBytes}`);

          // Send success message to frontend
          if (this.frontendService) {
            this.frontendService.sendMessage(sessionId, 'audio_chunk_received', {
              sequence,
              size: chunk.length,
              totalBytes: newBytes,
              timestamp: Date.now(),
              requestId
            });
          }

          resolve({
            sessionId,
            sequence,
            size: chunk.length,
            totalBytes: newBytes
          });
        });
      } catch (error) {
        Logger.error(`[SERVICE] Error in saveAudioChunk: ${error.message}`);
        reject(error);
      }
    });
  }

  /**
   * Finalize audio stream
   */
  finalizeStream(sessionId) {
    return new Promise((resolve) => {
      try {
        if (!this.streams.has(sessionId)) {
          Logger.warn(`[SERVICE] No audio stream found for session: ${sessionId}`);
          return resolve(null);
        }

        const stream = this.streams.get(sessionId);
        const chunks = this.chunks.get(sessionId) || [];
        const totalBytes = this.chunkSizes.get(sessionId) || 0;

        Logger.info(`[SERVICE] Finalizing audio for session: ${sessionId}`);
        Logger.info(`[SERVICE] Total audio chunks: ${chunks.length}`);
        Logger.info(`[SERVICE] Total audio bytes: ${totalBytes}`);

        // Check for missing sequences
        if (chunks.length > 0) {
          const sequences = chunks.map(c => c.sequence).sort((a, b) => a - b);
          const missingSequences = [];
          for (let i = 0; i < sequences[sequences.length - 1]; i++) {
            if (!sequences.includes(i)) {
              missingSequences.push(i);
            }
          }
          if (missingSequences.length > 0) {
            Logger.warn(`[SERVICE] Missing audio sequences: ${missingSequences.join(', ')}`);
          }
        }

        stream.end(() => {
          const filePath = stream.path;
          Logger.info(`[SERVICE] Audio stream closed: ${filePath}`);

          // Cleanup
          this.streams.delete(sessionId);
          this.chunkSizes.delete(sessionId);
          this.chunks.delete(sessionId);

          resolve(filePath);
        });
      } catch (error) {
        Logger.error(`[SERVICE] Error finalizing audio stream: ${error.message}`);
        resolve(null);
      }
    });
  }

  /**
   * Get audio stream info/stats
   */
  getStreamInfo(sessionId) {
    const chunks = this.chunks.get(sessionId) || [];
    const totalBytes = this.chunkSizes.get(sessionId) || 0;

    return {
      sessionId,
      isActive: this.streams.has(sessionId),
      totalChunks: chunks.length,
      totalBytes,
      lastChunkSize: chunks.length > 0 ? chunks[chunks.length - 1].size : 0,
      chunkSequences: chunks.map(c => c.sequence)
    };
  }

  /**
   * Get all active audio streams
   */
  getActiveSessions() {
    return Array.from(this.streams.keys());
  }

  /**
   * Close stream without finalizing (for cleanup)
   */
  closeStream(sessionId) {
    if (this.streams.has(sessionId)) {
      const stream = this.streams.get(sessionId);
      stream.destroy();
      this.streams.delete(sessionId);
      this.chunkSizes.delete(sessionId);
      this.chunks.delete(sessionId);
      Logger.info(`[SERVICE] Audio stream closed (destroyed): ${sessionId}`);
    }
  }
}

module.exports = AudioService;