const db = require('../config/db');
const { hasScheduleConflict } = require('../utils/conflictChecker');

// A 1v1 event (SOLO or TEAM participation) can only ever have 2 sides in a match.
// MULTIPLAYER events aren't capped here since group size varies.
const ONE_V_ONE_CAP = 2;

// Shared guard used by addParticipant and safeAddParticipant:
// - confirms the match exists
// - blocks adding the same participation twice
// - blocks exceeding 2 participants on a SOLO/TEAM (1v1) match
// Returns { error, status } if the add should be rejected, or null if it's fine.
async function checkCanAddParticipant(match_id, participation_id) {
    const [matchRows] = await db.query(`
        SELECT e.participation_type,
               (SELECT COUNT(*) FROM MatchParticipants WHERE match_id = ?) AS current_count
        FROM Matches m
        JOIN Events e ON m.event_id = e.event_id
        WHERE m.match_id = ?
    `, [match_id, match_id]);

    if (matchRows.length === 0) {
        return { status: 404, error: 'Match does not exist.' };
    }

    const [dupeRows] = await db.query(
        `SELECT 1 FROM MatchParticipants WHERE match_id = ? AND participation_id = ?`,
        [match_id, participation_id]
    );
    if (dupeRows.length > 0) {
        return { status: 409, error: 'This participant is already in the match.' };
    }

    const { participation_type, current_count } = matchRows[0];
    if (participation_type !== 'MULTIPLAYER' && current_count >= ONE_V_ONE_CAP) {
        return { status: 409, error: `This is a 1v1 match — it already has the maximum of ${ONE_V_ONE_CAP} participants.` };
    }

    return null;
}

// POST /api/matches
// Creates an empty scheduled match for an event
exports.createMatch = async (req, res) => {
    const { event_id, stage, start_time, end_time, venue } = req.body;
    
    try {
        const [result] = await db.query(
            `INSERT INTO Matches (event_id, stage, start_time, end_time, venue) 
             VALUES (?, ?, ?, ?, ?)`,
            [event_id, stage, start_time, end_time, venue]
        );
        res.status(201).json({ message: 'Match scheduled!', match_id: result.insertId });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
};

// POST /api/matches/participants
// Adds a registered user/team to a match using their participation_id
exports.addParticipant = async (req, res) => {
    const { match_id, participation_id } = req.body;

    try {
        const capacityError = await checkCanAddParticipant(match_id, participation_id);
        if (capacityError) {
            return res.status(capacityError.status).json({ error: capacityError.error });
        }

        await db.query(
            `INSERT INTO MatchParticipants (match_id, participation_id) VALUES (?, ?)`,
            [match_id, participation_id]
        );
        res.status(201).json({ message: 'Participant successfully added to match!' });
    } catch (error) {
        // This catches your trigger that ensures they belong to the correct event
        res.status(400).json({ error: error.message });
    }
};

// PUT /api/matches/score
// Updates the score for a specific participant in a match
// PUT /api/matches/score
// Updates the score and writes an immutable record to the Audit Log
exports.updateScore = async (req, res) => {
    const { match_id, participation_id, score, is_winner } = req.body;
    const manager_uid = req.user.uid; // Provided by authMiddleware

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // 1. Fetch the old score before we overwrite it
        const [oldData] = await connection.query(
            `SELECT score FROM MatchParticipants WHERE match_id = ? AND participation_id = ?`,
            [match_id, participation_id]
        );

        if (oldData.length === 0) {
            throw new Error('Participant not found in this match.');
        }
        
        const old_score = oldData[0].score;

        // 2. Update the actual score
        await connection.query(
            `UPDATE MatchParticipants SET score = ?, is_winner = ? 
             WHERE match_id = ? AND participation_id = ?`,
            [score, is_winner, match_id, participation_id]
        );

        // 3. Write to the Audit Trail
        // We only log if the score actually changed, preventing spam.
        if (old_score !== score) {
            await connection.query(
                `INSERT INTO ScoreAuditLogs (match_id, participation_id, manager_uid, old_score, new_score)
                 VALUES (?, ?, ?, ?, ?)`,
                [match_id, participation_id, manager_uid, old_score, score]
            );
        }

        await connection.commit();
        res.status(200).json({ message: 'Score updated and audit log recorded!' });

    } catch (error) {
        await connection.rollback();
        res.status(500).json({ error: error.message });
    } finally {
        connection.release();
    }
};

