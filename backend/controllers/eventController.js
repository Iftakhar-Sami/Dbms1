const db = require('../config/db');

const VALID_PARTICIPATION_TYPES = ['SOLO', 'TEAM', 'MULTIPLAYER'];

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

// GET /api/events/sports
// Lists existing sports, so the "Create event" form can suggest one
// instead of the admin risking a near-duplicate (e.g. "Uno" vs "UNO").
exports.getAllSports = async (req, res) => {
    try {
        const [rows] = await db.query(`SELECT sport_id, name FROM Sports ORDER BY name ASC`);
        res.status(200).json(rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch sports' });
    }
};

// POST /api/events
// Creates a new sport event. Admin only. If sport_name doesn't match an
// existing Sport, a new one is created for it automatically.
exports.createEvent = async (req, res) => {
    const { event_name, sport_name, participation_type, season_id } = req.body;

    if (!event_name || !event_name.trim()) {
        return res.status(400).json({ error: 'event_name is required.' });
    }
    if (!sport_name || !sport_name.trim()) {
        return res.status(400).json({ error: 'sport_name is required.' });
    }
    if (!VALID_PARTICIPATION_TYPES.includes(participation_type)) {
        return res.status(400).json({ error: `participation_type must be one of: ${VALID_PARTICIPATION_TYPES.join(', ')}.` });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        // Find or create the Sport
        const [existingSport] = await connection.query(
            `SELECT sport_id FROM Sports WHERE name = ?`,
            [sport_name.trim()]
        );
        let sport_id;
        if (existingSport.length > 0) {
            sport_id = existingSport[0].sport_id;
        } else {
            const [sportResult] = await connection.query(
                `INSERT INTO Sports (name) VALUES (?)`,
                [sport_name.trim()]
            );
            sport_id = sportResult.insertId;
        }

        // Resolve season: use whatever was passed in, or fall back to the most recent season
        let resolvedSeasonId = season_id || null;
        if (!resolvedSeasonId) {
            const [seasonRows] = await connection.query(`SELECT season_id FROM Seasons ORDER BY season_id DESC LIMIT 1`);
            resolvedSeasonId = seasonRows.length ? seasonRows[0].season_id : null;
        }

        const [result] = await connection.query(
            `INSERT INTO Events (event_name, participation_type, sport_id, season_id) VALUES (?, ?, ?, ?)`,
            [event_name.trim(), participation_type, sport_id, resolvedSeasonId]
        );

        await connection.commit();
        res.status(201).json({
            message: 'Event created!',
            event_id: result.insertId,
            sport_id,
            season_id: resolvedSeasonId,
        });
    } catch (error) {
        await connection.rollback();
        res.status(400).json({ error: error.message });
    } finally {
        connection.release();
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