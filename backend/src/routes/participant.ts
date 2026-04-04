import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/db';

export const participantRouter = Router();

// Any authenticated user can access these endpoints
// They can only see pools they're participants in

// GET /api/participant/pools - Get all pools user is in
participantRouter.get('/pools', async (req, res) => {
  try {
    if (!req.auth) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userId = Number(req.auth.userId);

    const client = await db.connect();
    try {
      // Get pools where user has assigned squares
      const result = await client.query(
        `SELECT DISTINCT p.id, p.pool_name, p.season, p.primary_team,
                p.square_cost, p.q1_payout, p.q2_payout, p.q3_payout, p.q4_payout,
                t.team_name, COUNT(DISTINCT s.id) as total_squares,
                COUNT(CASE WHEN s.participant_id = $1 THEN 1 END) as user_squares
         FROM football_pool.pool p
         LEFT JOIN football_pool.team t ON p.team_id = t.id
         LEFT JOIN football_pool.square s ON p.id = s.pool_id
         WHERE s.participant_id = $1
         GROUP BY p.id, t.team_name
         ORDER BY p.id DESC`,
        [userId]
      );

      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Participant pools error:', error);
    res.status(500).json({ error: 'Failed to fetch pools' });
  }
});

// GET /api/participant/pools/:poolId/squares - Get user's squares in a pool
participantRouter.get('/pools/:poolId/squares', async (req, res) => {
  try {
    if (!req.auth) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.params);
    const userId = Number(req.auth.userId);

    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT s.id, s.square_num, s.paid_flg, s.participant_id, s.player_id,
                u.first_name, u.last_name,
                p.first_name as player_first_name, p.last_name as player_last_name
         FROM football_pool.square s
         LEFT JOIN football_pool.users u ON s.participant_id = u.id
         LEFT JOIN football_pool.player_team pt ON s.player_id = pt.id
         LEFT JOIN football_pool.users p ON pt.user_id = p.id
         WHERE s.pool_id = $1 AND s.participant_id = $2
         ORDER BY s.square_num`,
        [poolId, userId]
      );

      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('User squares error:', error);
    res.status(500).json({ error: 'Failed to fetch squares' });
  }
});

// GET /api/participant/winnings - Get user's winnings across all pools
participantRouter.get('/winnings', async (req, res) => {
  try {
    if (!req.auth) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const userId = Number(req.auth.userId);

    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT wl.id, wl.game_id, wl.pool_id, wl.quarter, wl.amount_won, wl.payout_status,
                p.pool_name, g.opponent, g.game_dt
         FROM football_pool.winnings_ledger wl
         LEFT JOIN football_pool.pool p ON wl.pool_id = p.id
         LEFT JOIN football_pool.game g ON wl.game_id = g.id
         WHERE wl.winner_user_id = $1
         ORDER BY g.game_dt DESC, wl.quarter ASC`,
        [userId]
      );

      const totalWon = result.rows.reduce((sum, row) => sum + (row.amount_won || 0), 0);
      const totalPending = result.rows
        .filter(row => row.payout_status === 'pending')
        .reduce((sum, row) => sum + (row.amount_won || 0), 0);

      res.json({
        userId,
        totalWon,
        totalPending,
        winnings: result.rows
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('User winnings error:', error);
    res.status(500).json({ error: 'Failed to fetch winnings' });
  }
});

// GET /api/participant/pools/:poolId/games - Get games for a pool with results
participantRouter.get('/pools/:poolId/games', async (req, res) => {
  try {
    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.params);

    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT g.id, g.pool_id, g.opponent, g.game_dt, g.is_simulation,
                g.q1_primary_score, g.q1_opponent_score, g.q2_primary_score, g.q2_opponent_score,
                g.q3_primary_score, g.q3_opponent_score, g.q4_primary_score, g.q4_opponent_score
         FROM football_pool.game g
         WHERE g.pool_id = $1
         ORDER BY g.game_dt DESC`,
        [poolId]
      );

      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Pool games error:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// GET /api/participant/pools/:poolId/board - Full 10x10 board with season win coloring data
participantRouter.get('/pools/:poolId/board', async (req, res) => {
  try {
    if (!req.auth) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.params);
    const gameQuery = z.object({ gameId: z.coerce.number().int().positive().optional() }).safeParse(req.query);
    const gameId = gameQuery.success ? gameQuery.data.gameId : undefined;

    const client = await db.connect();
    try {
      const poolResult = await client.query(
        `SELECT p.id, p.pool_name, p.primary_team,
                t.team_name, t.primary_color, t.secondary_color, t.logo_file
         FROM football_pool.pool p
         LEFT JOIN football_pool.team t ON t.id = p.team_id
         WHERE p.id = $1`,
        [poolId]
      );

      if (poolResult.rows.length === 0) {
        return res.status(404).json({ error: 'Pool not found' });
      }

      const gameResult = gameId
        ? await client.query(
            `SELECT id, opponent, game_dt
             FROM football_pool.game
             WHERE pool_id = $1 AND id = $2
             LIMIT 1`,
            [poolId, gameId]
          )
        : { rows: [] };

      const selectedGame = gameResult.rows[0] ?? null;

      const squaresResult = await client.query(
        `WITH quarter_winners AS (
           SELECT g.pool_id, ((g.q1_opponent_score % 10) * 10 + (g.q1_primary_score % 10) + 1) AS square_num, p.q1_payout AS amount
           FROM football_pool.game g
           JOIN football_pool.pool p ON p.id = g.pool_id
           WHERE g.pool_id = $1 AND g.q1_primary_score IS NOT NULL AND g.q1_opponent_score IS NOT NULL

           UNION ALL

           SELECT g.pool_id, ((g.q2_opponent_score % 10) * 10 + (g.q2_primary_score % 10) + 1) AS square_num, p.q2_payout AS amount
           FROM football_pool.game g
           JOIN football_pool.pool p ON p.id = g.pool_id
           WHERE g.pool_id = $1 AND g.q2_primary_score IS NOT NULL AND g.q2_opponent_score IS NOT NULL

           UNION ALL

           SELECT g.pool_id, ((g.q3_opponent_score % 10) * 10 + (g.q3_primary_score % 10) + 1) AS square_num, p.q3_payout AS amount
           FROM football_pool.game g
           JOIN football_pool.pool p ON p.id = g.pool_id
           WHERE g.pool_id = $1 AND g.q3_primary_score IS NOT NULL AND g.q3_opponent_score IS NOT NULL

           UNION ALL

           SELECT g.pool_id, ((g.q4_opponent_score % 10) * 10 + (g.q4_primary_score % 10) + 1) AS square_num, p.q4_payout AS amount
           FROM football_pool.game g
           JOIN football_pool.pool p ON p.id = g.pool_id
           WHERE g.pool_id = $1 AND g.q4_primary_score IS NOT NULL AND g.q4_opponent_score IS NOT NULL
         )
         SELECT s.id,
                s.square_num,
                s.participant_id,
                s.player_id,
                s.paid_flg,
                u.first_name AS participant_first_name,
                u.last_name AS participant_last_name,
                pt.jersey_num AS player_jersey_num,
                COUNT(qw.square_num)::int AS wins_count,
                COALESCE(SUM(qw.amount), 0)::int AS won_total
         FROM football_pool.square s
         LEFT JOIN football_pool.users u ON u.id = s.participant_id
         LEFT JOIN football_pool.player_team pt ON pt.id = s.player_id
         LEFT JOIN quarter_winners qw ON qw.pool_id = s.pool_id AND qw.square_num = s.square_num
         WHERE s.pool_id = $1
         GROUP BY s.id, s.square_num, s.participant_id, s.player_id, s.paid_flg, u.first_name, u.last_name, pt.jersey_num
         ORDER BY s.square_num`,
        [poolId]
      );

      return res.json({
        board: {
          poolId,
          poolName: poolResult.rows[0].pool_name,
          primaryTeam: poolResult.rows[0].primary_team,
          opponent: selectedGame?.opponent ?? 'Detroit Lions',
          gameId: selectedGame?.id ?? null,
          gameDate: selectedGame?.game_dt ?? null,
          teamName: poolResult.rows[0].team_name,
          teamPrimaryColor: poolResult.rows[0].primary_color ?? '#fbbc04',
          teamSecondaryColor: poolResult.rows[0].secondary_color ?? '#111111',
          teamLogo: poolResult.rows[0].logo_file ?? null,
          squares: squaresResult.rows
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Pool board error:', error);
    return res.status(500).json({ error: 'Failed to fetch pool board' });
  }
});
