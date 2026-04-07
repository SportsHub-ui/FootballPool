import type { PoolClient } from 'pg';
import { db } from '../config/db';
import { emitScoreNotifications, type QuarterNotificationResult, type LiveLeaderState } from './notifications';

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

type GameScoreSnapshot = {
  id: number;
  pool_id: number;
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

const getLatestScoredQuarter = (game: GameScoreSnapshot): number | null => {
  if (game.q4_primary_score != null && game.q4_opponent_score != null) return 4;
  if (game.q3_primary_score != null && game.q3_opponent_score != null) return 3;
  if (game.q2_primary_score != null && game.q2_opponent_score != null) return 2;
  if (game.q1_primary_score != null && game.q1_opponent_score != null) return 1;
  return null;
};

const getQuarterScoresFromGame = (game: GameScoreSnapshot, quarter: number): { primaryScore: number | null; opponentScore: number | null } => {
  if (quarter === 1) return { primaryScore: game.q1_primary_score, opponentScore: game.q1_opponent_score };
  if (quarter === 2) return { primaryScore: game.q2_primary_score, opponentScore: game.q2_opponent_score };
  if (quarter === 3) return { primaryScore: game.q3_primary_score, opponentScore: game.q3_opponent_score };
  return { primaryScore: game.q4_primary_score, opponentScore: game.q4_opponent_score };
};

const getQuarterScoresFromInput = (scores: QuarterScoresInput, quarter: number): { primaryScore: number | null; opponentScore: number | null } => {
  if (quarter === 1) return { primaryScore: scores.q1PrimaryScore, opponentScore: scores.q1OpponentScore };
  if (quarter === 2) return { primaryScore: scores.q2PrimaryScore, opponentScore: scores.q2OpponentScore };
  if (quarter === 3) return { primaryScore: scores.q3PrimaryScore, opponentScore: scores.q3OpponentScore };
  return { primaryScore: scores.q4PrimaryScore, opponentScore: scores.q4OpponentScore };
};

const buildLiveLeaderState = (game: GameScoreSnapshot): LiveLeaderState | null => {
  if (game.q4_primary_score != null && game.q4_opponent_score != null) {
    return null;
  }

  const latestQuarter = getLatestScoredQuarter(game);
  if (latestQuarter == null) {
    return null;
  }

  const quarterScores = getQuarterScoresFromGame(game, latestQuarter);
  const squareNum = resolveWinningSquareNumber(game.row_numbers, game.col_numbers, quarterScores.opponentScore, quarterScores.primaryScore);

  if (squareNum == null) {
    return null;
  }

  return {
    quarter: latestQuarter,
    squareNum,
    primaryScore: quarterScores.primaryScore,
    opponentScore: quarterScores.opponentScore
  };
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

// Refactored for normalized schema: process scores for each pool_game
export const processGameScoresWithClient = async (
  client: PoolClient,
  gameId: number,
  scores: QuarterScoresInput
): Promise<ScoreProcessingResult[]> => {
  // Find all pool_game entries for this game
  const poolGames = await client.query(
    `SELECT pool_id, row_numbers, column_numbers FROM football_pool.pool_game WHERE game_id = $1`,
    [gameId]
  );
  const results: ScoreProcessingResult[] = [];
  for (const pg of poolGames.rows) {
    // Get previous winners for this pool/game
    const previousWinningsResult = await client.query<{
      quarter: number;
      winner_user_id: number | null;
      amount_won: number | null;
    }>(
      `SELECT quarter, winner_user_id, amount_won
       FROM football_pool.winnings_ledger
       WHERE game_id = $1 AND pool_id = $2`,
      [gameId, pg.pool_id]
    );
    const previousWinners = new Map<number, { winnerUserId: number | null; amountWon: number | null }>(
      previousWinningsResult.rows.map((row) => [
        Number(row.quarter),
        {
          winnerUserId: row.winner_user_id != null ? Number(row.winner_user_id) : null,
          amountWon: row.amount_won != null ? Number(row.amount_won) : null
        }
      ])
    );
    // Get pool payouts
    const payouts = await ensurePoolPayouts(client, pg.pool_id);
    const quarters: QuarterSpec[] = [
      {
        num: 1,
        payout: payouts.q1_payout,
        squareNum: resolveWinningSquareNumber(pg.row_numbers, pg.column_numbers, scores.q1OpponentScore, scores.q1PrimaryScore)
      },
      {
        num: 2,
        payout: payouts.q2_payout,
        squareNum: resolveWinningSquareNumber(pg.row_numbers, pg.column_numbers, scores.q2OpponentScore, scores.q2PrimaryScore)
      },
      {
        num: 3,
        payout: payouts.q3_payout,
        squareNum: resolveWinningSquareNumber(pg.row_numbers, pg.column_numbers, scores.q3OpponentScore, scores.q3PrimaryScore)
      },
      {
        num: 4,
        payout: payouts.q4_payout,
        squareNum: resolveWinningSquareNumber(pg.row_numbers, pg.column_numbers, scores.q4OpponentScore, scores.q4PrimaryScore)
      }
    ];
    let winnersWritten = 0;
    let unresolvedWinners = 0;
    const quarterResults: QuarterNotificationResult[] = [];
    for (const quarter of quarters) {
      const result = await upsertWinningsForQuarter(client, gameId, pg.pool_id, quarter);
      const quarterScores = getQuarterScoresFromInput(scores, quarter.num);
      quarterResults.push({
        quarter: quarter.num,
        payout: Number(quarter.payout ?? 0),
        squareNum: quarter.squareNum,
        winnerUserId: result.winnerUserId,
        primaryScore: quarterScores.primaryScore,
        opponentScore: quarterScores.opponentScore
      });
      if (result.written) winnersWritten += 1;
      if (result.unresolved) unresolvedWinners += 1;
    }
    await emitScoreNotifications(client, {
      gameId,
      poolId: pg.pool_id,
      quarters: quarterResults,
      previousWinners,
      currentLeader: null, // Not implemented for normalized yet
      previousLeader: null, // Not implemented for normalized yet
      gameComplete: scores.q4PrimaryScore != null && scores.q4OpponentScore != null
    });
    results.push({
      game: { id: gameId, pool_id: pg.pool_id, q1_primary_score: scores.q1PrimaryScore, q1_opponent_score: scores.q1OpponentScore, q2_primary_score: scores.q2PrimaryScore, q2_opponent_score: scores.q2OpponentScore, q3_primary_score: scores.q3PrimaryScore, q3_opponent_score: scores.q3OpponentScore, q4_primary_score: scores.q4PrimaryScore, q4_opponent_score: scores.q4OpponentScore },
      winnersCalculated: true,
      winnersWritten,
      unresolvedWinners
    });
  }
  return results;
};

const upsertWinningsForQuarter = async (
  client: PoolClient,
  gameId: number,
  poolId: number,
  quarter: QuarterSpec
): Promise<{ written: boolean; unresolved: boolean; winnerUserId: number | null }> => {
  const squareNum = quarter.squareNum;

  if (squareNum == null) {
    return { written: false, unresolved: true, winnerUserId: null };
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
    return { written: false, unresolved: true, winnerUserId: null };
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
    return { written: true, unresolved: false, winnerUserId };
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

  return { written: true, unresolved: false, winnerUserId };
};


export const processGameScores = async (
  gameId: number,
  scores: QuarterScoresInput
): Promise<ScoreProcessingResult[]> => {
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
