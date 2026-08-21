import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { db } from '../config/db';

export const fundraiserGamesRouter = Router();

// GET /api/games - List all games for current season
fundraiserGamesRouter.get('/', async (_req, res) => {
  try {
    const result = await db.query(
      `
        SELECT 
          g.id,
          g.season,
          g.game_type,
          g.opponent,
          g.game_dt,
          g.is_complete,
          g.q1_primary_score,
          g.q2_primary_score,
          g.q3_primary_score,
          g.q4_primary_score,
          g.q1_opponent_score,
          g.q2_opponent_score,
          g.q3_opponent_score,
          g.q4_opponent_score
        FROM football_pool.game g
        WHERE g.season = EXTRACT(YEAR FROM CURRENT_DATE)
        ORDER BY g.game_dt ASC
      `
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching games:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

// GET /api/games/:gameId/squares - Get board state for a game
fundraiserGamesRouter.get('/:gameId/squares', async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId, 10);

    // Get game info
    const gameResult = await db.query(
      `SELECT * FROM football_pool.game WHERE id = $1`,
      [gameId]
    );

    if (gameResult.rows.length === 0) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    // Get squares for this game
    const squaresResult = await db.query(
      `
        SELECT 
          id,
          square_num,
          player_name,
          row_digit,
          col_digit
        FROM football_pool.square
        WHERE game_id = $1
        ORDER BY square_num ASC
      `,
      [gameId]
    );

    // Get board numbers
    const numbersResult = await db.query(
      `
        SELECT row_numbers, col_numbers
        FROM football_pool.game_board_numbers
        WHERE game_id = $1
      `,
      [gameId]
    );

    res.json({
      game: gameResult.rows[0],
      squares: squaresResult.rows,
      boardNumbers: numbersResult.rows[0] || { row_numbers: [], col_numbers: [] }
    });
  } catch (error) {
    console.error('Error fetching squares:', error);
    res.status(500).json({ error: 'Failed to fetch squares' });
  }
});

// POST /api/games/:gameId/add-player - Add player to a square
const addPlayerSchema = z.object({
  squareNum: z.number().int().min(1).max(100),
  playerName: z.string().trim().min(1).max(100)
});

fundraiserGamesRouter.post('/:gameId/add-player', async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId, 10);
    const { squareNum, playerName } = addPlayerSchema.parse(req.body);

    // Check if square exists and is available
    const squareResult = await db.query(
      `
        SELECT id, player_name
        FROM football_pool.square
        WHERE game_id = $1 AND square_num = $2
      `,
      [gameId, squareNum]
    );

    if (squareResult.rows.length === 0) {
      res.status(404).json({ error: 'Square not found' });
      return;
    }

    const square = squareResult.rows[0];
    if (square.player_name) {
      res.status(409).json({ error: 'Square already assigned' });
      return;
    }

    // Update square with player name
    await db.query(
      `UPDATE football_pool.square SET player_name = $1 WHERE id = $2`,
      [playerName, square.id]
    );

    res.json({ success: true, message: 'Player assigned to square' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }

    console.error('Error adding player:', error);
    res.status(500).json({ error: 'Failed to add player' });
  }
});

// POST /api/games/:gameId/remove-player - Remove player from square
const removePlayerSchema = z.object({
  squareNum: z.number().int().min(1).max(100)
});

fundraiserGamesRouter.post('/:gameId/remove-player', async (req, res) => {
  try {
    const gameId = parseInt(req.params.gameId, 10);
    const { squareNum } = removePlayerSchema.parse(req.body);

    const result = await db.query(
      `
        UPDATE football_pool.square 
        SET player_name = NULL 
        WHERE game_id = $1 AND square_num = $2
        RETURNING id
      `,
      [gameId, squareNum]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Square not found' });
      return;
    }

    res.json({ success: true, message: 'Player removed from square' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Invalid input', details: error.errors });
      return;
    }

    console.error('Error removing player:', error);
    res.status(500).json({ error: 'Failed to remove player' });
  }
});
