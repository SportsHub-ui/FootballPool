import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { requireRole } from '../middleware/auth';

export const winningsRouter = Router();

// GET /api/winnings - Get all winnings for a pool (organizer view)
winningsRouter.get('/pool/:poolId', requireRole('organizer'), async (req, res) => {
  try {
    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.params);

    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT wl.id,
                wl.game_id,
                wl.pool_id,
                wl.quarter,
                wl.winner_user_id,
                wl.amount_won,
                wl.payout_status,
                u.first_name,
                u.last_name,
                u.email,
                away.name AS opponent,
                COALESCE(g.kickoff_at, g.game_date::timestamp) AS game_dt
         FROM football_pool.winnings_ledger wl
         LEFT JOIN football_pool.users u ON wl.winner_user_id = u.id
         LEFT JOIN football_pool.game g ON wl.game_id = g.id
         LEFT JOIN football_pool.sport_team away ON away.id = g.away_team_id
         WHERE wl.pool_id = $1
         ORDER BY COALESCE(g.kickoff_at, g.game_date::timestamp) DESC, wl.quarter ASC`,
        [poolId]
      );

      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Winnings fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch winnings' });
    }
  }
});

// GET /api/winnings/user/:userId - Get winnings for a specific user across all pools
winningsRouter.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = z.object({ userId: z.coerce.number().int().positive() }).parse(req.params);

    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT wl.id,
                wl.game_id,
                wl.pool_id,
                wl.quarter,
                wl.amount_won,
                wl.payout_status,
                p.pool_name,
                away.name AS opponent,
                COALESCE(g.kickoff_at, g.game_date::timestamp) AS game_dt
         FROM football_pool.winnings_ledger wl
         LEFT JOIN football_pool.pool p ON wl.pool_id = p.id
         LEFT JOIN football_pool.game g ON wl.game_id = g.id
         LEFT JOIN football_pool.sport_team away ON away.id = g.away_team_id
         WHERE wl.winner_user_id = $1
         ORDER BY COALESCE(g.kickoff_at, g.game_date::timestamp) DESC, wl.quarter ASC`,
        [userId]
      );

      const totalWon = result.rows.reduce((sum, row) => sum + (row.amount_won || 0), 0);

      res.json({
        userId,
        totalWon,
        winnings: result.rows
      });
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('User winnings fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch user winnings' });
    }
  }
});

// GET /api/winnings/game/:gameId - Get all winnings for a specific game
winningsRouter.get('/game/:gameId', requireRole('organizer'), async (req, res) => {
  try {
    const { gameId } = z.object({ gameId: z.coerce.number().int().positive() }).parse(req.params);

    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT wl.id, wl.game_id, wl.pool_id, wl.quarter, wl.winner_user_id,
                wl.amount_won, wl.payout_status,
                u.first_name, u.last_name, u.email
         FROM football_pool.winnings_ledger wl
         LEFT JOIN football_pool.users u ON wl.winner_user_id = u.id
         WHERE wl.game_id = $1
         ORDER BY wl.quarter ASC`,
        [gameId]
      );

      res.json(result.rows);
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Game winnings fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch game winnings' });
    }
  }
});

// PATCH /api/winnings/:winningId/payout - Mark a winning as paid out
winningsRouter.patch('/:winningId/payout', requireRole('organizer'), async (req, res) => {
  try {
    const { winningId } = z.object({ winningId: z.coerce.number().int().positive() }).parse(req.params);

    const client = await db.connect();
    try {
      const result = await client.query(
        `UPDATE football_pool.winnings_ledger
         SET payout_status = 'paid'
         WHERE id = $1
         RETURNING id, game_id, pool_id, quarter, winner_user_id, amount_won, payout_status`,
        [winningId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Winning record not found' });
      }

      res.json({ message: 'Payout marked as paid', winning: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Payout update error:', error);
      res.status(500).json({ error: 'Failed to update payout status' });
    }
  }
});