// POST /api/matches/:id/complete
// Marks a match as completed and auto-advances the winner to the next bracket
exports.completeMatch = async (req, res) => {
    const matchId = req.params.id;

    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();

        // 1. Update the match status
        await connection.query(
            `UPDATE Matches SET match_status = 'COMPLETED' WHERE match_id = ?`,
            [matchId]
        );

        // 2. Find the winner and the next_match_id
        const [matchData] = await connection.query(`
            SELECT m.next_match_id, mp.participation_id
            FROM Matches m
            JOIN MatchParticipants mp ON m.match_id = mp.match_id
            WHERE m.match_id = ? AND mp.is_winner = TRUE
        `, [matchId]);

        if (matchData.length === 0) {
            throw new Error('No winner found for this match.');
        }

        const nextMatchId = matchData[0].next_match_id;
        const winnerId = matchData[0].participation_id;

        // 3. If there is a next match (it's not the grand final), push the winner forward
        if (nextMatchId) {
            await connection.query(
                `INSERT INTO MatchParticipants (match_id, participation_id) VALUES (?, ?)`,
                [nextMatchId, winnerId]
            );
        } else {
            // If next_match_id is NULL, this was the final. Update their final_rank!
            await connection.query(
                `UPDATE Participation SET competition_status = 'WINNER', final_rank = 1 WHERE participation_id = ?`,
                [winnerId]
            );
        }

        await connection.commit();
        res.status(200).json({ message: 'Match completed. Bracket updated automatically!' });

    } catch (error) {
        await connection.rollback();
        res.status(400).json({ error: error.message });
    } finally {
        connection.release();
    }
};


// POST /api/matches/participants/safe-add
// Adds a participant ONLY if no team members are double-booked
exports.safeAddParticipant = async (req, res) => {
    const { match_id, participation_id } = req.body;

    try {
        // 1. Get the match times
        const [matchRows] = await db.query(
            `SELECT start_time, end_time FROM Matches WHERE match_id = ?`, 
            [match_id]
        );
        if (matchRows.length === 0 || !matchRows[0].start_time) {
            return res.status(400).json({ error: 'Match does not exist or has no scheduled time.' });
        }
        const { start_time, end_time } = matchRows[0];

        // 2. Enforce match capacity / no duplicate participants
        const capacityError = await checkCanAddParticipant(match_id, participation_id);
        if (capacityError) {
            return res.status(capacityError.status).json({ error: capacityError.error });
        }

        // 3. Find all UIDs involved in this participation (Solo or Team)
        const [users] = await db.query(`
            SELECT u.uid, u.name 
            FROM Participation p
            LEFT JOIN TeamMembers tm ON p.team_id = tm.team_id
            JOIN Users u ON (p.uid = u.uid OR tm.uid = u.uid)
            WHERE p.participation_id = ?
        `, [participation_id]);

        // 4. Loop through every user and check for temporal overlaps
        for (const user of users) {
            const conflicts = await hasScheduleConflict(user.uid, start_time, end_time);
            
            if (conflicts) {
                return res.status(409).json({ 
                    error: 'Schedule Conflict Detected',
                    message: `${user.name} is already playing in another match during this time.`,
                    conflict_details: conflicts[0]
                });
            }
        }

        // 5. If we survive the loop, it's safe to insert
        await db.query(
            `INSERT INTO MatchParticipants (match_id, participation_id) VALUES (?, ?)`,
            [match_id, participation_id]
        );

        res.status(201).json({ message: 'Participant successfully and safely added to match!' });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};