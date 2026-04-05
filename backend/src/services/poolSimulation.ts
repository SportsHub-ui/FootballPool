import type { PoolClient } from 'pg'
import { env } from '../config/env'
import { ensurePoolSquaresInitialized, TOTAL_POOL_SQUARES } from './poolSquares'
import { importPoolScheduleFromEspn } from './scheduleImport'
import { processGameScoresWithClient, type QuarterScoresInput } from './scoreProcessing'

export type PoolSimulationStatus = {
  enabledInEnvironment: boolean
  hasSimulationData: boolean
  hasAssignedSquares: boolean
  userCount: number
  playerCount: number
  canSimulate: boolean
  canCleanup: boolean
  blockers: string[]
}

export type PoolSimulationResult = {
  season: number
  teamName: string
  simulatedGames: number
  byeWeeks: number[]
  assignedSquares: number
}

export type PoolSimulationCleanupResult = {
  clearedSquares: number
  deletedGames: number
  deletedWinnings: number
}

type PoolContext = {
  id: number
  season: number | null
  team_id: number | null
  primary_team: string | null
  team_name: string | null
}

type PoolGame = {
  id: number
  opponent: string | null
}

const randomInt = (maxExclusive: number): number => Math.floor(Math.random() * maxExclusive)

const shuffle = <T,>(values: T[]): T[] => {
  const next = [...values]

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1)
    ;[next[index], next[swapIndex]] = [next[swapIndex], next[index]]
  }

  return next
}

const normalize = (value: string | null | undefined): string =>
  (value ?? '').trim().toUpperCase()

const buildRandomDigitOrder = (): number[] => shuffle(Array.from({ length: 10 }, (_, index) => index))

const buildBalancedAssignments = (ids: number[], total: number): number[] => {
  const assignments: number[] = []

  while (assignments.length < total) {
    assignments.push(...shuffle(ids))
  }

  return shuffle(assignments.slice(0, total))
}

const quarterAddOptions = [0, 0, 3, 3, 6, 7, 7, 10, 14]

const buildRandomScores = (): QuarterScoresInput => {
  let primary = 0
  let opponent = 0

  const nextPrimary = () => {
    primary += quarterAddOptions[randomInt(quarterAddOptions.length)]
    return primary
  }

  const nextOpponent = () => {
    opponent += quarterAddOptions[randomInt(quarterAddOptions.length)]
    return opponent
  }

  return {
    q1PrimaryScore: nextPrimary(),
    q1OpponentScore: nextOpponent(),
    q2PrimaryScore: nextPrimary(),
    q2OpponentScore: nextOpponent(),
    q3PrimaryScore: nextPrimary(),
    q3OpponentScore: nextOpponent(),
    q4PrimaryScore: nextPrimary(),
    q4OpponentScore: nextOpponent()
  }
}

const assertSimulationEnabled = (): void => {
  if (!env.SIMULATION_ENABLED) {
    throw new Error('Simulation tools are disabled by configuration.')
  }
}

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
  )

  const pool = result.rows[0]

  if (!pool) {
    throw new Error('Pool not found.')
  }

  return pool
}

export const getPoolSimulationStatus = async (
  client: PoolClient,
  poolId: number
): Promise<PoolSimulationStatus> => {
  const pool = await loadPoolContext(client, poolId)

  const [userResult, playerResult, squareResult, simulationResult] = await Promise.all([
    client.query<{ user_count: number }>(
      `SELECT COUNT(*)::int AS user_count
       FROM football_pool.users`
    ),
    client.query<{ player_count: number }>(
      `SELECT COUNT(*)::int AS player_count
       FROM football_pool.player_team
       WHERE team_id = $1`,
      [pool.team_id]
    ),
    client.query<{ assigned_square_count: number }>(
      `SELECT COUNT(*)::int AS assigned_square_count
       FROM football_pool.square
       WHERE pool_id = $1
         AND (participant_id IS NOT NULL OR player_id IS NOT NULL)`,
      [poolId]
    ),
    client.query<{ simulation_game_count: number }>(
      `SELECT COUNT(*)::int AS simulation_game_count
       FROM football_pool.game
       WHERE pool_id = $1
         AND COALESCE(is_simulation, FALSE) = TRUE`,
      [poolId]
    )
  ])

  const userCount = Number(userResult.rows[0]?.user_count ?? 0)
  const playerCount = Number(playerResult.rows[0]?.player_count ?? 0)
  const assignedSquareCount = Number(squareResult.rows[0]?.assigned_square_count ?? 0)
  const simulationGameCount = Number(simulationResult.rows[0]?.simulation_game_count ?? 0)

  const hasAssignedSquares = assignedSquareCount > 0
  const hasSimulationData = simulationGameCount > 0
  const blockers: string[] = []

  if (!env.SIMULATION_ENABLED) {
    blockers.push('Simulation tools are disabled by configuration.')
  }

  if (!pool.team_id) {
    blockers.push('Select a team for the pool first.')
  }

  if (userCount < 1) {
    blockers.push('Add at least one user first.')
  }

  if (playerCount < 1) {
    blockers.push('Assign at least one player to the pool team first.')
  }

  if (hasAssignedSquares && !hasSimulationData) {
    blockers.push('Simulation requires a pool with no assigned squares.')
  }

  return {
    enabledInEnvironment: env.SIMULATION_ENABLED,
    hasSimulationData,
    hasAssignedSquares,
    userCount,
    playerCount,
    canSimulate:
      env.SIMULATION_ENABLED &&
      !hasSimulationData &&
      !hasAssignedSquares &&
      userCount > 0 &&
      playerCount > 0 &&
      Boolean(pool.team_id),
    canCleanup: env.SIMULATION_ENABLED && hasSimulationData,
    blockers
  }
}

