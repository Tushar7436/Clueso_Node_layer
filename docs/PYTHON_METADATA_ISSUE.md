# 🔍 Python Layer Missing Metadata Issue

**Date:** December 19, 2025  
**Issue:** Python receives `undefined` for `sessionId`, `url`, and `viewport`  
**Impact:** Python cannot build timeline analysis or RAG context  
**Status:** ⚠️ **PARTIALLY FIXED**

---

## 📊 The Problem

### **Python Layer Warnings:**
```
[Script Generation] Step 2/5: Analyzing event timeline...
[Script Generation]   ⚠️  No session data for timeline analysis

[Script Generation] Step 3/5: Building RAG context from DOM events...
[Script Generation]   ⚠️  No DOM events available, skipping RAG context
```

### **Node.js Logs Show:**
```log
[Python Service]    - metadata.sessionId: undefined  ← ❌
[Python Service]    - metadata.url: undefined        ← ❌
[Python Service]    - metadata.viewport: undefined   ← ❌
```

---

## 🔍 Root Cause Analysis

### **What Python Expects:**

Python's `/audio-full-process` endpoint expects this payload structure:

```javascript
{
  text: "Transcribed text...",
  domEvents: [ /* array of events */ ],
  deepgramResponse: { /* full Deepgram JSON */ },
  recordingsPath: "D:\\...\\recordings",
  metadata: {
    sessionId: "session_123",           // ← REQUIRED
    url: "https://airbnb.com",          // ← REQUIRED for context
    viewport: { width: 1920, height: 1080 },  // ← REQUIRED for coordinates
    startTime: 1766114088653,           // ← REQUIRED for timeline
    endTime: 1766114147806              // ← REQUIRED for timeline
  }
}
```

### **What Node.js is Sending:**

```javascript
{
  text: "Transcribed text...",
  domEvents: [ /* 65 events */ ],       // ✅ OK
  deepgramResponse: { /* full JSON */ }, // ✅ OK
  recordingsPath: "D:\\...\\recordings",  // ✅ OK
  metadata: {
    sessionId: "session_1766114088653_nbskqmx",  // ✅ FIXED
    url: undefined,                      // ❌ MISSING
    viewport: undefined,                 // ❌ MISSING
    startTime: undefined,                // ❌ MISSING
    endTime: undefined,                  // ❌ MISSING
    timestamp: "2025-12-19T03:15:57.000Z"  // ✅ OK
  }
}
```

---

## 🐛 Why Metadata is Missing

### **The Flow:**

1. **Extension sends events** to `/dom-events`:
   ```javascript
   POST /api/v1/recording/dom-events
   Body: {
     sessionId: "session_123",
     events: [ /* events */ ],
     metadata: {
       // ❌ Extension is NOT sending url, viewport, startTime, endTime
     }
   }
   ```

2. **Node.js stores events**:
   ```javascript
   recordingService.appendDomEvents(sessionId, events, metadata);
   // metadata is empty or incomplete
   ```

3. **Extension calls finalize**:
   ```javascript
   POST /api/v1/recording/finalize
   Body: {
     sessionId: "session_123"
     // ❌ No metadata here either
   }
   ```

4. **Node.js retrieves metadata**:
   ```javascript
   const metadata = recordingService.getMetadataForSession(sessionId);
   // Returns {} (empty object)
   ```

5. **Node.js sends to Python**:
   ```javascript
   pythonController.processWithAI(text, events, metadata, ...);
   // metadata only has sessionId, missing url/viewport/etc
   ```

---

## ✅ Partial Fix Applied

### **What Was Fixed:**

Added `sessionId` to metadata before sending to Python:

```javascript
// recording-controller.js - Line 432
const enrichedMetadata = {
  sessionId: sessionId,  // ✅ Always include sessionId
  ...metadata,           // Merge any stored metadata from events
};

pythonController.processWithAI(
  transcribedText,
  events,
  enrichedMetadata,  // ← Now includes sessionId
  deepgramResponse,
  sessionId,
  permanentAudioPath
);
```

