const { createClient } = require('@deepgram/sdk');
const fs = require('fs');
const { Logger } = require('../config');

class DeepgramService {
  constructor() {
    const apiKey = process.env.DEEPGRAM_API_KEY;
    
    if (!apiKey) {
      Logger.warn('Deepgram API key not found. Deepgram service may not work properly.');
    }
    
    this.client = apiKey ? createClient(apiKey) : null;
  }

  /**
   * Convert audio file to text using Deepgram
   * @param {string} audioFilePath - Path to the audio file
   * @param {object} options - Optional configuration (language, model, etc.)
   * @returns {Promise<string>} - Transcribed text
   */
  async transcribeAudio(audioFilePath, options = {}) {
    try {
      if (!this.client) {
        throw new Error('Deepgram client not initialized. Please set DEEPGRAM_API_KEY in environment variables.');
      }

      if (!fs.existsSync(audioFilePath)) {
        throw new Error(`Audio file not found: ${audioFilePath}`);
      }

      Logger.info(`[Deepgram] Starting transcription for: ${audioFilePath}`);

      // Read audio file
      const audioBuffer = fs.readFileSync(audioFilePath);
      
      // Detect MIME type from file extension
      const mimeType = this._detectMimeType(audioFilePath);
      
      // Configure transcription options
      const transcriptionOptions = {
        model: options.model || 'nova-2',
        language: options.language || 'en-US',
        punctuate: options.punctuate !== false,
        diarize: options.diarize || false,
        ...options
      };

      // Transcribe audio using v3 API: listen.prerecorded.transcribeFile
      // FileSource can be a Buffer or ReadStream - pass buffer directly
      const { result, error } = await this.client.listen.prerecorded.transcribeFile(
        audioBuffer,
        transcriptionOptions
      );

      if (error) {
        Logger.error('[Deepgram] Transcription error:', error);
        throw new Error(`Deepgram transcription failed: ${error.message || JSON.stringify(error)}`);
      }

      if (!result) {
        throw new Error('No transcription results returned from Deepgram');
      }

      // Extract transcript text
      const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      
      Logger.info(`[Deepgram] Transcription completed. Text length: ${transcript.length} characters`);
      
      return {
        text: transcript,
        confidence: result.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0,
        metadata: {
          model: result.metadata?.model,
          language: result.metadata?.language,
          duration: result.metadata?.duration
        },
        fullResult: result // Include full result for advanced usage
      };
    } catch (error) {
      Logger.error('[Deepgram] Error in transcribeAudio:', error);
      throw error;
    }
  }

  /**
   * Convert audio buffer to text using Deepgram
   * @param {Buffer} audioBuffer - Audio data as Buffer
   * @param {object} options - Optional configuration
   * @returns {Promise<object>} - Transcription result with text and metadata
   */
  async transcribeAudioBuffer(audioBuffer, options = {}) {
    try {
      if (!this.client) {
        throw new Error('Deepgram client not initialized. Please set DEEPGRAM_API_KEY in environment variables.');
      }

      if (!Buffer.isBuffer(audioBuffer)) {
        throw new Error('audioBuffer must be a Buffer');
      }

      Logger.info(`[Deepgram] Starting transcription from buffer (${audioBuffer.length} bytes)`);

      // Detect MIME type from options or default to webm
      const mimeType = options.mimetype || 'audio/webm';
      
      // Configure transcription options
      const transcriptionOptions = {
        model: options.model || 'nova-2',
        language: options.language || 'en-US',
        punctuate: options.punctuate !== false,
        diarize: options.diarize || false,
        ...options
      };

      // Remove mimetype from transcription options (it's a separate parameter)
      delete transcriptionOptions.mimetype;

      // Transcribe audio using v3 API: listen.prerecorded.transcribeFile
      // FileSource can be a Buffer or ReadStream
      const { result, error } = await this.client.listen.prerecorded.transcribeFile(
        audioBuffer,
        transcriptionOptions
      );

      if (error) {
        Logger.error('[Deepgram] Transcription error:', error);
        throw new Error(`Deepgram transcription failed: ${error.message || JSON.stringify(error)}`);
      }

      if (!result) {
        throw new Error('No transcription results returned from Deepgram');
      }

      // Extract transcript text
      const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
      
      Logger.info(`[Deepgram] Transcription completed. Text length: ${transcript.length} characters`);
      
      return {
        text: transcript,
        confidence: result.results?.channels?.[0]?.alternatives?.[0]?.confidence || 0,
        metadata: {
          model: result.metadata?.model,
          language: result.metadata?.language,
          duration: result.metadata?.duration
        },
        fullResult: result // Include full result for advanced usage
      };
    } catch (error) {
      Logger.error('[Deepgram] Error in transcribeAudioBuffer:', error);
      throw error;
    }
  }

  /**
   * Detect MIME type from file extension
   * @private
   */
  _detectMimeType(filePath) {
    const ext = filePath.toLowerCase().split('.').pop();
    const mimeTypes = {
      'webm': 'audio/webm',
      'wav': 'audio/wav',
      'mp3': 'audio/mpeg',
      'm4a': 'audio/m4a',
      'ogg': 'audio/ogg',
      'flac': 'audio/flac',
      'mp4': 'audio/mp4'
    };
    return mimeTypes[ext] || 'audio/webm';
  }
}

// Export singleton instance
module.exports = new DeepgramService();

