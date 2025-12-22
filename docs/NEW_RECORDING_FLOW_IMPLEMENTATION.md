# 🎯 New Recording Flow Implementation

**Date:** December 18, 2025  
**Status:** ✅ **IMPLEMENTED**  
**Version:** 2.0

---

## 📊 Overview

The new recording flow implements a **4-phase sequential architecture** that eliminates race conditions and guarantees Python AI receives complete data (transcribed text + DOM events).

---

## 🔄 New Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Phase 1: Chunk Streaming (During Recording)                │
│  POST /api/v1/recording/video-chunk (multiple times)        │
│  POST /api/v1/recording/audio-chunk (multiple times)        │
│  └─ Chunks stored in activeStreams Map                      │
│  └─ Audio chunks can trigger real-time Deepgram (future)    │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 2: Events Storage (During/After Recording)           │
│  POST /api/v1/recording/dom-events (multiple times)         │
│  └─ Events stored incrementally in sessionEvents Map        │
│  └─ Events appended to temporary JSON file                  │
│  └─ Can be called with batches (e.g., 5 events at a time)   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 3: Finalization (After Everything Sent)              │
│  POST /api/v1/recording/finalize (once)                     │
│  └─ Waits for Deepgram transcription to complete            │
│  └─ Retrieves stored events from sessionEvents Map          │
│  └─ Finalizes audio/video streams                           │
│  └─ Sends complete data to Python AI                        │
│  └─ Cleans up temporary storage                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Phase 4: Frontend Display                                  │
│  Frontend connects via WebSocket                            │
│  └─ Receives AI-processed instructions                      │
│  └─ Receives audio narration                                │
│  └─ Receives video                                           │
└─────────────────────────────────────────────────────────────┘
```

---

## 🆕 New Endpoints

### **1. POST `/api/v1/recording/dom-events`**

**Purpose:** Store DOM events incrementally during/after recording

**Request Body:**
```json
{
  "sessionId": "session_123",
  "events": [
    {
      "type": "click",
      "timestamp": 1734521880000,
      "target": {
        "tagName": "BUTTON",
        "id": "submit-btn",
        "bbox": { "x": 100, "y": 200, "width": 150, "height": 40 }
      },
      "x": 125,
      "y": 220
    }
    // ... more events (can send in batches)
  ],
  "metadata": {
    "url": "https://example.com",
    "viewport": { "width": 1920, "height": 1080 }
  }
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "session_123",
  "eventsReceived": 5,
  "totalEvents": 38,
  "message": "DOM events stored successfully"
}
```

**Features:**
- ✅ Can be called **multiple times** with batches of events
- ✅ Events stored in memory (`sessionEvents` Map)
- ✅ Events appended to temporary JSON file incrementally
- ✅ Auto-cleanup after 2 hours (TTL)

---

### **2. POST `/api/v1/recording/finalize`**

**Purpose:** Trigger final processing after all data is sent

**Request Body:**
```json
{
  "sessionId": "session_123"
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "session_123",
  "message": "Recording finalized and processed successfully",
  "transcription": {
    "text": "This is a screen recording integration...",
    "textLength": 156,
    "hasDeepgramResponse": true
  },
  "events": {
    "count": 38
  },
  "python": {
    "processed": true,
    "response": { /* Python AI response */ }
  },
  "files": {
    "audio": "D:\\...\\recording_session_123_audio.webm",
    "video": "D:\\...\\recording_session_123_video.webm"
  }
}
```

**Processing Steps:**
1. ⏳ **Waits** for Deepgram transcription to complete (max 60s)
2. 📦 **Retrieves** stored DOM events from memory
3. 📁 **Finalizes** audio/video streams
4. 🤖 **Sends** complete data to Python AI:
   - Transcribed text ✅
   - DOM events (38 events) ✅
   - Deepgram full response ✅
   - Audio file path ✅
5. 🧹 **Cleans up** temporary storage
6. ✅ **Returns** success response

---

## 🔧 Backend Implementation Details

### **State Management (recording-service.js)**

```javascript
// NEW Maps for session data
const sessionEvents = new Map();        // sessionId → events array
const sessionMetadata = new Map();      // sessionId → metadata object
const sessionEventsFile = new Map();    // sessionId → temp file path
const deepgramStatus = new Map();       // sessionId → { completed, text, deepgramResponse }
```

### **New Service Functions**

#### **1. `appendDomEvents(sessionId, events, metadata)`**
- Appends events to in-memory array
- Writes events to temporary JSON file incrementally
- Returns total event count

#### **2. `setDeepgramStatus(sessionId, completed, text, deepgramResponse)`**
- Tracks Deepgram transcription progress
- Called when transcription completes
- Stores transcribed text and full response

#### **3. `waitForDeepgramCompletion(sessionId, maxWaitMs)`**
- **Waits** for Deepgram to complete (polls every 500ms)
- Returns Deepgram status when complete
- Throws error if timeout (default: 60s)

#### **4. `getEventsForSession(sessionId)`**
- Retrieves stored events from memory
- Returns empty array if no events

#### **5. `clearSessionData(sessionId)`**
- Deletes events, metadata, Deepgram status
- Removes temporary files
- Called after finalization

---

## 📝 Detailed Logging

### **Phase 1: Chunk Streaming**
```log
[CONTROLLER] Video chunk - Session: session_123, Sequence: 0
[SERVICE] Created video stream for session: session_123
[SERVICE] Saving video chunk for session session_123
[SERVICE] Sequence: 0, Size: 242828 bytes
[SERVICE] Video bytes written: 242828
```

### **Phase 2: Events Storage**
```log
[Recording Controller] 📥 Receiving 5 DOM events for session: session_123
[SERVICE] Appended 5 events for session: session_123 (Total: 5)
[Recording Controller] ✅ Stored 5 events (Total: 5)

