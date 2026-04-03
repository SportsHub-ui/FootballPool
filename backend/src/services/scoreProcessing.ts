import type { PoolClient } from 'pg';
import { db } from '../config/db';

export interface QuarterScoresInput {
  q1PrimaryScore: number;
  q1OpponentScore: number;
  q2PrimaryScore: number;
  q2OpponentScore: number;
  q3PrimaryScore: number;
  q3OpponentScore: number;
  q4PrimaryScore: number;
  q4OpponentScore: number;
}

interface QuarterSpec {
  num: number;
  primaryScore: number;
  opponentScore: number;
  payout: number;
}

export interface ScoreProcessingResult {
  game: {
    id: number;
    pool_id: number;
    q1_primary_score: number;
    q1_opponent_score: number;
    q2_primary_score: number;
    q2_opponent_score: number;
    q3_primary_score: number;
    q3_opponent_score: number;
    q4_primary_score: number;
    q4_opponent_score: number;
  };
  winnersCalculated: boolean;
  winnersWritten: number;
  unresolvedWinners: number;
}

const calculateSquareNumber = (opponentDigit: number, primaryDigit: number): number => {
  // Grid is 1..100, where each row has 10 entries.
  return (opponentDigit * 10) + primaryDigit + 1;
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
  const primaryDigit = quarter.primaryScore % 10;
  const opponentDigit = quarter.opponentScore % 10;
  const squareNum = calculateSquareNumber(opponentDigit, primaryDigit);

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

export const processGameScores = async (
  gameId: number,
  scores: QuarterScoresInput
): Promise<ScoreProcessingResult> => {
  const client = await db.connect();

  try {
    await client.query('BEGIN');

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
      { num: 1, primaryScore: scores.q1PrimaryScore, opponentScore: scores.q1OpponentScore, payout: payouts.q1_payout },
      { num: 2, primaryScore: scores.q2PrimaryScore, opponentScore: scores.q2OpponentScore, payout: payouts.q2_payout },
      { num: 3, primaryScore: scores.q3PrimaryScore, opponentScore: scores.q3OpponentScore, payout: payouts.q3_payout },
      { num: 4, primaryScore: scores.q4PrimaryScore, opponentScore: scores.q4OpponentScore, payout: payouts.q4_payout }
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

    await client.query('COMMIT');

    return {
      game,
      winnersCalculated: true,
      winnersWritten,
      unresolvedWinners
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
