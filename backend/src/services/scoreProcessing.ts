import type { PoolClient } from 'pg';
import { db } from '../config/db';

export interface QuarterScoresInput {
  q1PrimaryScore: number | null;
  q1OpponentScore: number | null;
  q2PrimaryScore: number | null;
  q2OpponentScore: number | null;
  q3PrimaryScore: number | null;
  q3OpponentScore: number | null;
  q4PrimaryScore: number | null;
  q4OpponentScore: number | null;
}

interface QuarterSpec {
  num: number;
  payout: number;
  squareNum: number | null;
}

export interface ScoreProcessingResult {
  game: {
    id: number;
    pool_id: number;
    q1_primary_score: number | null;
    q1_opponent_score: number | null;
    q2_primary_score: number | null;
    q2_opponent_score: number | null;
    q3_primary_score: number | null;
    q3_opponent_score: number | null;
    q4_primary_score: number | null;
    q4_opponent_score: number | null;
  };
  winnersCalculated: boolean;
  winnersWritten: number;
  unresolvedWinners: number;
}

const defaultDigitOrder = Array.from({ length: 10 }, (_, index) => index);

const toDigitOrder = (value: unknown): number[] => {
  if (typeof value === 'string') {
    try {
      return toDigitOrder(JSON.parse(value));
    } catch {
      return defaultDigitOrder;
    }
  }

  if (Array.isArray(value)) {
    const normalized = value.map((entry) => Number(entry));
    if (normalized.length === 10 && normalized.every((entry) => Number.isFinite(entry))) {
      return normalized;
    }
  }

  return defaultDigitOrder;
};

export const resolveWinningSquareNumber = (
  rowNumbers: unknown,
  colNumbers: unknown,
  opponentScore: number | null | undefined,
  primaryScore: number | null | undefined
): number | null => {
  if (opponentScore == null || primaryScore == null) {
    return null;
  }

  const rowDigits = toDigitOrder(rowNumbers);
  const colDigits = toDigitOrder(colNumbers);
  const opponentDigit = Number(opponentScore) % 10;
  const primaryDigit = Number(primaryScore) % 10;
  const rowIndex = rowDigits.findIndex((digit) => digit === opponentDigit);
  const colIndex = colDigits.findIndex((digit) => digit === primaryDigit);

  if (rowIndex === -1 || colIndex === -1) {
    return null;
  }

  return (rowIndex * 10) + colIndex + 1;
};

const ensurePoolPayouts = async (client: PoolClient, poolId: number) => {
  const result = await client.query(
    `SELECT q1_payout, q2_payout, q3_payout, q4_payout
     FROM football_pool.pool
     WHERE id = $1`,
    [poolId]
  );

  if (result.rows.length === 0) {
    throw new Error('Pool not found');
  }

  return result.rows[0] as {
    q1_payout: number;
    q2_payout: number;
    q3_payout: number;
    q4_payout: number;
  };
};

const upsertWinningsForQuarter = async (
  client: PoolClient,
  gameId: number,
  poolId: number,
  quarter: QuarterSpec
): Promise<{ written: boolean; unresolved: boolean }> => {
  const squareNum = quarter.squareNum;

  if (squareNum == null) {
    return { written: false, unresolved: true };
  }

  const winnerSquareResult = await client.query(
    `SELECT id, participant_id
     FROM football_pool.square
     WHERE pool_id = $1
       AND square_num = $2
     LIMIT 1`,
    [poolId, squareNum]
  );

  if (winnerSquareResult.rows.length === 0 || winnerSquareResult.rows[0].participant_id == null) {
    return { written: false, unresolved: true };
  }

  const winnerUserId = winnerSquareResult.rows[0].participant_id as number;

  const existing = await client.query(
    `SELECT id
     FROM football_pool.winnings_ledger
     WHERE game_id = $1
       AND pool_id = $2
       AND quarter = $3`,
    [gameId, poolId, quarter.num]
  );

  if (existing.rows.length > 0) {
    await client.query(
      `UPDATE football_pool.winnings_ledger
       SET winner_user_id = $1,
           amount_won = $2
       WHERE id = $3`,
      [winnerUserId, quarter.payout, existing.rows[0].id]
    );
    return { written: true, unresolved: false };
  }

  const winningIdResult = await client.query(
    'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM football_pool.winnings_ledger'
  );

  await client.query(
    `INSERT INTO football_pool.winnings_ledger
       (id, game_id, pool_id, quarter, winner_user_id, amount_won, payout_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
    [winningIdResult.rows[0].next_id, gameId, poolId, quarter.num, winnerUserId, quarter.payout]
  );

  return { written: true, unresolved: false };
};

export const processGameScoresWithClient = async (
  client: PoolClient,
  gameId: number,
  scores: QuarterScoresInput
): Promise<ScoreProcessingResult> => {
  const updateResult = await client.query(
    `UPDATE football_pool.game
     SET q1_primary_score = $1,
         q1_opponent_score = $2,
         q2_primary_score = $3,
         q2_opponent_score = $4,
         q3_primary_score = $5,
         q3_opponent_score = $6,
         q4_primary_score = $7,
         q4_opponent_score = $8
     WHERE id = $9
     RETURNING id, pool_id,
               row_numbers, col_numbers,
               q1_primary_score, q1_opponent_score,
               q2_primary_score, q2_opponent_score,
               q3_primary_score, q3_opponent_score,
               q4_primary_score, q4_opponent_score`,
    [
      scores.q1PrimaryScore,
      scores.q1OpponentScore,
      scores.q2PrimaryScore,
      scores.q2OpponentScore,
      scores.q3PrimaryScore,
      scores.q3OpponentScore,
      scores.q4PrimaryScore,
      scores.q4OpponentScore,
      gameId
    ]
  );

  if (updateResult.rows.length === 0) {
    throw new Error('Game not found');
  }

  const game = updateResult.rows[0];
  const payouts = await ensurePoolPayouts(client, game.pool_id);

  const quarters: QuarterSpec[] = [
    {
      num: 1,
      payout: payouts.q1_payout,
      squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, scores.q1OpponentScore, scores.q1PrimaryScore)
    },
    {
      num: 2,
      payout: payouts.q2_payout,
      squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, scores.q2OpponentScore, scores.q2PrimaryScore)
    },
    {
      num: 3,
      payout: payouts.q3_payout,
      squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, scores.q3OpponentScore, scores.q3PrimaryScore)
    },
    {
      num: 4,
      payout: payouts.q4_payout,
      squareNum: resolveWinningSquareNumber(game.row_numbers, game.col_numbers, scores.q4OpponentScore, scores.q4PrimaryScore)
    }
  ];

  let winnersWritten = 0;
  let unresolvedWinners = 0;

  for (const quarter of quarters) {
    const result = await upsertWinningsForQuarter(client, game.id, game.pool_id, quarter);
    if (result.written) {
      winnersWritten += 1;
    }
    if (result.unresolved) {
      unresolvedWinners += 1;
    }
  }

  return {
    game,
    winnersCalculated: true,
    winnersWritten,
    unresolvedWinners
  };
};

export const processGameScores = async (
  gameId: number,
  scores: QuarterScoresInput
): Promise<ScoreProcessingResult> => {
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const result = await processGameScoresWithClient(client, gameId, scores);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
