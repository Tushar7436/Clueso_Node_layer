# Frontend Integration - Two Approaches

## Current Approach (Manual Trigger)

### Frontend Code:
```javascript
import io from 'socket.io-client';

// 1. Connect to WebSocket
const socket = io('http://localhost:3000');

// 2. Register for session
socket.emit('register', 'session_1765089986708_lyv7icnrb');

// 3. Listen for events
socket.on('video', (data) => {
  console.log('Video:', data);
  const videoUrl = `http://localhost:3000${data.path}`;
});

socket.on('audio', (data) => {
  console.log('Audio:', data);
  const audioUrl = `http://localhost:3000${data.path}`;
});

socket.on('instructions', (data) => {
  console.log('Instruction:', data);
});

// 4. Trigger demo data (call this when you want the data)
function loadDemoData() {
  fetch('http://localhost:3000/api/v1/frontend/demo-data')
    .then(res => res.json())
    .then(data => console.log('Demo data triggered:', data));
}

// Call it when needed (e.g., button click)
loadDemoData();
```

## Alternative Approach (Auto-send on Registration)

If you want data sent automatically when frontend registers, I can modify the registration handler to check for a special session ID and auto-trigger the demo data.

### Would you like me to implement auto-send?

Let me know and I can add this feature!

## Testing the Current Setup

### Step 1: Restart Server
The server needs to restart to pick up the static file serving changes.

```bash
# Stop current server (Ctrl+C)
# Then restart:
npm run dev
```

### Step 2: Test File Access
Open these URLs in browser:

**Video** (should now work):
```
http://localhost:3000/recordings/recording_session_1765089986708_lyv7icnrb_video.webm
```

**Audio** (should work):
```
http://localhost:3000/recordings/processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm
```

### Step 3: Test Full Flow

```javascript
// In your frontend
const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('✅ Connected to WebSocket');
  
  // Register for session
  socket.emit('register', 'session_1765089986708_lyv7icnrb');
});

socket.on('registered', (data) => {
  console.log('✅ Registered:', data);
  
  // Now trigger demo data
  fetch('http://localhost:3000/api/v1/frontend/demo-data')
    .then(res => res.json())
    .then(data => {
      console.log('✅ Demo data triggered:', data);
    });
});

socket.on('video', (videoData) => {
  console.log('📹 Video received:', videoData);
  // videoData.path = "/recordings/recording_session_1765089986708_lyv7icnrb_video.webm"
});

socket.on('audio', (audioData) => {
  console.log('🎵 Audio received:', audioData);
  // audioData.path = "/recordings/processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm"
});

socket.on('instructions', (instruction) => {
  console.log('📋 Instruction received:', instruction);
});
```

## Why Files Are Now Accessible

Before:
- `/recordings` → served from `recordings/` only
- Video in `src/recordings/` → ❌ Not accessible

After:
- `/recordings` → served from both `recordings/` AND `src/recordings/`
- Video in `src/recordings/` → ✅ Accessible
- Audio in `recordings/` → ✅ Still accessible

Express will check both directories when serving `/recordings/*` URLs.
