const express = require('express');
const cors = require('cors'); // Import the cors middleware

const { ServerConfig, Logger } = require('./config');
const apiRoutes = require('./routes');
const recordingRoutes = require('./routes/v1/recording-routes');

const app = express();

// Enable CORS for all routes and origins (you can configure this further)
app.use(cors());

// IMPORTANT: Recording routes MUST come BEFORE global body parsers
// to prevent corruption of binary chunk data
app.use('/api/recording', recordingRoutes);

// Normal JSON and URL encoded parsers for other APIs
app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true }));

// All other API routes
app.use('/api', apiRoutes);

app.listen(ServerConfig.PORT, () => {
    console.log(`Successfully started server on PORT ${ServerConfig.PORT}`);
    Logger.info("Server started");
});