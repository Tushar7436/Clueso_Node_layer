const express = require('express');
const http = require('http');
const cors = require('cors'); // Import the cors middleware

const { ServerConfig, Logger } = require('./config');
const apiRoutes = require('./routes');
const recordingRoutes = require('./routes/v1/recording-routes');
const pythonRoutes = require('./routes/v1/python-routes'); // Add python routes
const { FrontendService } = require('./services');

const app = express();
const httpServer = http.createServer(app);

// Initialize Socket.IO for frontend communication
FrontendService.initialize(httpServer);

// Enable CORS for all routes and origins (you can configure this further)
app.use(cors());

// Serve static files from uploads directory (for audio files)
app.use('/uploads', express.static('uploads'));

// Serve static files from recordings directory (for processed audio from Python)
app.use('/recordings', express.static('recordings'));

// Serve static files from src/recordings directory (for raw video/audio files)
app.use('/recordings', express.static('src/recordings'));

// IMPORTANT: Recording routes MUST come BEFORE global body parsers
// to prevent corruption of binary chunk data
app.use('/api/recording', recordingRoutes);

// Python AI processing routes
app.use('/api/python', pythonRoutes);

// Normal JSON and URL encoded parsers for other APIs
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// All other API routes
app.use('/api', apiRoutes);

httpServer.listen(ServerConfig.PORT, () => {
    console.log(`Successfully started server on PORT ${ServerConfig.PORT}`);
    Logger.info("Server started");
    Logger.info("Socket.IO server ready for frontend connections");
});