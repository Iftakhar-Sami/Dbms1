const express = require('express');
const router = express.Router();
const teamController = require('../controllers/teamController');

router.post('/register', teamController.registerTeam);

module.exports = router;