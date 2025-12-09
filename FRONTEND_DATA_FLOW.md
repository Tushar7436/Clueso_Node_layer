# Frontend Data Flow - Complete Documentation

## Overview

Node.js sends **three types of data** to the frontend via **Socket.IO WebSocket** connections:
1. **Video** - Raw screen recording
2. **Audio** - Processed audio with cleaned text
3. **Instructions** - AI analysis or DOM events

## Socket.IO Events

### Event Names
- `video` - Screen recording data
- `audio` - Processed audio data  
- `instructions` - Step-by-step instructions/events

### Connection Flow
```javascript
// Frontend connects
socket.emit('register', sessionId);

// Frontend receives
socket.on('video', (videoData) => { ... });
socket.on('audio', (audioData) => { ... });
socket.on('instructions', (instruction) => { ... });
```

## Data Structures

### 1. Video Data
**Event:** `video`  
**When:** Immediately after recording finishes  
**Source:** `src/recordings/recording_session_XXX_video.webm`

```javascript
{
  filename: "recording_session_1765087651871_xq79d8rtl_video.webm",
  path: "/recordings/recording_session_1765087651871_xq79d8rtl_video.webm",
  metadata: {
    sessionId: "session_1765087651871_xq79d8rtl",
    startTime: 1765087651871,
    endTime: 1765087662345,
    url: "https://example.com/page",
    path: "/page",
    viewport: {
      width: 1536,
      height: 695
    }
  },
  timestamp: "2025-12-07T11:38:02.123Z"
}
```

### 2. Audio Data
**Event:** `audio`  
**When:** After Python processing completes  
**Source:** `src/recordings/processed_audio_session_XXX_timestamp.webm`

```javascript
{
  filename: "processed_audio_session_1765087651871_xq79d8rtl_1765087682456.webm",
  path: "/recordings/processed_audio_session_1765087651871_xq79d8rtl_1765087682456.webm",
  text: "Hello, guys. This is Tushar, and this is my website, Claude.",
  timestamp: "2025-12-07T11:38:22.456Z"
}
```

### 3. Instructions Data
**Event:** `instructions`  
**When:** After Python processing (or immediately with DOM events fallback)  
**Source:** Python AI analysis OR DOM events from recording

**Each instruction sent individually:**
```javascript
{
  type: "click",
  target: "button.submit",
  timestamp: 1765087655000,
  x: 450,
  y: 320,
  metadata: {
    text: "Submit",
    classes: ["btn", "btn-primary"]
  }
}
```

## Code Flow

### From `recording-controller.js`

```javascript
// 1. Broadcast video immediately
frontendService.sendVideo(sessionId, {
  filename: path.basename(permanentVideoPath),
  path: `/recordings/${path.basename(permanentVideoPath)}`,
  metadata: metadata,
  timestamp: new Date().toISOString()
});

// 2. After Python processing, broadcast audio
frontendService.sendAudio(sessionId, {
  filename: pythonResponse.processed_audio_filename,
  path: `/recordings/${pythonResponse.processed_audio_filename}`,
  text: transcribedText,
  timestamp: new Date().toISOString()
});

// 3. Broadcast instructions (Python or DOM events)
if (pythonResponse.instructions && pythonResponse.instructions.length > 0) {
  // Send Python instructions
  pythonResponse.instructions.forEach(instruction => {
    frontendService.sendInstructions(sessionId, instruction);
  });
} else {
  // Fallback: Send DOM events as instructions
  events.forEach(event => {
    frontendService.sendInstructions(sessionId, event);
  });
}
```

### From `frontend-service.js`

```javascript
// Video
sendVideo(sessionId, videoData) {
  const socket = this.sessions.get(sessionId);
  if (!socket) {
    this._queueMessage(sessionId, "video", videoData); // Buffer if not connected
    return true;
  }
  socket.emit("video", videoData); // Send via WebSocket
}

// Audio
sendAudio(sessionId, audioData) {
  const socket = this.sessions.get(sessionId);
  if (!socket) {
    this._queueMessage(sessionId, "audio", audioData); // Buffer if not connected
    return true;
  }
  socket.emit("audio", audioData); // Send via WebSocket
}

// Instructions
sendInstructions(sessionId, instructions) {
  const socket = this.sessions.get(sessionId);
  if (!socket) {
    this._queueMessage(sessionId, "instructions", instructions); // Buffer if not connected
    return true;
  }
  socket.emit("instructions", instructions); // Send via WebSocket
}
```

## Buffering System

**Problem:** Frontend might connect after data is ready  
**Solution:** Message queue buffers data until frontend connects

```javascript
// When no client connected
this._queueMessage(sessionId, "video", videoData);
this._queueMessage(sessionId, "audio", audioData);
this._queueMessage(sessionId, "instructions", instruction);

// When client connects and registers
socket.on("register", (sessionId) => {
  this._flushQueue(sessionId, socket); // Send all buffered messages
});
```

## Log Analysis

### Typical Flow (from logs)

```
1. Recording finishes
   [SERVICE] Recording saved: recording_session_XXX_timestamp.json

2. Video broadcast
   [Recording Controller] Broadcasting video to frontend session: session_XXX
   [Frontend Service] No client connected. Buffering video.
   [Frontend Service] Buffered video message. Queue size: 1

3. Deepgram transcription
   [Recording Controller] Transcribed text from Deepgram
   [Recording Controller] Text: "Hello, guys..."

4. Python processing
   [Python Service] Successfully received response from Python layer
   [Recording Controller] Python response: {...}

5. Audio broadcast
   [Recording Controller] Found processed audio, broadcasting to frontend
   [Frontend Service] No client connected. Buffering audio.
   [Frontend Service] Buffered audio message. Queue size: 2

6. Instructions broadcast
   [Recording Controller] Broadcasting 15 DOM events as instructions
   [Recording Controller] Sent DOM event 1/15 as instruction
   [Frontend Service] No client connected. Buffering instructions.
   [Frontend Service] Buffered instructions message. Queue size: 3

7. Frontend connects
   [Frontend Service] Client connected: XRdiwiBGGl5yRgqkAAAB
   [Frontend Service] Client registered for session: session_XXX
   [Frontend Service] Flushing 3 buffered messages
   [Frontend Service] Sending buffered video
   [Frontend Service] Sending buffered audio
   [Frontend Service] Sending buffered instructions
```

## Frontend Integration

### Socket.IO Client Setup

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000');

// Register for session
socket.emit('register', sessionId);

// Listen for data
socket.on('video', (videoData) => {
  console.log('Video received:', videoData);
  // videoData.path = URL to fetch video file
});

socket.on('audio', (audioData) => {
  console.log('Audio received:', audioData);
  // audioData.path = URL to fetch audio file
  // audioData.text = Cleaned transcription
});

socket.on('instructions', (instruction) => {
  console.log('Instruction received:', instruction);
  // instruction = Single DOM event or AI instruction
});
```

### File Access

Files are served statically from `/recordings/`:

```javascript
// Video
const videoUrl = `http://localhost:3000${videoData.path}`;
// http://localhost:3000/recordings/recording_session_XXX_video.webm

// Audio
const audioUrl = `http://localhost:3000${audioData.path}`;
// http://localhost:3000/recordings/processed_audio_session_XXX_timestamp.webm
```

## Summary

✅ **Three Socket.IO events**: `video`, `audio`, `instructions`  
✅ **Buffering**: Messages queued if frontend not connected  
✅ **Automatic flush**: All buffered messages sent when frontend registers  
✅ **File URLs**: Static files served from `/recordings/` endpoint  
✅ **Fallback**: DOM events used as instructions if Python doesn't provide them
