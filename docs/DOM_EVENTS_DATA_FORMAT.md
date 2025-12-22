# DOM Events Data Format Documentation

## Overview
This document explains how DOM events are accepted from the Chrome extension in the Node.js backend, including the exact data format, endpoints, and processing flow.

---

## 📍 Exact Location: Where DOM Events Are Received

### **Primary Endpoint**
```
POST /api/v1/recording/process-recording
```

**File Location:**
- **Route Definition:** `src/routes/v1/recording-routes.js` (Lines 34-48)
- **Controller Handler:** `src/controllers/recording-controller.js` (Line 127-237, function `processRecording`)
- **Service Processing:** `src/services/recording-service.js`

---

## 📦 Data Format: FormData (NOT JSON)

### **Answer to Your Question:**
**DOM events are sent as FormData, NOT as raw JSON.**

The extension sends data using `multipart/form-data` format, which is handled by **Multer middleware**.

---

## 🔧 Multer Configuration

### Route Configuration (recording-routes.js)
```javascript
router.post("/process-recording",
  multer({
    dest: "uploads/",
    limits: {
      fileSize: 100 * 1024 * 1024,  // 100MB for files
      fieldSize: 50 * 1024 * 1024    // 50MB for field values (events, metadata)
    }
  }).fields([
    { name: "events", maxCount: 1 },      // ← DOM events field
    { name: "video", maxCount: 1 },       // ← Video file
    { name: "audio", maxCount: 1 },       // ← Audio file
    { name: "metadata", maxCount: 1 }     // ← Session metadata
  ]),
  recordingController.processRecording
);
```

**Key Points:**
- Uses `multer().fields()` to handle multiple form fields
- `events` field can contain up to **50MB** of data
- Events are sent as a **stringified JSON** in the FormData field

---

## 📥 How Events Are Parsed in Controller

### Controller Code (recording-controller.js, Line 129)
```javascript
exports.processRecording = async (req, res) => {
  try {
    // Parse events from FormData field (stringified JSON)
    const events = req.body.events ? JSON.parse(req.body.events) : [];
    const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};

    const videoPath = req.files?.video?.[0]?.path;
    let audioPath = req.files?.audio?.[0]?.path;

    // Process recording...
  }
}
```

**Processing Steps:**
1. **Receive:** `req.body.events` contains the stringified JSON from FormData
2. **Parse:** `JSON.parse(req.body.events)` converts string to JavaScript array
3. **Validate:** Defaults to empty array `[]` if events are missing
4. **Store:** Events are stored for fallback (line 154-160)
5. **Forward:** Events are sent to Python AI processing (line 165-170)

---

## 📋 Expected DOM Events Structure

### Individual Event Format
```javascript
{
  "type": "click",              // Event type (click, scroll, input, etc.)
  "timestamp": 1234567890,      // Unix timestamp in milliseconds
  "target": {
    "tagName": "BUTTON",
    "id": "submit-btn",
    "className": "btn primary",
    "textContent": "Submit",
    "bbox": {                   // Bounding box coordinates
      "x": 100,
      "y": 200,
      "width": 150,
      "height": 40
    }
  },
  "x": 125,                     // Mouse X coordinate (for clicks)
  "y": 220,                     // Mouse Y coordinate (for clicks)
  "value": "user input text",   // Input value (for input events)
  "url": "https://example.com", // Current page URL
  "viewport": {
    "width": 1920,
    "height": 1080
  }
}
```

### Events Array Format
```javascript
[
  {
    "type": "click",
    "timestamp": 1234567890,
    "target": { /* ... */ },
    "x": 100,
    "y": 200
  },
  {
    "type": "input",
    "timestamp": 1234567895,
    "target": { /* ... */ },
    "value": "user typed text"
  },
  {
    "type": "scroll",
    "timestamp": 1234567900,
    "scrollX": 0,
    "scrollY": 500
  }
  // ... more events
]
```

---

## 🚀 How Extension Should Send Data

### Extension Code Example (FormData)
```javascript
// In your Chrome extension (background.js or offscreen.js)
const formData = new FormData();

// 1. Add events as stringified JSON
const events = [
  { type: "click", timestamp: Date.now(), /* ... */ },
  { type: "input", timestamp: Date.now(), /* ... */ }
];
formData.append('events', JSON.stringify(events));

// 2. Add metadata as stringified JSON
const metadata = {
  sessionId: 'session_123',
  startTime: Date.now(),
  url: window.location.href,
  viewport: { width: 1920, height: 1080 }
};
formData.append('metadata', JSON.stringify(metadata));

// 3. Add video file (Blob)
formData.append('video', videoBlob, 'recording.webm');

// 4. Add audio file (Blob)
formData.append('audio', audioBlob, 'audio.webm');

// 5. Send to Node.js backend
fetch('http://localhost:3000/api/v1/recording/process-recording', {
  method: 'POST',
  body: formData  // ← FormData, NOT JSON
});
```

