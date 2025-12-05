const express = require('express');

const v1Routes = require('./v1');
const recording = require('./v1/recording-routes')
const router = express.Router();

router.use('/v1', v1Routes);
router.use("/recording", recording);

module.exports = router;