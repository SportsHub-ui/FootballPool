export const supportedLeagueCodes = ['NFL', 'NCAAF', 'NCAAB', 'MLB', 'NBA', 'NHL'] as const;
export const allPayoutSlotKeys = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'] as const;

export type SupportedLeagueCode = typeof supportedLeagueCodes[number];
export type SupportedSportCode = 'FOOTBALL' | 'BASKETBALL' | 'BASEBALL' | 'HOCKEY';
export type PayoutSlotKey = typeof allPayoutSlotKeys[number];
export type PayoutValueKey = `${PayoutSlotKey}Payout`;
export type ScoreSegmentNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type PayoutValues = Record<PayoutValueKey, number>;
export type PayoutLabelMap = Record<PayoutSlotKey, string>;

export type PoolLeagueDefinition = {
  leagueCode: SupportedLeagueCode;
  sportCode: SupportedSportCode;
  label: string;
  espnPath: string;
  activePayoutSlots: PayoutSlotKey[];
  payoutLabels: PayoutLabelMap;
  regularSeasonGameCount: number;
};

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
});

const poolLeagueDefinitions: Record<SupportedLeagueCode, PoolLeagueDefinition> = {
  NFL: {
    leagueCode: 'NFL',
    sportCode: 'FOOTBALL',
    label: 'NFL',
    espnPath: 'football/nfl',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4'],
    payoutLabels: buildPayoutLabels({ q1: 'Q1 payout', q2: 'Halftime payout', q3: 'Q3 payout', q4: 'Final payout' }),
    regularSeasonGameCount: 17
  },
  NCAAF: {
    leagueCode: 'NCAAF',
    sportCode: 'FOOTBALL',
    label: 'NCAAF',
    espnPath: 'football/college-football',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4'],
    payoutLabels: buildPayoutLabels({ q1: 'Q1 payout', q2: 'Halftime payout', q3: 'Q3 payout', q4: 'Final payout' }),
    regularSeasonGameCount: 12
  },
  NBA: {
    leagueCode: 'NBA',
    sportCode: 'BASKETBALL',
    label: 'NBA',
    espnPath: 'basketball/nba',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4'],
    payoutLabels: buildPayoutLabels({ q1: 'Q1 payout', q2: 'Halftime payout', q3: 'Q3 payout', q4: 'Final payout' }),
    regularSeasonGameCount: 82
  },
  NCAAB: {
    leagueCode: 'NCAAB',
    sportCode: 'BASKETBALL',
    label: 'NCAAB',
    espnPath: 'basketball/mens-college-basketball',
    activePayoutSlots: ['q1', 'q4'],
    payoutLabels: buildPayoutLabels({ q1: '1st half payout', q4: 'Final payout' }),
    regularSeasonGameCount: 31
  },
  NHL: {
    leagueCode: 'NHL',
    sportCode: 'HOCKEY',
    label: 'NHL',
    espnPath: 'hockey/nhl',
    activePayoutSlots: ['q1', 'q2', 'q4'],
    payoutLabels: buildPayoutLabels({ q1: '1st period payout', q2: '2nd period payout', q4: 'Final payout' }),
    regularSeasonGameCount: 82
  },
  MLB: {
    leagueCode: 'MLB',
    sportCode: 'BASEBALL',
    label: 'MLB',
    espnPath: 'baseball/mlb',
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
};

const payoutSlotSegmentMap: Record<PayoutSlotKey, ScoreSegmentNumber> = {
  q1: 1,
  q2: 2,
  q3: 3,
  q4: 4,
  q5: 5,
  q6: 6,
  q7: 7,
  q8: 8,
  q9: 9
};

const getOrdinalLabel = (value: number): string => {
  if (value % 100 >= 11 && value % 100 <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
};

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
});

export const getPayoutValueForSlot = (
  entry: Partial<PayoutValues> | null | undefined,
  slot: PayoutSlotKey
): number => Number(entry?.[`${slot}Payout` as PayoutValueKey] ?? 0);

export const getPoolLeagueDefinition = (leagueCode?: string | null): PoolLeagueDefinition => {
  const normalized = String(leagueCode ?? 'NFL').trim().toUpperCase() as SupportedLeagueCode;
  return poolLeagueDefinitions[normalized] ?? poolLeagueDefinitions.NFL;
};

export const getActiveScoreSegmentNumbers = (leagueCode?: string | null): ScoreSegmentNumber[] =>
  getPoolLeagueDefinition(leagueCode).activePayoutSlots.map((slot) => payoutSlotSegmentMap[slot]);

export const getScoreSegmentLabel = (leagueCode?: string | null, quarter?: number | null): string => {
  const definition = getPoolLeagueDefinition(leagueCode);

  if (quarter == null) {
    return 'current segment';
  }

  const slot = allPayoutSlotKeys[Math.max(0, Math.min(allPayoutSlotKeys.length - 1, quarter - 1))] ?? 'q1';
  const rawLabel = String(definition.payoutLabels[slot] ?? `Q${quarter}`).replace(/\s*payout$/i, '').trim();
  return rawLabel || `Q${quarter}`;
};

export const getSimulationStepDescriptor = (
  leagueCode?: string | null
): {
  modeLabel: string;
  singularLabel: string;
  pluralLabel: string;
} => {
  const normalizedLeague = String(leagueCode ?? '').trim().toUpperCase();

  if (normalizedLeague === 'NCAAB') {
    return {
      modeLabel: 'By Half',
      singularLabel: 'Half',
      pluralLabel: 'halves'
    };
  }

  if (normalizedLeague === 'NHL') {
    return {
      modeLabel: 'By Period',
      singularLabel: 'Period',
      pluralLabel: 'periods'
    };
  }

  if (normalizedLeague === 'MLB') {
    return {
      modeLabel: 'By Inning',
      singularLabel: 'Inning',
      pluralLabel: 'innings'
    };
  }

  return {
    modeLabel: 'By Quarter',
    singularLabel: 'Quarter',
    pluralLabel: 'quarters'
  };
};

export const getSimulationStepLabel = (leagueCode?: string | null, quarter?: number | null): string => {
  const normalizedLeague = String(leagueCode ?? '').trim().toUpperCase();

  if (quarter == null) {
    return getSimulationStepDescriptor(leagueCode).singularLabel.toLowerCase();
  }

  if (normalizedLeague === 'NCAAB') {
    return quarter === 1 ? '1st half' : 'final';
  }

  if (normalizedLeague === 'NHL') {
    if (quarter === 1) return '1st period';
    if (quarter === 2) return '2nd period';
    return 'final';
  }

  if (normalizedLeague === 'MLB') {
    return quarter >= 9 ? 'final' : `${getOrdinalLabel(quarter)} inning`;
  }

  return `quarter ${quarter}`;
};

export const normalizePayoutsForLeague = (
  leagueCode: string | null | undefined,
  payouts: PayoutValues
): PayoutValues => {
  const activeSlots = new Set(getPoolLeagueDefinition(leagueCode).activePayoutSlots);
  const normalized = buildEmptyPayoutValues();

  for (const slot of allPayoutSlotKeys) {
    const valueKey = `${slot}Payout` as PayoutValueKey;
    normalized[valueKey] = activeSlots.has(slot) ? Math.max(0, Number(payouts[valueKey]) || 0) : 0;
  }

  return normalized;
};
