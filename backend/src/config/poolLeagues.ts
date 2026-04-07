export const supportedLeagueCodes = ['NFL', 'NCAAF', 'NCAAB', 'MLB', 'NBA', 'NHL'] as const;

export type SupportedLeagueCode = typeof supportedLeagueCodes[number];
export type SupportedSportCode = 'FOOTBALL' | 'BASKETBALL' | 'BASEBALL' | 'HOCKEY';
export type PayoutSlotKey = 'q1' | 'q2' | 'q3' | 'q4';

export type PoolLeagueDefinition = {
  leagueCode: SupportedLeagueCode;
  sportCode: SupportedSportCode;
  label: string;
  espnPath: string;
  activePayoutSlots: PayoutSlotKey[];
  regularSeasonGameCount: number;
};

const poolLeagueDefinitions: Record<SupportedLeagueCode, PoolLeagueDefinition> = {
  NFL: {
    leagueCode: 'NFL',
    sportCode: 'FOOTBALL',
    label: 'NFL',
    espnPath: 'football/nfl',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4'],
    regularSeasonGameCount: 17
  },
  NCAAF: {
    leagueCode: 'NCAAF',
    sportCode: 'FOOTBALL',
    label: 'NCAAF',
    espnPath: 'football/college-football',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4'],
    regularSeasonGameCount: 12
  },
  NBA: {
    leagueCode: 'NBA',
    sportCode: 'BASKETBALL',
    label: 'NBA',
    espnPath: 'basketball/nba',
    activePayoutSlots: ['q1', 'q2', 'q3', 'q4'],
    regularSeasonGameCount: 82
  },
  NCAAB: {
    leagueCode: 'NCAAB',
    sportCode: 'BASKETBALL',
    label: 'NCAAB',
    espnPath: 'basketball/mens-college-basketball',
    activePayoutSlots: ['q1', 'q4'],
    regularSeasonGameCount: 31
  },
  NHL: {
    leagueCode: 'NHL',
    sportCode: 'HOCKEY',
    label: 'NHL',
    espnPath: 'hockey/nhl',
    activePayoutSlots: ['q1', 'q2', 'q4'],
    regularSeasonGameCount: 82
  },
  MLB: {
    leagueCode: 'MLB',
    sportCode: 'BASEBALL',
    label: 'MLB',
    espnPath: 'baseball/mlb',
    activePayoutSlots: ['q4'],
    regularSeasonGameCount: 162
  }
};

export const getPoolLeagueDefinition = (leagueCode?: string | null): PoolLeagueDefinition => {
  const normalized = String(leagueCode ?? 'NFL').trim().toUpperCase() as SupportedLeagueCode;
  return poolLeagueDefinitions[normalized] ?? poolLeagueDefinitions.NFL;
};

export const normalizePayoutsForLeague = (
  leagueCode: string | null | undefined,
  payouts: { q1Payout: number; q2Payout: number; q3Payout: number; q4Payout: number }
): { q1Payout: number; q2Payout: number; q3Payout: number; q4Payout: number } => {
  const activeSlots = new Set(getPoolLeagueDefinition(leagueCode).activePayoutSlots);

  return {
    q1Payout: activeSlots.has('q1') ? Math.max(0, Number(payouts.q1Payout) || 0) : 0,
    q2Payout: activeSlots.has('q2') ? Math.max(0, Number(payouts.q2Payout) || 0) : 0,
    q3Payout: activeSlots.has('q3') ? Math.max(0, Number(payouts.q3Payout) || 0) : 0,
    q4Payout: activeSlots.has('q4') ? Math.max(0, Number(payouts.q4Payout) || 0) : 0
  };
};
