import { Request, Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { db } from '../config/db';
import { ensurePoolSquaresInitialized } from '../services/poolSquares';

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

const canManageLandingMaintenance = (req: Request): boolean => req.auth?.role === 'organizer';

const loadAccessiblePools = async (client: PoolClient, userId: number | null) => {
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

  return result.rows;
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

const loadLandingTeams = async (client: PoolClient, userId: number | null, canManage: boolean) => {
  if (canManage) {
    const result = await client.query(
      `SELECT
          id,
          team_name,
          primary_color,
          secondary_color,
          logo_file,
          FALSE AS default_flg
       FROM football_pool.team
       ORDER BY team_name NULLS LAST, id`
    );

    return result.rows;
  }

  const result = await client.query(
    `SELECT *
     FROM (
       SELECT DISTINCT
              t.id,
              t.team_name,
              t.primary_color,
              t.secondary_color,
              t.logo_file,
              COALESCE(p.default_flg, FALSE) AS default_flg
       FROM football_pool.pool p
       JOIN football_pool.team t ON t.id = p.team_id
       LEFT JOIN football_pool.user_pool up
         ON up.pool_id = p.id
        AND up.user_id = $1
       WHERE COALESCE(p.sign_in_req_flg, FALSE) = FALSE
          OR ($1::int IS NOT NULL AND up.user_id IS NOT NULL)
     ) accessible_teams
     ORDER BY default_flg DESC,
              team_name NULLS LAST,
              id`,
    [userId]
  );

  return result.rows;
};

landingRouter.get('/pools', async (req, res) => {
  try {
    const userId = getSignedInUserId(req);
    const client = await db.connect();

    try {
      const pools = await loadAccessiblePools(client, userId);

      res.json({
        signedIn: userId !== null,
        pools
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Landing pools error:', error);
    res.status(500).json({ error: 'Failed to fetch landing pools' });
  }
});

landingRouter.get('/players', async (req, res) => {
  try {
    const userId = getSignedInUserId(req);
    const canManage = canManageLandingMaintenance(req);
    const client = await db.connect();

    try {
      const teams = await loadLandingTeams(client, userId, canManage);
      const teamIds = teams.map((team) => Number(team.id)).filter((teamId) => Number.isFinite(teamId));

      if (!canManage && teamIds.length === 0) {
        return res.json({
          signedIn: userId !== null,
          teams,
          players: []
        });
      }

      const result = await client.query(
        `SELECT
            u.id,
            u.first_name,
            u.last_name,
            u.email,
            u.phone,
            COALESCE(u.is_player_flg, FALSE) AS is_player_flg,
            pt.team_id,
            t.team_name,
            pt.jersey_num
         FROM football_pool.users u
         LEFT JOIN football_pool.player_team pt
           ON pt.user_id = u.id
          AND ($2::boolean = TRUE OR pt.team_id = ANY($1::int[]))
         LEFT JOIN football_pool.team t
           ON t.id = pt.team_id
         WHERE pt.user_id IS NOT NULL
            OR (
              COALESCE(u.is_player_flg, FALSE) = TRUE
              AND (
                $2::boolean = TRUE
                OR NOT EXISTS (
                  SELECT 1
                  FROM football_pool.player_team other_pt
                  WHERE other_pt.user_id = u.id
                )
              )
            )
         ORDER BY u.last_name NULLS LAST,
                  u.first_name NULLS LAST,
                  u.id,
                  t.team_name NULLS LAST,
                  pt.team_id NULLS LAST`,
        [teamIds, canManage]
      );

      type LandingPlayerSummary = {
        id: number;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone: string | null;
        is_player_flg: boolean;
        player_teams: Array<{ team_id: number; team_name: string | null; jersey_num: number | null }>;
      };

      const playersMap = new Map<number, LandingPlayerSummary>();

      for (const row of result.rows) {
        const id = Number(row.id);
        const existing: LandingPlayerSummary = playersMap.get(id) ?? {
          id,
          first_name: row.first_name ?? null,
          last_name: row.last_name ?? null,
          email: row.email ?? null,
          phone: row.phone ?? null,
          is_player_flg: Boolean(row.is_player_flg),
          player_teams: []
        };

        if (row.team_id != null) {
          existing.player_teams.push({
            team_id: Number(row.team_id),
            team_name: row.team_name ?? null,
            jersey_num: row.jersey_num != null ? Number(row.jersey_num) : null
          });
        }

        playersMap.set(id, existing);
      }

      return res.json({
        signedIn: userId !== null,
        teams,
        players: Array.from(playersMap.values())
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Landing players error:', error);
    return res.status(500).json({ error: 'Failed to fetch player maintenance data' });
  }
});

landingRouter.get('/users', async (req, res) => {
  try {
    const userId = getSignedInUserId(req);
    const canManage = canManageLandingMaintenance(req);
    const client = await db.connect();

    try {
      const pools = await loadAccessiblePools(client, userId);
      const teams = await loadLandingTeams(client, userId, canManage);
      const poolIds = pools.map((pool) => Number(pool.id)).filter((poolId) => Number.isFinite(poolId));
      const teamIds = teams.map((team) => Number(team.id)).filter((teamId) => Number.isFinite(teamId));

      const result = await client.query(
        `SELECT
            u.id,
            u.first_name,
            u.last_name,
            u.email,
            u.phone,
            COALESCE(u.is_player_flg, FALSE) AS is_player_flg,
            up.pool_id,
            p.pool_name,
            p.season,
            p.primary_team,
            pool_team.team_name AS pool_team_name,
            pt.team_id,
            t.team_name,
            pt.jersey_num
         FROM football_pool.users u
         LEFT JOIN football_pool.user_pool up
           ON up.user_id = u.id
          AND (
            $3::boolean = TRUE
            OR cardinality($1::int[]) = 0
            OR up.pool_id = ANY($1::int[])
          )
         LEFT JOIN football_pool.pool p
           ON p.id = up.pool_id
         LEFT JOIN football_pool.team pool_team
           ON pool_team.id = p.team_id
         LEFT JOIN football_pool.player_team pt
           ON pt.user_id = u.id
          AND (
            $3::boolean = TRUE
            OR cardinality($2::int[]) = 0
            OR pt.team_id = ANY($2::int[])
          )
         LEFT JOIN football_pool.team t
           ON t.id = pt.team_id
         WHERE $3::boolean = TRUE
            OR up.user_id IS NOT NULL
            OR pt.user_id IS NOT NULL
         ORDER BY u.last_name NULLS LAST,
                  u.first_name NULLS LAST,
                  u.id,
                  p.pool_name NULLS LAST,
                  up.pool_id NULLS LAST,
                  t.team_name NULLS LAST,
                  pt.team_id NULLS LAST`,
        [poolIds, teamIds, canManage]
      );

      type LandingUserSummary = {
        id: number;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone: string | null;
        is_player_flg: boolean;
        user_pools: Array<{
          pool_id: number;
          pool_name: string | null;
          season: number | null;
          team_name: string | null;
          primary_team: string | null;
        }>;
        player_teams: Array<{ team_id: number; team_name: string | null; jersey_num: number | null }>;
      };

      const usersMap = new Map<number, LandingUserSummary>();
      const seenPoolKeys = new Set<string>();
      const seenTeamKeys = new Set<string>();

      for (const row of result.rows) {
        const id = Number(row.id);
        const existing: LandingUserSummary = usersMap.get(id) ?? {
          id,
          first_name: row.first_name ?? null,
          last_name: row.last_name ?? null,
          email: row.email ?? null,
          phone: row.phone ?? null,
          is_player_flg: Boolean(row.is_player_flg),
          user_pools: [],
          player_teams: []
        };

        if (row.pool_id != null) {
          const poolKey = `${id}:${Number(row.pool_id)}`;
          if (!seenPoolKeys.has(poolKey)) {
            existing.user_pools.push({
              pool_id: Number(row.pool_id),
              pool_name: row.pool_name ?? null,
              season: row.season != null ? Number(row.season) : null,
              team_name: row.pool_team_name ?? null,
              primary_team: row.primary_team ?? null
            });
            seenPoolKeys.add(poolKey);
          }
        }

        if (row.team_id != null) {
          const teamKey = `${id}:${Number(row.team_id)}`;
          if (!seenTeamKeys.has(teamKey)) {
            existing.player_teams.push({
              team_id: Number(row.team_id),
              team_name: row.team_name ?? null,
              jersey_num: row.jersey_num != null ? Number(row.jersey_num) : null
            });
            seenTeamKeys.add(teamKey);
          }
        }

        usersMap.set(id, existing);
      }

      return res.json({
        signedIn: userId !== null,
        canManage,
        pools,
        users: Array.from(usersMap.values())
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Landing users error:', error);
    return res.status(500).json({ error: 'Failed to fetch user maintenance data' });
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

      await ensurePoolSquaresInitialized(client, poolId);

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
