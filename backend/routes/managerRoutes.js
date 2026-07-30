const express = require('express');
const router = express.Router();
const managerController = require('../controllers/managerController');

router.post('/', managerController.assignManager);

module.exports = router;