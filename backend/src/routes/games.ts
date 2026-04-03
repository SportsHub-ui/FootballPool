import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { requireRole } from '../middleware/auth';
import { processGameScores } from '../services/scoreProcessing';

export const gamesRouter = Router();

// All game endpoints require organizer role
gamesRouter.use(requireRole('organizer'));

const createGameSchema = z.object({
  poolId: z.number().int().positive(),
  opponent: z.string().min(1),
  gameDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date format'),
  isSimulation: z.boolean().optional().default(false)
});

const scoreUpdateSchema = z.object({
  q1PrimaryScore: z.number().int().nonnegative(),
  q1OpponentScore: z.number().int().nonnegative(),
  q2PrimaryScore: z.number().int().nonnegative(),
  q2OpponentScore: z.number().int().nonnegative(),
  q3PrimaryScore: z.number().int().nonnegative(),
  q3OpponentScore: z.number().int().nonnegative(),
  q4PrimaryScore: z.number().int().nonnegative(),
  q4OpponentScore: z.number().int().nonnegative()
});

// POST /api/games - Create a new game
gamesRouter.post('/', async (req, res) => {
  try {
    const input = createGameSchema.parse(req.body);

    const client = await db.connect();
    try {
      // Generate next game ID (simulated sequence)
      const idResult = await client.query(
        'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM football_pool.game'
      );
      const gameId = idResult.rows[0].next_id;

      const result = await client.query(
        `INSERT INTO football_pool.game 
         (id, pool_id, opponent, game_dt, is_simulation)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, pool_id, opponent, game_dt, is_simulation, 
                   q1_primary_score, q1_opponent_score, q2_primary_score, q2_opponent_score,
                   q3_primary_score, q3_opponent_score, q4_primary_score, q4_opponent_score`,
        [gameId, input.poolId, input.opponent, input.gameDate, input.isSimulation]
      );

      res.json({ message: 'Game created', game: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Game creation error:', error);
      res.status(500).json({ error: 'Failed to create game' });
    }
  }
});

// PATCH /api/games/:gameId/scores - Update game scores and calculate winners
gamesRouter.patch('/:gameId/scores', async (req, res) => {
  try {
    const { gameId } = z.object({ gameId: z.coerce.number().int().positive() }).parse(req.params);
    const scores = scoreUpdateSchema.parse(req.body);

    const result = await processGameScores(gameId, scores);

    res.json({
      message: 'Scores updated and winners calculated',
      ...result
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else if (error instanceof Error && error.message === 'Game not found') {
      res.status(404).json({ error: error.message });
    } else if (error instanceof Error && error.message === 'Pool not found') {
      res.status(404).json({ error: error.message });
    } else {
      console.error('Score update error:', error);
      res.status(500).json({ error: 'Failed to update scores' });
    }
  }
});

// GET /api/games - List all games for a pool
gamesRouter.get('/', async (req, res) => {
  try {
    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.query);

    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT id, pool_id, opponent, game_dt, is_simulation,
                q1_primary_score, q1_opponent_score, q2_primary_score, q2_opponent_score,
                q3_primary_score, q3_opponent_score, q4_primary_score, q4_opponent_score
         FROM football_pool.game
         WHERE pool_id = $1
         ORDER BY game_dt DESC`,
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
      console.error('Games list error:', error);
      res.status(500).json({ error: 'Failed to fetch games' });
    }
  }
});

// GET /api/games/:gameId - Get a specific game
gamesRouter.get('/:gameId', async (req, res) => {
  try {
    const { gameId } = z.object({ gameId: z.coerce.number().int().positive() }).parse(req.params);

    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT id, pool_id, opponent, game_dt, is_simulation,
                q1_primary_score, q1_opponent_score, q2_primary_score, q2_opponent_score,
                q3_primary_score, q3_opponent_score, q4_primary_score, q4_opponent_score
         FROM football_pool.game
         WHERE id = $1`,
        [gameId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Game not found' });
      }

      res.json(result.rows[0]);
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Game fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch game' });
    }
  }
});