[Recording Controller] 📥 Receiving 10 DOM events for session: session_123
[SERVICE] Appended 10 events for session: session_123 (Total: 15)
[Recording Controller] ✅ Stored 10 events (Total: 15)
```

### **Phase 3: Finalization**
```log
[Recording Controller] 🏁 FINALIZE called for session: session_123
[Recording Controller] ⏳ Waiting for Deepgram transcription to complete...
[SERVICE] Deepgram completed for session: session_123
[Recording Controller] ✅ Deepgram transcription completed
[Recording Controller] 📝 Transcribed Text (156 chars):
[Recording Controller] "This is a screen recording integration. The format activity domains. Overview. Close-up content there."
[Recording Controller] 📦 Retrieved 38 stored DOM events
[Recording Controller] 📁 Audio path: D:\...\recording_session_123_audio.webm
[Recording Controller] 📁 Video path: D:\...\recording_session_123_video.webm
[Recording Controller] 🤖 Sending to Python AI...
[Recording Controller] 📊 Data being sent to Python:
[Recording Controller]    - Text: "This is a screen recording integration..." (156 chars)
[Recording Controller]    - Events: 38 events
[Recording Controller]    - Deepgram Response: YES
[Recording Controller]    - Audio Path: D:\...\recording_session_123_audio.webm
[Python Controller] Processing with AI:
[Python Controller] - Text: "This is a screen recording integration..."
[Python Controller] - DOM Events: 38  ← ✅ CORRECT!
[Python Service] Sending text with 38 DOM events to Python layer
[Recording Controller] ✅ Python AI processing completed successfully
[Recording Controller] 🧹 Cleaned up session data for: session_123
```

---

## 🔄 Extension Integration

### **Updated Extension Flow**

```javascript
// background.js

async function handleStop() {
  console.log("[background] STOP", recording.sessionId);
  recording.isActive = false;

  // 1. Stop offscreen (finishes sending chunks)
  chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" });
  await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for chunks

  // 2. Send DOM events (can send in batches)
  await sendDomEventsInBatches();

  // 3. Finalize and trigger processing
  await finalizeRecording();

  // 4. Open frontend
  chrome.tabs.create({
    url: `http://localhost:3001/recording/${recording.sessionId}`
  });
}

// Send events in batches of 5
async function sendDomEventsInBatches() {
  const batchSize = 5;
  const events = recording.domEvents;

  for (let i = 0; i < events.length; i += batchSize) {
    const batch = events.slice(i, i + batchSize);

    const response = await fetch('http://localhost:3000/api/v1/recording/dom-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: recording.sessionId,
        events: batch,
        metadata: {
          url: recording.url,
          viewport: recording.viewport,
          startTime: recording.startTime
        }
      })
    });

    const result = await response.json();
    console.log(`[background] Sent batch ${i / batchSize + 1}: ${result.totalEvents} total events`);
  }

  console.log(`[background] ✅ All ${events.length} events sent`);
}

