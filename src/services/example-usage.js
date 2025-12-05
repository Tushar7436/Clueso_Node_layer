/**
 * Example usage of Deepgram and Python services
 * 
 * This file demonstrates how to:
 * 1. Convert audio to text using Deepgram
 * 2. Send text with DOM events to Python layer
 * 
 * Environment variables required:
 * - DEEPGRAM_API_KEY: Your Deepgram API key
 * - PYTHON_LAYER_URL: URL of the Python layer (default: http://localhost:8000)
 * - PYTHON_SERVICE_TIMEOUT: Timeout in milliseconds (default: 30000)
 */

const { DeepgramService, PythonService } = require('./index');
const path = require('path');

/**
 * Example: Process audio file and send to Python layer
 */
async function processAudioWithDomEvents(audioFilePath, domEvents, metadata) {
  try {
    // Step 1: Convert audio to text using Deepgram
    console.log('Step 1: Transcribing audio with Deepgram...');
    const transcription = await DeepgramService.transcribeAudio(audioFilePath, {
      model: 'nova-2',
      language: 'en-US',
      punctuate: true
    });

    console.log('Transcription result:', transcription.text);
    console.log('Confidence:', transcription.confidence);

    // Step 2: Send text with DOM events to Python layer
    console.log('Step 2: Sending text and DOM events to Python layer...');
    const pythonResponse = await PythonService.sendTextWithDomEvents(
      transcription.text,
      domEvents,
      metadata
    );

    console.log('Python layer response:', pythonResponse);
    return pythonResponse;
  } catch (error) {
    console.error('Error processing audio:', error);
    throw error;
  }
}

/**
 * Example: Process audio buffer (from streaming or in-memory)
 */
async function processAudioBufferWithDomEvents(audioBuffer, domEvents, metadata) {
  try {
    // Step 1: Convert audio buffer to text
    console.log('Step 1: Transcribing audio buffer with Deepgram...');
    const transcription = await DeepgramService.transcribeAudioBuffer(audioBuffer, {
      model: 'nova-2',
      language: 'en-US',
      punctuate: true
    });

    console.log('Transcription result:', transcription.text);

    // Step 2: Send to Python layer
    console.log('Step 2: Sending to Python layer...');
    const pythonResponse = await PythonService.sendTextWithDomEvents(
      transcription.text,
      domEvents,
      metadata
    );

    return pythonResponse;
  } catch (error) {
    console.error('Error processing audio buffer:', error);
    throw error;
  }
}

/**
 * Example: Check Python layer health before sending data
 */
async function checkPythonLayerHealth() {
  const isHealthy = await PythonService.healthCheck();
  if (isHealthy) {
    console.log('Python layer is reachable');
  } else {
    console.warn('Python layer is not reachable');
  }
  return isHealthy;
}

// Example usage (commented out - uncomment to test)
/*
(async () => {
  const audioPath = path.join(__dirname, '../uploads/audio_example.webm');
  const domEvents = [
    {
      timestamp: 1000,
      type: 'click',
      metadata: { x: 100, y: 200 }
    },
    {
      timestamp: 2000,
      type: 'scroll',
      metadata: { x: 0, y: 500 }
    }
  ];
  const metadata = {
    sessionId: 'example_session_123',
    url: 'https://example.com',
    viewport: { width: 1920, height: 1080 },
    startTime: Date.now() - 10000,
    endTime: Date.now()
  };

  // Check health first
  await checkPythonLayerHealth();

  // Process audio
  await processAudioWithDomEvents(audioPath, domEvents, metadata);
})();
*/

module.exports = {
  processAudioWithDomEvents,
  processAudioBufferWithDomEvents,
  checkPythonLayerHealth
};

