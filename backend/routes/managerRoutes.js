const express = require('express');
const router = express.Router();
const managerController = require('../controllers/managerController');
const { authenticate, isAdmin } = require('../middleware/authMiddleware');

router.post('/', authenticate, isAdmin, managerController.assignManager);

module.exports = router;