
import { Request, Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { db } from '../config/db';
import { env } from '../config/env';
import { getPoolLeagueDefinition, getPayoutValueForSlot, type PayoutSlotKey } from '../config/poolLeagues';
import { ensurePoolSquaresInitialized } from '../services/poolSquares';
import { ensurePoolDisplayTokenSupport } from '../services/poolDisplay';
import { getPoolSimulationStatus } from '../services/poolSimulation';
import { ensureNotificationSupport } from '../services/notifications';
import { loadPoolPayoutConfig, resolvePoolPayoutsForRound } from '../services/poolPayouts';
import { ensureDisplayAdvertisingSupport, loadDisplayAdvertising } from '../services/displayAds';
import { resolveWinningSquareNumber } from '../services/scoreProcessing';
import { buildMatchupDisplayLabel } from '../utils/matchupLabels';

export const landingRouter = Router();

const getSignedInUserId = (req: Request): number | null => {
  if (!req.auth?.userId) {
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
  q5_primary_score?: number | null;
  q5_opponent_score?: number | null;
  q6_primary_score?: number | null;
  q6_opponent_score?: number | null;
  q7_primary_score?: number | null;
  q7_opponent_score?: number | null;
  q8_primary_score?: number | null;
  q8_opponent_score?: number | null;
  q9_primary_score?: number | null;
  q9_opponent_score?: number | null;
}): number | null => {
  if (game.q9_primary_score != null || game.q9_opponent_score != null) return 9;
  if (game.q8_primary_score != null || game.q8_opponent_score != null) return 8;
  if (game.q7_primary_score != null || game.q7_opponent_score != null) return 7;
  if (game.q6_primary_score != null || game.q6_opponent_score != null) return 6;
  if (game.q5_primary_score != null || game.q5_opponent_score != null) return 5;
  if (game.q4_primary_score != null || game.q4_opponent_score != null) return 4;
  if (game.q3_primary_score != null || game.q3_opponent_score != null) return 3;
  if (game.q2_primary_score != null || game.q2_opponent_score != null) return 2;
  if (game.q1_primary_score != null || game.q1_opponent_score != null) return 1;
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
    q5_primary_score?: number | null;
    q5_opponent_score?: number | null;
    q6_primary_score?: number | null;
    q6_opponent_score?: number | null;
    q7_primary_score?: number | null;
    q7_opponent_score?: number | null;
    q8_primary_score?: number | null;
    q8_opponent_score?: number | null;
    q9_primary_score?: number | null;
    q9_opponent_score?: number | null;
  },
  quarter: number
): { primaryScore: number | null; opponentScore: number | null } => {
  if (quarter === 1) return { primaryScore: game.q1_primary_score, opponentScore: game.q1_opponent_score };
  if (quarter === 2) return { primaryScore: game.q2_primary_score, opponentScore: game.q2_opponent_score };
  if (quarter === 3) return { primaryScore: game.q3_primary_score, opponentScore: game.q3_opponent_score };
  if (quarter === 4) return { primaryScore: game.q4_primary_score, opponentScore: game.q4_opponent_score };
  if (quarter === 5) return { primaryScore: game.q5_primary_score ?? null, opponentScore: game.q5_opponent_score ?? null };
  if (quarter === 6) return { primaryScore: game.q6_primary_score ?? null, opponentScore: game.q6_opponent_score ?? null };
  if (quarter === 7) return { primaryScore: game.q7_primary_score ?? null, opponentScore: game.q7_opponent_score ?? null };
  if (quarter === 8) return { primaryScore: game.q8_primary_score ?? null, opponentScore: game.q8_opponent_score ?? null };
  return { primaryScore: game.q9_primary_score ?? null, opponentScore: game.q9_opponent_score ?? null };
};

const getDisplayQuarterScores = (
  game: {
    state?: string | null;
    q1_primary_score: number | null;
    q1_opponent_score: number | null;
    q2_primary_score: number | null;
    q2_opponent_score: number | null;
    q3_primary_score: number | null;
    q3_opponent_score: number | null;
    q4_primary_score: number | null;
    q4_opponent_score: number | null;
    q5_primary_score?: number | null;
    q5_opponent_score?: number | null;
    q6_primary_score?: number | null;
    q6_opponent_score?: number | null;
    q7_primary_score?: number | null;
    q7_opponent_score?: number | null;
    q8_primary_score?: number | null;
    q8_opponent_score?: number | null;
    q9_primary_score?: number | null;
    q9_opponent_score?: number | null;
  },
  quarter: number,
  currentQuarter?: number | null
): { primaryScore: number | null; opponentScore: number | null } => {
  const normalizedState = String(game.state ?? '').trim().toLowerCase();
  const isCompleted = ['completed', 'complete', 'closed', 'finished', 'final', 'post'].includes(normalizedState);
  const normalizedCurrentQuarter = Number(currentQuarter ?? 0) || null;

  if (!isCompleted && normalizedCurrentQuarter != null && quarter > normalizedCurrentQuarter) {
    return { primaryScore: null, opponentScore: null };
  }

  let primaryScore: number | null = null;
  let opponentScore: number | null = null;
  const cappedQuarter = Math.min(Math.max(quarter, 1), 9);

  for (let index = 1; index <= cappedQuarter; index += 1) {
    const scoreEntry = getQuarterScores(game, index);
    if (scoreEntry.primaryScore != null) primaryScore = scoreEntry.primaryScore;
    if (scoreEntry.opponentScore != null) opponentScore = scoreEntry.opponentScore;
  }

  return { primaryScore, opponentScore };
};