export const createPoolSeasonSimulation = async (
  client: PoolClient,
  poolId: number
): Promise<PoolSimulationResult> => {
  assertSimulationEnabled()

  const pool = await loadPoolContext(client, poolId)
  const status = await getPoolSimulationStatus(client, poolId)

  if (!status.canSimulate) {
    throw new Error(status.blockers[0] ?? 'Pool is not ready for simulation.')
  }

  await ensurePoolSquaresInitialized(client, poolId)

  const [userResult, playerResult, importedSchedule] = await Promise.all([
    client.query<{ id: number }>(
      `SELECT id
       FROM football_pool.users
       ORDER BY id`
    ),
    client.query<{ id: number }>(
      `SELECT pt.id
       FROM football_pool.player_team pt
       WHERE pt.team_id = $1
       ORDER BY pt.id`,
      [pool.team_id]
    ),
    importPoolScheduleFromEspn(client, poolId)
  ])

  const participantIds = userResult.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id))
  const playerIds = playerResult.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id))

  const participantAssignments = buildBalancedAssignments(participantIds, TOTAL_POOL_SQUARES)
  const playerAssignments = buildBalancedAssignments(playerIds, TOTAL_POOL_SQUARES)

  await client.query(
    `UPDATE football_pool.square AS sq
     SET participant_id = src.participant_id,
         player_id = src.player_id,
         paid_flg = TRUE
     FROM unnest($2::int[], $3::int[]) WITH ORDINALITY AS src(participant_id, player_id, ord)
     WHERE sq.pool_id = $1
       AND sq.square_num = src.ord`,
    [poolId, participantAssignments, playerAssignments]
  )

  const gamesResult = await client.query<PoolGame>(
    `SELECT id, opponent
     FROM football_pool.game
     WHERE pool_id = $1
     ORDER BY COALESCE(week_num, 999), game_dt ASC, id ASC`,
    [poolId]
  )

  let simulatedGames = 0

  for (const game of gamesResult.rows) {
    await client.query(
      `UPDATE football_pool.game
       SET is_simulation = TRUE,
           row_numbers = $2::jsonb,
           col_numbers = $3::jsonb
       WHERE id = $1`,
      [game.id, JSON.stringify(buildRandomDigitOrder()), JSON.stringify(buildRandomDigitOrder())]
    )

    if (normalize(game.opponent) === 'BYE') {
      await client.query(
        `UPDATE football_pool.game
         SET q1_primary_score = NULL,
             q1_opponent_score = NULL,
             q2_primary_score = NULL,
             q2_opponent_score = NULL,
             q3_primary_score = NULL,
             q3_opponent_score = NULL,
             q4_primary_score = NULL,
             q4_opponent_score = NULL
         WHERE id = $1`,
        [game.id]
      )

      await client.query(
        `DELETE FROM football_pool.winnings_ledger
         WHERE game_id = $1
           AND pool_id = $2`,
        [game.id, poolId]
      )
      continue
    }

    await processGameScoresWithClient(client, game.id, buildRandomScores())
    simulatedGames += 1
  }

  return {
    season: Number(pool.season ?? importedSchedule.season),
    teamName: pool.team_name ?? pool.primary_team ?? importedSchedule.teamName,
    simulatedGames,
    byeWeeks: importedSchedule.byeWeeks,
    assignedSquares: TOTAL_POOL_SQUARES
  }
}

export const cleanupPoolSeasonSimulation = async (
  client: PoolClient,
  poolId: number
): Promise<PoolSimulationCleanupResult> => {
  assertSimulationEnabled()

  await ensurePoolSquaresInitialized(client, poolId)

  const simulationGamesResult = await client.query<{ id: number }>(
    `SELECT id
     FROM football_pool.game
     WHERE pool_id = $1
       AND COALESCE(is_simulation, FALSE) = TRUE`,
    [poolId]
  )

  const simulationGameIds = simulationGamesResult.rows
    .map((row) => Number(row.id))
    .filter((id) => Number.isFinite(id))

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
  )

  let deletedWinnings = 0
  let deletedGames = 0

  if (simulationGameIds.length > 0) {
    const deleteWinningsResult = await client.query(
      `DELETE FROM football_pool.winnings_ledger
       WHERE pool_id = $1
         AND game_id = ANY($2::int[])`,
      [poolId, simulationGameIds]
    )

    const deleteGamesResult = await client.query(
      `DELETE FROM football_pool.game
       WHERE pool_id = $1
         AND id = ANY($2::int[])`,
      [poolId, simulationGameIds]
    )

    deletedWinnings = deleteWinningsResult.rowCount ?? 0
    deletedGames = deleteGamesResult.rowCount ?? 0
  }

  return {
    clearedSquares: clearSquaresResult.rowCount ?? 0,
    deletedGames,
    deletedWinnings
  }
}
