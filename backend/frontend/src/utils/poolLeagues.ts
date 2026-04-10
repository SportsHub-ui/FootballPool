export const supportedLeagueCodes = ['NFL', 'NCAAF', 'NCAAB', 'MLB', 'NBA', 'NHL'] as const
export const allPayoutSlotKeys = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'] as const

export type SupportedLeagueCode = (typeof supportedLeagueCodes)[number]
export type SupportedSportCode = 'FOOTBALL' | 'BASKETBALL' | 'BASEBALL' | 'HOCKEY'
export type PayoutSlotKey = (typeof allPayoutSlotKeys)[number]
export type PayoutValueKey = `${PayoutSlotKey}Payout`
export type ScoreSegmentNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
export type PayoutValues = Record<PayoutValueKey, number>
export type PayoutLabelMap = Record<PayoutSlotKey, string>

export type PoolLeagueDefinition = {
  leagueCode: SupportedLeagueCode
  sportCode: SupportedSportCode
  label: string
  activePayoutSlots: PayoutSlotKey[]
  payoutLabels: PayoutLabelMap
  regularSeasonGameCount: number
}

const buildPayoutLabels = (overrides: Partial<PayoutLabelMap>): PayoutLabelMap => ({
  q1: 'Unused',
  q2: 'Unused',
  q3: 'Unused',
  q4: 'Unused',
  q5: 'Unused',
  q6: 'Unused',
  q7: 'Unused',
  q8: 'Unused',
  q9: 'Unused',
  ...overrides
})

const poolLeagueDefinitions: Record<SupportedLeagueCode, PoolLeagueDefinition> = {
  NFL: {
    leagueCode: 'NFL',
    sportCode: 'FOOTBALL',
    label: 'NFL',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4'],
    payoutLabels: buildPayoutLabels({ q1: 'Q1 payout', q2: 'Halftime payout', q3: 'Q3 payout', q4: 'Final payout' }),
    regularSeasonGameCount: 17
  },
  NCAAF: {
    leagueCode: 'NCAAF',
    sportCode: 'FOOTBALL',
    label: 'NCAAF',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4'],
    payoutLabels: buildPayoutLabels({ q1: 'Q1 payout', q2: 'Halftime payout', q3: 'Q3 payout', q4: 'Final payout' }),
    regularSeasonGameCount: 12
  },
  NBA: {
    leagueCode: 'NBA',
    sportCode: 'BASKETBALL',
    label: 'NBA',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4'],
    payoutLabels: buildPayoutLabels({ q1: 'Q1 payout', q2: 'Halftime payout', q3: 'Q3 payout', q4: 'Final payout' }),
    regularSeasonGameCount: 82
  },
  NCAAB: {
    leagueCode: 'NCAAB',
    sportCode: 'BASKETBALL',
    label: 'NCAAB',
    activePayoutSlots: ['q1', 'q4'],
    payoutLabels: buildPayoutLabels({ q1: '1st half payout', q4: 'Final payout' }),
    regularSeasonGameCount: 31
  },
  NHL: {
    leagueCode: 'NHL',
    sportCode: 'HOCKEY',
    label: 'NHL',
    activePayoutSlots: ['q1', 'q2', 'q4'],
    payoutLabels: buildPayoutLabels({ q1: '1st period payout', q2: '2nd period payout', q4: 'Final payout' }),
    regularSeasonGameCount: 82
  },
  MLB: {
    leagueCode: 'MLB',
    sportCode: 'BASEBALL',
    label: 'MLB',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'],
    payoutLabels: buildPayoutLabels({
      q1: '1st inning payout',
      q2: '2nd inning payout',
      q3: '3rd inning payout',
      q4: '4th inning payout',
      q5: '5th inning payout',
      q6: '6th inning payout',
      q7: '7th inning payout',
      q8: '8th inning payout',
      q9: 'Final inning payout'
    }),
    regularSeasonGameCount: 162
  }
}

const payoutSlotQuarterMap: Record<PayoutSlotKey, ScoreSegmentNumber> = {
  q1: 1,
  q2: 2,
  q3: 3,
  q4: 4,
  q5: 5,
  q6: 6,
  q7: 7,
  q8: 8,
  q9: 9
}

const getOrdinalLabel = (value: number): string => {
  if (value % 100 >= 11 && value % 100 <= 13) return `${value}th`
  if (value % 10 === 1) return `${value}st`
  if (value % 10 === 2) return `${value}nd`
  if (value % 10 === 3) return `${value}rd`
  return `${value}th`
}

