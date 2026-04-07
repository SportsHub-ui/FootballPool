import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { requireRole } from '../middleware/auth';
import { importPoolScheduleFromEspn } from '../services/scheduleImport';
import { ingestGameScores } from '../services/scoreIngestion';

export const gamesRouter = Router();

// All game endpoints require organizer role
gamesRouter.use(requireRole('organizer'));

const createGameSchema = z.object({
  poolId: z.number().int().positive(),
  weekNum: z.number().int().min(1).max(25).nullable().optional(),
  homeTeamId: z.number().int().positive(),
  awayTeamId: z.number().int().positive(),
  gameDate: z.string().refine((d) => !isNaN(Date.parse(d)), 'Invalid date format'),
  isSimulation: z.boolean().optional().default(false),
  rowNumbers: z.any().optional(),
  columnNumbers: z.any().optional()
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

// POST /api/games - Create a new game (normalized)
gamesRouter.post('/', async (req, res) => {
  try {
    const input = createGameSchema.parse(req.body);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Insert into game_new if not exists (unique by season, week, home, away, date)
      const gameResult = await client.query(
        `INSERT INTO football_pool.game_new (season_year, week_number, home_team_id, away_team_id, game_date, state, scores_by_quarter, created_at, updated_at)
         VALUES (
           (SELECT season FROM football_pool.pool WHERE id = $1),
           $2, $3, $4, $5, 'not_started', '{}'::jsonb, NOW(), NOW()
         )
         ON CONFLICT (season_year, week_number, home_team_id, away_team_id, game_date)
         DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [input.poolId, input.weekNum, input.homeTeamId, input.awayTeamId, input.gameDate]
      );
      const gameId = gameResult.rows[0].id;
      // Insert into pool_game
      const poolGameResult = await client.query(
        `INSERT INTO football_pool.pool_game (pool_id, game_id, row_numbers, column_numbers, created_at, updated_at)
         VALUES ($1, $2, $3, $4, NOW(), NOW())
         ON CONFLICT (pool_id, game_id) DO UPDATE SET updated_at = NOW()
         RETURNING *`,
        [input.poolId, gameId, input.rowNumbers ?? null, input.columnNumbers ?? null]
      );
      await client.query('COMMIT');
      res.json({ message: 'Game created', poolGame: poolGameResult.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
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

// PATCH /api/games/:gameId - Update a game schedule (normalized)
gamesRouter.patch('/:gameId', async (req, res) => {
  try {
    const { gameId } = gameIdParamsSchema.parse(req.params);
    const input = createGameSchema.parse(req.body);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      // Update game_new metadata
      await client.query(
        `UPDATE football_pool.game_new
         SET week_number = $1, game_date = $2, updated_at = NOW()
         WHERE id = $3`,
        [input.weekNum, input.gameDate, gameId]
      );
      // Update pool_game row/col numbers
      const poolGameResult = await client.query(
        `UPDATE football_pool.pool_game
         SET row_numbers = $1, column_numbers = $2, updated_at = NOW()
         WHERE game_id = $3 AND pool_id = $4
         RETURNING *`,
        [input.rowNumbers ?? null, input.columnNumbers ?? null, gameId, input.poolId]
      );
      await client.query('COMMIT');
      if (poolGameResult.rows.length === 0) {
        return res.status(404).json({ error: 'Game not found for this pool' });
      }
      res.json({ message: 'Game updated', poolGame: poolGameResult.rows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
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

// PATCH /api/games/:gameId/scores - Update game scores and calculate winners (normalized)
gamesRouter.patch('/:gameId/scores', async (req, res) => {
  try {
    const { gameId } = z.object({ gameId: z.coerce.number().int().positive() }).parse(req.params);
    const scores = scoreUpdateSchema.parse(req.body);
    const result = await ingestGameScores(gameId, 'payload', scores, { forceProcess: true });

    res.json({ message: 'Scores updated and winners calculated', ...result });
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

// DELETE /api/games/:gameId - Delete a game schedule (normalized)
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
      // Delete from pool_game first
      await client.query(
        `DELETE FROM football_pool.pool_game WHERE game_id = $1`,
        [gameId]
      );
      // Delete from game_new
      const deleteResult = await client.query(
        `DELETE FROM football_pool.game_new WHERE id = $1 RETURNING id`,
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

// GET /api/games - List all games for a pool (normalized)
gamesRouter.get('/', async (req, res) => {
  try {
    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.query);
    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT pg.id as pool_game_id, pg.pool_id, pg.row_numbers, pg.column_numbers,
                g.id as game_id, g.season_year, g.week_number, g.game_date, g.state, g.scores_by_quarter, g.current_quarter, g.time_remaining_in_quarter,
                g.final_score_home, g.final_score_away,
                home.name as home_team, home.primary_color as home_color, home.logo_url as home_logo,
                away.name as away_team, away.primary_color as away_color, away.logo_url as away_logo
         FROM football_pool.pool_game pg
         JOIN football_pool.game_new g ON g.id = pg.game_id
         JOIN football_pool.nfl_team home ON g.home_team_id = home.id
         JOIN football_pool.nfl_team away ON g.away_team_id = away.id
         WHERE pg.pool_id = $1
         ORDER BY g.week_number, g.game_date, g.id`,
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

// GET /api/games/:gameId - Get a specific game (normalized)
gamesRouter.get('/:gameId', async (req, res) => {
  try {
    const { gameId } = z.object({ gameId: z.coerce.number().int().positive() }).parse(req.params);
    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT pg.id as pool_game_id, pg.pool_id, pg.row_numbers, pg.column_numbers,
                g.id as game_id, g.season_year, g.week_number, g.game_date, g.state, g.scores_by_quarter, g.current_quarter, g.time_remaining_in_quarter,
                g.final_score_home, g.final_score_away,
                home.name as home_team, home.primary_color as home_color, home.logo_url as home_logo,
                away.name as away_team, away.primary_color as away_color, away.logo_url as away_logo
         FROM football_pool.pool_game pg
         JOIN football_pool.game_new g ON g.id = pg.game_id
         JOIN football_pool.nfl_team home ON g.home_team_id = home.id
         JOIN football_pool.nfl_team away ON g.away_team_id = away.id
         WHERE pg.game_id = $1
         LIMIT 1`,
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
