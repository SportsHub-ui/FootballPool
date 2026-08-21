import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../config/db';
import { env } from '../config/env';

export const fundraiserAdminRouter = Router();

// Simple API key auth for admin endpoints
const adminAuth = (req: Request, res: Response, next: NextFunction) => {
  const apiKey = req.headers['x-admin-key'];
  
  // Use environment variable for admin key (must be set before running)
  const expectedKey = process.env.FUNDRAISER_ADMIN_KEY;
  
  if (!expectedKey) {
    res.status(500).json({ error: 'Admin key not configured' });
    return;
  }
  
  if (apiKey !== expectedKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  
  next();
};

fundraiserAdminRouter.use(adminAuth);

// POST /api/admin/games/create - Add a new game
const createGameSchema = z.object({
  season: z.number().int().min(2020),
  gameType: z.enum(['NFL', 'MADNESS']),
  opponent: z.string().trim().min(1).max(100),
  gameDate: z.string().refine((d) => !Number.isNaN(Date.parse(d)), 'Invalid date'),
  rowNumbers: z.array(z.number()).optional(),
  colNumbers: z.array(z.number()).optional()
});

fundraiserAdminRouter.post('/games/create', async (req, res) => {
  try {
    const data = createGameSchema.parse(req.body);
    
    // Insert game
    const gameResult = await db.query(
      `
        INSERT INTO football_pool.game (season, game_type, opponent, game_dt, is_complete)
        VALUES ($1, $2, $3, $4, FALSE)
        RETURNING id
      `,
      [data.season, data.gameType, data.opponent, data.gameDate]
    );

    const gameId = gameResult.rows[0].id;

    // Insert board numbers if provided
    if (data.rowNumbers && data.colNumbers) {
      await db.query(
        `
          INSERT INTO football_pool.game_board_numbers (game_id, row_numbers, col_numbers)
          VALUES ($1, $2, $3)
        `,
        [gameId, JSON.stringify(data.rowNumbers), JSON.stringify(data.colNumbers)]
      );
    }

    // Create 100 squares for this game
    for (let i = 1; i <= 100; i++) {
      await db.query(
        `
          INSERT INTO football_pool.square (game_id, square_num)
          VALUES ($1, $2)
        `,
        [gameId, i]
      );
    }

    res.json({ 
      success: true, 
      gameId, 
      message: `Game created with ${100} squares` 
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }

    console.error('Error creating game:', error);
    res.status(500).json({ error: 'Failed to create game' });
  }
});

// POST /api/admin/games/:gameId/update-scores - Update game scores
const updateScoresSchema = z.object({
  q1PrimaryScore: z.number().int().min(0).optional(),
  q1OpponentScore: z.number().int().min(0).optional(),
  q2PrimaryScore: z.number().int().min(0).optional(),
  q2OpponentScore: z.number().int().min(0).optional(),
  q3PrimaryScore: z.number().int().min(0).optional(),
  q3OpponentScore: z.number().int().min(0).optional(),
  q4PrimaryScore: z.number().int().min(0).optional(),
  q4OpponentScore: z.number().int().min(0).optional(),
  isComplete: z.boolean().optional()
});

fundraiserAdminRouter.post('/games/:gameId/update-scores', async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId, 10);
    const data = updateScoresSchema.parse(req.body);

    const updateFields = Object.entries(data)
      .map(([key, value]) => {
        const dbKey = key
          .replace(/([A-Z])/g, '_$1')
          .toLowerCase()
          .slice(1);
        return { key: dbKey, value };
      });

    if (updateFields.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    let query = 'UPDATE football_pool.game SET ';
    query += updateFields.map((f, i) => `${f.key} = $${i + 1}`).join(', ');
    query += ` WHERE id = $${updateFields.length + 1} RETURNING id`;

    const values = [...updateFields.map(f => f.value), gameId];

    const result = await db.query(query, values);

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    res.json({ success: true, message: 'Game scores updated' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }

    console.error('Error updating scores:', error);
    res.status(500).json({ error: 'Failed to update scores' });
  }
});

// GET /api/admin/pool/stats - Get pool statistics
fundraiserAdminRouter.get('/pool/stats', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        (SELECT COUNT(*) FROM football_pool.square WHERE player_name IS NOT NULL) as assigned_squares,
        (SELECT COUNT(*) FROM football_pool.square) as total_squares,
        (SELECT COUNT(DISTINCT player_name) FROM football_pool.square WHERE player_name IS NOT NULL) as unique_players,
        (SELECT COUNT(*) FROM football_pool.game) as total_games
    `);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});
