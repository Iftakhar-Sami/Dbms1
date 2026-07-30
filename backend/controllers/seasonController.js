const db = require('../config/db');

// GET /api/seasons/:id/leaderboard
// Generates a points-based leaderboard for an entire Sports Week season
exports.getSeasonLeaderboard = async (req, res) => {
    const seasonId = req.params.id;

    try {
        const [leaderboard] = await db.query(`
            SELECT 
                COALESCE(u.name, t.team_name) AS competitor_name,
                COALESCE(u.registration_no, 'TEAM') AS identifier,
                COUNT(p.participation_id) AS events_played,
                SUM(
                    CASE 
                        WHEN p.competition_status = 'WINNER' OR p.final_rank = 1 THEN 10
                        WHEN p.competition_status = 'RUNNER_UP' OR p.final_rank = 2 THEN 5
                        ELSE 0 
                    END
                ) AS total_points
            FROM Participation p
            JOIN Events e ON p.event_id = e.event_id
            LEFT JOIN Users u ON p.uid = u.uid
            LEFT JOIN Teams t ON p.team_id = t.team_id
            WHERE e.season_id = ? 
              AND p.registration_status = 'ACCEPTED'
            GROUP BY competitor_name, identifier
            HAVING total_points > 0
            ORDER BY total_points DESC, events_played ASC
        `, [seasonId]);

        res.status(200).json({
            season_id: seasonId,
            standings: leaderboard
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to generate leaderboard.' });
    }
};