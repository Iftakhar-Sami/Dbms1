const express = require('express');
const router = express.Router();
const matchController = require('../controllers/matchController');
const { authenticate, isMatchManager, isEventManager } = require('../middleware/authMiddleware');



router.post('/', authenticate, isEventManager, matchController.createMatch);
router.post('/participants', authenticate, isMatchManager, matchController.addParticipant);
router.put('/score', authenticate, isMatchManager, matchController.updateScore);
// Mark match complete and advance winner
router.post('/:id/complete', authenticate, isMatchManager, matchController.completeMatch);
// Add a participant with temporal conflict checking
router.post('/participants/safe-add', authenticate, isMatchManager, matchController.safeAddParticipant);

module.exports = router;