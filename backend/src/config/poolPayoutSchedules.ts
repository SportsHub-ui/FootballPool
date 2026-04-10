import { buildEmptyPayoutValues, normalizePayoutsForLeague, type PayoutValues } from './poolLeagues';

export const poolPayoutScheduleModeValues = ['uniform', 'by_round'] as const;
export type PoolPayoutScheduleMode = (typeof poolPayoutScheduleModeValues)[number];

export type PoolRoundPayoutInput = PayoutValues & {
  roundLabel: string;
  roundSequence?: number | null;
};

const normalizeRoundLabel = (value?: string | null): string => String(value ?? '').trim();

export const getPoolPayoutScheduleMode = (value?: string | null): PoolPayoutScheduleMode => {
  const normalized = String(value ?? 'uniform').trim().toLowerCase() as PoolPayoutScheduleMode;
  return poolPayoutScheduleModeValues.includes(normalized) ? normalized : 'uniform';
};

export const normalizePoolRoundPayouts = (
  leagueCode: string | null | undefined,
  roundPayouts: PoolRoundPayoutInput[]
): PoolRoundPayoutInput[] => {
  const seen = new Set<string>();

  return roundPayouts
    .map((roundPayout) => {
      const roundLabel = normalizeRoundLabel(roundPayout.roundLabel);
      const roundSequence =
        roundPayout.roundSequence == null || !Number.isFinite(Number(roundPayout.roundSequence))
          ? null
          : Math.max(1, Math.trunc(Number(roundPayout.roundSequence)));
      const normalizedPayouts = normalizePayoutsForLeague(leagueCode, {
        q1Payout: roundPayout.q1Payout,
        q2Payout: roundPayout.q2Payout,
        q3Payout: roundPayout.q3Payout,
        q4Payout: roundPayout.q4Payout,
        q5Payout: roundPayout.q5Payout,
        q6Payout: roundPayout.q6Payout,
        q7Payout: roundPayout.q7Payout,
        q8Payout: roundPayout.q8Payout,
        q9Payout: roundPayout.q9Payout
      });

      return {
        roundLabel,
        roundSequence,
        ...normalizedPayouts
      };
    })
    .filter((roundPayout) => {
      if (!roundPayout.roundLabel) {
        return false;
      }

      const key = roundPayout.roundSequence != null ? `seq:${roundPayout.roundSequence}` : `label:${roundPayout.roundLabel.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    })
    .sort((left, right) => {
      const leftSequence = left.roundSequence ?? Number.MAX_SAFE_INTEGER;
      const rightSequence = right.roundSequence ?? Number.MAX_SAFE_INTEGER;
      if (leftSequence !== rightSequence) {
        return leftSequence - rightSequence;
      }

      return left.roundLabel.localeCompare(right.roundLabel);
    });
};

export const findMatchingRoundPayout = (
  roundPayouts: PoolRoundPayoutInput[],
  roundLabel?: string | null,
  roundSequence?: number | null
): PoolRoundPayoutInput | null => {
  if (roundSequence != null) {
    const matchedBySequence = roundPayouts.find((roundPayout) => Number(roundPayout.roundSequence ?? 0) === Number(roundSequence));
    if (matchedBySequence) {
      return matchedBySequence;
    }
  }

  const normalizedRoundLabel = normalizeRoundLabel(roundLabel).toLowerCase();
  if (!normalizedRoundLabel) {
    return null;
  }

  return (
    roundPayouts.find((roundPayout) => normalizeRoundLabel(roundPayout.roundLabel).toLowerCase() === normalizedRoundLabel) ?? null
  );
};

export const resolveConfiguredPayouts = (options: {
  payoutScheduleMode?: string | null;
  defaultPayouts: PayoutValues;
  roundPayouts?: PoolRoundPayoutInput[];
  roundLabel?: string | null;
  roundSequence?: number | null;
}): PayoutValues => {
  const payoutScheduleMode = getPoolPayoutScheduleMode(options.payoutScheduleMode);

  if (payoutScheduleMode !== 'by_round') {
    return options.defaultPayouts;
  }

  const matchingRoundPayout = findMatchingRoundPayout(options.roundPayouts ?? [], options.roundLabel, options.roundSequence);
  if (!matchingRoundPayout) {
    return buildEmptyPayoutValues();
  }

  return {
    q1Payout: Number(matchingRoundPayout.q1Payout ?? 0),
    q2Payout: Number(matchingRoundPayout.q2Payout ?? 0),
    q3Payout: Number(matchingRoundPayout.q3Payout ?? 0),
    q4Payout: Number(matchingRoundPayout.q4Payout ?? 0),
    q5Payout: Number(matchingRoundPayout.q5Payout ?? 0),
    q6Payout: Number(matchingRoundPayout.q6Payout ?? 0),
    q7Payout: Number(matchingRoundPayout.q7Payout ?? 0),
    q8Payout: Number(matchingRoundPayout.q8Payout ?? 0),
    q9Payout: Number(matchingRoundPayout.q9Payout ?? 0)
  };
};