type QuarterKey = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type QuarterScoreMap = Partial<Record<QuarterKey, { home?: number | null; away?: number | null }>>;

const toQuarterScoreMap = (value: unknown): QuarterScoreMap => {
  if (!value) {
    return {};
  }

  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as QuarterScoreMap;
    } catch {
      return {};
    }
  }

  if (typeof value === 'object') {
    return value as QuarterScoreMap;
  }

  return {};
};

const toNullableNumber = (value: unknown): number | null => {
  if (value == null || value === '') {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const mapLandingGameRow = (row: Record<string, any>) => {
  const scores = toQuarterScoreMap(row.scores_by_quarter);

  return {
    ...row,
    id: Number(row.id ?? row.game_id ?? row.pool_game_id),
    pool_game_id: toNullableNumber(row.pool_game_id),
    game_id: toNullableNumber(row.game_id) ?? toNullableNumber(row.id),
    pool_id: toNullableNumber(row.pool_id),
    week_num: toNullableNumber(row.week_num),
    opponent: buildMatchupDisplayLabel(
      typeof row.home_team_name === 'string' ? row.home_team_name : null,
      typeof row.away_team_name === 'string'
        ? row.away_team_name
        : typeof row.opponent === 'string'
          ? row.opponent
          : null,
      {
        roundLabel: typeof row.round_label === 'string' ? row.round_label : null,
        fallback: 'Opponent'
      }
    ),
    game_dt: row.game_dt ?? row.game_date ?? null,
    is_simulation: Boolean(row.is_simulation ?? false),
    round_label: typeof row.round_label === 'string' ? row.round_label : null,
    round_sequence: toNullableNumber(row.round_sequence),
    row_numbers: Array.isArray(row.row_numbers) ? row.row_numbers : null,
    col_numbers: Array.isArray(row.col_numbers)
      ? row.col_numbers
      : Array.isArray(row.column_numbers)
        ? row.column_numbers
        : null,
    state: typeof row.state === 'string' ? row.state : null,
    current_quarter: toNullableNumber(row.current_quarter),
    time_remaining_in_quarter: typeof row.time_remaining_in_quarter === 'string' ? row.time_remaining_in_quarter : null,
    q1_primary_score: toNullableNumber(row.q1_primary_score) ?? toNullableNumber(scores['1']?.home),
    q1_opponent_score: toNullableNumber(row.q1_opponent_score) ?? toNullableNumber(scores['1']?.away),
    q2_primary_score: toNullableNumber(row.q2_primary_score) ?? toNullableNumber(scores['2']?.home),
    q2_opponent_score: toNullableNumber(row.q2_opponent_score) ?? toNullableNumber(scores['2']?.away),
    q3_primary_score: toNullableNumber(row.q3_primary_score) ?? toNullableNumber(scores['3']?.home),
    q3_opponent_score: toNullableNumber(row.q3_opponent_score) ?? toNullableNumber(scores['3']?.away),
    q4_primary_score: toNullableNumber(row.q4_primary_score) ?? toNullableNumber(scores['4']?.home),
    q4_opponent_score: toNullableNumber(row.q4_opponent_score) ?? toNullableNumber(scores['4']?.away),
    q5_primary_score: toNullableNumber((row as { q5_primary_score?: unknown }).q5_primary_score) ?? toNullableNumber(scores['5']?.home),
    q5_opponent_score: toNullableNumber((row as { q5_opponent_score?: unknown }).q5_opponent_score) ?? toNullableNumber(scores['5']?.away),
    q6_primary_score: toNullableNumber((row as { q6_primary_score?: unknown }).q6_primary_score) ?? toNullableNumber(scores['6']?.home),
    q6_opponent_score: toNullableNumber((row as { q6_opponent_score?: unknown }).q6_opponent_score) ?? toNullableNumber(scores['6']?.away),
    q7_primary_score: toNullableNumber((row as { q7_primary_score?: unknown }).q7_primary_score) ?? toNullableNumber(scores['7']?.home),
    q7_opponent_score: toNullableNumber((row as { q7_opponent_score?: unknown }).q7_opponent_score) ?? toNullableNumber(scores['7']?.away),
    q8_primary_score: toNullableNumber((row as { q8_primary_score?: unknown }).q8_primary_score) ?? toNullableNumber(scores['8']?.home),
    q8_opponent_score: toNullableNumber((row as { q8_opponent_score?: unknown }).q8_opponent_score) ?? toNullableNumber(scores['8']?.away),
    q9_primary_score: toNullableNumber((row as { q9_primary_score?: unknown }).q9_primary_score) ?? toNullableNumber(scores['9']?.home),
    q9_opponent_score: toNullableNumber((row as { q9_opponent_score?: unknown }).q9_opponent_score) ?? toNullableNumber(scores['9']?.away)
  };
};

const loadPoolGames = async (client: PoolClient, poolId: number) => {
  const result = await client.query(
    `SELECT g.id,
            pg.id AS pool_game_id,
            g.id AS game_id,
            pg.pool_id,
            g.week_number AS week_num,
            home_team.name AS home_team_name,
            home_team.primary_color AS home_team_primary_color,
            home_team.logo_url AS home_team_logo_url,
            away_team.name AS away_team_name,
            away_team.primary_color AS away_team_primary_color,
            away_team.logo_url AS away_team_logo_url,
            away_team.name AS opponent,
            COALESCE(g.kickoff_at, g.game_date::timestamp) AS game_dt,
            COALESCE(g.is_simulation, FALSE) AS is_simulation,
            pg.round_label,
            pg.round_sequence,
            pg.row_numbers,
            pg.column_numbers,
            COALESCE(g.state, 'scheduled') AS state,
            g.current_quarter,
            g.time_remaining_in_quarter,
            g.scores_by_quarter
     FROM football_pool.pool_game pg
     JOIN football_pool.game g ON g.id = pg.game_id
     LEFT JOIN football_pool.sport_team home_team ON home_team.id = g.home_team_id
     LEFT JOIN football_pool.sport_team away_team ON away_team.id = g.away_team_id
     WHERE pg.pool_id = $1
     ORDER BY COALESCE(g.week_number, 999), COALESCE(g.kickoff_at, g.game_date::timestamp) ASC, g.id ASC`,
    [poolId]
  );

  return result.rows.map((row) => mapLandingGameRow(row));
};

const loadAccessiblePools = async (client: PoolClient, userId: number | null, canManage: boolean) => {
  await ensurePoolDisplayTokenSupport(client);

  const result = await client.query(
    `SELECT p.id,
            p.pool_name,
            p.season,
            p.team_id,
            COALESCE(p.pool_type, 'season') AS pool_type,
            p.primary_team,
            p.primary_sport_team_id,
            p.sport_code,
            p.league_code,
            COALESCE(p.winner_loser_flg, FALSE) AS winner_loser_flg,
            p.square_cost,
            COALESCE(p.default_flg, FALSE) AS default_flg,
            COALESCE(p.sign_in_req_flg, FALSE) AS sign_in_req_flg,
            COALESCE(p.display_token, '') AS display_token,
            t.team_name,
            COALESCE(NULLIF(t.primary_color, ''), st.primary_color) AS primary_color,
            t.secondary_color,
            COALESCE(NULLIF(t.logo_file, ''), st.logo_url) AS logo_file,
            COALESCE(t.has_members_flg, TRUE) AS has_members_flg
     FROM football_pool.pool p
     LEFT JOIN football_pool.organization t ON t.id = p.team_id
     LEFT JOIN football_pool.sport_team st ON st.id = COALESCE(p.primary_sport_team_id, t.sport_team_id)
     LEFT JOIN football_pool.user_pool up
       ON up.pool_id = p.id
      AND up.user_id = $1
     WHERE $2::boolean = TRUE
        OR COALESCE(p.sign_in_req_flg, FALSE) = FALSE
        OR ($1::int IS NOT NULL AND up.user_id IS NOT NULL)
     ORDER BY COALESCE(p.default_flg, FALSE) DESC,
              COALESCE(t.team_name, p.primary_team, p.pool_name),
              p.pool_name,
              p.id`,
    [userId, canManage]
  );

  return result.rows;
};

const loadAccessiblePool = async (client: PoolClient, poolId: number, userId: number | null, canManage: boolean) => {
  await ensurePoolDisplayTokenSupport(client);

  const result = await client.query(
    `SELECT p.id,
            p.pool_name,
            p.season,
            p.team_id,
            COALESCE(p.pool_type, 'season') AS pool_type,
            p.primary_team,
            p.primary_sport_team_id,
            p.sport_code,
            p.league_code,
            COALESCE(p.winner_loser_flg, FALSE) AS winner_loser_flg,
            p.square_cost,
            COALESCE(p.default_flg, FALSE) AS default_flg,
            COALESCE(p.sign_in_req_flg, FALSE) AS sign_in_req_flg,
            COALESCE(p.display_token, '') AS display_token,
            t.team_name,
            COALESCE(NULLIF(t.primary_color, ''), st.primary_color) AS primary_color,
            t.secondary_color,
            COALESCE(NULLIF(t.logo_file, ''), st.logo_url) AS logo_file,
            COALESCE(t.has_members_flg, TRUE) AS has_members_flg
     FROM football_pool.pool p
     LEFT JOIN football_pool.organization t ON t.id = p.team_id
     LEFT JOIN football_pool.sport_team st ON st.id = COALESCE(p.primary_sport_team_id, t.sport_team_id)
     LEFT JOIN football_pool.user_pool up
       ON up.pool_id = p.id
      AND up.user_id = $2
     WHERE p.id = $1
       AND (
         $3::boolean = TRUE
         OR COALESCE(p.sign_in_req_flg, FALSE) = FALSE
         OR ($2::int IS NOT NULL AND up.user_id IS NOT NULL)
       )
     LIMIT 1`,
    [poolId, userId, canManage]
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
       FROM football_pool.organization
       WHERE COALESCE(has_members_flg, TRUE) = TRUE
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
              COALESCE(t.has_members_flg, TRUE) AS has_members_flg,
              COALESCE(p.default_flg, FALSE) AS default_flg
       FROM football_pool.pool p
       JOIN football_pool.organization t ON t.id = p.team_id
       LEFT JOIN football_pool.user_pool up
         ON up.pool_id = p.id
        AND up.user_id = $1
       WHERE COALESCE(t.has_members_flg, TRUE) = TRUE
         AND (
              COALESCE(p.sign_in_req_flg, FALSE) = FALSE
              OR ($1::int IS NOT NULL AND up.user_id IS NOT NULL)
         )
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
            p.team_id,
            COALESCE(p.pool_type, 'season') AS pool_type,
            p.primary_team,
            p.primary_sport_team_id,
            p.sport_code,
            p.league_code,
            COALESCE(p.winner_loser_flg, FALSE) AS winner_loser_flg,
            p.square_cost,
            COALESCE(p.default_flg, FALSE) AS default_flg,
            COALESCE(p.sign_in_req_flg, FALSE) AS sign_in_req_flg,
            COALESCE(p.display_token, '') AS display_token,
            t.team_name,
            COALESCE(NULLIF(t.primary_color, ''), st.primary_color) AS primary_color,
            t.secondary_color,
            COALESCE(NULLIF(t.logo_file, ''), st.logo_url) AS logo_file,
            COALESCE(t.has_members_flg, TRUE) AS has_members_flg
     FROM football_pool.pool p
     LEFT JOIN football_pool.organization t ON t.id = p.team_id
     LEFT JOIN football_pool.sport_team st ON st.id = COALESCE(p.primary_sport_team_id, t.sport_team_id)
     WHERE p.display_token = $1
     LIMIT 1`,
    [displayToken]
  );

  return result.rows[0] ?? null;
};

const pickDisplayGameId = (
  games: Array<{
    id: number;
    game_dt?: string | null;
    gameDate?: string | null;
    state?: string | null;
    opponent?: string | null;
    q1_primary_score: number | null;
    q1_opponent_score: number | null;
    q2_primary_score: number | null;
    q2_opponent_score: number | null;
    q3_primary_score: number | null;
    q3_opponent_score: number | null;
    q4_primary_score: number | null;
    q4_opponent_score: number | null;
    q5_primary_score: number | null;
    q5_opponent_score: number | null;
    q6_primary_score: number | null;
    q6_opponent_score: number | null;
    q7_primary_score: number | null;
    q7_opponent_score: number | null;
    q8_primary_score: number | null;
    q8_opponent_score: number | null;
    q9_primary_score: number | null;
    q9_opponent_score: number | null;
  }>,
  currentGameId?: number | null,
  options?: { enablePostgameRotation?: boolean }
): number | null => {
  if (games.length === 0) {
    return null;
  }

  const isByeGame = (game: { opponent?: string | null }): boolean => (game.opponent ?? '').trim().toUpperCase() === 'BYE';
  const isCompletedGame = (game: {
    state?: string | null;
    q9_primary_score?: number | null;
    q9_opponent_score?: number | null;
  }): boolean => {
    const normalizedState = String(game.state ?? '').trim().toLowerCase();

    if (['completed', 'complete', 'closed', 'finished', 'final', 'post'].includes(normalizedState)) {
      return true;
    }

    if (normalizedState) {
      return false;
    }

    return game.q9_primary_score != null && game.q9_opponent_score != null;
  };

  const isLiveGame = (game: {
    state?: string | null;
    q1_primary_score: number | null;
    q1_opponent_score: number | null;
    q2_primary_score: number | null;
    q2_opponent_score: number | null;
    q3_primary_score: number | null;
    q3_opponent_score: number | null;
    q4_primary_score: number | null;
    q4_opponent_score: number | null;
    q5_primary_score?: number | null;
    q5_opponent_score?: number | null;
    q6_primary_score?: number | null;
    q6_opponent_score?: number | null;
    q7_primary_score?: number | null;
    q7_opponent_score?: number | null;
    q8_primary_score?: number | null;
    q8_opponent_score?: number | null;
    q9_primary_score?: number | null;
    q9_opponent_score?: number | null;
  }): boolean => {
    const normalizedState = String(game.state ?? '').trim().toLowerCase();

    if ([
      'in_progress',
      'in progress',
      'live',
      'active',
      'ongoing',
      'underway',
      'midgame',
      'halftime',
      'delayed',
      'delay',
      'rain_delay',
      'rain delay',
      'suspended'
    ].includes(normalizedState)) {
      return true;
    }

    return !isCompletedGame(game) && getLatestScoredQuarter(game) != null;
  };

  const getRawGameDate = (game: { game_dt?: string | null; gameDate?: string | null }): string | null => {
    const rawGameDate = game.game_dt ?? game.gameDate;
    return typeof rawGameDate === 'string' ? rawGameDate : null;
  };

  const isLikelyPlaceholderStartTime = (game: {
    game_dt?: string | null;
    gameDate?: string | null;
    state?: string | null;
    q1_primary_score: number | null;
    q1_opponent_score: number | null;
    q2_primary_score: number | null;
    q2_opponent_score: number | null;
    q3_primary_score: number | null;
    q3_opponent_score: number | null;
    q4_primary_score: number | null;
    q4_opponent_score: number | null;
    q5_primary_score: number | null;
    q5_opponent_score: number | null;
    q6_primary_score: number | null;
    q6_opponent_score: number | null;
    q7_primary_score: number | null;
    q7_opponent_score: number | null;
    q8_primary_score: number | null;
    q8_opponent_score: number | null;
    q9_primary_score: number | null;
    q9_opponent_score: number | null;
  }): boolean => {
    const rawGameDate = getRawGameDate(game)?.trim();
    const normalizedState = String(game.state ?? '').trim().toLowerCase();

    if (!rawGameDate || (normalizedState && normalizedState !== 'scheduled') || getLatestScoredQuarter(game) != null) {
      return false;
    }

    if (
      /^\d{4}-\d{2}-\d{2}$/.test(rawGameDate) ||
      /T00:00:00(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(rawGameDate) ||
      /T12:00:00(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(rawGameDate)
    ) {
      return true;
    }

    const parsed = new Date(rawGameDate);
    if (Number.isNaN(parsed.getTime())) {
      return false;
    }

    const centralTime = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(parsed);

    return centralTime === '00:00';
  };

  const getGameTimestamp = (game: { game_dt?: string | null; gameDate?: string | null }): number | null => {
    const rawGameDate = getRawGameDate(game);

    if (!rawGameDate) {
      return null;
    }

    const timestamp = new Date(rawGameDate).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  };

  const selectableGames = games.filter((game) => !isByeGame(game));
  const nowMs = Date.now();
  const lastCompletedGame = [...selectableGames].reverse().find((game) => isCompletedGame(game));
  const lastCompletedTimestamp = lastCompletedGame ? getGameTimestamp(lastCompletedGame) : null;

  const liveGame = selectableGames.find((game) => isLiveGame(game));
  if (liveGame) {
    return Number(liveGame.id);
  }

  if (currentGameId != null) {
    const currentGame = selectableGames.find((game) => Number(game.id) === Number(currentGameId));
    if (currentGame && !isCompletedGame(currentGame)) {
      return Number(currentGame.id);
    }
  }

  const startedGame = [...selectableGames].reverse().find((game) => {
    if (isCompletedGame(game) || isLikelyPlaceholderStartTime(game)) {
      return false;
    }

    const timestamp = getGameTimestamp(game);
    if (timestamp == null || timestamp > nowMs) {
      return false;
    }

    if (lastCompletedTimestamp != null && timestamp < lastCompletedTimestamp) {
      return false;
    }

    return true;
  });

  if (startedGame) {
    return Number(startedGame.id);
  }

  const nextUpcomingGame = selectableGames.find((game) => {
    if (isCompletedGame(game)) {
      return false;
    }

    if (isLikelyPlaceholderStartTime(game)) {
      return true;
    }

    const timestamp = getGameTimestamp(game);
    return timestamp != null && timestamp > nowMs;
  });

  if (options?.enablePostgameRotation && lastCompletedGame && nextUpcomingGame) {
    const rotationMs = Math.max(1, env.DISPLAY_POSTGAME_ROTATION_SECONDS) * 1000;
    const shouldShowNextGame = Math.floor(nowMs / rotationMs) % 2 === 1;
    return Number((shouldShowNextGame ? nextUpcomingGame : lastCompletedGame).id);
  }

  if (nextUpcomingGame) {
    return Number(nextUpcomingGame.id);
  }
  const selectedId = lastCompletedGame?.id ?? selectableGames[0]?.id ?? games[0]?.id ?? null;

  return selectedId != null ? Number(selectedId) : null;
};

const buildBoardPayoutSummary = (
  leagueCode: string | null | undefined,
  payoutConfig: Awaited<ReturnType<typeof loadPoolPayoutConfig>>,
  roundLabel?: string | null,
  roundSequence?: number | null
) => {
  const leagueDefinition = getPoolLeagueDefinition(leagueCode);
  const activePayouts = resolvePoolPayoutsForRound(payoutConfig, roundLabel, roundSequence);

  return {
    payoutScheduleMode: payoutConfig.payoutScheduleMode,
    currentRoundLabel: roundLabel ?? null,
    currentRoundSequence: roundSequence ?? null,
    activeSlots: leagueDefinition.activePayoutSlots,
    payoutLabels: leagueDefinition.payoutLabels,
    defaultPayouts: payoutConfig.defaultPayouts,
    activePayouts: {
      q1Payout: activePayouts.q1Payout,
      q2Payout: activePayouts.q2Payout,
      q3Payout: activePayouts.q3Payout,
      q4Payout: activePayouts.q4Payout,
      q5Payout: activePayouts.q5Payout,
      q6Payout: activePayouts.q6Payout,
      q7Payout: activePayouts.q7Payout,
      q8Payout: activePayouts.q8Payout,
      q9Payout: activePayouts.q9Payout
    },
    roundPayouts: payoutConfig.roundPayouts
  };
};

const loadBoardPayload = async (client: PoolClient, poolId: number, pool: any, gameId?: number | null) => {
  const games = await loadPoolGames(client, poolId);

  const preferredGameId =
    gameId ?? pickDisplayGameId(games as Array<{
      id: number;
      game_dt?: string | null;
      gameDate?: string | null;
      state?: string | null;
      opponent?: string | null;
      q1_primary_score: number | null;
      q1_opponent_score: number | null;
      q2_primary_score: number | null;
      q2_opponent_score: number | null;
      q3_primary_score: number | null;
      q3_opponent_score: number | null;
      q4_primary_score: number | null;
      q4_opponent_score: number | null;
      q5_primary_score: number | null;
      q5_opponent_score: number | null;
      q6_primary_score: number | null;
      q6_opponent_score: number | null;
      q7_primary_score: number | null;
      q7_opponent_score: number | null;
      q8_primary_score: number | null;
      q8_opponent_score: number | null;
      q9_primary_score: number | null;
      q9_opponent_score: number | null;
    }>);

  const selectedGame =
    preferredGameId != null
      ? games.find(
          (game) => Number(game.id) === Number(preferredGameId) || Number(game.game_id ?? 0) === Number(preferredGameId)
        ) ?? null
      : null;

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

  const payoutConfig = await loadPoolPayoutConfig(client, poolId);

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
     LEFT JOIN football_pool.member_organization pt ON pt.id = s.player_id
     WHERE s.pool_id = $1
     ORDER BY s.square_num`,
    [poolId]
  );

  const simulationStatus = await getPoolSimulationStatus(client, poolId).catch(() => null);
  const winnerLoserMode = Boolean(payoutConfig.winnerLoserMode);
  const currentGameTotals = new Map<number, number>();
  const seasonTotals = new Map<number, number>();
  const selectedGameIsLiveSimulationQuarter =
    selectedGame &&
    simulationStatus?.mode === 'by_quarter' &&
    Number(simulationStatus.currentGameId ?? 0) === Number(selectedGame.id) &&
    simulationStatus.nextQuarter != null;
  const latestScoredQuarter = selectedGame ? getLatestScoredQuarter(selectedGame) : null;
  const currentDisplayQuarter = selectedGameIsLiveSimulationQuarter
    ? Number(simulationStatus?.nextQuarter ?? latestScoredQuarter ?? 0) || latestScoredQuarter
    : Number(selectedGame?.current_quarter ?? 0) || latestScoredQuarter;
  const displayQuarterScores = selectedGame && currentDisplayQuarter != null
    ? getDisplayQuarterScores(selectedGame, currentDisplayQuarter, currentDisplayQuarter)
    : null;
  const currentLeaderSquare =
    selectedGame &&
    currentDisplayQuarter != null &&
    displayQuarterScores &&
    !['completed', 'complete', 'closed', 'finished', 'final', 'post'].includes(String(selectedGame.state ?? '').trim().toLowerCase())
      ? resolveWinningSquareNumber(
          selectedGame.row_numbers,
          selectedGame.col_numbers,
          displayQuarterScores.opponentScore,
          displayQuarterScores.primaryScore,
          winnerLoserMode
        )
      : null;

  const gamesUpToSelection = selectedGame
    ? games.filter((game) => {
        const gameWeek = game.week_num ?? Number.MAX_SAFE_INTEGER;
        const selectedWeek = selectedGame.week_num ?? Number.MAX_SAFE_INTEGER;
        const gameTime = game.game_dt ? new Date(game.game_dt).getTime() : Number.MAX_SAFE_INTEGER;
        const selectedTime = selectedGame.game_dt ? new Date(selectedGame.game_dt).getTime() : Number.MAX_SAFE_INTEGER;

        return (
          gameWeek < selectedWeek ||
          (gameWeek === selectedWeek &&
            (gameTime < selectedTime ||
              (gameTime === selectedTime && Number(game.id) <= Number(selectedGame.id))))
        );
      })
    : games;

  for (const game of gamesUpToSelection) {
    const liveQuarterToExclude =
      selectedGameIsLiveSimulationQuarter && selectedGame && Number(game.id) === Number(selectedGame.id)
        ? Number(simulationStatus?.nextQuarter ?? 0)
        : null;

    const gamePayouts = resolvePoolPayoutsForRound(payoutConfig, game.round_label, game.round_sequence);
    const activeSlots = getPoolLeagueDefinition(pool.league_code).activePayoutSlots;
    const entries = activeSlots.map((slot) => {
      const quarter = Number(slot.slice(1));
      const quarterScores = getQuarterScores(game, quarter);

      return {
        quarter,
        squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, quarterScores.opponentScore, quarterScores.primaryScore, winnerLoserMode),
        amount: getPayoutValueForSlot(gamePayouts, slot)
      };
    });

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

  const payoutSummary = buildBoardPayoutSummary(
    pool.league_code,
    payoutConfig,
    selectedGame?.round_label ?? null,
    selectedGame?.round_sequence ?? null
  );

  return {
    selectedGame,
    board: {
      poolId,
      poolName: pool.pool_name,
      primaryTeam: winnerLoserMode ? 'Winning Score' : pool.primary_team ?? pool.team_name ?? 'Preferred Team',
      opponent: winnerLoserMode ? 'Losing Score' : selectedGame?.opponent ?? 'Opponent',
      gameId: selectedGame?.id ?? null,
      winnerLoserMode,
      poolType: pool.pool_type ?? 'season',
      gameDate: selectedGame?.game_dt ?? null,
      teamName: pool.team_name,
      teamPrimaryColor: pool.primary_color ?? '#8a8f98',
      teamSecondaryColor: pool.secondary_color ?? '#233042',
      teamLogo: pool.logo_file ?? null,
      rowNumbers: Array.isArray(selectedGame?.row_numbers) ? selectedGame.row_numbers : null,
      colNumbers: Array.isArray(selectedGame?.col_numbers) ? selectedGame.col_numbers : null,
      payoutSummary,
      squares
    }
  };
}

landingRouter.get('/pools', async (req, res) => {
  try {
    const userId = getSignedInUserId(req);
    const canManage = canManageLandingMaintenance(req);
    const client = await db.connect();

    try {
      const pools = await loadAccessiblePools(client, userId, canManage);
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
         LEFT JOIN football_pool.member_organization pt
           ON pt.user_id = u.id
          AND ($2::boolean = TRUE OR pt.team_id = ANY($1::int[]))
         LEFT JOIN football_pool.organization t
           ON t.id = pt.team_id
         WHERE pt.user_id IS NOT NULL
            OR (
              COALESCE(u.is_player_flg, FALSE) = TRUE
              AND (
                $2::boolean = TRUE
                OR NOT EXISTS (
                  SELECT 1
                  FROM football_pool.member_organization other_pt
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

      const pools = await loadAccessiblePools(client, userId, canManage);
      const teams = await loadLandingTeams(client, userId, canManage);
      const bootstrapResult = await client.query<{ user_count: string }>(`SELECT COUNT(*)::text AS user_count FROM football_pool.users`);
      const bootstrapMode = Number(bootstrapResult.rows[0]?.user_count ?? 0) === 0;
      const effectiveCanManage = canManage || bootstrapMode;
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
         LEFT JOIN football_pool.organization pool_team
           ON pool_team.id = p.team_id
         LEFT JOIN football_pool.member_organization pt
           ON pt.user_id = u.id
          AND (
            $3::boolean = TRUE
            OR cardinality($2::int[]) = 0
            OR pt.team_id = ANY($2::int[])
          )
         LEFT JOIN football_pool.organization t
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
        [poolIds, teamIds, effectiveCanManage]
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
        canManage: effectiveCanManage,
        bootstrapMode,
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
    const canManage = canManageLandingMaintenance(req);
    const client = await db.connect();

    try {
      const pool = await loadAccessiblePool(client, poolId, userId, canManage);

      if (!pool) {
        return res.status(404).json({ error: 'Pool not found or unavailable' });
      }

      const games = await loadPoolGames(client, poolId);

      res.json({ pool, games });
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
    const canManage = canManageLandingMaintenance(req);

    const client = await db.connect();
    try {
      const pool = await loadAccessiblePool(client, poolId, userId, canManage);

      if (!pool) {
        return res.status(404).json({ error: 'Pool not found or unavailable' });
      }

      try {
        await ensurePoolSquaresInitialized(client, poolId);
      } catch (squareInitError) {
        console.warn(`[landing-metrics] continuing without auto-initialized squares for pool=${poolId}`, squareInitError);
      }

      const summaryResult = await client.query(
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
      );

      const gameResult = await client.query(
        `SELECT
            COUNT(*)::int AS total_games,
            COUNT(*) FILTER (
              WHERE LOWER(COALESCE(g.state, 'scheduled')) IN ('completed', 'complete', 'closed', 'finished', 'final', 'post')
            )::int AS completed_games
         FROM football_pool.pool_game pg
         JOIN football_pool.game g ON g.id = pg.game_id
         WHERE pg.pool_id = $1`,
        [poolId]
      );

      const payoutResult = await client.query(
        `SELECT
            COALESCE(SUM(wl.amount_won), 0)::int AS total_awarded,
            COALESCE(SUM(wl.amount_won) FILTER (WHERE lower(COALESCE(wl.payout_status, 'pending')) = 'paid'), 0)::int AS total_paid_out,
            COALESCE(SUM(wl.amount_won) FILTER (WHERE lower(COALESCE(wl.payout_status, 'pending')) <> 'paid'), 0)::int AS total_pending
         FROM football_pool.winnings_ledger wl
         WHERE wl.pool_id = $1`,
        [poolId]
      );

      let playerRows: Array<Record<string, unknown>> = [];
      let participantRows: Array<Record<string, unknown>> = [];

      try {
        const playerResult = await client.query(
          `WITH season_winners AS (
             SELECT ((NULLIF(g.scores_by_quarter -> '1' ->> 'away', '')::int % 10) * 10
                     + (NULLIF(g.scores_by_quarter -> '1' ->> 'home', '')::int % 10) + 1) AS square_num,
                    p.q1_payout AS amount
             FROM football_pool.pool_game pg
             JOIN football_pool.game g ON g.id = pg.game_id
             JOIN football_pool.pool p ON p.id = pg.pool_id
             WHERE pg.pool_id = $1
               AND g.scores_by_quarter -> '1' ->> 'home' IS NOT NULL
               AND g.scores_by_quarter -> '1' ->> 'away' IS NOT NULL

             UNION ALL

             SELECT ((NULLIF(g.scores_by_quarter -> '2' ->> 'away', '')::int % 10) * 10
                     + (NULLIF(g.scores_by_quarter -> '2' ->> 'home', '')::int % 10) + 1) AS square_num,
                    p.q2_payout AS amount
             FROM football_pool.pool_game pg
             JOIN football_pool.game g ON g.id = pg.game_id
             JOIN football_pool.pool p ON p.id = pg.pool_id
             WHERE pg.pool_id = $1
               AND g.scores_by_quarter -> '2' ->> 'home' IS NOT NULL
               AND g.scores_by_quarter -> '2' ->> 'away' IS NOT NULL

             UNION ALL

             SELECT ((NULLIF(g.scores_by_quarter -> '3' ->> 'away', '')::int % 10) * 10
                     + (NULLIF(g.scores_by_quarter -> '3' ->> 'home', '')::int % 10) + 1) AS square_num,
                    p.q3_payout AS amount
             FROM football_pool.pool_game pg
             JOIN football_pool.game g ON g.id = pg.game_id
             JOIN football_pool.pool p ON p.id = pg.pool_id
             WHERE pg.pool_id = $1
               AND g.scores_by_quarter -> '3' ->> 'home' IS NOT NULL
               AND g.scores_by_quarter -> '3' ->> 'away' IS NOT NULL

             UNION ALL

             SELECT ((NULLIF(g.scores_by_quarter -> '4' ->> 'away', '')::int % 10) * 10
                     + (NULLIF(g.scores_by_quarter -> '4' ->> 'home', '')::int % 10) + 1) AS square_num,
                    p.q4_payout AS amount
             FROM football_pool.pool_game pg
             JOIN football_pool.game g ON g.id = pg.game_id
             JOIN football_pool.pool p ON p.id = pg.pool_id
             WHERE pg.pool_id = $1
               AND g.scores_by_quarter -> '4' ->> 'home' IS NOT NULL
               AND g.scores_by_quarter -> '4' ->> 'away' IS NOT NULL
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
           JOIN football_pool.member_organization pt ON pt.id = s.player_id
           LEFT JOIN football_pool.users u ON u.id = pt.user_id
           LEFT JOIN season_winners sw ON sw.square_num = s.square_num
           WHERE s.pool_id = $1
           GROUP BY pt.id, u.first_name, u.last_name, pt.jersey_num
           ORDER BY squares_sold DESC, total_won DESC, wins_count DESC, pt.jersey_num NULLS LAST`,
          [poolId]
        );

        const participantResult = await client.query(
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
        );

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
    const canManage = canManageLandingMaintenance(req);

    const client = await db.connect();
    try {
      const pool = await loadAccessiblePool(client, poolId, userId, canManage);

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

      await ensureDisplayAdvertisingSupport(client);
      const games = await loadPoolGames(client, Number(pool.id));
      const simulationStatus = await getPoolSimulationStatus(client, Number(pool.id)).catch(() => null);
      const { settings: displayAdSettings, ads: displayAds } = await loadDisplayAdvertising(client, {
        organizationId: Number(pool.team_id ?? 0) || null
      });
      const selectedGameId = pickDisplayGameId(
        games as Array<{
          id: number;
          game_dt?: string | null;
          gameDate?: string | null;
          state?: string | null;
          opponent?: string | null;
          q1_primary_score: number | null;
          q1_opponent_score: number | null;
          q2_primary_score: number | null;
          q2_opponent_score: number | null;
          q3_primary_score: number | null;
          q3_opponent_score: number | null;
          q4_primary_score: number | null;
          q4_opponent_score: number | null;
          q5_primary_score: number | null;
          q5_opponent_score: number | null;
          q6_primary_score: number | null;
          q6_opponent_score: number | null;
          q7_primary_score: number | null;
          q7_opponent_score: number | null;
          q8_primary_score: number | null;
          q8_opponent_score: number | null;
          q9_primary_score: number | null;
          q9_opponent_score: number | null;
        }>,
        simulationStatus?.currentGameId ?? null,
        { enablePostgameRotation: true }
      );
      const { board } = await loadBoardPayload(client, Number(pool.id), pool, selectedGameId);

      return res.json({
        displayOnly: true,
        pool,
        games,
        selectedGameId,
        board,
        displayAds,
        displayAdSettings,
        postgameRotationSeconds: env.DISPLAY_POSTGAME_ROTATION_SECONDS
      });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Landing display link error:', error);
    return res.status(500).json({ error: 'Failed to load display board' });
  }
});

