import { normalizePayoutsForLeague, type PayoutValues } from './poolLeagues'

export const poolPayoutScheduleModeValues = ['uniform', 'by_round'] as const
export type PoolPayoutScheduleMode = (typeof poolPayoutScheduleModeValues)[number]

export type RoundPayoutConfig = PayoutValues & {
  roundLabel: string
  roundSequence?: number | null
}

const normalizeRoundLabel = (value?: string | null): string => String(value ?? '').trim()

export const getPoolPayoutScheduleMode = (value?: string | null): PoolPayoutScheduleMode => {
  const normalized = String(value ?? 'uniform').trim().toLowerCase() as PoolPayoutScheduleMode
  return poolPayoutScheduleModeValues.includes(normalized) ? normalized : 'uniform'
}

export const normalizeRoundPayouts = (
  leagueCode: string | null | undefined,
  roundPayouts: RoundPayoutConfig[]
): RoundPayoutConfig[] => {
  const seen = new Set<string>()

  return roundPayouts
    .map((roundPayout) => {
      const roundLabel = normalizeRoundLabel(roundPayout.roundLabel)
      const roundSequence =
        roundPayout.roundSequence == null || !Number.isFinite(Number(roundPayout.roundSequence))
          ? null
          : Math.max(1, Math.trunc(Number(roundPayout.roundSequence)))
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
      })

      return {
        roundLabel,
        roundSequence,
        ...normalizedPayouts
      }
    })
    .filter((roundPayout) => {
      if (!roundPayout.roundLabel) {
        return false
      }

      const key = roundPayout.roundSequence != null ? `seq:${roundPayout.roundSequence}` : `label:${roundPayout.roundLabel.toLowerCase()}`
      if (seen.has(key)) {
        return false
      }

      seen.add(key)
      return true
    })
    .sort((left, right) => {
      const leftSequence = left.roundSequence ?? Number.MAX_SAFE_INTEGER
      const rightSequence = right.roundSequence ?? Number.MAX_SAFE_INTEGER
      if (leftSequence !== rightSequence) {
        return leftSequence - rightSequence
      }

      return left.roundLabel.localeCompare(right.roundLabel)
    })
}

export const findMatchingRoundPayout = (
  roundPayouts: RoundPayoutConfig[],
  roundLabel?: string | null,
  roundSequence?: number | null
): RoundPayoutConfig | null => {
  if (roundSequence != null) {
    const matchedBySequence = roundPayouts.find((roundPayout) => Number(roundPayout.roundSequence ?? 0) === Number(roundSequence))
    if (matchedBySequence) {
      return matchedBySequence
    }
  }

  const normalizedRoundLabel = normalizeRoundLabel(roundLabel).toLowerCase()
  if (!normalizedRoundLabel) {
    return null
  }

  return roundPayouts.find((roundPayout) => normalizeRoundLabel(roundPayout.roundLabel).toLowerCase() === normalizedRoundLabel) ?? null
}
