const db = require('../config/db');

// GET /api/users/:uid/schedule
exports.getUserSchedule = async (req, res) => {
    const uid = req.params.uid;

    try {
        const [schedule] = await db.query(`
            SELECT 
                m.match_id, 
                e.event_name, 
                s.name AS sport_name,
                m.stage, 
                m.start_time, 
                m.venue,
                m.match_status
            FROM Matches m
            JOIN Events e ON m.event_id = e.event_id
            JOIN Sports s ON e.sport_id = s.sport_id
            JOIN MatchParticipants mp ON m.match_id = mp.match_id
            JOIN Participation p ON mp.participation_id = p.participation_id
            LEFT JOIN TeamMembers tm ON p.team_id = tm.team_id
            WHERE p.uid = ? OR tm.uid = ?
            ORDER BY m.start_time ASC
        `, [uid, uid]);

        res.status(200).json(schedule);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch schedule' });
    }
};