**Result:** Python now receives `sessionId` ✅

---

## ⚠️ Still Missing

Python still needs:
- ❌ `url` - The URL being recorded (e.g., "https://airbnb.com")
- ❌ `viewport` - Screen dimensions for coordinate mapping
- ❌ `startTime` - Recording start timestamp
- ❌ `endTime` - Recording end timestamp

---

## 🔧 Complete Solution

### **Option 1: Extension Sends Metadata with Events** (Recommended)

**Update extension's `/dom-events` calls:**

```javascript
// extension/background.js
await fetch('http://localhost:3000/api/v1/recording/dom-events', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: recording.sessionId,
    events: batch,
    metadata: {
      url: recording.url,                    // ✅ Add this
      viewport: recording.viewport,          // ✅ Add this
      startTime: recording.startTime,        // ✅ Add this
      // endTime will be added on finalize
    }
  })
});
```

**Update extension's `/finalize` call:**

```javascript
// extension/background.js
await fetch('http://localhost:3000/api/v1/recording/finalize', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: recording.sessionId,
    metadata: {
      endTime: Date.now()  // ✅ Add endTime on finalize
    }
  })
});
```

### **Option 2: Extract from Events** (Fallback)

If extension can't send metadata, extract from events:

```javascript
// recording-controller.js
const enrichedMetadata = {
  sessionId: sessionId,
  ...metadata,
  // Extract from first/last events if not provided
  url: metadata.url || (events[0]?.url),
  viewport: metadata.viewport || (events[0]?.viewport),
  startTime: metadata.startTime || (events[0]?.timestamp),
  endTime: metadata.endTime || (events[events.length - 1]?.timestamp)
};
```

---

## 📊 Expected Logs After Fix

### **Node.js Logs:**
```log
[Python Service] 📦 Payload Structure:
[Python Service]    - text: "..." (433 chars)
[Python Service]    - domEvents: Array(65)
[Python Service]    - metadata.sessionId: session_1766114088653_nbskqmx  ✅
[Python Service]    - metadata.url: https://airbnb.com                   ✅
[Python Service]    - metadata.viewport: { width: 1920, height: 1080 }   ✅
[Python Service]    - metadata.startTime: 1766114088653                  ✅
[Python Service]    - metadata.endTime: 1766114147806                    ✅
[Python Service]    - deepgramResponse: YES
[Python Service]    - deepgramResponse.timeline: 11 segments
```

### **Python Logs:**
```
[Script Generation] Step 2/5: Analyzing event timeline...
[Script Generation]   ✅ Found 65 events spanning 59 seconds
[Script Generation]   ✅ Timeline analysis complete

[Script Generation] Step 3/5: Building RAG context from DOM events...
[Script Generation]   ✅ Built RAG context from 65 DOM events
[Script Generation]   ✅ Context includes URL: https://airbnb.com
```

---

## 🎯 Action Items

### **Priority 1: Extension Changes** (Required)

1. **Update `/dom-events` calls** to include metadata:
   - `url`
   - `viewport`
   - `startTime`

2. **Update `/finalize` call** to include:
   - `endTime`

### **Priority 2: Backend Fallback** (Nice to Have)

1. **Extract metadata from events** if not provided
2. **Validate metadata** before sending to Python
3. **Log warnings** if metadata is incomplete

---

## 📝 Summary

| Field | Status | Source |
|-------|--------|--------|
| `sessionId` | ✅ Fixed | Always added by Node.js |
| `url` | ❌ Missing | Needs to come from extension |
| `viewport` | ❌ Missing | Needs to come from extension |
| `startTime` | ❌ Missing | Needs to come from extension |
| `endTime` | ❌ Missing | Needs to come from extension |
| `text` | ✅ OK | From Deepgram |
| `domEvents` | ✅ OK | From extension |
| `deepgramResponse` | ✅ OK | From Deepgram |

---

**Status:** ⚠️ **EXTENSION CHANGES REQUIRED**  
**Next Step:** Update extension to send metadata with `/dom-events` and `/finalize` calls
