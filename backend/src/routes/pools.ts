import { Router } from 'express';
import { db } from '../config/db';
import { requireRole } from '../middleware/auth';

export const poolsRouter = Router();

poolsRouter.get('/', requireRole('organizer', 'participant', 'player'), async (_req, res) => {
  const result = await db.query(
    `
      SELECT
        p.id,
        p.pool_name,
        p.season,
        t.team_name
      FROM football_pool.pool p
      JOIN football_pool.team t ON t.id = p.team_id
      ORDER BY p.created_at DESC
      LIMIT 100
    `
  );

  res.json(result.rows);
});
