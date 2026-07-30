const db = require('../config/db');

// Checks if a specific student is already booked during a given time window
exports.hasScheduleConflict = async (uid, startTime, endTime) => {
    const [conflicts] = await db.query(`
        SELECT 
            m.match_id, 
            e.event_name, 
            m.start_time, 
            m.end_time
        FROM Matches m
        JOIN Events e ON m.event_id = e.event_id
        JOIN MatchParticipants mp ON m.match_id = mp.match_id
        JOIN Participation p ON mp.participation_id = p.participation_id
        LEFT JOIN TeamMembers tm ON p.team_id = tm.team_id
        WHERE (p.uid = ? OR tm.uid = ?)
          AND m.match_status IN ('SCHEDULED', 'ONGOING')
          -- The Temporal Overlap Logic:
          AND m.start_time < ? 
          AND m.end_time > ?
    `, [uid, uid, endTime, startTime]);

    return conflicts.length > 0 ? conflicts : null;
};