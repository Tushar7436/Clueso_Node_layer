# 🎯 Quick Reference: DOM Events Data Format

## ✅ ANSWER: FormData (NOT JSON)

### 📍 Exact Location
**File:** `src/controllers/recording-controller.js`  
**Line:** `129`  
**Function:** `processRecording`

```javascript
const events = req.body.events ? JSON.parse(req.body.events) : [];
```

---

## 📦 Data Format Summary

| Property | Value |
|----------|-------|
| **HTTP Method** | `POST` |
| **Endpoint** | `/api/v1/recording/process-recording` |
| **Content-Type** | `multipart/form-data` |
| **Format** | **FormData** |
| **Events Field** | Stringified JSON array |
| **Middleware** | Multer |
| **Max Size** | 50MB |

---

## 🔧 Extension Code (How to Send)

```javascript
// ✅ CORRECT WAY
const formData = new FormData();

// Stringify events before appending
formData.append('events', JSON.stringify([
  { type: "click", timestamp: Date.now(), x: 100, y: 200 },
  { type: "input", timestamp: Date.now(), value: "text" }
]));

formData.append('metadata', JSON.stringify({
  sessionId: 'session_123',
  url: 'https://example.com'
}));

formData.append('video', videoBlob, 'recording.webm');
formData.append('audio', audioBlob, 'audio.webm');

// Send as FormData (NOT JSON)
fetch('http://localhost:3000/api/v1/recording/process-recording', {
  method: 'POST',
  body: formData  // ← FormData, NOT JSON.stringify()
});
```

---

## ❌ Common Mistakes

```javascript
// ❌ WRONG: Sending as JSON
fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ events: [...] })  // ← WRONG!
});

// ❌ WRONG: Not stringifying events
formData.append('events', events);  // ← WRONG! Must stringify

// ❌ WRONG: Setting Content-Type manually
fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'multipart/form-data' },  // ← WRONG! Browser sets this
  body: formData
});
```

---

## 📋 Event Structure

```javascript
{
  "type": "click",           // Required: Event type
  "timestamp": 1234567890,   // Required: Unix timestamp (ms)
  "target": {                // Required: Target element info
    "tagName": "BUTTON",
    "id": "submit-btn",
    "className": "btn primary",
    "textContent": "Submit",
    "bbox": {                // Required: Bounding box
      "x": 100,
      "y": 200,
      "width": 150,
      "height": 40
    }
  },
  "x": 125,                  // Optional: Mouse X (for clicks)
  "y": 220,                  // Optional: Mouse Y (for clicks)
  "value": "user input",     // Optional: Input value
  "url": "https://...",      // Optional: Current URL
  "viewport": {              // Optional: Viewport size
    "width": 1920,
    "height": 1080
  }
}
```

---

## 🔄 Processing Flow

```
Extension (FormData)
    ↓
POST /api/v1/recording/process-recording
    ↓
Multer Middleware (parses FormData)
    ↓
recording-controller.js:129
    ↓
JSON.parse(req.body.events)
    ↓
┌─────────────────┬──────────────────┬─────────────────┐
│                 │                  │                 │
Store in Memory   Send to Python    Fallback to       
(frontend-service) (python-controller) Frontend        
```

---

## 🧪 Testing

### cURL Test
```bash
curl -X POST http://localhost:3000/api/v1/recording/process-recording \
  -F "events=[{\"type\":\"click\",\"timestamp\":1234567890}]" \
  -F "metadata={\"sessionId\":\"test_123\"}" \
  -F "video=@test.webm" \
  -F "audio=@test.webm"
```

### Console Debug
```javascript
// In recording-controller.js:129
console.log('Raw events:', req.body.events);
console.log('Parsed events:', JSON.parse(req.body.events));
console.log('Event count:', JSON.parse(req.body.events).length);
```

---

## 📚 Related Files

- **Route:** `src/routes/v1/recording-routes.js:34-48`
- **Controller:** `src/controllers/recording-controller.js:127-237`
- **Service:** `src/services/frontend-service.js:215-224`
- **Docs:** `docs/DOM_EVENTS_DATA_FORMAT.md`

---

**Last Updated:** December 18, 2025