// Finalize recording
async function finalizeRecording() {
  const response = await fetch('http://localhost:3000/api/v1/recording/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: recording.sessionId
    })
  });

  const result = await response.json();
  console.log('[background] ✅ Recording finalized:', result);
}
```

---

## ✅ Benefits of New Architecture

| Benefit | Description |
|---------|-------------|
| **No Race Conditions** | Events sent BEFORE finalize, guaranteed order |
| **Complete Data to Python** | Python always gets text + events |
| **Incremental Events** | Can send events in batches during recording |
| **Deepgram Wait** | Finalize waits for transcription to complete |
| **Better Error Handling** | Clear errors at each phase |
| **Detailed Logging** | See exactly what's being sent to Python |
| **Idempotent** | Can retry any phase safely |
| **Scalable** | Easy to add more data types (screenshots, etc.) |
| **Auto-Cleanup** | TTL cleanup prevents memory leaks |

---

## 🔍 Deepgram Completion Check

### **How It Works:**

1. **During Transcription:**
   ```javascript
   // In transcribeAudio function
   recordingService.setDeepgramStatus(sessionId, true, transcribedText, deepgramResponse);
   ```

2. **During Finalization:**
   ```javascript
   // In finalizeRecording function
   const deepgramStatus = await recordingService.waitForDeepgramCompletion(sessionId, 60000);
   ```

3. **Wait Mechanism:**
   - Polls `deepgramStatus` Map every 500ms
   - Returns when `completed: true`
   - Throws error if timeout (60s)

### **Status Tracking:**
```javascript
deepgramStatus.set(sessionId, {
  completed: true,
  text: "Transcribed text...",
  deepgramResponse: { /* full response */ },
  timestamp: 1734521920000
});
```

---

## 🧪 Testing

### **Test Scenario 1: Normal Flow**
```bash
# 1. Send video chunks
POST /api/v1/recording/video-chunk (x17)

# 2. Send audio chunks
POST /api/v1/recording/audio-chunk (x8)

# 3. Send events in batches
POST /api/v1/recording/dom-events (batch 1: 5 events)
POST /api/v1/recording/dom-events (batch 2: 10 events)
POST /api/v1/recording/dom-events (batch 3: 23 events)

# 4. Finalize
POST /api/v1/recording/finalize

# Expected: Python receives 38 events ✅
```

### **Test Scenario 2: Events Before Chunks**
```bash
# 1. Send events first
POST /api/v1/recording/dom-events (38 events)

# 2. Send chunks
POST /api/v1/recording/video-chunk (x17)
POST /api/v1/recording/audio-chunk (x8)

# 3. Finalize
POST /api/v1/recording/finalize

# Expected: Still works! Events stored, retrieved on finalize ✅
```

### **Test Scenario 3: Deepgram Timeout**
```bash
# 1. Send chunks (audio fails to transcribe)
POST /api/v1/recording/audio-chunk (corrupted data)

# 2. Send events
POST /api/v1/recording/dom-events (38 events)

# 3. Finalize
POST /api/v1/recording/finalize

# Expected: Returns error after 60s timeout ❌
# Fallback: DOM events sent to frontend ✅
```

---

## 📚 API Reference

### **Endpoints Summary**

| Endpoint | Method | Purpose | Called |
|----------|--------|---------|--------|
| `/video-chunk` | POST | Stream video chunks | Multiple times |
| `/audio-chunk` | POST | Stream audio chunks | Multiple times |
| `/dom-events` | POST | Store DOM events | Multiple times |
| `/finalize` | POST | Trigger processing | Once |
| `/process-recording` | POST | Legacy (deprecated) | Once (old flow) |

---

## 🔧 Configuration

### **Timeouts**
```javascript
// Deepgram wait timeout
const DEEPGRAM_TIMEOUT = 60000; // 60 seconds

// Event storage TTL
const EVENT_TTL = 2 * 60 * 60 * 1000; // 2 hours

// Status check interval
const CHECK_INTERVAL = 500; // 500ms
```

### **Limits**
```javascript
// Events field size
const EVENT_FIELD_LIMIT = '50mb';

// Events per batch (recommended)
const EVENTS_BATCH_SIZE = 5;
```

---

## 🎯 Migration Guide

### **From Old Flow to New Flow**

**Old Extension Code:**
```javascript
// ❌ OLD: Single call with all data
const formData = new FormData();
formData.append('events', JSON.stringify(allEvents));
formData.append('video', videoBlob);
formData.append('audio', audioBlob);
fetch('/process-recording', { method: 'POST', body: formData });
```

**New Extension Code:**
```javascript
// ✅ NEW: Sequential calls
// 1. Chunks sent during recording (already working)
// 2. Events sent in batches
await sendDomEventsInBatches();
// 3. Finalize
await fetch('/finalize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ sessionId })
});
```

---

## 📊 Success Metrics

After implementation, you should see:

✅ **Python receives correct event count:**
```log
[Python Controller] - DOM Events: 38  ← Not 0!
```

✅ **Deepgram text logged:**
```log
[Recording Controller] 📝 Transcribed Text (156 chars):
[Recording Controller] "This is a screen recording integration..."
```

✅ **Complete data sent to Python:**
```log
[Recording Controller] 📊 Data being sent to Python:
[Recording Controller]    - Text: "..." (156 chars)
[Recording Controller]    - Events: 38 events
[Recording Controller]    - Deepgram Response: YES
```

✅ **No race conditions:**
```log
[Recording Controller] ⏳ Waiting for Deepgram transcription to complete...
[Recording Controller] ✅ Deepgram transcription completed
[Recording Controller] 📦 Retrieved 38 stored DOM events
```

---

**Document Version:** 2.0  
**Implementation Date:** December 18, 2025  
**Status:** ✅ **READY FOR TESTING**
