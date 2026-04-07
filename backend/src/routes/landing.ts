
import { Request, Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { db } from '../config/db';
import { ensurePoolSquaresInitialized } from '../services/poolSquares';
import { ensurePoolDisplayTokenSupport } from '../services/poolDisplay';
import { getPoolSimulationStatus } from '../services/poolSimulation';
import { ensureNotificationSupport } from '../services/notifications';
import { resolveWinningSquareNumber } from '../services/scoreProcessing';

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

const getLatestScoredQuarter = (game: {
  q1_primary_score: number | null;
  q1_opponent_score: number | null;
  q2_primary_score: number | null;
  q2_opponent_score: number | null;
  q3_primary_score: number | null;
  q3_opponent_score: number | null;
  q4_primary_score: number | null;
  q4_opponent_score: number | null;
}): number | null => {
  if (game.q4_primary_score != null && game.q4_opponent_score != null) return 4;
  if (game.q3_primary_score != null && game.q3_opponent_score != null) return 3;
  if (game.q2_primary_score != null && game.q2_opponent_score != null) return 2;
  if (game.q1_primary_score != null && game.q1_opponent_score != null) return 1;
  return null;
};

const getQuarterScores = (
  game: {
    q1_primary_score: number | null;
    q1_opponent_score: number | null;
    q2_primary_score: number | null;
    q2_opponent_score: number | null;
    q3_primary_score: number | null;
    q3_opponent_score: number | null;
    q4_primary_score: number | null;
    q4_opponent_score: number | null;
  },
  quarter: number
): { primaryScore: number | null; opponentScore: number | null } => {
  if (quarter === 1) return { primaryScore: game.q1_primary_score, opponentScore: game.q1_opponent_score };
  if (quarter === 2) return { primaryScore: game.q2_primary_score, opponentScore: game.q2_opponent_score };
  if (quarter === 3) return { primaryScore: game.q3_primary_score, opponentScore: game.q3_opponent_score };
  return { primaryScore: game.q4_primary_score, opponentScore: game.q4_opponent_score };
};

const loadAccessiblePools = async (client: PoolClient, userId: number | null) => {
  await ensurePoolDisplayTokenSupport(client);

  const result = await client.query(
    `SELECT p.id,
            p.pool_name,
            p.season,
            p.primary_team,
            p.square_cost,
            COALESCE(p.default_flg, FALSE) AS default_flg,
            COALESCE(p.sign_in_req_flg, FALSE) AS sign_in_req_flg,
            COALESCE(p.display_token, '') AS display_token,
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
  await ensurePoolDisplayTokenSupport(client);

  const result = await client.query(
    `SELECT p.id,
            p.pool_name,
            p.season,
            p.primary_team,
            p.square_cost,
            COALESCE(p.default_flg, FALSE) AS default_flg,
            COALESCE(p.sign_in_req_flg, FALSE) AS sign_in_req_flg,
            COALESCE(p.display_token, '') AS display_token,
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

const loadPoolByDisplayToken = async (client: PoolClient, displayToken: string) => {
  await ensurePoolDisplayTokenSupport(client);

  const result = await client.query(
    `SELECT p.id,
            p.pool_name,
            p.season,
            p.primary_team,
            p.square_cost,
            COALESCE(p.default_flg, FALSE) AS default_flg,
            COALESCE(p.sign_in_req_flg, FALSE) AS sign_in_req_flg,
            COALESCE(p.display_token, '') AS display_token,
            t.team_name,
            t.primary_color,
            t.secondary_color,
            t.logo_file
     FROM football_pool.pool p
     LEFT JOIN football_pool.team t ON t.id = p.team_id
     WHERE p.display_token = $1
     LIMIT 1`,
    [displayToken]
  );

  return result.rows[0] ?? null;
};

const pickDisplayGameId = (
  games: Array<{
    id: number;
    opponent?: string | null;
    q1_primary_score?: number | null;
    q1_opponent_score?: number | null;
    q2_primary_score?: number | null;
    q2_opponent_score?: number | null;
    q3_primary_score?: number | null;
    q3_opponent_score?: number | null;
    q4_primary_score: number | null;
    q4_opponent_score: number | null;
  }>,
  currentGameId?: number | null
): number | null => {
  if (games.length === 0) {
    return null;
  }

  const isByeGame = (game: { opponent?: string | null }): boolean => (game.opponent ?? '').trim().toUpperCase() === 'BYE';
  const isCompletedGame = (game: { q4_primary_score: number | null; q4_opponent_score: number | null }): boolean =>
    game.q4_primary_score != null && game.q4_opponent_score != null;

  if (currentGameId != null) {
    const currentGame = games.find((game) => Number(game.id) === Number(currentGameId));
    if (currentGame && !isByeGame(currentGame)) {
      return Number(currentGame.id);
    }
  }

  const activeGame = games.find((game) => !isByeGame(game) && !isCompletedGame(game));
  if (activeGame) {
    return Number(activeGame.id);
  }

  const lastCompletedGame = [...games].reverse().find((game) => !isByeGame(game) && isCompletedGame(game));
  const selectedId = lastCompletedGame?.id ?? games.find((game) => !isByeGame(game))?.id ?? games[0]?.id ?? null;

  return selectedId != null ? Number(selectedId) : null;
};

const loadBoardPayload = async (client: PoolClient, poolId: number, pool: any, gameId?: number | null) => {
  const selectedGameResult = gameId
    ? await client.query(
        `SELECT id,
                pool_id,
                week_num,
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
                week_num,
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
                  COALESCE(week_num, 999),
                  game_dt ASC,
                  id ASC
         LIMIT 1`,
        [poolId]
      );

  const selectedGame = selectedGameResult.rows[0] ?? null;

  const squareCountResult = await client.query<{ square_count: number }>(
    `SELECT COUNT(*)::int AS square_count
     FROM football_pool.square
     WHERE pool_id = $1`,
    [poolId]
  );

  if ((squareCountResult.rows[0]?.square_count ?? 0) === 0) {
    try {
      await client.query('BEGIN');
      await ensurePoolSquaresInitialized(client, poolId);
      await client.query('COMMIT');
    } catch (squareInitError) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.warn(`[landing-board] continuing without auto-initialized squares for pool=${poolId}`, squareInitError);
    }
  }

  const payoutsResult = await client.query(
    `SELECT q1_payout, q2_payout, q3_payout, q4_payout
     FROM football_pool.pool
     WHERE id = $1
     LIMIT 1`,
    [poolId]
  );

  const gamesUpToSelectionResult = await client.query(
    `SELECT id,
            week_num,
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
       AND (
         $2::int IS NULL
         OR COALESCE(week_num, 999) < COALESCE($2::int, 999)
         OR (
           COALESCE(week_num, 999) = COALESCE($2::int, 999)
           AND ($3::timestamptz IS NULL OR game_dt <= $3::timestamptz)
         )
       )
     ORDER BY COALESCE(week_num, 999), game_dt ASC, id ASC`,
    [poolId, selectedGame?.week_num ?? null, selectedGame?.game_dt ?? null]
  );

  const squaresResult = await client.query(
    `SELECT s.id,
            s.square_num,
            s.participant_id,
            s.player_id,
            s.paid_flg,
            u.first_name AS participant_first_name,
            u.last_name AS participant_last_name,
            pt.jersey_num AS player_jersey_num
     FROM football_pool.square s
     LEFT JOIN football_pool.users u ON u.id = s.participant_id
     LEFT JOIN football_pool.player_team pt ON pt.id = s.player_id
     WHERE s.pool_id = $1
     ORDER BY s.square_num`,
    [poolId]
  );

  const payouts = payoutsResult.rows[0] ?? {
    q1_payout: 0,
    q2_payout: 0,
    q3_payout: 0,
    q4_payout: 0
  };

  const simulationStatus = await getPoolSimulationStatus(client, poolId).catch(() => null);
  const currentGameTotals = new Map<number, number>();
  const seasonTotals = new Map<number, number>();
  const selectedGameIsLiveSimulationQuarter =
    selectedGame &&
    simulationStatus?.mode === 'by_quarter' &&
    Number(simulationStatus.currentGameId ?? 0) === Number(selectedGame.id) &&
    simulationStatus.nextQuarter != null;
  const latestScoredQuarter = selectedGame ? getLatestScoredQuarter(selectedGame) : null;
  const currentLeaderSquare =
    selectedGame &&
    latestScoredQuarter != null &&
    (selectedGame.q4_primary_score == null || selectedGame.q4_opponent_score == null)
      ? resolveWinningSquareNumber(
          selectedGame.row_numbers,
          selectedGame.col_numbers,
          getQuarterScores(selectedGame, latestScoredQuarter).opponentScore,
          getQuarterScores(selectedGame, latestScoredQuarter).primaryScore
        )
      : null;

  for (const game of gamesUpToSelectionResult.rows) {
    const liveQuarterToExclude =
      selectedGameIsLiveSimulationQuarter && selectedGame && Number(game.id) === Number(selectedGame.id)
        ? Number(simulationStatus?.nextQuarter ?? 0)
        : null;

    const entries = [
      {
        quarter: 1,
        squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, game.q1_opponent_score, game.q1_primary_score),
        amount: Number(payouts.q1_payout ?? 0)
      },
      {
        quarter: 2,
        squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, game.q2_opponent_score, game.q2_primary_score),
        amount: Number(payouts.q2_payout ?? 0)
      },
      {
        quarter: 3,
        squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, game.q3_opponent_score, game.q3_primary_score),
        amount: Number(payouts.q3_payout ?? 0)
      },
      {
        quarter: 4,
        squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, game.q4_opponent_score, game.q4_primary_score),
        amount: Number(payouts.q4_payout ?? 0)
      }
    ];

    for (const entry of entries) {
      if (entry.squareNum == null || entry.amount <= 0) {
        continue;
      }

      if (liveQuarterToExclude != null && entry.quarter >= liveQuarterToExclude) {
        continue;
      }

      seasonTotals.set(entry.squareNum, (seasonTotals.get(entry.squareNum) ?? 0) + entry.amount);

      if (selectedGame && Number(game.id) === Number(selectedGame.id)) {
        currentGameTotals.set(entry.squareNum, (currentGameTotals.get(entry.squareNum) ?? 0) + entry.amount);
      }
    }

  }

  const squares = squaresResult.rows.map((square) => ({
    ...square,
    current_game_won: Number(currentGameTotals.get(Number(square.square_num)) ?? 0),
    season_won_total: Number(seasonTotals.get(Number(square.square_num)) ?? 0),
    is_current_score_leader: currentLeaderSquare != null && Number(square.square_num) === Number(currentLeaderSquare)
  }));

  return {
    selectedGame,
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
      squares
    }
  };
}

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
            u.venmo_acct,
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
        venmo_acct: string | null;
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
          venmo_acct: row.venmo_acct ?? null,
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
      await ensureNotificationSupport(client);

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
            u.venmo_acct,
            COALESCE(u.is_player_flg, FALSE) AS is_player_flg,
            COALESCE(u.notification_level, 'none') AS notification_level,
            COALESCE(u.notify_on_square_lead_flg, FALSE) AS notify_on_square_lead_flg,
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
        venmo_acct: string | null;
        is_player_flg: boolean;
        notification_level: string;
        notify_on_square_lead_flg: boolean;
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
          venmo_acct: row.venmo_acct ?? null,
          is_player_flg: Boolean(row.is_player_flg),
          notification_level: row.notification_level ?? 'none',
          notify_on_square_lead_flg: Boolean(row.notify_on_square_lead_flg),
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
                g.week_num,
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
         ORDER BY COALESCE(g.week_num, 999), g.game_dt ASC, g.id ASC`,
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

landingRouter.get('/pools/:poolId/metrics', async (req, res) => {
  try {
    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.params);
    const userId = getSignedInUserId(req);

    const client = await db.connect();
    try {
      const pool = await loadAccessiblePool(client, poolId, userId);

      if (!pool) {
        return res.status(404).json({ error: 'Pool not found or unavailable' });
      }

      try {
        await ensurePoolSquaresInitialized(client, poolId);
      } catch (squareInitError) {
        console.warn(`[landing-metrics] continuing without auto-initialized squares for pool=${poolId}`, squareInitError);
      }

      const [summaryResult, gameResult, payoutResult] = await Promise.all([
        client.query(
          `SELECT
              COUNT(*)::int AS total_squares,
              COUNT(*) FILTER (WHERE s.participant_id IS NOT NULL)::int AS sold_squares,
              COUNT(*) FILTER (WHERE s.participant_id IS NULL)::int AS open_squares,
              COUNT(*) FILTER (WHERE COALESCE(s.paid_flg, FALSE) = TRUE)::int AS paid_squares,
              COUNT(*) FILTER (WHERE s.participant_id IS NOT NULL AND COALESCE(s.paid_flg, FALSE) = FALSE)::int AS unpaid_squares,
              COUNT(DISTINCT s.participant_id)::int AS unique_participants,
              COUNT(DISTINCT s.player_id)::int AS unique_players
           FROM football_pool.square s
           WHERE s.pool_id = $1`,
          [poolId]
        ),
        client.query(
          `SELECT
              COUNT(*)::int AS total_games,
              COUNT(*) FILTER (
                WHERE g.q4_primary_score IS NOT NULL
                  AND g.q4_opponent_score IS NOT NULL
              )::int AS completed_games
           FROM football_pool.game g
           WHERE g.pool_id = $1`,
          [poolId]
        ),
        client.query(
          `SELECT
              COALESCE(SUM(wl.amount_won), 0)::int AS total_awarded,
              COALESCE(SUM(wl.amount_won) FILTER (WHERE lower(COALESCE(wl.payout_status, 'pending')) = 'paid'), 0)::int AS total_paid_out,
              COALESCE(SUM(wl.amount_won) FILTER (WHERE lower(COALESCE(wl.payout_status, 'pending')) <> 'paid'), 0)::int AS total_pending
           FROM football_pool.winnings_ledger wl
           WHERE wl.pool_id = $1`,
          [poolId]
        )
      ]);

      let playerRows: Array<Record<string, unknown>> = [];
      let participantRows: Array<Record<string, unknown>> = [];

      try {
        const [playerResult, participantResult] = await Promise.all([
          client.query(
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
             )
             SELECT
               pt.id AS player_id,
               COALESCE(
                 NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
                 CONCAT('Player #', pt.id::text)
               ) AS player_name,
               pt.jersey_num,
               COUNT(DISTINCT s.id) FILTER (WHERE s.participant_id IS NOT NULL)::int AS squares_sold,
               COUNT(sw.square_num)::int AS wins_count,
               COALESCE(SUM(sw.amount), 0)::int AS total_won
             FROM football_pool.square s
             JOIN football_pool.player_team pt ON pt.id = s.player_id
             LEFT JOIN football_pool.users u ON u.id = pt.user_id
             LEFT JOIN season_winners sw ON sw.square_num = s.square_num
             WHERE s.pool_id = $1
             GROUP BY pt.id, u.first_name, u.last_name, pt.jersey_num
             ORDER BY squares_sold DESC, total_won DESC, wins_count DESC, pt.jersey_num NULLS LAST`,
            [poolId]
          ),
          client.query(
            `WITH square_ownership AS (
               SELECT
                 s.participant_id,
                 COUNT(*)::int AS squares_owned,
                 COUNT(*) FILTER (WHERE COALESCE(s.paid_flg, FALSE) = TRUE)::int AS squares_paid
               FROM football_pool.square s
               WHERE s.pool_id = $1
                 AND s.participant_id IS NOT NULL
               GROUP BY s.participant_id
             )
             SELECT
               u.id AS participant_id,
               COALESCE(
                 NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''),
                 COALESCE(u.email, CONCAT('Participant #', u.id::text))
               ) AS participant_name,
               COALESCE(so.squares_owned, 0)::int AS squares_owned,
               COALESCE(so.squares_paid, 0)::int AS squares_paid,
               COUNT(wl.id)::int AS wins_count,
               COALESCE(SUM(wl.amount_won), 0)::int AS amount_won
             FROM football_pool.users u
             LEFT JOIN square_ownership so ON so.participant_id = u.id
             LEFT JOIN football_pool.winnings_ledger wl
               ON wl.pool_id = $1
              AND wl.winner_user_id = u.id
             WHERE so.participant_id IS NOT NULL
                OR wl.winner_user_id IS NOT NULL
             GROUP BY u.id, u.first_name, u.last_name, u.email, so.squares_owned, so.squares_paid
             ORDER BY amount_won DESC, wins_count DESC, participant_name`,
            [poolId]
          )
        ]);

        playerRows = playerResult.rows;
        participantRows = participantResult.rows;
      } catch (metricsDetailError) {
        console.warn(`[landing-metrics] analytics detail fallback for pool=${poolId}`, metricsDetailError);
      }

      const summaryRow = summaryResult.rows[0] ?? {};
      const gameRow = gameResult.rows[0] ?? {};
      const payoutRow = payoutResult.rows[0] ?? {};

      return res.json({
        pool: {
          id: Number(pool.id),
          pool_name: pool.pool_name ?? null,
          season: pool.season != null ? Number(pool.season) : null,
          primary_team: pool.primary_team ?? null,
          team_name: pool.team_name ?? null,
          square_cost: pool.square_cost != null ? Number(pool.square_cost) : null
        },
        summary: {
          totalSquares: Number(summaryRow.total_squares ?? 100),
          soldSquares: Number(summaryRow.sold_squares ?? 0),
          openSquares: Number(summaryRow.open_squares ?? Math.max(100 - Number(summaryRow.sold_squares ?? 0), 0)),
          paidSquares: Number(summaryRow.paid_squares ?? 0),
          unpaidSquares: Number(summaryRow.unpaid_squares ?? 0),
          uniqueParticipants: Number(summaryRow.unique_participants ?? 0),
          uniquePlayers: Number(summaryRow.unique_players ?? 0),
          totalGames: Number(gameRow.total_games ?? 0),
          completedGames: Number(gameRow.completed_games ?? 0),
          totalAwarded: Number(payoutRow.total_awarded ?? 0),
          totalPaidOut: Number(payoutRow.total_paid_out ?? 0),
          totalPending: Number(payoutRow.total_pending ?? 0)
        },
        playerMetrics: playerRows.map((row) => ({
          playerId: Number(row.player_id),
          playerName: row.player_name ?? 'Unnamed player',
          jerseyNum: row.jersey_num != null ? Number(row.jersey_num) : null,
          squaresSold: Number(row.squares_sold ?? 0),
          winsCount: Number(row.wins_count ?? 0),
          totalWon: Number(row.total_won ?? 0)
        })),
        participantMetrics: participantRows.map((row) => ({
          participantId: Number(row.participant_id),
          participantName: row.participant_name ?? 'Unnamed participant',
          squaresOwned: Number(row.squares_owned ?? 0),
          squaresPaid: Number(row.squares_paid ?? 0),
          winsCount: Number(row.wins_count ?? 0),
          amountWon: Number(row.amount_won ?? 0)
        }))
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Landing metrics error:', error);
    return res.status(500).json({ error: 'Failed to fetch metrics' });
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

      const { board } = await loadBoardPayload(client, poolId, pool, gameId);
      return res.json({ board });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Landing board error:', error);
    return res.status(500).json({ error: 'Failed to fetch board' });
  }
});

