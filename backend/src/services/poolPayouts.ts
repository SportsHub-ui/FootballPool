import type { PoolClient } from 'pg';
import {
  getPoolPayoutScheduleMode,
  normalizePoolRoundPayouts,
  resolveConfiguredPayouts,
  type PoolPayoutScheduleMode,
  type PoolRoundPayoutInput
} from '../config/poolPayoutSchedules';
import { ensurePoolPayoutStructureSupport } from './poolPayoutStructureSupport';

export type PoolPayoutConfig = {
  payoutScheduleMode: PoolPayoutScheduleMode;
  winnerLoserMode: boolean;
  defaultPayouts: {
    q1Payout: number;
    q2Payout: number;
    q3Payout: number;
    q4Payout: number;
  };
  roundPayouts: PoolRoundPayoutInput[];
};

export const loadPoolPayoutConfig = async (client: PoolClient, poolId: number): Promise<PoolPayoutConfig> => {
  await ensurePoolPayoutStructureSupport(client);

  const poolResult = await client.query<{
    league_code: string | null;
    payout_schedule_mode: string | null;
    winner_loser_flg: boolean | null;
    q1_payout: number | null;
    q2_payout: number | null;
    q3_payout: number | null;
    q4_payout: number | null;
  }>(
    `SELECT league_code,
            payout_schedule_mode,
            COALESCE(winner_loser_flg, FALSE) AS winner_loser_flg,
            COALESCE(q1_payout, 0) AS q1_payout,
            COALESCE(q2_payout, 0) AS q2_payout,
            COALESCE(q3_payout, 0) AS q3_payout,
            COALESCE(q4_payout, 0) AS q4_payout
     FROM football_pool.pool
     WHERE id = $1
     LIMIT 1`,
    [poolId]
  );

  if (poolResult.rows.length === 0) {
    throw new Error('Pool not found');
  }

  const pool = poolResult.rows[0];

  const roundPayoutResult = await client.query<{
    round_label: string;
    round_sequence: number | null;
    q1_payout: number | null;
    q2_payout: number | null;
    q3_payout: number | null;
    q4_payout: number | null;
  }>(
    `SELECT round_label,
            round_sequence,
            q1_payout,
            q2_payout,
            q3_payout,
            q4_payout
     FROM football_pool.pool_payout_rule
     WHERE pool_id = $1
     ORDER BY COALESCE(round_sequence, 32767), LOWER(round_label), id`,
    [poolId]
  );

  return {
    payoutScheduleMode: getPoolPayoutScheduleMode(pool.payout_schedule_mode),
    winnerLoserMode: Boolean(pool.winner_loser_flg),
    defaultPayouts: {
      q1Payout: Number(pool.q1_payout ?? 0),
      q2Payout: Number(pool.q2_payout ?? 0),
      q3Payout: Number(pool.q3_payout ?? 0),
      q4Payout: Number(pool.q4_payout ?? 0)
    },
    roundPayouts: normalizePoolRoundPayouts(
      pool.league_code,
      roundPayoutResult.rows.map((row) => ({
        roundLabel: row.round_label,
        roundSequence: row.round_sequence != null ? Number(row.round_sequence) : null,
        q1Payout: Number(row.q1_payout ?? 0),
        q2Payout: Number(row.q2_payout ?? 0),
        q3Payout: Number(row.q3_payout ?? 0),
        q4Payout: Number(row.q4_payout ?? 0)
      }))
    )
  };
};

export const replacePoolRoundPayouts = async (
  client: PoolClient,
  options: {
    poolId: number;
    leagueCode: string | null | undefined;
    payoutScheduleMode?: string | null;
    roundPayouts?: PoolRoundPayoutInput[];
  }
): Promise<PoolRoundPayoutInput[]> => {
  await ensurePoolPayoutStructureSupport(client);

  const payoutScheduleMode = getPoolPayoutScheduleMode(options.payoutScheduleMode);
  const normalizedRoundPayouts = normalizePoolRoundPayouts(options.leagueCode, options.roundPayouts ?? []);

  await client.query(
    `DELETE FROM football_pool.pool_payout_rule
     WHERE pool_id = $1`,
    [options.poolId]
  );

  if (payoutScheduleMode !== 'by_round' || normalizedRoundPayouts.length === 0) {
    return [];
  }

  for (const roundPayout of normalizedRoundPayouts) {
    await client.query(
      `INSERT INTO football_pool.pool_payout_rule (
         pool_id,
         round_label,
         round_sequence,
         q1_payout,
         q2_payout,
         q3_payout,
         q4_payout,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [
        options.poolId,
        roundPayout.roundLabel,
        roundPayout.roundSequence ?? null,
        roundPayout.q1Payout,
        roundPayout.q2Payout,
        roundPayout.q3Payout,
        roundPayout.q4Payout
      ]
    );
  }

  return normalizedRoundPayouts;
};

export const resolvePoolPayoutsForRound = (
  payoutConfig: PoolPayoutConfig,
  roundLabel?: string | null,
  roundSequence?: number | null
): {
  q1Payout: number;
  q2Payout: number;
  q3Payout: number;
  q4Payout: number;
  winnerLoserMode: boolean;
} => {
  const resolvedPayouts = resolveConfiguredPayouts({
    payoutScheduleMode: payoutConfig.payoutScheduleMode,
    defaultPayouts: payoutConfig.defaultPayouts,
    roundPayouts: payoutConfig.roundPayouts,
    roundLabel,
    roundSequence
  });

  return {
    ...resolvedPayouts,
    winnerLoserMode: payoutConfig.winnerLoserMode
  };
};
