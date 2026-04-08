import type { PoolTypeCode } from './poolTypes';

export const poolStructureModeValues = ['manual', 'template'] as const;
export type PoolStructureMode = (typeof poolStructureModeValues)[number];

export const poolTemplateValues = ['ncaab_march_madness'] as const;
export type PoolTemplateCode = (typeof poolTemplateValues)[number];

export type PoolTemplateRoundDefinition = {
  label: string;
  sequence: number;
  gameCount: number;
  regions?: string[];
  championship?: boolean;
  dateOffsetDays?: number;
};

export type PoolTemplateDefinition = {
  code: PoolTemplateCode;
  label: string;
  description: string;
  supportedPoolTypes: PoolTypeCode[];
  supportedLeagueCodes: string[];
  expectedGameCount: number;
  rounds: PoolTemplateRoundDefinition[];
  getDefaultDateWindow: (season: number) => { startDate: string; endDate: string };
};

const poolTemplateDefinitions: Record<PoolTemplateCode, PoolTemplateDefinition> = {
  ncaab_march_madness: {
    code: 'ncaab_march_madness',
    label: 'NCAAB March Madness',
    description:
      'Seeds a standard men\'s college basketball tournament window with First Four through Championship round planning.',
    supportedPoolTypes: ['tournament'],
    supportedLeagueCodes: ['NCAAB'],
    expectedGameCount: 67,
    rounds: [
      { label: 'First Four', sequence: 1, gameCount: 4, dateOffsetDays: 0 },
      { label: 'Round of 64', sequence: 2, gameCount: 32, regions: ['East', 'West', 'South', 'Midwest'], dateOffsetDays: 2 },
      { label: 'Round of 32', sequence: 3, gameCount: 16, regions: ['East', 'West', 'South', 'Midwest'], dateOffsetDays: 4 },
      { label: 'Sweet 16', sequence: 4, gameCount: 8, regions: ['East', 'West', 'South', 'Midwest'], dateOffsetDays: 9 },
      { label: 'Elite 8', sequence: 5, gameCount: 4, regions: ['East', 'West', 'South', 'Midwest'], dateOffsetDays: 11 },
      { label: 'Final Four', sequence: 6, gameCount: 2, dateOffsetDays: 18 },
      { label: 'Championship', sequence: 7, gameCount: 1, championship: true, dateOffsetDays: 20 }
    ],
    getDefaultDateWindow: (season: number) => ({
      startDate: `${season}-03-15`,
      endDate: `${season}-04-07`
    })
  }
};

export const getPoolStructureMode = (value?: string | null): PoolStructureMode => {
  const normalized = String(value ?? 'manual').trim().toLowerCase() as PoolStructureMode;
  return poolStructureModeValues.includes(normalized) ? normalized : 'manual';
};

export const getPoolTemplateDefinition = (value?: string | null): PoolTemplateDefinition | null => {
  const normalized = String(value ?? '').trim().toLowerCase() as PoolTemplateCode;
  return poolTemplateDefinitions[normalized] ?? null;
};

export const listAvailablePoolTemplates = (options?: {
  poolType?: string | null;
  leagueCode?: string | null;
}): PoolTemplateDefinition[] => {
  const normalizedPoolType = String(options?.poolType ?? '').trim().toLowerCase();
  const normalizedLeagueCode = String(options?.leagueCode ?? '').trim().toUpperCase();

  return Object.values(poolTemplateDefinitions).filter((template) => {
    const matchesPoolType = !normalizedPoolType || template.supportedPoolTypes.includes(normalizedPoolType as PoolTypeCode);
    const matchesLeagueCode = !normalizedLeagueCode || template.supportedLeagueCodes.includes(normalizedLeagueCode);
    return matchesPoolType && matchesLeagueCode;
  });
};

export const resolveTemplateRoundSequence = (templateCode: string | null | undefined, roundLabel?: string | null): number | null => {
  const normalizedLabel = String(roundLabel ?? '').trim().toLowerCase();
  if (!normalizedLabel) {
    return null;
  }

  const templateDefinition = getPoolTemplateDefinition(templateCode);
  const matchingRound = templateDefinition?.rounds.find((round) => round.label.trim().toLowerCase() === normalizedLabel);
  return matchingRound?.sequence ?? null;
};
