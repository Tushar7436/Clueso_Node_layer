# Demo Endpoint Usage Guide

## Quick Start

### Call the Demo Endpoint

Simply make a GET request to trigger sending test data to frontend:

```bash
curl http://localhost:3000/api/v1/frontend/demo-data
```

Or open in browser:
```
http://localhost:3000/api/v1/frontend/demo-data
```

## What It Does

The `/api/frontend/demo-data` endpoint:
1. ✅ Loads existing recording files from disk
2. ✅ Sends video via WebSocket (`video` event)
3. ✅ Sends audio via WebSocket (`audio` event)
4. ✅ Sends 15 instructions via WebSocket (`instructions` event)
5. ✅ Returns JSON response with details

## Response Format

```json
{
  "success": true,
  "message": "Demo data sent to frontend via WebSocket",
  "sessionId": "session_1765089986708_lyv7icnrb",
  "data": {
    "video": {
      "filename": "recording_session_1765089986708_lyv7icnrb_video.webm",
      "path": "/recordings/recording_session_1765089986708_lyv7icnrb_video.webm",
      "size": "6.93 MB"
    },
    "audio": {
      "filename": "processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm",
      "path": "/recordings/processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm",
      "size": "0.37 MB",
      "text": "Hello, guys. This is Tushar, and this is my website on Vercel."
    },
    "instructions": {
      "count": 15,
      "types": ["click", "scroll"]
    }
  },
  "note": "Data sent via WebSocket. Frontend should register with sessionId to receive it.",
  "frontendConnection": "socket.emit('register', 'session_1765089986708_lyv7icnrb')"
}
```

## Frontend Integration

### Step 1: Connect to WebSocket

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000');

// Register for the test session
socket.emit('register', 'session_1765089986708_lyv7icnrb');

socket.on('registered', (data) => {
  console.log('✅ Registered:', data);
});
```

### Step 2: Listen for Events

```javascript
socket.on('video', (videoData) => {
  console.log('📹 Video received:', videoData);
  // videoData.path = "/recordings/recording_session_1765089986708_lyv7icnrb_video.webm"
  const videoUrl = `http://localhost:3000${videoData.path}`;
  // Load video player with videoUrl
});

socket.on('audio', (audioData) => {
  console.log('🎵 Audio received:', audioData);
  // audioData.path = "/recordings/processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm"
  // audioData.text = "Hello, guys. This is Tushar..."
  const audioUrl = `http://localhost:3000${audioData.path}`;
  // Load audio player with audioUrl and display transcription
});

socket.on('instructions', (instruction) => {
  console.log('📋 Instruction received:', instruction);
  // Each instruction arrives separately (15 total)
  // instruction.type = "click" or "scroll"
  // instruction.target = { tag, classes, text, selector, bbox }
});
```

### Step 3: Trigger Demo Data

```javascript
// Call the demo endpoint
fetch('http://localhost:3000/api/v1/frontend/demo-data')
  .then(res => res.json())
  .then(data => {
    console.log('Demo data triggered:', data);
    // WebSocket events will start arriving
  });
```

## Complete React Example

```javascript
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

function DemoPlayer() {
  const [socket, setSocket] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [transcription, setTranscription] = useState('');
  const [instructions, setInstructions] = useState([]);

  useEffect(() => {
    // Connect to WebSocket
    const newSocket = io('http://localhost:3000');
    setSocket(newSocket);
    
    // Register for session
    newSocket.emit('register', 'session_1765089986708_lyv7icnrb');
    
    newSocket.on('registered', (data) => {
      console.log('✅ Registered:', data);
    });
    
    newSocket.on('video', (videoData) => {
      console.log('📹 Video received:', videoData);
      setVideoUrl(`http://localhost:3000${videoData.path}`);
    });
    
    newSocket.on('audio', (audioData) => {
      console.log('🎵 Audio received:', audioData);
      setAudioUrl(`http://localhost:3000${audioData.path}`);
      setTranscription(audioData.text);
    });
    
    newSocket.on('instructions', (instruction) => {
      console.log('📋 Instruction received:', instruction);
      setInstructions(prev => [...prev, instruction]);
    });
    
    return () => newSocket.disconnect();
  }, []);

  const loadDemoData = () => {
    fetch('http://localhost:3000/api/v1/frontend/demo-data')
      .then(res => res.json())
      .then(data => {
        console.log('✅ Demo data triggered:', data);
      })
      .catch(err => {
        console.error('❌ Error:', err);
      });
  };

  return (
    <div>
      <h1>Demo Recording Player</h1>
      
      <button onClick={loadDemoData}>
        Load Demo Data
      </button>
      
      {videoUrl && (
        <div>
          <h2>Video</h2>
          <video src={videoUrl} controls width="800" />
        </div>
      )}
      
      {audioUrl && (
        <div>
          <h2>Audio</h2>
          <audio src={audioUrl} controls />
          <p><strong>Transcription:</strong> {transcription}</p>
        </div>
      )}
      
      {instructions.length > 0 && (
        <div>
          <h2>Instructions ({instructions.length})</h2>
          <ul>
            {instructions.map((inst, i) => (
              <li key={i}>
                <strong>{inst.type}</strong> - {inst.target?.text || inst.target?.tag}
                {inst.timestamp && ` (${inst.timestamp}ms)`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default DemoPlayer;
```

## Testing Workflow

### 1. Start Node.js Server
```bash
npm run dev
```
Server is already running ✅

### 2. Test the Endpoint
```bash
curl http://localhost:3000/api/v1/frontend/demo-data
```

You should see a JSON response with file details.

### 3. Connect Frontend
- Open your frontend application
- Connect to `http://localhost:3000` via Socket.IO
- Register with session ID: `session_1765089986708_lyv7icnrb`
- Call the demo endpoint
- Watch the WebSocket events arrive!

## Buffering Behavior

**If frontend connects AFTER calling the endpoint:**
- All data is buffered in a queue
- When frontend registers, all buffered messages are sent immediately
- No data is lost!

**If frontend connects BEFORE calling the endpoint:**
- Data is sent immediately as it's generated
- No buffering needed

## File Access

Files are served statically from `/recordings/`:

- **Video**: `http://localhost:3000/recordings/recording_session_1765089986708_lyv7icnrb_video.webm`
- **Audio**: `http://localhost:3000/recordings/processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm`

You can test these URLs directly in your browser!

## Advantages

✅ **No Recording Needed** - Use existing files  
✅ **Fast Testing** - Instant data delivery  
✅ **Repeatable** - Call endpoint multiple times  
✅ **Real Data** - Uses actual recording files  
✅ **Easy Integration** - Simple HTTP GET request

## Troubleshooting

### "File not found" error
Check that files exist:
- Video: `src/recordings/recording_session_1765089986708_lyv7icnrb_video.webm`
- Audio: `recordings/processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm`
- Events: `src/recordings/recording_session_1765089986708_lyv7icnrb_1765090028574.json`

### Frontend not receiving data
1. Ensure frontend is connected to WebSocket
2. Verify session ID matches: `session_1765089986708_lyv7icnrb`
3. Check browser console for connection errors
4. Check server logs for WebSocket events

### CORS errors
CORS is enabled in `src/index.js`. If you still see errors, check your frontend URL.