landingRouter.get('/display/:displayToken', async (req, res) => {
  try {
    const { displayToken } = z.object({ displayToken: z.string().trim().min(6).max(64) }).parse(req.params);

    const client = await db.connect();
    try {
      const pool = await loadPoolByDisplayToken(client, displayToken);

      if (!pool) {
        return res.status(404).json({ error: 'Pool display link not found' });
      }

      const gamesResult = await client.query(
        `SELECT g.id,
                g.pool_id,
                g.week_num,
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
         ORDER BY COALESCE(g.week_num, 999), g.game_dt ASC, g.id ASC`,
        [pool.id]
      );

      const games = gamesResult.rows;
      const simulationStatus = await getPoolSimulationStatus(client, Number(pool.id)).catch(() => null);
      const selectedGameId = pickDisplayGameId(
        games as Array<{
          id: number;
          opponent?: string | null;
          q1_primary_score?: number | null;
          q1_opponent_score?: number | null;
          q2_primary_score?: number | null;
          q2_opponent_score?: number | null;
          q3_primary_score?: number | null;
          q3_opponent_score?: number | null;
          q4_primary_score: number | null;
          q4_opponent_score: number | null;
        }>,
        simulationStatus?.currentGameId ?? null
      );
      const { board } = await loadBoardPayload(client, Number(pool.id), pool, selectedGameId);

      return res.json({
        displayOnly: true,
        pool,
        games,
        selectedGameId,
        board
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Landing display link error:', error);
    return res.status(500).json({ error: 'Failed to load display board' });
  }
});
