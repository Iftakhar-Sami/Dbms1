const db = require('../config/db');

// GET /api/events
exports.getAllEvents = async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT e.event_id, e.event_name, e.participation_type, s.name as sport_name
            FROM Events e
            JOIN Sports s ON e.sport_id = s.sport_id
        `);
        res.status(200).json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch events' });
    }
};

// POST /api/events/register-solo
exports.registerSolo = async (req, res) => {
    const { event_id, uid } = req.body;
    try {
        const [result] = await db.query(
            `INSERT INTO Participation (event_id, uid) VALUES (?, ?)`,
            [event_id, uid]
        );
        res.status(201).json({ message: 'Successfully registered!', id: result.insertId });
    } catch (error) {
        // This catches your custom SQLSTATE 45000 errors from the triggers!
        res.status(400).json({ error: error.message });
    }
};


// GET /api/events/:id/report
// Fetches the event details and a unified list of all participants
exports.getEventReport = async (req, res) => {
    const eventId = req.params.id;

    try {
        // 1. Get basic event details
        const [eventRows] = await db.query(`
            SELECT e.event_name, e.participation_type, s.name AS sport_name
            FROM Events e
            JOIN Sports s ON e.sport_id = s.sport_id
            WHERE e.event_id = ?
        `, [eventId]);

        if (eventRows.length === 0) {
            return res.status(404).json({ error: 'Event not found' });
        }

        // 2. The Complex Query: Unifying Solo and Team participants
        const [participants] = await db.query(`
            SELECT 
                p.participation_id,
                p.registration_status,
                p.competition_status,
                COALESCE(u.name, t.team_name) AS participant_name,
                COALESCE(u.registration_no, 'TEAM') AS identifier
            FROM Participation p
            LEFT JOIN Users u ON p.uid = u.uid
            LEFT JOIN Teams t ON p.team_id = t.team_id
            WHERE p.event_id = ?
        `, [eventId]);

        res.status(200).json({
            event: eventRows[0],
            total_participants: participants.length,
            participants: participants
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate event report' });
    }
};