const db = require('../config/db');

// PUT /api/admin/participation/:id/status
exports.updateRegistrationStatus = async (req, res) => {
    const participationId = req.params.id;
    const { status } = req.body; // Expects 'ACCEPTED' or 'REJECTED'

    if (!['ACCEPTED', 'REJECTED', 'PENDING'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status value' });
    }

    try {
        const [result] = await db.query(
            `UPDATE Participation SET registration_status = ? WHERE participation_id = ?`,
            [status, participationId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Participation record not found' });
        }

        res.status(200).json({ message: `Registration successfully marked as ${status}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// GET /api/admin/audit-logs
// Fetches the complete history of score changes
exports.getScoreAuditLogs = async (req, res) => {
    try {
        const [logs] = await db.query(`
            SELECT 
                al.log_id,
                e.event_name,
                m.stage,
                COALESCE(u.name, t.team_name) AS participant_name,
                manager.name AS changed_by_manager,
                al.old_score,
                al.new_score,
                al.changed_at
            FROM ScoreAuditLogs al
            JOIN Matches m ON al.match_id = m.match_id
            JOIN Events e ON m.event_id = e.event_id
            JOIN Participation p ON al.participation_id = p.participation_id
            LEFT JOIN Users u ON p.uid = u.uid
            LEFT JOIN Teams t ON p.team_id = t.team_id
            JOIN Users manager ON al.manager_uid = manager.uid
            ORDER BY al.changed_at DESC
        `);

        res.status(200).json(logs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch audit logs.' });
    }
};