import { Request, Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { db } from '../config/db';

export const landingRouter = Router();

const hasBearerToken = (req: Request): boolean => {
  const authHeader = req.header('Authorization');
  return Boolean(authHeader && authHeader.startsWith('Bearer '));
};

const getSignedInUserId = (req: Request): number | null => {
  if (!hasBearerToken(req) || !req.auth?.userId) {
    return null;
  }

  const parsed = Number(req.auth.userId);
  return Number.isFinite(parsed) ? parsed : null;
};

const loadAccessiblePool = async (client: PoolClient, poolId: number, userId: number | null) => {
  const result = await client.query(
    `SELECT p.id,
            p.pool_name,
            p.season,
            p.primary_team,
            COALESCE(p.default_flg, FALSE) AS default_flg,
            COALESCE(p.sign_in_req_flg, FALSE) AS sign_in_req_flg,
            t.team_name,
            t.primary_color,
            t.secondary_color,
            t.logo_file
     FROM football_pool.pool p
     LEFT JOIN football_pool.team t ON t.id = p.team_id
     LEFT JOIN football_pool.user_pool up
       ON up.pool_id = p.id
      AND up.user_id = $2
     WHERE p.id = $1
       AND (
         COALESCE(p.sign_in_req_flg, FALSE) = FALSE
         OR ($2::int IS NOT NULL AND up.user_id IS NOT NULL)
       )
     LIMIT 1`,
    [poolId, userId]
  );

  return result.rows[0] ?? null;
};

landingRouter.get('/pools', async (req, res) => {
  try {
    const userId = getSignedInUserId(req);
    const client = await db.connect();

    try {
      const result = await client.query(
        `SELECT p.id,
                p.pool_name,
                p.season,
                p.primary_team,
                COALESCE(p.default_flg, FALSE) AS default_flg,
                COALESCE(p.sign_in_req_flg, FALSE) AS sign_in_req_flg,
                t.team_name,
                t.primary_color,
                t.secondary_color,
                t.logo_file
         FROM football_pool.pool p
         LEFT JOIN football_pool.team t ON t.id = p.team_id
         LEFT JOIN football_pool.user_pool up
           ON up.pool_id = p.id
          AND up.user_id = $1
         WHERE COALESCE(p.sign_in_req_flg, FALSE) = FALSE
            OR ($1::int IS NOT NULL AND up.user_id IS NOT NULL)
         ORDER BY COALESCE(p.default_flg, FALSE) DESC,
                  COALESCE(t.team_name, p.primary_team, p.pool_name),
                  p.pool_name,
                  p.id`,
        [userId]
      );

      res.json({
        signedIn: userId !== null,
        pools: result.rows
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Landing pools error:', error);
    res.status(500).json({ error: 'Failed to fetch landing pools' });
  }
});

landingRouter.get('/pools/:poolId/games', async (req, res) => {
  try {
    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.params);
    const userId = getSignedInUserId(req);
    const client = await db.connect();

    try {
      const pool = await loadAccessiblePool(client, poolId, userId);

      if (!pool) {
        return res.status(404).json({ error: 'Pool not found or unavailable' });
      }

      const result = await client.query(
        `SELECT g.id,
                g.pool_id,
                g.opponent,
                g.game_dt,
                g.is_simulation,
                g.row_numbers,
                g.col_numbers,
                g.q1_primary_score,
                g.q1_opponent_score,
                g.q2_primary_score,
                g.q2_opponent_score,
                g.q3_primary_score,
                g.q3_opponent_score,
                g.q4_primary_score,
                g.q4_opponent_score
         FROM football_pool.game g
         WHERE g.pool_id = $1
         ORDER BY g.game_dt ASC, g.id ASC`,
        [poolId]
      );

      res.json({ pool, games: result.rows });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Landing games error:', error);
    res.status(500).json({ error: 'Failed to fetch games' });
  }
});

landingRouter.get('/pools/:poolId/board', async (req, res) => {
  try {
    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.params);
    const parsedQuery = z
      .object({ gameId: z.coerce.number().int().positive().optional() })
      .safeParse(req.query);
    const gameId = parsedQuery.success ? parsedQuery.data.gameId : undefined;
    const userId = getSignedInUserId(req);

    const client = await db.connect();
    try {
      const pool = await loadAccessiblePool(client, poolId, userId);

      if (!pool) {
        return res.status(404).json({ error: 'Pool not found or unavailable' });
      }

      const selectedGameResult = gameId
        ? await client.query(
            `SELECT id,
                    pool_id,
                    opponent,
                    game_dt,
                    row_numbers,
                    col_numbers,
                    q1_primary_score,
                    q1_opponent_score,
                    q2_primary_score,
                    q2_opponent_score,
                    q3_primary_score,
                    q3_opponent_score,
                    q4_primary_score,
                    q4_opponent_score
             FROM football_pool.game
             WHERE pool_id = $1
               AND id = $2
             LIMIT 1`,
            [poolId, gameId]
          )
        : await client.query(
            `SELECT id,
                    pool_id,
                    opponent,
                    game_dt,
                    row_numbers,
                    col_numbers,
                    q1_primary_score,
                    q1_opponent_score,
                    q2_primary_score,
                    q2_opponent_score,
                    q3_primary_score,
                    q3_opponent_score,
                    q4_primary_score,
                    q4_opponent_score
             FROM football_pool.game
             WHERE pool_id = $1
             ORDER BY CASE WHEN game_dt >= CURRENT_DATE THEN 0 ELSE 1 END,
                      game_dt ASC,
                      id ASC
             LIMIT 1`,
            [poolId]
          );

      const selectedGame = selectedGameResult.rows[0] ?? null;

      const squaresResult = await client.query(
        `WITH season_winners AS (
           SELECT ((g.q1_opponent_score % 10) * 10 + (g.q1_primary_score % 10) + 1) AS square_num,
                  p.q1_payout AS amount
           FROM football_pool.game g
           JOIN football_pool.pool p ON p.id = g.pool_id
           WHERE g.pool_id = $1
             AND g.q1_primary_score IS NOT NULL
             AND g.q1_opponent_score IS NOT NULL

           UNION ALL

           SELECT ((g.q2_opponent_score % 10) * 10 + (g.q2_primary_score % 10) + 1) AS square_num,
                  p.q2_payout AS amount
           FROM football_pool.game g
           JOIN football_pool.pool p ON p.id = g.pool_id
           WHERE g.pool_id = $1
             AND g.q2_primary_score IS NOT NULL
             AND g.q2_opponent_score IS NOT NULL

           UNION ALL

           SELECT ((g.q3_opponent_score % 10) * 10 + (g.q3_primary_score % 10) + 1) AS square_num,
                  p.q3_payout AS amount
           FROM football_pool.game g
           JOIN football_pool.pool p ON p.id = g.pool_id
           WHERE g.pool_id = $1
             AND g.q3_primary_score IS NOT NULL
             AND g.q3_opponent_score IS NOT NULL

           UNION ALL

           SELECT ((g.q4_opponent_score % 10) * 10 + (g.q4_primary_score % 10) + 1) AS square_num,
                  p.q4_payout AS amount
           FROM football_pool.game g
           JOIN football_pool.pool p ON p.id = g.pool_id
           WHERE g.pool_id = $1
             AND g.q4_primary_score IS NOT NULL
             AND g.q4_opponent_score IS NOT NULL
         ),
         current_game_winners AS (
           SELECT ((g.q1_opponent_score % 10) * 10 + (g.q1_primary_score % 10) + 1) AS square_num,
                  p.q1_payout AS amount
           FROM football_pool.game g
           JOIN football_pool.pool p ON p.id = g.pool_id
           WHERE g.pool_id = $1
             AND g.id = $2
             AND g.q1_primary_score IS NOT NULL
             AND g.q1_opponent_score IS NOT NULL

           UNION ALL

           SELECT ((g.q2_opponent_score % 10) * 10 + (g.q2_primary_score % 10) + 1) AS square_num,
                  p.q2_payout AS amount
           FROM football_pool.game g
           JOIN football_pool.pool p ON p.id = g.pool_id
           WHERE g.pool_id = $1
             AND g.id = $2
             AND g.q2_primary_score IS NOT NULL
             AND g.q2_opponent_score IS NOT NULL

           UNION ALL

           SELECT ((g.q3_opponent_score % 10) * 10 + (g.q3_primary_score % 10) + 1) AS square_num,
                  p.q3_payout AS amount
           FROM football_pool.game g
           JOIN football_pool.pool p ON p.id = g.pool_id
           WHERE g.pool_id = $1
             AND g.id = $2
             AND g.q3_primary_score IS NOT NULL
             AND g.q3_opponent_score IS NOT NULL

           UNION ALL

           SELECT ((g.q4_opponent_score % 10) * 10 + (g.q4_primary_score % 10) + 1) AS square_num,
                  p.q4_payout AS amount
           FROM football_pool.game g
           JOIN football_pool.pool p ON p.id = g.pool_id
           WHERE g.pool_id = $1
             AND g.id = $2
             AND g.q4_primary_score IS NOT NULL
             AND g.q4_opponent_score IS NOT NULL
         )
         SELECT s.id,
                s.square_num,
                s.participant_id,
                s.player_id,
                s.paid_flg,
                u.first_name AS participant_first_name,
                u.last_name AS participant_last_name,
                pt.jersey_num AS player_jersey_num,
                COALESCE((
                  SELECT SUM(cgw.amount)
                  FROM current_game_winners cgw
                  WHERE cgw.square_num = s.square_num
                ), 0)::int AS current_game_won,
                COALESCE((
                  SELECT SUM(sw.amount)
                  FROM season_winners sw
                  WHERE sw.square_num = s.square_num
                ), 0)::int AS season_won_total
         FROM football_pool.square s
         LEFT JOIN football_pool.users u ON u.id = s.participant_id
         LEFT JOIN football_pool.player_team pt ON pt.id = s.player_id
         WHERE s.pool_id = $1
         ORDER BY s.square_num`,
        [poolId, selectedGame?.id ?? null]
      );

      return res.json({
        board: {
          poolId,
          poolName: pool.pool_name,
          primaryTeam: pool.primary_team ?? pool.team_name ?? 'Preferred Team',
          opponent: selectedGame?.opponent ?? 'Opponent',
          gameId: selectedGame?.id ?? null,
          gameDate: selectedGame?.game_dt ?? null,
          teamName: pool.team_name,
          teamPrimaryColor: pool.primary_color ?? '#8a8f98',
          teamSecondaryColor: pool.secondary_color ?? '#233042',
          teamLogo: pool.logo_file ?? null,
          rowNumbers: Array.isArray(selectedGame?.row_numbers) ? selectedGame.row_numbers : null,
          colNumbers: Array.isArray(selectedGame?.col_numbers) ? selectedGame.col_numbers : null,
          squares: squaresResult.rows
        }
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Landing board error:', error);
    return res.status(500).json({ error: 'Failed to fetch board' });
  }
});
