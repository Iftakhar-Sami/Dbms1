const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');
const { authenticate, isAdmin } = require('../middleware/authMiddleware');

router.get('/', eventController.getAllEvents);
router.get('/sports', eventController.getAllSports);
router.post('/', authenticate, isAdmin, eventController.createEvent);
router.post('/register-solo', eventController.registerSolo);
router.get('/:id/report', eventController.getEventReport);

module.exports = router;