**Important:**
- Do **NOT** set `Content-Type` header (browser sets it automatically with boundary)
- Events must be **stringified** before appending to FormData
- Files are added as Blobs with filenames

---

## 🔄 Data Flow After Reception

### 1. **Immediate Storage**
```javascript
// Line 154-160 in recording-controller.js
const frontendService = require("../services/frontend-service");
if (events && events.length > 0) {
  frontendService.storeDomEvents(actualSessionId, events);
  Logger.info(`Stored ${events.length} DOM events for potential fallback`);
}
```

### 2. **Sent to Python AI Processing**
```javascript
// Line 165-170 in recording-controller.js
pythonResponse = await pythonController.processWithAI(
  transcriptionResult.text,
  events,                          // ← DOM events sent here
  metadata,
  transcriptionResult.deepgramResponse,
  actualSessionId,
  permanentAudioPath
);
```

### 3. **Fallback Mechanism**
If Python processing fails, DOM events are sent directly to frontend:
```javascript
// Line 173-180 in recording-controller.js
if (!pythonResponse) {
  Logger.warn(`Python processing failed, triggering DOM events fallback`);
  frontendService.sendDomEventsAsFallback(actualSessionId);
}
```

---

## 📊 Complete Request Example

### cURL Example
```bash
curl -X POST http://localhost:3000/api/v1/recording/process-recording \
  -F "events=[{\"type\":\"click\",\"timestamp\":1234567890,\"x\":100,\"y\":200}]" \
  -F "metadata={\"sessionId\":\"session_123\",\"url\":\"https://example.com\"}" \
  -F "video=@recording.webm" \
  -F "audio=@audio.webm"
```

### Fetch API Example (from Extension)
```javascript
const formData = new FormData();
formData.append('events', JSON.stringify([
  {
    type: "click",
    timestamp: 1734521880000,
    target: {
      tagName: "BUTTON",
      id: "submit-btn",
      bbox: { x: 100, y: 200, width: 150, height: 40 }
    },
    x: 125,
    y: 220
  }
]));

formData.append('metadata', JSON.stringify({
  sessionId: 'session_1734521880000_abc123',
  startTime: 1734521880000,
  endTime: 1734521920000,
  url: 'https://example.com',
  viewport: { width: 1920, height: 1080 }
}));

formData.append('video', videoBlob, 'recording.webm');
formData.append('audio', audioBlob, 'audio.webm');

const response = await fetch('http://localhost:3000/api/v1/recording/process-recording', {
  method: 'POST',
  body: formData
});

const result = await response.json();
console.log('Processing result:', result);
```

---

## 🎯 Summary

| Aspect | Details |
|--------|---------|
| **Endpoint** | `POST /api/v1/recording/process-recording` |
| **Data Format** | **FormData** (multipart/form-data) |
| **Events Field** | `events` (stringified JSON array) |
| **Max Size** | 50MB for events field |
| **Parsing** | `JSON.parse(req.body.events)` |
| **Middleware** | Multer with `.fields()` |
| **Location** | `src/controllers/recording-controller.js:129` |

---

## ⚠️ Common Mistakes to Avoid

1. **DON'T send events as raw JSON body** - Use FormData
2. **DON'T forget to stringify events** - Must be string in FormData
3. **DON'T set Content-Type header** - Browser handles it automatically
4. **DON'T exceed 50MB** for events field
5. **DO include sessionId** in metadata for proper tracking

---

## 🔍 Debugging Tips

### Check if events are received:
```javascript
// In recording-controller.js
console.log('Raw events from FormData:', req.body.events);
console.log('Parsed events:', JSON.parse(req.body.events));
console.log('Events count:', JSON.parse(req.body.events).length);
```

### Check Multer parsing:
```javascript
// In recording-routes.js
router.post("/process-recording",
  (req, res, next) => {
    console.log('FormData fields:', Object.keys(req.body));
    console.log('Files:', Object.keys(req.files || {}));
    next();
  },
  multer(/* ... */).fields([/* ... */]),
  recordingController.processRecording
);
```

---

## 📞 Related Endpoints

### Store DOM Events (Alternative)
```
POST /api/v1/frontend/store-events
```
Used for storing events separately (see `frontend-controller.js:327`)

### Trigger Fallback
```
POST /api/v1/frontend/trigger-fallback
```
Manually trigger DOM events fallback (see `frontend-controller.js:375`)

---

**Last Updated:** December 18, 2025
**Maintained by:** Clueso Development Team
