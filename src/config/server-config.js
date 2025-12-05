const dotenv = require('dotenv');

dotenv.config();

module.exports = {
    PORT: process.env.PORT,
    DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
    PYTHON_LAYER_URL: process.env.PYTHON_LAYER_URL || 'http://localhost:8000',
    PYTHON_SERVICE_TIMEOUT: parseInt(process.env.PYTHON_SERVICE_TIMEOUT || '30000', 10)
}