const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, isAdmin, isParticipationManager } = require('../middleware/authMiddleware');

// The request must pass authenticate AND (be an ADMIN OR manage this registration's event)
router.put(
    '/participation/:id/status', 
    authenticate, 
    isParticipationManager, 
    adminController.updateRegistrationStatus
);
// Add this below your existing admin routes
router.get('/audit-logs', authenticate, isAdmin, adminController.getScoreAuditLogs);

module.exports = router;