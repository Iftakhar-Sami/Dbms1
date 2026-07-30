const db = require('../config/db');

// POST /api/teams/register
exports.registerTeam = async (req, res) => {
    const { event_id, team_name, uids } = req.body;

    // Validate incoming data
    if (!event_id || !team_name || !uids || !Array.isArray(uids) || uids.length === 0) {
        return res.status(400).json({ error: 'Missing required fields or empty team.' });
    }

    // Get a dedicated connection from the pool for the transaction
    const connection = await db.getConnection();

    try {
        // 1. Start the transaction
        await connection.beginTransaction();

        // 2. Create the Team
        const [teamResult] = await connection.query(
            `INSERT INTO Teams (event_id, team_name) VALUES (?, ?)`,
            [event_id, team_name]
        );
        const team_id = teamResult.insertId;

        // 3. Add all Team Members
        // Format the uids array into an array of arrays for bulk insertion: [[team_id, uid1], [team_id, uid2]]
        const memberValues = uids.map(uid => [team_id, uid]);
        await connection.query(
            `INSERT INTO TeamMembers (team_id, uid) VALUES ?`,
            [memberValues]
        );

        // 4. Register the Team in Participation
        await connection.query(
            `INSERT INTO Participation (event_id, team_id) VALUES (?, ?)`,
            [event_id, team_id]
        );

        // 5. Commit the transaction if all queries succeed
        await connection.commit();
        
        res.status(201).json({ 
            message: 'Team successfully registered!', 
            team_id: team_id 
        });

    } catch (error) {
        // If ANY query fails (like a trigger firing), rollback everything
        await connection.rollback();
        console.error("Transaction failed, rolled back:", error.message);
        
        // Return the clean SQL trigger error message to the frontend
        res.status(400).json({ error: error.message });
    } finally {
        // Always release the connection back to the pool
        connection.release();
    }
};