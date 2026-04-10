import type { PoolClient } from 'pg';
import { env } from '../config/env';
import { getActiveScoreSegmentNumbers, getSimulationStepDescriptor, getSimulationStepLabel } from '../config/poolLeagues';
import { ensurePoolSquaresInitialized, TOTAL_POOL_SQUARES } from './poolSquares';
import { resolvePoolGameBoardNumbers } from './poolBoardNumbers';
import { importPoolScheduleFromEspn } from './scheduleImport';
import { getGameIngestionUpdate, type IngestionSource } from './scoreIngestion';
import { processGameScoresWithClient, type QuarterScoresInput } from './scoreProcessing';

export type SimulationMode = 'full_year' | 'by_game' | 'by_quarter';
type SimulationProgressAction = 'complete_game' | 'complete_quarter';
type SimulationAdvanceAction = 'complete' | 'live';

export type PoolSimulationStatus = {
  enabledInEnvironment: boolean;
  hasSimulationData: boolean;
  hasAssignedSquares: boolean;
  userCount: number;
  playerCount: number;
  canSimulate: boolean;
  canCleanup: boolean;
  blockers: string[];
  mode: SimulationMode | null;
  currentGameId: number | null;
  nextQuarter: number | null;
  progressAction: SimulationProgressAction | null;
  canAdvance: boolean;
};

export type PoolSimulationResult = {
  season: number;
  teamName: string;
  simulatedGames: number;
  byeWeeks: number[];
  assignedSquares: number;
  mode: SimulationMode;
  currentGameId: number | null;
  nextQuarter: number | null;
  progressAction: SimulationProgressAction | null;
};

export type PoolSimulationAdvanceResult = {
  message: string;
  status: PoolSimulationStatus;
  completedGameId: number | null;
  completedQuarter: number | null;
};

export type PoolSimulationCleanupResult = {
  clearedSquares: number;
  deletedGames: number;
  deletedWinnings: number;
};

type PoolContext = {
  id: number;
  season: number | null;
  team_id: number | null;
  primary_team: string | null;
  team_name: string | null;
  league_code: string | null;
};

type PoolGame = {
  id: number;
  opponent: string | null;
  week_num: number | null;
  row_numbers: unknown;
  col_numbers: unknown;
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
};

type PoolSimulationState = {
  pool_id: number;
  mode: SimulationMode;
  current_game_id: number | null;
  next_quarter: number | null;
};

type QuarterKey = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9';
type QuarterScoreMap = Partial<Record<QuarterKey, { home?: number | null; away?: number | null }>>;

