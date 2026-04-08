export const supportedLeagueCodes = ['NFL', 'NCAAF', 'NCAAB', 'MLB', 'NBA', 'NHL'] as const

export type SupportedLeagueCode = (typeof supportedLeagueCodes)[number]
export type SupportedSportCode = 'FOOTBALL' | 'BASKETBALL' | 'BASEBALL' | 'HOCKEY'
export type PayoutSlotKey = 'q1' | 'q2' | 'q3' | 'q4'

export type PoolLeagueDefinition = {
  leagueCode: SupportedLeagueCode
  sportCode: SupportedSportCode
  label: string
  activePayoutSlots: PayoutSlotKey[]
  payoutLabels: Record<PayoutSlotKey, string>
  regularSeasonGameCount: number
}

const poolLeagueDefinitions: Record<SupportedLeagueCode, PoolLeagueDefinition> = {
  NFL: {
    leagueCode: 'NFL',
    sportCode: 'FOOTBALL',
    label: 'NFL',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4'],
    payoutLabels: { q1: 'Q1 payout', q2: 'Halftime payout', q3: 'Q3 payout', q4: 'Final payout' },
    regularSeasonGameCount: 17
  },
  NCAAF: {
    leagueCode: 'NCAAF',
    sportCode: 'FOOTBALL',
    label: 'NCAAF',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4'],
    payoutLabels: { q1: 'Q1 payout', q2: 'Halftime payout', q3: 'Q3 payout', q4: 'Final payout' },
    regularSeasonGameCount: 12
  },
  NBA: {
    leagueCode: 'NBA',
    sportCode: 'BASKETBALL',
    label: 'NBA',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4'],
    payoutLabels: { q1: 'Q1 payout', q2: 'Halftime payout', q3: 'Q3 payout', q4: 'Final payout' },
    regularSeasonGameCount: 82
  },
  NCAAB: {
    leagueCode: 'NCAAB',
    sportCode: 'BASKETBALL',
    label: 'NCAAB',
    activePayoutSlots: ['q1', 'q4'],
    payoutLabels: { q1: '1st half payout', q2: 'Unused', q3: 'Unused', q4: 'Final payout' },
    regularSeasonGameCount: 31
  },
  NHL: {
    leagueCode: 'NHL',
    sportCode: 'HOCKEY',
    label: 'NHL',
    activePayoutSlots: ['q1', 'q2', 'q4'],
    payoutLabels: { q1: '1st period payout', q2: '2nd period payout', q3: 'Unused', q4: 'Final payout' },
    regularSeasonGameCount: 82
  },
  MLB: {
    leagueCode: 'MLB',
    sportCode: 'BASEBALL',
    label: 'MLB',
    activePayoutSlots: ['q4'],
    payoutLabels: { q1: 'Unused', q2: 'Unused', q3: 'Unused', q4: 'Final payout' },
    regularSeasonGameCount: 162
  }
}

export const getPoolLeagueDefinition = (leagueCode?: string | null): PoolLeagueDefinition => {
  const normalized = String(leagueCode ?? 'NFL').trim().toUpperCase() as SupportedLeagueCode
  return poolLeagueDefinitions[normalized] ?? poolLeagueDefinitions.NFL
}

const payoutSlotQuarterMap: Record<PayoutSlotKey, 1 | 2 | 3 | 4> = {
  q1: 1,
  q2: 2,
  q3: 3,
  q4: 4
}

export type ScoreSegmentDefinition = {
  slot: PayoutSlotKey
  quarter: 1 | 2 | 3 | 4
  shortLabel: string
  fullLabel: string
}

const getCompactScoreSegmentLabel = (
  slot: PayoutSlotKey,
  payoutLabel: string,
  leagueCode: SupportedLeagueCode
): string => {
  const normalizedLabel = payoutLabel.trim().toLowerCase()

  if (slot === 'q4' || normalizedLabel.includes('final')) {
    return 'Final'
  }

  if (normalizedLabel.includes('half')) {
    return slot === 'q1' ? '1st Half' : 'Halftime'
  }

  if (normalizedLabel.includes('period')) {
    return slot === 'q1' ? '1st Period' : slot === 'q2' ? '2nd Period' : '3rd Period'
  }

  if (leagueCode === 'MLB') {
    return 'Final'
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
  payouts: { q1Payout: number; q2Payout: number; q3Payout: number; q4Payout: number }
): { q1Payout: number; q2Payout: number; q3Payout: number; q4Payout: number } => {
  const activeSlots = new Set(getPoolLeagueDefinition(leagueCode).activePayoutSlots)

  return {
    q1Payout: activeSlots.has('q1') ? Math.max(0, Number(payouts.q1Payout) || 0) : 0,
    q2Payout: activeSlots.has('q2') ? Math.max(0, Number(payouts.q2Payout) || 0) : 0,
    q3Payout: activeSlots.has('q3') ? Math.max(0, Number(payouts.q3Payout) || 0) : 0,
    q4Payout: activeSlots.has('q4') ? Math.max(0, Number(payouts.q4Payout) || 0) : 0
  }
}
