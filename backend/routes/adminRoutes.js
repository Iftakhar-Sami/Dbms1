const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, isAdmin } = require('../middleware/authMiddleware');

// The request must pass authenticate AND isAdmin before it reaches updateRegistrationStatus
router.put(
    '/participation/:id/status', 
    authenticate, 
    isAdmin, 
    adminController.updateRegistrationStatus
);
// Add this below your existing admin routes
router.get('/audit-logs', authenticate, isAdmin, adminController.getScoreAuditLogs);

module.exports = router;