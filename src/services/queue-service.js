const Logger = require('../utils/logger');

class QueueService {
  constructor() {
    // sessionId -> { messages: [], isPersisting: boolean }
    this.messageQueues = new Map();
    this.maxQueueSize = parseInt(process.env.MAX_QUEUE_SIZE || '1000', 10);
    this.persistenceInterval = parseInt(process.env.PERSISTENCE_INTERVAL || '5000', 10);
    this.isPersistenceEnabled = process.env.ENABLE_QUEUE_PERSISTENCE === 'true';
    
    if (this.isPersistenceEnabled) {
      this.startPersistenceWorker();
    }
  }

  /**
   * Enqueue a message for a session
   * @param {string} sessionId - Session identifier
   * @param {object} message - Message to queue
   * @param {string} message.type - Message type (video, audio, transcript, etc)
   * @param {any} message.data - Message payload
   * @param {number} timestamp - Timestamp of message
   * @returns {boolean} - Success status
   */
  enqueue(sessionId, message, timestamp = Date.now()) {
    try {
      if (!this.messageQueues.has(sessionId)) {
        this.messageQueues.set(sessionId, {
          messages: [],
          createdAt: timestamp,
          lastMessageAt: timestamp,
          isPersisting: false
        });
      }

      const queue = this.messageQueues.get(sessionId);

      // Check queue size limit
      if (queue.messages.length >= this.maxQueueSize) {
        Logger.warn(
          `[Queue Service] Queue size limit reached for session: ${sessionId}. ` +
          `Current size: ${queue.messages.length}. Dropping oldest message.`
        );
        queue.messages.shift(); // Remove oldest message
      }

      queue.messages.push({
        type: message.type,
        data: message.data,
        timestamp,
        sequence: queue.messages.length,
        id: `${sessionId}-${timestamp}-${Math.random()}`
      });

      queue.lastMessageAt = timestamp;

      Logger.info(
        `[Queue Service] Enqueued ${message.type} for session: ${sessionId}. ` +
        `Queue size: ${queue.messages.length}`
      );

      return true;
    } catch (error) {
      Logger.error(
        `[Queue Service] Error enqueuing message for session ${sessionId}: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Dequeue all messages for a session
   * @param {string} sessionId - Session identifier
   * @returns {array} - All queued messages
   */
  dequeueAll(sessionId) {
    try {
      if (!this.messageQueues.has(sessionId)) {
        return [];
      }

      const queue = this.messageQueues.get(sessionId);
      const messages = [...queue.messages];
      const count = messages.length;

      queue.messages = [];

      if (count > 0) {
        Logger.info(
          `[Queue Service] Dequeued ${count} messages for session: ${sessionId}`
        );
      }

      return messages;
    } catch (error) {
      Logger.error(
        `[Queue Service] Error dequeuing messages for session ${sessionId}: ${error.message}`
      );
      return [];
    }
  }

  /**
   * Get queue size for a session
   * @param {string} sessionId - Session identifier
   * @returns {number} - Queue size
   */
  getQueueSize(sessionId) {
    if (!this.messageQueues.has(sessionId)) {
      return 0;
    }
    return this.messageQueues.get(sessionId).messages.length;
  }

  /**
   * Get queue stats for a session
   * @param {string} sessionId - Session identifier
   * @returns {object} - Queue statistics
   */
  getQueueStats(sessionId) {
    if (!this.messageQueues.has(sessionId)) {
      return null;
    }

    const queue = this.messageQueues.get(sessionId);
    const messages = queue.messages;

    return {
      sessionId,
      queueSize: messages.length,
      createdAt: queue.createdAt,
      lastMessageAt: queue.lastMessageAt,
      messageTypes: [...new Set(messages.map(m => m.type))],
      oldestMessageAge: messages.length > 0 ? Date.now() - messages[0].timestamp : 0,
      newestMessageAge: messages.length > 0 ? Date.now() - messages[messages.length - 1].timestamp : 0
    };
  }

  /**
   * Clear queue for a session
   * @param {string} sessionId - Session identifier
   */
  clearQueue(sessionId) {
    try {
      if (this.messageQueues.has(sessionId)) {
        const queue = this.messageQueues.get(sessionId);
        const size = queue.messages.length;
        
        queue.messages = [];

        if (size > 0) {
          Logger.info(
            `[Queue Service] Cleared ${size} messages from queue for session: ${sessionId}`
          );
        }
      }
    } catch (error) {
      Logger.error(
        `[Queue Service] Error clearing queue for session ${sessionId}: ${error.message}`
      );
    }
  }

  /**
   * Delete entire session queue
   * @param {string} sessionId - Session identifier
   */
  deleteSession(sessionId) {
    try {
      if (this.messageQueues.has(sessionId)) {
        const queue = this.messageQueues.get(sessionId);
        Logger.info(
          `[Queue Service] Deleting session queue: ${sessionId}. ` +
          `Removed ${queue.messages.length} messages.`
        );
        this.messageQueues.delete(sessionId);
      }
    } catch (error) {
      Logger.error(
        `[Queue Service] Error deleting session ${sessionId}: ${error.message}`
      );
    }
  }

  /**
   * Get all active sessions
   * @returns {array} - List of session IDs
   */
  getActiveSessions() {
    return Array.from(this.messageQueues.keys());
  }

  /**
   * Start persistence worker to periodically save queues
   */
  startPersistenceWorker() {
    this.persistenceWorker = setInterval(() => {
      this.persistQueues();
    }, this.persistenceInterval);

    Logger.info(
      `[Queue Service] Persistence worker started. Interval: ${this.persistenceInterval}ms`
    );
  }

  /**
   * Persist queues to file system (optional feature)
   */
  persistQueues() {
    try {
      const fs = require('fs').promises;
      const path = require('path');
      const queueDir = path.join(__dirname, '../../.queues');

      // Create directory if it doesn't exist
      fs.mkdir(queueDir, { recursive: true }).catch(() => {});

      const queuesToPersist = {};
      
      for (const [sessionId, queue] of this.messageQueues) {
        if (queue.messages.length > 0) {
          queuesToPersist[sessionId] = {
            messages: queue.messages,
            createdAt: queue.createdAt,
            lastMessageAt: queue.lastMessageAt,
            persistedAt: Date.now()
          };
        }
      }

      if (Object.keys(queuesToPersist).length > 0) {
        const filePath = path.join(queueDir, `queues-${Date.now()}.json`);
        fs.writeFile(filePath, JSON.stringify(queuesToPersist, null, 2)).catch(error => {
          Logger.error(`[Queue Service] Error persisting queues: ${error.message}`);
        });
      }
    } catch (error) {
      Logger.error(`[Queue Service] Persistence worker error: ${error.message}`);
    }
  }

  /**
   * Stop persistence worker
   */
  stopPersistenceWorker() {
    if (this.persistenceWorker) {
      clearInterval(this.persistenceWorker);
      Logger.info('[Queue Service] Persistence worker stopped');
    }
  }

  /**
   * Get all queue information
   * @returns {object} - All queues with stats
   */
  getAllQueuesInfo() {
    const info = {};
    
    for (const [sessionId, queue] of this.messageQueues) {
      info[sessionId] = {
        queueSize: queue.messages.length,
        createdAt: queue.createdAt,
        lastMessageAt: queue.lastMessageAt,
        messageTypes: [...new Set(queue.messages.map(m => m.type))],
        isPersisting: queue.isPersisting
      };
    }

    return info;
  }
}

module.exports = QueueService;