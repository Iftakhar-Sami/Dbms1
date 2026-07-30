const db = require('../config/db');

// 1. Authenticate: Checks who the user is
exports.authenticate = async (req, res, next) => {
    // In a real app, this would be a decoded JWT token. 
    // For today, we just read the raw user ID from the HTTP headers.
    const uid = req.headers['x-user-id'];
    
    if (!uid) {
        return res.status(401).json({ error: 'Unauthorized: Missing x-user-id header' });
    }

    try {
        const [rows] = await db.query(`SELECT uid, role FROM Users WHERE uid = ?`, [uid]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Unauthorized: User does not exist' });
        }

        // Attach the user data to the request object so the next functions can use it
        req.user = rows[0]; 
        next(); // Proceed to the next step
    } catch (error) {
        res.status(500).json({ error: 'Auth middleware database error' });
    }
};

// 2. Authorize: Checks if they are an Admin
exports.isAdmin = (req, res, next) => {
    if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Forbidden: You must be an ADMIN to do this' });
    }
    next(); // Proceed to the controller
};

// 3. Row-Level Authorization: Is this user the manager of THIS specific match?
exports.isMatchManager = async (req, res, next) => {
    // If they are an Admin, they can do anything, so let them pass
    if (req.user.role === 'ADMIN') return next();

    const uid = req.user.uid;
    const matchId = req.body.match_id || req.params.matchId;

    try {
        // Query to check if this user manages the event that this match belongs to
        const [rows] = await db.query(`
            SELECT m.uid 
            FROM Managers m
            JOIN Matches mt ON m.event_id = mt.event_id
            WHERE m.uid = ? AND mt.match_id = ?
        `, [uid, matchId]);

        if (rows.length === 0) {
            return res.status(403).json({ error: 'Forbidden: You do not manage this event.' });
        }
        
        next();
    } catch (error) {
        res.status(500).json({ error: 'Manager verification failed.' });
    }
};