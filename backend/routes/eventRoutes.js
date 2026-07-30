const express = require('express');
const router = express.Router();
const eventController = require('../controllers/eventController');

router.get('/', eventController.getAllEvents);
router.post('/register-solo', eventController.registerSolo);
// Add this line below your existing routes in eventRoutes.js
router.get('/:id/report', eventController.getEventReport);

module.exports = router;