# Frontend Testing Guide

## Quick Start

### 1. Run the Test Script

```bash
node test-send-to-frontend.js
```

This will send existing recording data to the frontend via WebSocket.

### 2. Frontend Connection

Your frontend should connect like this:

```javascript
import io from 'socket.io-client';

const socket = io('http://localhost:3000');

// Register for the test session
socket.emit('register', 'session_1765089986708_lyv7icnrb');

// Listen for data
socket.on('video', (videoData) => {
  console.log('📹 Video received:', videoData);
  // Load video: http://localhost:3000/recordings/recording_session_1765089986708_lyv7icnrb_video.webm
});

socket.on('audio', (audioData) => {
  console.log('🎵 Audio received:', audioData);
  // Load audio: http://localhost:3000/recordings/processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm
  // Transcription: audioData.text
});

socket.on('instructions', (instruction) => {
  console.log('📋 Instruction received:', instruction);
  // Each event arrives separately
});
```

## Test Session Details

**Session ID**: `session_1765089986708_lyv7icnrb`

**Files Used**:
- **Video**: `src/recordings/recording_session_1765089986708_lyv7icnrb_video.webm` (7.26 MB)
- **Audio**: `recordings/processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm` (378 KB)
- **Events**: `src/recordings/recording_session_1765089986708_lyv7icnrb_1765090028574.json` (15 events)

**Recording Info**:
- URL: `https://vercel.com/tushar7436s-projects`
- Viewport: 1536x695
- Duration: ~42 seconds
- Events: 15 (clicks, scrolls)

## Available Commands

### Send Test Data
```bash
node test-send-to-frontend.js
```

### List All Available Sessions
```bash
node test-send-to-frontend.js --list
```

## Expected Output

```
🧪 FRONTEND TEST SCRIPT

============================================================
📤 SENDING TEST DATA TO FRONTEND
============================================================
Session ID: session_1765089986708_lyv7icnrb

🔍 Verifying files...
✅ All files found

📖 Loading events from JSON...
✅ Loaded 15 events
   URL: https://vercel.com/tushar7436s-projects
   Viewport: 1536x695

📹 Sending video to frontend...
✅ Video sent successfully
   Path: /recordings/recording_session_1765089986708_lyv7icnrb_video.webm
   Size: 6.93 MB

🎵 Sending audio to frontend...
✅ Audio sent successfully
   Path: /recordings/processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm
   Size: 0.37 MB
   Text: "Test transcription - This is processed audio from 11Labs"

📋 Sending 15 instructions to frontend...
✅ Sent 15 instructions successfully

============================================================
📊 SUMMARY
============================================================
Session ID: session_1765089986708_lyv7icnrb
Video: Sent
Audio: Sent
Instructions: Sent 15

💡 Frontend should connect with:
   socket.emit('register', 'session_1765089986708_lyv7icnrb');
============================================================
```

## Buffering Behavior

If no frontend is connected when you run the script:

```
⚠️  Video buffered (no client connected yet)
⚠️  Audio buffered (no client connected yet)
⚠️  All 15 instructions buffered (no client connected yet)
```

**Don't worry!** The data is stored in a queue and will be sent automatically when the frontend connects and registers.

## Frontend Integration Example

### Complete React Example

```javascript
import { useEffect, useState } from 'react';
import io from 'socket.io-client';

function RecordingPlayer() {
  const [videoUrl, setVideoUrl] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [transcription, setTranscription] = useState('');
  const [instructions, setInstructions] = useState([]);

  useEffect(() => {
    const socket = io('http://localhost:3000');
    
    // Register for session
    socket.emit('register', 'session_1765089986708_lyv7icnrb');
    
    socket.on('registered', (data) => {
      console.log('✅ Registered:', data);
    });
    
    socket.on('video', (videoData) => {
      console.log('📹 Video received:', videoData);
      setVideoUrl(`http://localhost:3000${videoData.path}`);
    });
    
    socket.on('audio', (audioData) => {
      console.log('🎵 Audio received:', audioData);
      setAudioUrl(`http://localhost:3000${audioData.path}`);
      setTranscription(audioData.text);
    });
    
    socket.on('instructions', (instruction) => {
      console.log('📋 Instruction received:', instruction);
      setInstructions(prev => [...prev, instruction]);
    });
    
    return () => socket.disconnect();
  }, []);

  return (
    <div>
      <h1>Recording Player</h1>
      
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
                {inst.type} - {inst.target?.text || inst.target?.tag}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

## Testing Workflow

1. **Start Node.js server** (already running ✅)
   ```bash
   npm run dev
   ```

2. **Run test script**
   ```bash
   node test-send-to-frontend.js
   ```

3. **Start your frontend**
   - Connect to `http://localhost:3000`
   - Register with session ID: `session_1765089986708_lyv7icnrb`

4. **Verify data received**
   - Check browser console for logs
   - Video should load and play
   - Audio should load and play
   - Instructions should appear in timeline

## Customizing Test Session

To use a different session, edit `test-send-to-frontend.js`:

```javascript
const TEST_SESSION = {
  sessionId: 'session_YOUR_SESSION_ID',
  videoFile: 'recording_session_YOUR_SESSION_ID_video.webm',
  audioFile: 'processed_audio_session_YOUR_SESSION_ID_timestamp.webm',
  eventsFile: 'recording_session_YOUR_SESSION_ID_timestamp.json'
};
```

Run `node test-send-to-frontend.js --list` to see all available sessions.

## Troubleshooting

### "File not found" error
- Check that files exist in the correct directories
- Video/Events: `src/recordings/`
- Audio: `recordings/`

### Frontend not receiving data
- Ensure frontend is connected to `http://localhost:3000`
- Verify session ID matches: `session_1765089986708_lyv7icnrb`
- Check browser console for WebSocket connection errors

### Video/Audio won't play
- Files are served from `/recordings/` endpoint
- Full URL: `http://localhost:3000/recordings/filename.webm`
- Check browser network tab for 404 errors

## File Access URLs

Once sent, files are accessible at:

- **Video**: `http://localhost:3000/recordings/recording_session_1765089986708_lyv7icnrb_video.webm`
- **Audio**: `http://localhost:3000/recordings/processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm`

You can test these URLs directly in your browser!