const toQuarterScoreMap = (value: unknown): QuarterScoreMap => {
  if (!value) return {};
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
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const buildEmptyScores = (): QuarterScoresInput => ({
  q1PrimaryScore: null,
  q1OpponentScore: null,
  q2PrimaryScore: null,
  q2OpponentScore: null,
  q3PrimaryScore: null,
  q3OpponentScore: null,
  q4PrimaryScore: null,
  q4OpponentScore: null,
  q5PrimaryScore: null,
  q5OpponentScore: null,
  q6PrimaryScore: null,
  q6OpponentScore: null,
  q7PrimaryScore: null,
  q7OpponentScore: null,
  q8PrimaryScore: null,
  q8OpponentScore: null,
  q9PrimaryScore: null,
  q9OpponentScore: null
});

const getQuarterScoresFromInput = (
  scores: QuarterScoresInput,
  quarter: number
): { primaryScore: number | null; opponentScore: number | null } => {
  if (quarter === 1) return { primaryScore: scores.q1PrimaryScore, opponentScore: scores.q1OpponentScore };
  if (quarter === 2) return { primaryScore: scores.q2PrimaryScore, opponentScore: scores.q2OpponentScore };
  if (quarter === 3) return { primaryScore: scores.q3PrimaryScore, opponentScore: scores.q3OpponentScore };
  if (quarter === 4) return { primaryScore: scores.q4PrimaryScore, opponentScore: scores.q4OpponentScore };
  if (quarter === 5) return { primaryScore: scores.q5PrimaryScore, opponentScore: scores.q5OpponentScore };
  if (quarter === 6) return { primaryScore: scores.q6PrimaryScore, opponentScore: scores.q6OpponentScore };
  if (quarter === 7) return { primaryScore: scores.q7PrimaryScore, opponentScore: scores.q7OpponentScore };
  if (quarter === 8) return { primaryScore: scores.q8PrimaryScore, opponentScore: scores.q8OpponentScore };
  return { primaryScore: scores.q9PrimaryScore, opponentScore: scores.q9OpponentScore };
};

const setQuarterScoresOnSnapshot = (
  scores: QuarterScoresInput,
  quarter: number,
  values: { primaryScore: number | null; opponentScore: number | null }
): void => {
  if (quarter === 1) {
    scores.q1PrimaryScore = values.primaryScore;
    scores.q1OpponentScore = values.opponentScore;
    return;
  }

  if (quarter === 2) {
    scores.q2PrimaryScore = values.primaryScore;
    scores.q2OpponentScore = values.opponentScore;
    return;
  }

  if (quarter === 3) {
    scores.q3PrimaryScore = values.primaryScore;
    scores.q3OpponentScore = values.opponentScore;
    return;
  }

  if (quarter === 4) {
    scores.q4PrimaryScore = values.primaryScore;
    scores.q4OpponentScore = values.opponentScore;
    return;
  }

  if (quarter === 5) {
    scores.q5PrimaryScore = values.primaryScore;
    scores.q5OpponentScore = values.opponentScore;
    return;
  }

  if (quarter === 6) {
    scores.q6PrimaryScore = values.primaryScore;
    scores.q6OpponentScore = values.opponentScore;
    return;
  }

  if (quarter === 7) {
    scores.q7PrimaryScore = values.primaryScore;
    scores.q7OpponentScore = values.opponentScore;
    return;
  }

  if (quarter === 8) {
    scores.q8PrimaryScore = values.primaryScore;
    scores.q8OpponentScore = values.opponentScore;
    return;
  }

  scores.q9PrimaryScore = values.primaryScore;
  scores.q9OpponentScore = values.opponentScore;
};

const getPreviousActiveQuarter = (activeQuarters: number[], quarter: number): number | null => {
  const currentIndex = activeQuarters.findIndex((value) => value === quarter);
  return currentIndex > 0 ? activeQuarters[currentIndex - 1] ?? null : null;
};

const getNextActiveQuarter = (activeQuarters: number[], quarter: number): number | null => {
  const currentIndex = activeQuarters.findIndex((value) => value === quarter);
  return currentIndex >= 0 ? activeQuarters[currentIndex + 1] ?? null : null;
};

const buildScoresByQuarterJson = (scores: QuarterScoresInput): QuarterScoreMap => ({
  '1': { home: scores.q1PrimaryScore, away: scores.q1OpponentScore },
  '2': { home: scores.q2PrimaryScore, away: scores.q2OpponentScore },
  '3': { home: scores.q3PrimaryScore, away: scores.q3OpponentScore },
  '4': { home: scores.q4PrimaryScore, away: scores.q4OpponentScore },
  '5': { home: scores.q5PrimaryScore, away: scores.q5OpponentScore },
  '6': { home: scores.q6PrimaryScore, away: scores.q6OpponentScore },
  '7': { home: scores.q7PrimaryScore, away: scores.q7OpponentScore },
  '8': { home: scores.q8PrimaryScore, away: scores.q8OpponentScore },
  '9': { home: scores.q9PrimaryScore, away: scores.q9OpponentScore }
});

const inferGameStateFromScores = (
  scores: QuarterScoresInput,
  activeQuarters: number[] = [1, 2, 3, 4]
): 'scheduled' | 'in_progress' | 'completed' => {
  const finalQuarter = activeQuarters[activeQuarters.length - 1] ?? 4;
  const finalScores = getQuarterScoresFromInput(scores, finalQuarter);

  if (finalScores.primaryScore != null && finalScores.opponentScore != null) {
    return 'completed';
  }

  if (activeQuarters.some((quarter) => {
    const quarterScores = getQuarterScoresFromInput(scores, quarter);
    return quarterScores.primaryScore != null || quarterScores.opponentScore != null;
  })) {
    return 'in_progress';
  }

  return 'scheduled';
};

const inferCurrentQuarter = (scores: QuarterScoresInput, activeQuarters: number[] = [1, 2, 3, 4]): number | null => {
  for (let index = activeQuarters.length - 1; index >= 0; index -= 1) {
    const quarter = activeQuarters[index];
    const quarterScores = getQuarterScoresFromInput(scores, quarter);
    if (quarterScores.primaryScore != null || quarterScores.opponentScore != null) {
      return quarter;
    }
  }

  return null;
};

const randomInt = (maxExclusive: number): number => Math.floor(Math.random() * maxExclusive);

const shuffle = <T,>(values: T[]): T[] => {
  const next = [...values];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
};

const normalize = (value: string | null | undefined): string =>
  (value ?? '').trim().toUpperCase();

const isByeOpponent = (value: string | null | undefined): boolean => normalize(value) === 'BYE';

const buildBalancedAssignments = (ids: number[], total: number): number[] => {
  const assignments: number[] = [];

  while (assignments.length < total) {
    assignments.push(...shuffle(ids));
  }

  return shuffle(assignments.slice(0, total));
};

const quarterAddOptions = [0, 0, 3, 3, 6, 7, 7, 10, 14];

const buildRandomScores = (activeQuarters: number[] = [1, 2, 3, 4]): QuarterScoresInput => {
  let primary = 0;
  let opponent = 0;
  const scores = buildEmptyScores();
  const normalizedActiveQuarters = activeQuarters.length > 0 ? activeQuarters : [1, 2, 3, 4];

  const nextPrimary = () => {
    primary += quarterAddOptions[randomInt(quarterAddOptions.length)];
    return primary;
  };

  const nextOpponent = () => {
    opponent += quarterAddOptions[randomInt(quarterAddOptions.length)];
    return opponent;
  };

  for (const quarter of normalizedActiveQuarters) {
    setQuarterScoresOnSnapshot(scores, quarter, {
      primaryScore: nextPrimary(),
      opponentScore: nextOpponent()
    });
  }

  return scores;
};

const assertSimulationEnabled = (): void => {
  if (!env.SIMULATION_ENABLED) {
    throw new Error('Simulation tools are disabled by configuration.');
  }
};

const loadPoolContext = async (client: PoolClient, poolId: number): Promise<PoolContext> => {
  const result = await client.query<PoolContext>(
    `SELECT
        p.id,
        p.season,
        p.team_id,
        p.primary_team,
        p.league_code,
        t.team_name
     FROM football_pool.pool p
     LEFT JOIN football_pool.organization t ON t.id = p.team_id
     WHERE p.id = $1
     LIMIT 1`,
    [poolId]
  );

  const pool = result.rows[0];

  if (!pool) {
    throw new Error('Pool not found.');
  }

  return pool;
};

const ensureSimulationStateTable = async (client: PoolClient): Promise<void> => {
  await client.query(
    `CREATE TABLE IF NOT EXISTS football_pool.pool_simulation_state (
      pool_id INTEGER PRIMARY KEY REFERENCES football_pool.pool(id) ON DELETE CASCADE,
      mode VARCHAR(20) NOT NULL CHECK (mode IN ('full_year', 'by_game', 'by_quarter')),
      current_game_id INTEGER NULL REFERENCES football_pool.game(id) ON DELETE SET NULL,
      next_quarter INTEGER NULL CHECK (next_quarter BETWEEN 1 AND 9),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );
};

const loadSimulationState = async (client: PoolClient, poolId: number): Promise<PoolSimulationState | null> => {
  await ensureSimulationStateTable(client);

  const result = await client.query<PoolSimulationState>(
    `SELECT pool_id, mode, current_game_id, next_quarter
     FROM football_pool.pool_simulation_state
     WHERE pool_id = $1
     LIMIT 1`,
    [poolId]
  );

  return result.rows[0] ?? null;
};

const upsertSimulationState = async (
  client: PoolClient,
  poolId: number,
  mode: SimulationMode,
  currentGameId: number | null,
  nextQuarter: number | null
): Promise<void> => {
  await ensureSimulationStateTable(client);

  await client.query(
    `INSERT INTO football_pool.pool_simulation_state (pool_id, mode, current_game_id, next_quarter, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (pool_id)
     DO UPDATE SET
       mode = EXCLUDED.mode,
       current_game_id = EXCLUDED.current_game_id,
       next_quarter = EXCLUDED.next_quarter,
       updated_at = NOW()`,
    [poolId, mode, currentGameId, nextQuarter]
  );
};

const clearSimulationState = async (client: PoolClient, poolId: number): Promise<void> => {
  await ensureSimulationStateTable(client);

  await client.query(
    `DELETE FROM football_pool.pool_simulation_state
     WHERE pool_id = $1`,
    [poolId]
  );
};

const loadPoolGames = async (client: PoolClient, poolId: number): Promise<PoolGame[]> => {
  const result = await client.query(
    `SELECT
        g.id,
        away.name AS opponent,
        g.week_number AS week_num,
        pg.row_numbers,
        pg.column_numbers AS col_numbers,
        g.is_simulation,
        g.scores_by_quarter,
        COALESCE(g.kickoff_at, g.game_date::timestamp) AS game_dt
     FROM football_pool.pool_game pg
     JOIN football_pool.game g ON g.id = pg.game_id
     LEFT JOIN football_pool.sport_team away ON away.id = g.away_team_id
     WHERE pg.pool_id = $1
     ORDER BY COALESCE(g.week_number, 999), COALESCE(g.kickoff_at, g.game_date::timestamp) ASC, g.id ASC`,
    [poolId]
  );

  return result.rows.map((row) => {
    const scores = toQuarterScoreMap((row as { scores_by_quarter?: unknown }).scores_by_quarter);

    return {
      id: Number((row as { id: number }).id),
      opponent: ((row as { opponent?: string | null }).opponent ?? null),
      week_num: toNullableNumber((row as { week_num?: unknown }).week_num),
      row_numbers: (row as { row_numbers?: unknown }).row_numbers,
      col_numbers: (row as { col_numbers?: unknown }).col_numbers,
      q1_primary_score: toNullableNumber(scores['1']?.home),
      q1_opponent_score: toNullableNumber(scores['1']?.away),
      q2_primary_score: toNullableNumber(scores['2']?.home),
      q2_opponent_score: toNullableNumber(scores['2']?.away),
      q3_primary_score: toNullableNumber(scores['3']?.home),
      q3_opponent_score: toNullableNumber(scores['3']?.away),
      q4_primary_score: toNullableNumber(scores['4']?.home),
      q4_opponent_score: toNullableNumber(scores['4']?.away),
      q5_primary_score: toNullableNumber(scores['5']?.home),
      q5_opponent_score: toNullableNumber(scores['5']?.away),
      q6_primary_score: toNullableNumber(scores['6']?.home),
      q6_opponent_score: toNullableNumber(scores['6']?.away),
      q7_primary_score: toNullableNumber(scores['7']?.home),
      q7_opponent_score: toNullableNumber(scores['7']?.away),
      q8_primary_score: toNullableNumber(scores['8']?.home),
      q8_opponent_score: toNullableNumber(scores['8']?.away),
      q9_primary_score: toNullableNumber(scores['9']?.home),
      q9_opponent_score: toNullableNumber(scores['9']?.away)
    };
  });
};

const findNextPlayableGame = (games: PoolGame[], currentGameId?: number | null): PoolGame | null => {
  const playableGames = games.filter((game) => !isByeOpponent(game.opponent));

  if (playableGames.length === 0) {
    return null;
  }

  if (!currentGameId) {
    return playableGames[0] ?? null;
  }

  const currentIndex = playableGames.findIndex((game) => Number(game.id) === Number(currentGameId));
  if (currentIndex === -1) {
    return playableGames[0] ?? null;
  }

  return playableGames[currentIndex + 1] ?? null;
};

const getQuarterScoresFromGame = (
  game: PoolGame,
  quarter: number
): { primaryScore: number | null; opponentScore: number | null } => {
  if (quarter === 1) return { primaryScore: game.q1_primary_score, opponentScore: game.q1_opponent_score };
  if (quarter === 2) return { primaryScore: game.q2_primary_score, opponentScore: game.q2_opponent_score };
  if (quarter === 3) return { primaryScore: game.q3_primary_score, opponentScore: game.q3_opponent_score };
  if (quarter === 4) return { primaryScore: game.q4_primary_score, opponentScore: game.q4_opponent_score };
  if (quarter === 5) return { primaryScore: game.q5_primary_score, opponentScore: game.q5_opponent_score };
  if (quarter === 6) return { primaryScore: game.q6_primary_score, opponentScore: game.q6_opponent_score };
  if (quarter === 7) return { primaryScore: game.q7_primary_score, opponentScore: game.q7_opponent_score };
  if (quarter === 8) return { primaryScore: game.q8_primary_score, opponentScore: game.q8_opponent_score };
  return { primaryScore: game.q9_primary_score, opponentScore: game.q9_opponent_score };
};

const getNextIncompleteQuarter = (game: PoolGame, activeQuarters: number[] = [1, 2, 3, 4]): number | null => {
  for (const quarter of activeQuarters) {
    const quarterScores = getQuarterScoresFromGame(game, quarter);
    if (quarterScores.primaryScore == null || quarterScores.opponentScore == null) {
      return quarter;
    }
  }

  return null;
};

const buildPartialQuarterSnapshot = (
  scores: QuarterScoresInput,
  quarter: number,
  activeQuarters: number[] = [1, 2, 3, 4]
): QuarterScoresInput => {
  const snapshot = buildEmptyScores();

  for (const activeQuarter of activeQuarters) {
    if (activeQuarter > quarter) {
      break;
    }

    setQuarterScoresOnSnapshot(snapshot, activeQuarter, getQuarterScoresFromInput(scores, activeQuarter));
  }

  return snapshot;
};

const buildLiveQuarterScore = (previousTotal: number | null | undefined, finalTotal: number | null | undefined): number | null => {
  if (finalTotal == null) {
    return null;
  }

  const start = Number(previousTotal ?? 0);
  const end = Number(finalTotal);

  if (!Number.isFinite(end)) {
    return null;
  }

  if (end <= start) {
    return end;
  }

  const delta = end - start;
  const liveScore = start + Math.max(1, Math.floor(delta / 2));

  // Keep "live" snapshots visibly short of the completed-quarter total until the
  // explicit Complete Quarter action is used.
  return Math.min(end - 1, liveScore);
};

const buildMidQuarterSnapshot = (
  scores: QuarterScoresInput,
  quarter: number,
  activeQuarters: number[] = [1, 2, 3, 4]
): QuarterScoresInput => {
  const snapshot = buildEmptyScores();

  for (const activeQuarter of activeQuarters) {
    if (activeQuarter < quarter) {
      setQuarterScoresOnSnapshot(snapshot, activeQuarter, getQuarterScoresFromInput(scores, activeQuarter));
      continue;
    }

    if (activeQuarter === quarter) {
      const previousQuarter = getPreviousActiveQuarter(activeQuarters, quarter);
      const baselineScores = previousQuarter != null ? getQuarterScoresFromInput(scores, previousQuarter) : { primaryScore: 0, opponentScore: 0 };
      const finalScores = getQuarterScoresFromInput(scores, quarter);

      setQuarterScoresOnSnapshot(snapshot, activeQuarter, {
        primaryScore: buildLiveQuarterScore(baselineScores.primaryScore, finalScores.primaryScore),
        opponentScore: buildLiveQuarterScore(baselineScores.opponentScore, finalScores.opponentScore)
      });
      break;
    }
  }

  return snapshot;
};

const advanceLiveQuarterScore = (
  currentTotal: number | null | undefined,
  previousTotal: number | null | undefined,
  finalTotal: number | null | undefined
): number | null => {
  if (finalTotal == null) {
    return null;
  }

  const start = Number(previousTotal ?? 0);
  const current = Number(currentTotal ?? start);
  const end = Number(finalTotal);

  if (!Number.isFinite(end)) {
    return null;
  }

  if (end <= start) {
    return end;
  }

  if (!Number.isFinite(current) || current < start) {
    return buildLiveQuarterScore(previousTotal, finalTotal);
  }

  if (current >= end - 1) {
    return end - 1;
  }

  const remaining = end - current;
  return Math.min(end - 1, current + Math.max(1, Math.floor(remaining / 2)));
};

const buildAdvancedMidQuarterSnapshot = (
  currentScores: QuarterScoresInput,
  finalScores: QuarterScoresInput,
  quarter: number,
  activeQuarters: number[] = [1, 2, 3, 4]
): QuarterScoresInput => {
  const snapshot = buildEmptyScores();

  for (const activeQuarter of activeQuarters) {
    if (activeQuarter < quarter) {
      setQuarterScoresOnSnapshot(snapshot, activeQuarter, getQuarterScoresFromInput(finalScores, activeQuarter));
      continue;
    }

    if (activeQuarter === quarter) {
      const previousQuarter = getPreviousActiveQuarter(activeQuarters, quarter);
      const baselineScores = previousQuarter != null ? getQuarterScoresFromInput(finalScores, previousQuarter) : { primaryScore: 0, opponentScore: 0 };
      const currentQuarterScores = getQuarterScoresFromInput(currentScores, quarter);
      const finalQuarterScores = getQuarterScoresFromInput(finalScores, quarter);

      setQuarterScoresOnSnapshot(snapshot, activeQuarter, {
        primaryScore: advanceLiveQuarterScore(currentQuarterScores.primaryScore, baselineScores.primaryScore, finalQuarterScores.primaryScore),
        opponentScore: advanceLiveQuarterScore(currentQuarterScores.opponentScore, baselineScores.opponentScore, finalQuarterScores.opponentScore)
      });
      break;
    }
  }

  return snapshot;
};

const writeGameScoreSnapshot = async (
  client: PoolClient,
  gameId: number,
  scores: QuarterScoresInput,
  activeQuarters: number[] = [1, 2, 3, 4]
): Promise<void> => {
  const state = inferGameStateFromScores(scores, activeQuarters);
  const currentQuarter = inferCurrentQuarter(scores, activeQuarters);
  const timeRemainingInQuarter = state === 'completed' ? '0:00' : null;
  const finalQuarter = activeQuarters[activeQuarters.length - 1] ?? 4;
  const finalScores = getQuarterScoresFromInput(scores, finalQuarter);

  await client.query(
    `UPDATE football_pool.game
     SET scores_by_quarter = $2::jsonb,
         final_score_home = $3,
         final_score_away = $4,
         state = $5,
         current_quarter = $6,
         time_remaining_in_quarter = $7,
         updated_at = NOW()
     WHERE id = $1`,
    [
      gameId,
      JSON.stringify(buildScoresByQuarterJson(scores)),
      finalScores.primaryScore,
      finalScores.opponentScore,
      state,
      currentQuarter,
      timeRemainingInQuarter
    ]
  );
};

const ensureQuarterAvailable = (scores: QuarterScoresInput, quarter: number, leagueCode?: string | null): void => {
  const quarterScores = getQuarterScoresFromInput(scores, quarter);

  if (quarterScores.primaryScore == null || quarterScores.opponentScore == null) {
    throw new Error(`ESPN has not posted a complete ${getSimulationStepLabel(leagueCode, quarter)} score yet.`);
  }
};

const ensureFullGameAvailable = (
  scores: QuarterScoresInput,
  activeQuarters: number[] = [1, 2, 3, 4],
  leagueCode?: string | null
): void => {
  const hasMissingSegment = activeQuarters.some((quarter) => {
    const quarterScores = getQuarterScoresFromInput(scores, quarter);
    return quarterScores.primaryScore == null || quarterScores.opponentScore == null;
  });

  if (hasMissingSegment) {
    const descriptor = getSimulationStepDescriptor(leagueCode);
    throw new Error(
      descriptor.singularLabel === 'Final'
        ? 'ESPN has not posted a final score for this game yet.'
        : `ESPN has not posted a complete ${descriptor.pluralLabel} score for this game yet.`
    );
  }
};

const loadSimulationAdvanceScores = async (
  gameId: number,
  source: IngestionSource,
  validateScores?: (scores: QuarterScoresInput) => void
): Promise<{
  scores: QuarterScoresInput;
  effectiveSource: IngestionSource;
  fallbackNotice: string | null;
  espnEventId: string | null;
  espnEventUid: string | null;
}> => {
  let attemptedUpdate: Awaited<ReturnType<typeof getGameIngestionUpdate>> | null = null;

  try {
    attemptedUpdate = await getGameIngestionUpdate(gameId, source);
    const scores = attemptedUpdate.scores;
    if (validateScores) {
      validateScores(scores);
    }

    return {
      scores,
      effectiveSource: source,
      fallbackNotice: null,
      espnEventId: attemptedUpdate.espnEventId ?? null,
      espnEventUid: attemptedUpdate.espnEventUid ?? null
    };
  } catch (error) {
    if (source !== 'espn') {
      throw error;
    }

    const fallbackUpdate = await getGameIngestionUpdate(gameId, 'mock');
    const scores = fallbackUpdate.scores;
    if (validateScores) {
      validateScores(scores);
    }

    return {
      scores,
      effectiveSource: 'mock',
      fallbackNotice: 'ESPN scores were unavailable, so mock scores were used instead.',
      espnEventId: attemptedUpdate?.espnEventId ?? null,
      espnEventUid: attemptedUpdate?.espnEventUid ?? null
    };
  }
};

const persistGameSourceIdentifiers = async (
  client: PoolClient,
  gameId: number,
  espnEventId?: string | null,
  espnEventUid?: string | null
): Promise<void> => {
  if (!espnEventId && !espnEventUid) {
    return;
  }

  await client.query(
    `UPDATE football_pool.game
     SET espn_event_id = COALESCE($2, espn_event_id),
         espn_event_uid = COALESCE($3, espn_event_uid),
         updated_at = NOW()
     WHERE id = $1`,
    [gameId, espnEventId ?? null, espnEventUid ?? null]
  );
};

const prepareGameForSimulation = async (client: PoolClient, poolId: number, gameId: number): Promise<void> => {
  const boardNumbers = await resolvePoolGameBoardNumbers(client, poolId);

  await client.query(
    `UPDATE football_pool.pool_game
     SET row_numbers = $3::jsonb,
         column_numbers = $4::jsonb,
         updated_at = NOW()
     WHERE pool_id = $1
       AND game_id = $2`,
    [poolId, gameId, JSON.stringify(boardNumbers.rowNumbers), JSON.stringify(boardNumbers.columnNumbers)]
  );

  await client.query(
    `UPDATE football_pool.game
     SET is_simulation = TRUE,
         updated_at = NOW()
     WHERE id = $1`,
    [gameId]
  );
};

const loadSimulationSchedule = async (
  client: PoolClient,
  pool: PoolContext
): Promise<{ season: number; teamName: string; byeWeeks: number[]; games: PoolGame[] }> => {
  let games = await loadPoolGames(client, pool.id);
  let season = Number(pool.season ?? new Date().getFullYear());
  let teamName = pool.team_name ?? pool.primary_team ?? 'Team';

  if (games.length === 0) {
    const imported = await importPoolScheduleFromEspn(client, pool.id);
    games = await loadPoolGames(client, pool.id);
    season = imported.season;
    teamName = imported.teamName;

    return {
      season,
      teamName,
      byeWeeks: imported.byeWeeks,
      games
    };
  }

  return {
    season,
    teamName,
    byeWeeks: games.filter((game) => isByeOpponent(game.opponent)).map((game) => Number(game.week_num)).filter((week) => Number.isFinite(week)),
    games
  };
};

const assignSimulationSquares = async (client: PoolClient, poolId: number, teamId: number | null): Promise<void> => {
  const userResult = await client.query<{ id: number }>(
    `SELECT id
     FROM football_pool.users
     ORDER BY id`
  );

  const playerResult = await client.query<{ id: number }>(
    `SELECT pt.id
     FROM football_pool.member_organization pt
     WHERE pt.team_id = $1
     ORDER BY pt.id`,
    [teamId]
  );

  const participantIds = userResult.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  const playerIds = playerResult.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));

  const participantAssignments = buildBalancedAssignments(participantIds, TOTAL_POOL_SQUARES);
  const playerAssignments = buildBalancedAssignments(playerIds, TOTAL_POOL_SQUARES);

  await client.query(
    `UPDATE football_pool.square AS sq
     SET participant_id = src.participant_id,
         player_id = src.player_id,
         paid_flg = TRUE
     FROM unnest($2::int[], $3::int[]) WITH ORDINALITY AS src(participant_id, player_id, ord)
     WHERE sq.pool_id = $1
       AND sq.square_num = src.ord`,
    [poolId, participantAssignments, playerAssignments]
  );
};

const resetSimulationGames = async (client: PoolClient, poolId: number): Promise<void> => {
  await client.query(
    `DELETE FROM football_pool.winnings_ledger
     WHERE pool_id = $1`,
    [poolId]
  );

  await client.query(
    `UPDATE football_pool.pool_game
     SET row_numbers = NULL,
         column_numbers = NULL,
         updated_at = NOW()
     WHERE pool_id = $1`,
    [poolId]
  );

  await client.query(
    `UPDATE football_pool.game
     SET is_simulation = TRUE,
         scores_by_quarter = '{}'::jsonb,
         final_score_home = NULL,
         final_score_away = NULL,
         state = 'scheduled',
         current_quarter = NULL,
         time_remaining_in_quarter = NULL,
         updated_at = NOW()
     WHERE id IN (
       SELECT pg.game_id
       FROM football_pool.pool_game pg
       WHERE pg.pool_id = $1
     )`,
    [poolId]
  );
};

export const getPoolSimulationStatus = async (
  client: PoolClient,
  poolId: number
): Promise<PoolSimulationStatus> => {
  const pool = await loadPoolContext(client, poolId);
  const simulationState = await loadSimulationState(client, poolId);

  const userResult = await client.query<{ user_count: number }>(
    `SELECT COUNT(*)::int AS user_count
     FROM football_pool.users`
  );
  const playerResult = await client.query<{ player_count: number }>(
    `SELECT COUNT(*)::int AS player_count
     FROM football_pool.member_organization
     WHERE team_id = $1`,
    [pool.team_id]
  );
  const squareResult = await client.query<{ assigned_square_count: number }>(
    `SELECT COUNT(*)::int AS assigned_square_count
     FROM football_pool.square
     WHERE pool_id = $1
       AND (participant_id IS NOT NULL OR player_id IS NOT NULL)`,
    [poolId]
  );
  const simulationResult = await client.query<{ simulation_game_count: number }>(
    `SELECT COUNT(*)::int AS simulation_game_count
     FROM football_pool.pool_game pg
     JOIN football_pool.game g ON g.id = pg.game_id
     WHERE pg.pool_id = $1
       AND COALESCE(g.is_simulation, FALSE) = TRUE`,
    [poolId]
  );

  const userCount = Number(userResult.rows[0]?.user_count ?? 0);
  const playerCount = Number(playerResult.rows[0]?.player_count ?? 0);
  const assignedSquareCount = Number(squareResult.rows[0]?.assigned_square_count ?? 0);
  const simulationGameCount = Number(simulationResult.rows[0]?.simulation_game_count ?? 0);

  const hasAssignedSquares = assignedSquareCount > 0;
  const hasSimulationState = Boolean(simulationState);
  const hasSimulationGames = simulationGameCount > 0;
  const hasSimulationData = hasSimulationState || hasSimulationGames;
  const blockers: string[] = [];

  if (!env.SIMULATION_ENABLED) {
    blockers.push('Simulation tools are disabled by configuration.');
  }

  if (!pool.team_id) {
    blockers.push('Select a team for the pool first.');
  }

  if (userCount < 1) {
    blockers.push('Add at least one user first.');
  }

  if (playerCount < 1) {
    blockers.push('Assign at least one player to the pool team first.');
  }

  if (hasAssignedSquares && !hasSimulationData) {
    blockers.push('Simulation requires a pool with no assigned squares.');
  }

  const progressAction =
    simulationState?.current_game_id && simulationState.mode === 'by_game'
      ? 'complete_game'
      : simulationState?.current_game_id && simulationState.mode === 'by_quarter'
        ? 'complete_quarter'
        : null;

  return {
    enabledInEnvironment: env.SIMULATION_ENABLED,
    hasSimulationData,
    hasAssignedSquares,
    userCount,
    playerCount,
    canSimulate:
      env.SIMULATION_ENABLED &&
      !hasSimulationState &&
      !hasAssignedSquares &&
      userCount > 0 &&
      playerCount > 0 &&
      Boolean(pool.team_id),
    canCleanup: env.SIMULATION_ENABLED && hasSimulationData,
    blockers,
    mode: simulationState?.mode ?? null,
    currentGameId: simulationState?.current_game_id ?? null,
    nextQuarter: simulationState?.next_quarter ?? null,
    progressAction,
    canAdvance: env.SIMULATION_ENABLED && Boolean(progressAction)
  };
};

export const createPoolSeasonSimulation = async (
  client: PoolClient,
  poolId: number,
  mode: SimulationMode = 'full_year'
): Promise<PoolSimulationResult> => {
  assertSimulationEnabled();

  const pool = await loadPoolContext(client, poolId);
  const activeScoreSegments = getActiveScoreSegmentNumbers(pool.league_code);
  const status = await getPoolSimulationStatus(client, poolId);

  if (!status.canSimulate) {
    throw new Error(status.blockers[0] ?? 'Pool is not ready for simulation.');
  }

  await ensurePoolSquaresInitialized(client, poolId);
  await assignSimulationSquares(client, poolId, pool.team_id);

  const schedule = await loadSimulationSchedule(client, pool);
  await resetSimulationGames(client, poolId);

  const games = await loadPoolGames(client, poolId);
  let simulatedGames = 0;
  let currentGameId: number | null = null;
  let nextQuarter: number | null = null;
  let progressAction: SimulationProgressAction | null = null;

  if (mode === 'full_year') {
    for (const game of games) {
      if (isByeOpponent(game.opponent)) {
        continue;
      }

      await prepareGameForSimulation(client, poolId, game.id);
      const { scores: simulationScores, espnEventId, espnEventUid } = await loadSimulationAdvanceScores(
        game.id,
        'espn',
        (scores) => ensureFullGameAvailable(scores, activeScoreSegments, pool.league_code)
      );
      await persistGameSourceIdentifiers(client, game.id, espnEventId, espnEventUid);
      await writeGameScoreSnapshot(client, game.id, simulationScores);
      await processGameScoresWithClient(client, game.id, simulationScores);
      simulatedGames += 1;
    }

    await upsertSimulationState(client, poolId, 'full_year', null, null);
  } else {
    const firstGame = findNextPlayableGame(games);

    if (firstGame) {
      await prepareGameForSimulation(client, poolId, firstGame.id);
      currentGameId = firstGame.id;
      const firstSimulationQuarter = activeScoreSegments[0] ?? 1;
      nextQuarter = mode === 'by_quarter' ? firstSimulationQuarter : null;
      progressAction = mode === 'by_quarter' ? 'complete_quarter' : 'complete_game';

      if (mode === 'by_quarter') {
        const { scores: previewScores, espnEventId, espnEventUid } = await loadSimulationAdvanceScores(
          firstGame.id,
          'espn',
          (scores) => ensureQuarterAvailable(scores, firstSimulationQuarter, pool.league_code)
        );
        await persistGameSourceIdentifiers(client, firstGame.id, espnEventId, espnEventUid);
        await writeGameScoreSnapshot(client, firstGame.id, buildMidQuarterSnapshot(previewScores, firstSimulationQuarter, activeScoreSegments), activeScoreSegments);
      }
    }

    await upsertSimulationState(client, poolId, mode, currentGameId, nextQuarter);
  }

  return {
    season: schedule.season,
    teamName: schedule.teamName,
    simulatedGames,
    byeWeeks: schedule.byeWeeks,
    assignedSquares: TOTAL_POOL_SQUARES,
    mode,
    currentGameId,
    nextQuarter,
    progressAction
  };
};

export const advancePoolSeasonSimulation = async (
  client: PoolClient,
  poolId: number,
  source: IngestionSource = 'espn',
  action: SimulationAdvanceAction = 'complete'
): Promise<PoolSimulationAdvanceResult> => {
  assertSimulationEnabled();

  const simulationState = await loadSimulationState(client, poolId);

  if (!simulationState || simulationState.mode === 'full_year' || !simulationState.current_game_id) {
    throw new Error('No step-by-step simulation is active for this pool.');
  }

  const pool = await loadPoolContext(client, poolId);
  const activeScoreSegments = getActiveScoreSegmentNumbers(pool.league_code);

  const games = await loadPoolGames(client, poolId);
  const currentGame = games.find((game) => Number(game.id) === Number(simulationState.current_game_id));

  if (!currentGame) {
    throw new Error('The active simulation game could not be found.');
  }

  if (currentGame.row_numbers == null || currentGame.col_numbers == null) {
    await prepareGameForSimulation(client, poolId, currentGame.id);
  }

  if (action === 'live') {
    if (simulationState.mode !== 'by_quarter') {
      throw new Error('Live score refresh is only available for By Quarter simulations.');
    }

    const liveQuarter = simulationState.next_quarter ?? getNextIncompleteQuarter(currentGame, activeScoreSegments) ?? activeScoreSegments[0] ?? 1;
    const { scores: fetchedScores, fallbackNotice, espnEventId, espnEventUid } = await loadSimulationAdvanceScores(
      currentGame.id,
      source,
      (scores) => ensureQuarterAvailable(scores, liveQuarter, pool.league_code)
    );

    await persistGameSourceIdentifiers(client, currentGame.id, espnEventId, espnEventUid);
    await writeGameScoreSnapshot(
      client,
      currentGame.id,
      buildAdvancedMidQuarterSnapshot(
        {
          q1PrimaryScore: currentGame.q1_primary_score,
          q1OpponentScore: currentGame.q1_opponent_score,
          q2PrimaryScore: currentGame.q2_primary_score,
          q2OpponentScore: currentGame.q2_opponent_score,
          q3PrimaryScore: currentGame.q3_primary_score,
          q3OpponentScore: currentGame.q3_opponent_score,
          q4PrimaryScore: currentGame.q4_primary_score,
          q4OpponentScore: currentGame.q4_opponent_score,
          q5PrimaryScore: currentGame.q5_primary_score,
          q5OpponentScore: currentGame.q5_opponent_score,
          q6PrimaryScore: currentGame.q6_primary_score,
          q6OpponentScore: currentGame.q6_opponent_score,
          q7PrimaryScore: currentGame.q7_primary_score,
          q7OpponentScore: currentGame.q7_opponent_score,
          q8PrimaryScore: currentGame.q8_primary_score,
          q8OpponentScore: currentGame.q8_opponent_score,
          q9PrimaryScore: currentGame.q9_primary_score,
          q9OpponentScore: currentGame.q9_opponent_score
        },
        fetchedScores,
        liveQuarter,
        activeScoreSegments
      ),
      activeScoreSegments
    );

    await upsertSimulationState(client, poolId, 'by_quarter', currentGame.id, liveQuarter);
    const status = await getPoolSimulationStatus(client, poolId);

    return {
      message: `Updated the live ${getSimulationStepLabel(pool.league_code, liveQuarter)} score for ${currentGame.opponent ?? 'the current game'}.${fallbackNotice ? ` ${fallbackNotice}` : ''}`,
      status,
      completedGameId: currentGame.id,
      completedQuarter: null
    };
  }

  if (simulationState.mode === 'by_game') {
    const { scores: fetchedScores, fallbackNotice, espnEventId, espnEventUid } = await loadSimulationAdvanceScores(
      currentGame.id,
      source,
      (scores) => ensureFullGameAvailable(scores, activeScoreSegments, pool.league_code)
    );

    await persistGameSourceIdentifiers(client, currentGame.id, espnEventId, espnEventUid);
    await writeGameScoreSnapshot(client, currentGame.id, fetchedScores, activeScoreSegments);
    await processGameScoresWithClient(client, currentGame.id, fetchedScores);

    const nextGame = findNextPlayableGame(games, currentGame.id);
    if (nextGame) {
      await prepareGameForSimulation(client, poolId, nextGame.id);
    }

    await upsertSimulationState(client, poolId, 'by_game', nextGame?.id ?? null, null);
    const status = await getPoolSimulationStatus(client, poolId);

    return {
      message: `${
        nextGame
          ? `Completed ${currentGame.opponent ?? 'the current game'} and prepared the next game.`
          : 'Completed the final simulated game.'
      }${fallbackNotice ? ` ${fallbackNotice}` : ''}`,
      status,
      completedGameId: currentGame.id,
      completedQuarter: 4
    };
  }

  const quarterToComplete = simulationState.next_quarter ?? getNextIncompleteQuarter(currentGame, activeScoreSegments) ?? activeScoreSegments[0] ?? 1;
  const { scores: fetchedScores, fallbackNotice, espnEventId, espnEventUid } = await loadSimulationAdvanceScores(
    currentGame.id,
    source,
    (scores) => ensureQuarterAvailable(scores, quarterToComplete, pool.league_code)
  );
  const partialScores = buildPartialQuarterSnapshot(fetchedScores, quarterToComplete, activeScoreSegments);

  await persistGameSourceIdentifiers(client, currentGame.id, espnEventId, espnEventUid);
  await writeGameScoreSnapshot(client, currentGame.id, partialScores, activeScoreSegments);
  await processGameScoresWithClient(client, currentGame.id, partialScores);

  let nextGameId: number | null = currentGame.id;
  let nextQuarter: number | null = getNextActiveQuarter(activeScoreSegments, quarterToComplete);
  let message = `Completed ${getSimulationStepLabel(pool.league_code, quarterToComplete)} for ${currentGame.opponent ?? 'the current game'}.`;

  if (nextQuarter == null) {
    const nextGame = findNextPlayableGame(games, currentGame.id);
    if (nextGame) {
      await prepareGameForSimulation(client, poolId, nextGame.id);
      const firstSimulationQuarter = activeScoreSegments[0] ?? 1;
      const { scores: previewScores, espnEventId, espnEventUid } = await loadSimulationAdvanceScores(
        nextGame.id,
        source,
        (scores) => ensureQuarterAvailable(scores, firstSimulationQuarter, pool.league_code)
      );
      await persistGameSourceIdentifiers(client, nextGame.id, espnEventId, espnEventUid);
      await writeGameScoreSnapshot(client, nextGame.id, buildMidQuarterSnapshot(previewScores, firstSimulationQuarter, activeScoreSegments));
      nextGameId = nextGame.id;
      nextQuarter = firstSimulationQuarter;
      message = `Completed ${currentGame.opponent ?? 'the current game'} and prepared the next game with a live ${getSimulationStepLabel(pool.league_code, firstSimulationQuarter)} score.`;
    } else {
      nextGameId = null;
      nextQuarter = null;
      message = 'Completed the final segment of the final simulated game.';
    }
  } else {
    await writeGameScoreSnapshot(client, currentGame.id, buildMidQuarterSnapshot(fetchedScores, nextQuarter, activeScoreSegments));
    message = `Completed ${getSimulationStepLabel(pool.league_code, quarterToComplete)} for ${currentGame.opponent ?? 'the current game'} and rolled into a live ${getSimulationStepLabel(pool.league_code, nextQuarter)} score.`;
  }

  await upsertSimulationState(client, poolId, 'by_quarter', nextGameId, nextQuarter);
  const status = await getPoolSimulationStatus(client, poolId);

  return {
    message: `${message}${fallbackNotice ? ` ${fallbackNotice}` : ''}`,
    status,
    completedGameId: currentGame.id,
    completedQuarter: quarterToComplete
  };
};

export const cleanupPoolSeasonSimulation = async (
  client: PoolClient,
  poolId: number
): Promise<PoolSimulationCleanupResult> => {
  assertSimulationEnabled();

  await ensurePoolSquaresInitialized(client, poolId);
  await clearSimulationState(client, poolId);

  const simulationGamesResult = await client.query<{ id: number }>(
    `SELECT g.id
     FROM football_pool.pool_game pg
     JOIN football_pool.game g ON g.id = pg.game_id
     WHERE pg.pool_id = $1
       AND COALESCE(g.is_simulation, FALSE) = TRUE`,
    [poolId]
  );

  const simulationGameIds = simulationGamesResult.rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id));

  const clearSquaresResult = await client.query(
    `UPDATE football_pool.square
     SET participant_id = NULL,
         player_id = NULL,
         paid_flg = FALSE
     WHERE pool_id = $1
       AND (
         participant_id IS NOT NULL
         OR player_id IS NOT NULL
         OR COALESCE(paid_flg, FALSE) = TRUE
       )`,
    [poolId]
  );

  let deletedWinnings = 0;
  let deletedGames = 0;

  if (simulationGameIds.length > 0) {
    const deleteWinningsResult = await client.query(
      `DELETE FROM football_pool.winnings_ledger
       WHERE pool_id = $1
         AND game_id = ANY($2::int[])`,
      [poolId, simulationGameIds]
    );

    await client.query(
      `UPDATE football_pool.pool_game
       SET row_numbers = NULL,
           column_numbers = NULL,
           updated_at = NOW()
       WHERE pool_id = $1
         AND game_id = ANY($2::int[])`,
      [poolId, simulationGameIds]
    );

    const resetGamesResult = await client.query(
      `UPDATE football_pool.game
       SET is_simulation = FALSE,
           scores_by_quarter = '{}'::jsonb,
           final_score_home = NULL,
           final_score_away = NULL,
           state = 'scheduled',
           current_quarter = NULL,
           time_remaining_in_quarter = NULL,
           updated_at = NOW()
       WHERE id = ANY($1::int[])`,
      [simulationGameIds]
    );

    deletedWinnings = deleteWinningsResult.rowCount ?? 0;
    deletedGames = resetGamesResult.rowCount ?? 0;
  }

  return {
    clearedSquares: clearSquaresResult.rowCount ?? 0,
    deletedGames,
    deletedWinnings
  };
};

