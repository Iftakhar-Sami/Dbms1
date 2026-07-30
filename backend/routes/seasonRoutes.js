const express = require('express');
const router = express.Router();
const seasonController = require('../controllers/seasonController');

router.get('/:id/leaderboard', seasonController.getSeasonLeaderboard);

module.exports = router;