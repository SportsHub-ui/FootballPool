import type { PoolClient } from 'pg';
import { env } from '../config/env';
import { ensurePoolSquaresInitialized, TOTAL_POOL_SQUARES } from './poolSquares';
import { importPoolScheduleFromEspn } from './scheduleImport';
import { getScoresForGame, type IngestionSource } from './scoreIngestion';
import { processGameScoresWithClient, type QuarterScoresInput } from './scoreProcessing';

export type SimulationMode = 'full_year' | 'by_game' | 'by_quarter';
type SimulationProgressAction = 'complete_game' | 'complete_quarter';

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
};

type PoolSimulationState = {
  pool_id: number;
  mode: SimulationMode;
  current_game_id: number | null;
  next_quarter: number | null;
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

const buildRandomDigitOrder = (): number[] => shuffle(Array.from({ length: 10 }, (_, index) => index));

const buildBalancedAssignments = (ids: number[], total: number): number[] => {
  const assignments: number[] = [];

  while (assignments.length < total) {
    assignments.push(...shuffle(ids));
  }

  return shuffle(assignments.slice(0, total));
};

const quarterAddOptions = [0, 0, 3, 3, 6, 7, 7, 10, 14];

const buildRandomScores = (): QuarterScoresInput => {
  let primary = 0;
  let opponent = 0;

  const nextPrimary = () => {
    primary += quarterAddOptions[randomInt(quarterAddOptions.length)];
    return primary;
  };

  const nextOpponent = () => {
    opponent += quarterAddOptions[randomInt(quarterAddOptions.length)];
    return opponent;
  };

  return {
    q1PrimaryScore: nextPrimary(),
    q1OpponentScore: nextOpponent(),
    q2PrimaryScore: nextPrimary(),
    q2OpponentScore: nextOpponent(),
    q3PrimaryScore: nextPrimary(),
    q3OpponentScore: nextOpponent(),
    q4PrimaryScore: nextPrimary(),
    q4OpponentScore: nextOpponent()
  };
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
        t.team_name
     FROM football_pool.pool p
     LEFT JOIN football_pool.team t ON t.id = p.team_id
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
      next_quarter INTEGER NULL CHECK (next_quarter BETWEEN 1 AND 4),
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
  const result = await client.query<PoolGame>(
    `SELECT
        id,
        opponent,
        week_num,
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
     ORDER BY COALESCE(week_num, 999), game_dt ASC, id ASC`,
    [poolId]
  );

  return result.rows;
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

const getNextIncompleteQuarter = (game: PoolGame): number | null => {
  if (game.q1_primary_score == null || game.q1_opponent_score == null) {
    return 1;
  }
  if (game.q2_primary_score == null || game.q2_opponent_score == null) {
    return 2;
  }
  if (game.q3_primary_score == null || game.q3_opponent_score == null) {
    return 3;
  }
  if (game.q4_primary_score == null || game.q4_opponent_score == null) {
    return 4;
  }

  return null;
};

const buildPartialQuarterSnapshot = (scores: QuarterScoresInput, quarter: number): QuarterScoresInput => ({
  q1PrimaryScore: quarter >= 1 ? scores.q1PrimaryScore : null,
  q1OpponentScore: quarter >= 1 ? scores.q1OpponentScore : null,
  q2PrimaryScore: quarter >= 2 ? scores.q2PrimaryScore : null,
  q2OpponentScore: quarter >= 2 ? scores.q2OpponentScore : null,
  q3PrimaryScore: quarter >= 3 ? scores.q3PrimaryScore : null,
  q3OpponentScore: quarter >= 3 ? scores.q3OpponentScore : null,
  q4PrimaryScore: quarter >= 4 ? scores.q4PrimaryScore : null,
  q4OpponentScore: quarter >= 4 ? scores.q4OpponentScore : null
});

const ensureQuarterAvailable = (scores: QuarterScoresInput, quarter: number): void => {
  const quarterValues =
    quarter === 1
      ? [scores.q1PrimaryScore, scores.q1OpponentScore]
      : quarter === 2
        ? [scores.q2PrimaryScore, scores.q2OpponentScore]
        : quarter === 3
          ? [scores.q3PrimaryScore, scores.q3OpponentScore]
          : [scores.q4PrimaryScore, scores.q4OpponentScore];

  if (quarterValues.some((value) => value == null)) {
    throw new Error(`ESPN has not posted complete scores for quarter ${quarter} yet.`);
  }
};

const ensureFullGameAvailable = (scores: QuarterScoresInput): void => {
  if (
    scores.q1PrimaryScore == null ||
    scores.q1OpponentScore == null ||
    scores.q2PrimaryScore == null ||
    scores.q2OpponentScore == null ||
    scores.q3PrimaryScore == null ||
    scores.q3OpponentScore == null ||
    scores.q4PrimaryScore == null ||
    scores.q4OpponentScore == null
  ) {
    throw new Error('ESPN has not posted a complete four-quarter score for this game yet.');
  }
};

const loadSimulationAdvanceScores = async (
  gameId: number,
  source: IngestionSource,
  validateScores: (scores: QuarterScoresInput) => void
): Promise<{ scores: QuarterScoresInput; effectiveSource: IngestionSource; fallbackNotice: string | null }> => {
  try {
    const scores = await getScoresForGame(gameId, source);
    validateScores(scores);

    return {
      scores,
      effectiveSource: source,
      fallbackNotice: null
    };
  } catch (error) {
    if (source !== 'espn') {
      throw error;
    }

    const scores = await getScoresForGame(gameId, 'mock');
    validateScores(scores);

    return {
      scores,
      effectiveSource: 'mock',
      fallbackNotice: 'ESPN scores were unavailable, so mock scores were used instead.'
    };
  }
};

const prepareGameForSimulation = async (client: PoolClient, gameId: number): Promise<void> => {
  await client.query(
    `UPDATE football_pool.game
     SET row_numbers = $2::jsonb,
         col_numbers = $3::jsonb,
         is_simulation = TRUE
     WHERE id = $1`,
    [gameId, JSON.stringify(buildRandomDigitOrder()), JSON.stringify(buildRandomDigitOrder())]
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
     FROM football_pool.player_team pt
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
    `UPDATE football_pool.game
     SET is_simulation = TRUE,
         row_numbers = NULL,
         col_numbers = NULL,
         q1_primary_score = NULL,
         q1_opponent_score = NULL,
         q2_primary_score = NULL,
         q2_opponent_score = NULL,
         q3_primary_score = NULL,
         q3_opponent_score = NULL,
         q4_primary_score = NULL,
         q4_opponent_score = NULL
     WHERE pool_id = $1`,
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
     FROM football_pool.player_team
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
     FROM football_pool.game
     WHERE pool_id = $1
       AND COALESCE(is_simulation, FALSE) = TRUE`,
    [poolId]
  );

  const userCount = Number(userResult.rows[0]?.user_count ?? 0);
  const playerCount = Number(playerResult.rows[0]?.player_count ?? 0);
  const assignedSquareCount = Number(squareResult.rows[0]?.assigned_square_count ?? 0);
  const simulationGameCount = Number(simulationResult.rows[0]?.simulation_game_count ?? 0);

  const hasAssignedSquares = assignedSquareCount > 0;
  const hasSimulationState = Boolean(simulationState);
  const hasSimulationData = hasSimulationState || (simulationGameCount > 0 && hasAssignedSquares);
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

      await prepareGameForSimulation(client, game.id);
      await processGameScoresWithClient(client, game.id, buildRandomScores());
      simulatedGames += 1;
    }

    await upsertSimulationState(client, poolId, 'full_year', null, null);
  } else {
    const firstGame = findNextPlayableGame(games);

    if (firstGame) {
      await prepareGameForSimulation(client, firstGame.id);
      currentGameId = firstGame.id;
      nextQuarter = mode === 'by_quarter' ? 1 : null;
      progressAction = mode === 'by_quarter' ? 'complete_quarter' : 'complete_game';
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
  source: IngestionSource = 'espn'
): Promise<PoolSimulationAdvanceResult> => {
  assertSimulationEnabled();

  const simulationState = await loadSimulationState(client, poolId);

  if (!simulationState || simulationState.mode === 'full_year' || !simulationState.current_game_id) {
    throw new Error('No step-by-step simulation is active for this pool.');
  }

  const games = await loadPoolGames(client, poolId);
  const currentGame = games.find((game) => Number(game.id) === Number(simulationState.current_game_id));

  if (!currentGame) {
    throw new Error('The active simulation game could not be found.');
  }

  if (currentGame.row_numbers == null || currentGame.col_numbers == null) {
    await prepareGameForSimulation(client, currentGame.id);
  }

  if (simulationState.mode === 'by_game') {
    const { scores: fetchedScores, fallbackNotice } = await loadSimulationAdvanceScores(
      currentGame.id,
      source,
      ensureFullGameAvailable
    );

    await processGameScoresWithClient(client, currentGame.id, fetchedScores);

    const nextGame = findNextPlayableGame(games, currentGame.id);
    if (nextGame) {
      await prepareGameForSimulation(client, nextGame.id);
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

  const quarterToComplete = simulationState.next_quarter ?? getNextIncompleteQuarter(currentGame) ?? 1;
  const { scores: fetchedScores, fallbackNotice } = await loadSimulationAdvanceScores(
    currentGame.id,
    source,
    (scores) => ensureQuarterAvailable(scores, quarterToComplete)
  );
  const partialScores = buildPartialQuarterSnapshot(fetchedScores, quarterToComplete);

  await processGameScoresWithClient(client, currentGame.id, partialScores);

  let nextGameId: number | null = currentGame.id;
  let nextQuarter: number | null = quarterToComplete + 1;
  let message = `Completed quarter ${quarterToComplete} for ${currentGame.opponent ?? 'the current game'}.`;

  if (quarterToComplete >= 4) {
    const nextGame = findNextPlayableGame(games, currentGame.id);
    if (nextGame) {
      await prepareGameForSimulation(client, nextGame.id);
      nextGameId = nextGame.id;
      nextQuarter = 1;
      message = `Completed ${currentGame.opponent ?? 'the current game'} and prepared the next game.`;
    } else {
      nextGameId = null;
      nextQuarter = null;
      message = 'Completed the final quarter of the final simulated game.';
    }
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
    `SELECT id
     FROM football_pool.game
     WHERE pool_id = $1
       AND COALESCE(is_simulation, FALSE) = TRUE`,
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

    const deleteGamesResult = await client.query(
      `DELETE FROM football_pool.game
       WHERE pool_id = $1
         AND id = ANY($2::int[])`,
      [poolId, simulationGameIds]
    );

    deletedWinnings = deleteWinningsResult.rowCount ?? 0;
    deletedGames = deleteGamesResult.rowCount ?? 0;
  }

  return {
    clearedSquares: clearSquaresResult.rowCount ?? 0,
    deletedGames,
    deletedWinnings
  };
};
