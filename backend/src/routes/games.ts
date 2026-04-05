import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { requireRole } from '../middleware/auth';
import { importPoolScheduleFromEspn } from '../services/scheduleImport';
import { processGameScores } from '../services/scoreProcessing';

export const gamesRouter = Router();

// All game endpoints require organizer role
gamesRouter.use(requireRole('organizer'));

const createGameSchema = z.object({
  poolId: z.number().int().positive(),
  weekNum: z.number().int().min(1).max(25).nullable().optional(),
  opponent: z.string().min(1),
  gameDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date format'),
  isSimulation: z.boolean().optional().default(false)
});

const gameIdParamsSchema = z.object({
  gameId: z.coerce.number().int().positive()
});

const scoreUpdateSchema = z.object({
  q1PrimaryScore: z.number().int().nonnegative().nullable(),
  q1OpponentScore: z.number().int().nonnegative().nullable(),
  q2PrimaryScore: z.number().int().nonnegative().nullable(),
  q2OpponentScore: z.number().int().nonnegative().nullable(),
  q3PrimaryScore: z.number().int().nonnegative().nullable(),
  q3OpponentScore: z.number().int().nonnegative().nullable(),
  q4PrimaryScore: z.number().int().nonnegative().nullable(),
  q4OpponentScore: z.number().int().nonnegative().nullable()
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
         (id, pool_id, week_num, opponent, game_dt, is_simulation)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, pool_id, week_num, opponent, game_dt, is_simulation,
                   row_numbers, col_numbers,
                   q1_primary_score, q1_opponent_score, q2_primary_score, q2_opponent_score,
                   q3_primary_score, q3_opponent_score, q4_primary_score, q4_opponent_score`,
        [gameId, input.poolId, input.weekNum ?? null, input.opponent, input.gameDate, input.isSimulation]
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

// POST /api/games/import/pool/:poolId - Look up and auto-fill the season schedule for the pool's preferred team
gamesRouter.post('/import/pool/:poolId', async (req, res) => {
  try {
    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.params);

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await importPoolScheduleFromEspn(client, poolId);
      await client.query('COMMIT');

      return res.json({
        message: `Fill Schedule complete for ${result.teamName} (${result.season}). Added ${result.created} missing game(s) and skipped ${result.skipped} existing game(s).`,
        result
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }

    console.error('Game schedule import error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to import schedule'
    });
  }
});

// PATCH /api/games/:gameId - Update a game schedule
gamesRouter.patch('/:gameId', async (req, res) => {
  try {
    const { gameId } = gameIdParamsSchema.parse(req.params);
    const input = createGameSchema.parse(req.body);

    const client = await db.connect();
    try {
      const result = await client.query(
        `UPDATE football_pool.game
         SET pool_id = $2,
             week_num = $3,
             opponent = $4,
             game_dt = $5,
             is_simulation = $6
         WHERE id = $1
         RETURNING id, pool_id, week_num, opponent, game_dt, is_simulation,
                   row_numbers, col_numbers,
                   q1_primary_score, q1_opponent_score, q2_primary_score, q2_opponent_score,
                   q3_primary_score, q3_opponent_score, q4_primary_score, q4_opponent_score`,
        [gameId, input.poolId, input.weekNum ?? null, input.opponent, input.gameDate, input.isSimulation]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Game not found' });
      }

      res.json({ message: 'Game updated', game: result.rows[0] });
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Game update error:', error);
      res.status(500).json({ error: 'Failed to update game' });
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

// DELETE /api/games/:gameId - Delete a game schedule
gamesRouter.delete('/:gameId', async (req, res) => {
  try {
    const { gameId } = gameIdParamsSchema.parse(req.params);

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      const winningsCheck = await client.query<{ ref_count: number }>(
        `SELECT COUNT(*)::int AS ref_count
         FROM football_pool.winnings_ledger
         WHERE game_id = $1`,
        [gameId]
      );

      if ((winningsCheck.rows[0]?.ref_count ?? 0) > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Cannot delete a game that already has winnings recorded.' });
      }

      await client.query(
        `DELETE FROM football_pool.game_square_numbers
         WHERE game_id = $1`,
        [gameId]
      );

      const deleteResult = await client.query(
        `DELETE FROM football_pool.game
         WHERE id = $1
         RETURNING id`,
        [gameId]
      );

      if (deleteResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Game not found' });
      }

      await client.query('COMMIT');
      res.json({ message: 'Game deleted', id: gameId });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Game delete error:', error);
      res.status(500).json({ error: 'Failed to delete game' });
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
        `SELECT id, pool_id, week_num, opponent, game_dt, is_simulation,
                row_numbers, col_numbers,
                q1_primary_score, q1_opponent_score, q2_primary_score, q2_opponent_score,
                q3_primary_score, q3_opponent_score, q4_primary_score, q4_opponent_score
         FROM football_pool.game
         WHERE pool_id = $1
         ORDER BY COALESCE(week_num, 999), game_dt ASC, id ASC`,
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
        `SELECT id, pool_id, week_num, opponent, game_dt, is_simulation,
                row_numbers, col_numbers,
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
