const path = require('path');
const fs = require('fs');

// Import frontend service
const frontendService = require('./src/services/frontend-service');

console.log('');
console.log('🧪 FRONTEND TEST SCRIPT');
console.log('');

// Configuration - Use existing session files
const TEST_SESSION = {
    sessionId: 'session_1765089986708_lyv7icnrb',
    videoFile: 'recording_session_1765089986708_lyv7icnrb_video.webm',
    audioFile: 'processed_audio_session_1765089986708_lyv7icnrb_1765090041930.webm',
    eventsFile: 'recording_session_1765089986708_lyv7icnrb_1765090028574.json'
};

// File paths
const VIDEO_PATH = path.join(__dirname, 'src', 'recordings', TEST_SESSION.videoFile);
const AUDIO_PATH = path.join(__dirname, 'recordings', TEST_SESSION.audioFile);
const EVENTS_PATH = path.join(__dirname, 'src', 'recordings', TEST_SESSION.eventsFile);

console.log('='.repeat(60));
console.log('📤 SENDING TEST DATA TO FRONTEND');
console.log('='.repeat(60));
console.log(`Session ID: ${TEST_SESSION.sessionId}`);
console.log('');

// Verify files exist
console.log('🔍 Verifying files...');
if (!fs.existsSync(VIDEO_PATH)) {
    console.error(`❌ Video file not found: ${VIDEO_PATH}`);
    process.exit(1);
}
if (!fs.existsSync(AUDIO_PATH)) {
    console.error(`❌ Audio file not found: ${AUDIO_PATH}`);
    process.exit(1);
}
if (!fs.existsSync(EVENTS_PATH)) {
    console.error(`❌ Events file not found: ${EVENTS_PATH}`);
    process.exit(1);
}
console.log('✅ All files found');
console.log('');

// Load events from JSON file
console.log('📖 Loading events from JSON...');
const eventsData = JSON.parse(fs.readFileSync(EVENTS_PATH, 'utf8'));
const events = eventsData.events || [];
const metadata = {
    sessionId: eventsData.sessionId,
    startTime: eventsData.startTime,
    endTime: eventsData.endTime,
    url: eventsData.url,
    viewport: eventsData.viewport
};
console.log(`✅ Loaded ${events.length} events`);
console.log(`   URL: ${metadata.url}`);
console.log(`   Viewport: ${metadata.viewport.width}x${metadata.viewport.height}`);
console.log('');

// 1. Send Video
console.log('📹 Sending video to frontend...');
const videoData = {
    filename: TEST_SESSION.videoFile,
    path: `/recordings/${TEST_SESSION.videoFile}`,
    metadata: metadata,
    timestamp: new Date().toISOString()
};

const videoSent = frontendService.sendVideo(TEST_SESSION.sessionId, videoData);
if (videoSent) {
    console.log('✅ Video sent successfully');
    console.log(`   Path: ${videoData.path}`);
    console.log(`   Size: ${(fs.statSync(VIDEO_PATH).size / 1024 / 1024).toFixed(2)} MB`);
} else {
    console.log('⚠️  Video buffered (no client connected yet)');
}
console.log('');

// 2. Send Audio
console.log('🎵 Sending audio to frontend...');
const audioData = {
    filename: TEST_SESSION.audioFile,
    path: `/recordings/${TEST_SESSION.audioFile}`,
    text: "Test transcription - This is processed audio from 11Labs",
    timestamp: new Date().toISOString()
};

const audioSent = frontendService.sendAudio(TEST_SESSION.sessionId, audioData);
if (audioSent) {
    console.log('✅ Audio sent successfully');
    console.log(`   Path: ${audioData.path}`);
    console.log(`   Size: ${(fs.statSync(AUDIO_PATH).size / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Text: "${audioData.text}"`);
} else {
    console.log('⚠️  Audio buffered (no client connected yet)');
}
console.log('');

// 3. Send Instructions (Events)
console.log(`📋 Sending ${events.length} instructions to frontend...`);
let instructionsSent = 0;
events.forEach((event, index) => {
    const sent = frontendService.sendInstructions(TEST_SESSION.sessionId, event);
    if (sent) {
        instructionsSent++;
    }
});

if (instructionsSent > 0) {
    console.log(`✅ Sent ${instructionsSent} instructions successfully`);
} else {
    console.log(`⚠️  All ${events.length} instructions buffered (no client connected yet)`);
}
console.log('');

// Summary
console.log('='.repeat(60));
console.log('📊 SUMMARY');
console.log('='.repeat(60));
console.log(`Session ID: ${TEST_SESSION.sessionId}`);
console.log(`Video: ${videoSent ? 'Sent' : 'Buffered'}`);
console.log(`Audio: ${audioSent ? 'Sent' : 'Buffered'}`);
console.log(`Instructions: ${instructionsSent > 0 ? `Sent ${instructionsSent}` : `Buffered ${events.length}`}`);
console.log('');
console.log('💡 If data was buffered, it will be sent when frontend connects');
console.log('💡 Frontend should connect with:');
console.log(`   socket.emit('register', '${TEST_SESSION.sessionId}');`);
console.log('='.repeat(60));
console.log('');
