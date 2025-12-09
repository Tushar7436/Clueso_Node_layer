const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const { InfoController } = require('../../controllers');

const router = express.Router();

// store audio in /uploads folder
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '../../../uploads');
        if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        cb(null, `audio_${Date.now()}.mp3`);
    }
});
const upload = multer({ storage });


router.post('/upload-audio', upload.single('audio'), (req, res) => {
    console.log("Received audio from Python!");

    return res.json({
        message: "Audio received successfully",
        file: req.file.filename,
        text: req.body.text
    });
});
router.use("/recording", require("./recording-routes"));
router.use("/frontend", require("./frontend-routes"));
router.use("/python", require("./python-routes"));

router.get('/info', InfoController.info);

module.exports = router;

