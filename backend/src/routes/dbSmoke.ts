import { Router } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { requireRole } from '../middleware/auth';
import { getApiUsageDashboard } from '../services/apiUsage';

export const dbSmokeRouter = Router();

dbSmokeRouter.get('/smoke', async (_req, res) => {
  try {
    const result = await db.query(
      `
        SELECT 'users' AS table_name, COUNT(*)::int AS row_count FROM football_pool.users
        UNION ALL
        SELECT 'team' AS table_name, COUNT(*)::int AS row_count FROM football_pool.team
        UNION ALL
        SELECT 'player_team' AS table_name, COUNT(*)::int AS row_count FROM football_pool.player_team
        UNION ALL
        SELECT 'pool' AS table_name, COUNT(*)::int AS row_count FROM football_pool.pool
        UNION ALL
        SELECT 'square' AS table_name, COUNT(*)::int AS row_count FROM football_pool.square
        UNION ALL
        SELECT 'game' AS table_name, COUNT(*)::int AS row_count FROM football_pool.game
        UNION ALL
        SELECT 'game_square_numbers' AS table_name, COUNT(*)::int AS row_count FROM football_pool.game_square_numbers
        UNION ALL
        SELECT 'winnings_ledger' AS table_name, COUNT(*)::int AS row_count FROM football_pool.winnings_ledger
        ORDER BY table_name
      `
    );

    res.json({
      status: 'ok',
      counts: result.rows
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Database query failed',
      detail: error instanceof Error ? error.message : 'Unknown database error'
    });
  }
});

dbSmokeRouter.get('/api-usage', requireRole('organizer'), async (req, res) => {
  try {
    const query = z
      .object({
        hours: z.coerce.number().int().positive().max(24 * 30).optional(),
        limit: z.coerce.number().int().positive().max(100).optional()
      })
      .safeParse(req.query);

    const dashboard = await getApiUsageDashboard({
      hours: query.success ? query.data.hours : undefined,
      limit: query.success ? query.data.limit : undefined
    });

    res.json({
      status: 'ok',
      ...dashboard
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Failed to load API usage dashboard',
      detail: error instanceof Error ? error.message : 'Unknown dashboard error'
    });
  }
});

dbSmokeRouter.get('/preview', async (_req, res) => {
  try {
    const result = await db.query(
      `
        SELECT
          p.id AS pool_id,
          p.pool_name,
          p.season,
          t.team_name,
          COUNT(s.id)::int AS total_squares,
          COUNT(s.id) FILTER (WHERE s.participant_id IS NOT NULL)::int AS sold_squares,
          MAX(g.game_dt) AS latest_game_dt
        FROM football_pool.pool p
        JOIN football_pool.team t ON t.id = p.team_id
        LEFT JOIN football_pool.square s ON s.pool_id = p.id
        LEFT JOIN football_pool.game g ON g.pool_id = p.id
        GROUP BY p.id, p.pool_name, p.season, t.team_name
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT 25
      `
    );

    res.json({
      status: 'ok',
      pools: result.rows
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Database query failed',
      detail: error instanceof Error ? error.message : 'Unknown database error'
    });
  }
});
