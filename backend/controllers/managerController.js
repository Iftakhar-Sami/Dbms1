const db = require('../config/db');

// POST /api/managers
// Assigns a user to manage a specific event
exports.assignManager = async (req, res) => {
    const { uid, event_id } = req.body;
    
    try {
        await db.query(
            `INSERT INTO Managers (uid, event_id) VALUES (?, ?)`,
            [uid, event_id]
        );
        res.status(201).json({ message: 'Manager successfully assigned!' });
    } catch (error) {
        // Will catch FK violations (e.g., user doesn't exist) or duplicate assignments
        res.status(400).json({ error: error.message });
    }
};