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
    // The match id can arrive as a route param named "id" (e.g. POST /:id/complete),
    // a route param named "matchId", or in the request body (e.g. PUT /score).
    const matchId = req.body.match_id || req.params.matchId || req.params.id;

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

// 4. Row-Level Authorization: Is this user the manager of THIS specific event?
// (used for actions like creating a match, where there's no match_id yet)
exports.isEventManager = async (req, res, next) => {
    if (req.user.role === 'ADMIN') return next();

    const uid = req.user.uid;
    const eventId = req.body.event_id || req.params.eventId;

    try {
        const [rows] = await db.query(
            `SELECT uid FROM Managers WHERE uid = ? AND event_id = ?`,
            [uid, eventId]
        );

        if (rows.length === 0) {
            return res.status(403).json({ error: 'Forbidden: You do not manage this event.' });
        }

        next();
    } catch (error) {
        res.status(500).json({ error: 'Manager verification failed.' });
    }
};

// 5. Row-Level Authorization: Is this user an Admin, OR the manager of the event
// that this Participation (registration) record belongs to?
// Lets an approved manager accept/reject registrations for their own event,
// while admins can still act on any event.
exports.isParticipationManager = async (req, res, next) => {
    if (req.user.role === 'ADMIN') return next();

    const uid = req.user.uid;
    const participationId = req.params.id;

    try {
        const [rows] = await db.query(`
            SELECT mgr.uid
            FROM Managers mgr
            JOIN Participation p ON p.event_id = mgr.event_id
            WHERE mgr.uid = ? AND p.participation_id = ?
        `, [uid, participationId]);

        if (rows.length === 0) {
            return res.status(403).json({ error: 'Forbidden: You do not manage the event this registration belongs to.' });
        }

        next();
    } catch (error) {
        res.status(500).json({ error: 'Manager verification failed.' });
    }
};