export const buildEmptyPayoutValues = (): PayoutValues => ({
  q1Payout: 0,
  q2Payout: 0,
  q3Payout: 0,
  q4Payout: 0,
  q5Payout: 0,
  q6Payout: 0,
  q7Payout: 0,
  q8Payout: 0,
  q9Payout: 0
})

export const getPayoutValueForSlot = (entry: Partial<PayoutValues> | null | undefined, slot: PayoutSlotKey): number =>
  Number(entry?.[`${slot}Payout` as PayoutValueKey] ?? 0)

export const getPoolLeagueDefinition = (leagueCode?: string | null): PoolLeagueDefinition => {
  const normalized = String(leagueCode ?? 'NFL').trim().toUpperCase() as SupportedLeagueCode
  return poolLeagueDefinitions[normalized] ?? poolLeagueDefinitions.NFL
}

export type ScoreSegmentDefinition = {
  slot: PayoutSlotKey
  quarter: ScoreSegmentNumber
  shortLabel: string
  fullLabel: string
}

const getCompactScoreSegmentLabel = (
  slot: PayoutSlotKey,
  payoutLabel: string,
  leagueCode: SupportedLeagueCode
): string => {
  const normalizedLabel = payoutLabel.trim().toLowerCase()

  if (slot === 'q9' || normalizedLabel.includes('final')) {
    return 'Final'
  }

  if (normalizedLabel.includes('half')) {
    return slot === 'q1' ? '1st Half' : 'Final'
  }

  if (normalizedLabel.includes('period')) {
    return slot === 'q1' ? '1st Period' : slot === 'q2' ? '2nd Period' : 'Final'
  }

  if (leagueCode === 'MLB') {
    return `${getOrdinalLabel(payoutSlotQuarterMap[slot])} Inning`
  }

  return slot.toUpperCase()
}

export const getScoreSegmentDefinitions = (options?: {
  leagueCode?: string | null
  activeSlots?: PayoutSlotKey[] | null
  payoutLabels?: Partial<Record<PayoutSlotKey, string>> | null
}): ScoreSegmentDefinition[] => {
  const leagueDefinition = getPoolLeagueDefinition(options?.leagueCode)
  const activeSlots = options?.activeSlots?.length ? options.activeSlots : leagueDefinition.activePayoutSlots
  const payoutLabels = { ...leagueDefinition.payoutLabels, ...(options?.payoutLabels ?? {}) }

  return activeSlots.map((slot) => ({
    slot,
    quarter: payoutSlotQuarterMap[slot],
    shortLabel: getCompactScoreSegmentLabel(slot, payoutLabels[slot] ?? slot.toUpperCase(), leagueDefinition.leagueCode),
    fullLabel: (payoutLabels[slot] ?? slot.toUpperCase()).replace(/\s*payout$/i, '').trim() || slot.toUpperCase()
  }))
}

export const getSimulationStepDescriptor = (options?: {
  leagueCode?: string | null
  activeSlots?: PayoutSlotKey[] | null
  payoutLabels?: Partial<Record<PayoutSlotKey, string>> | null
}): {
  modeLabel: string
  singularLabel: string
  pluralLabel: string
} => {
  const segments = getScoreSegmentDefinitions(options)
  const segmentLabels = segments.map((segment) => segment.fullLabel.toLowerCase()).join(' ')

  if (segmentLabels.includes('inning')) {
    return {
      modeLabel: 'By Inning',
      singularLabel: 'Inning',
      pluralLabel: 'innings'
    }
  }

  if (segmentLabels.includes('half')) {
    return {
      modeLabel: 'By Half',
      singularLabel: 'Half',
      pluralLabel: 'halves'
    }
  }

  if (segmentLabels.includes('period')) {
    return {
      modeLabel: 'By Period',
      singularLabel: 'Period',
      pluralLabel: 'periods'
    }
  }

  if (segments.length <= 1) {
    return {
      modeLabel: 'By Final Score',
      singularLabel: 'Final',
      pluralLabel: 'final scores'
    }
  }

  return {
    modeLabel: 'By Quarter',
    singularLabel: 'Quarter',
    pluralLabel: 'quarters'
  }
}

export const normalizePayoutsForLeague = (
  leagueCode: string | null | undefined,
  payouts: PayoutValues
): PayoutValues => {
  const activeSlots = new Set(getPoolLeagueDefinition(leagueCode).activePayoutSlots)
  const normalized = buildEmptyPayoutValues()

  for (const slot of allPayoutSlotKeys) {
    const valueKey = `${slot}Payout` as PayoutValueKey
    normalized[valueKey] = activeSlots.has(slot) ? Math.max(0, Number(payouts[valueKey]) || 0) : 0
  }

  return normalized
}
