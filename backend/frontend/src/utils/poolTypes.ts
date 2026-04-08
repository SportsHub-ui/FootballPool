export const poolTypeCodes = ['season', 'single_game', 'playoff_series', 'tournament'] as const

export type PoolTypeCode = (typeof poolTypeCodes)[number]
export type PoolTypeGameCountMode = 'league' | 'single' | 'series' | 'manual'

export type PoolTypeDefinition = {
  code: PoolTypeCode
  label: string
  requiresPreferredTeam: boolean
  supportsScheduleImport: boolean
  supportsDateWindow: boolean
  supportsStructureTemplates: boolean
  defaultWinnerLoserMode: boolean
  estimatedGameCountMode: PoolTypeGameCountMode
  description: string
}

const poolTypeDefinitions: Record<PoolTypeCode, PoolTypeDefinition> = {
  season: {
    code: 'season',
    label: 'Season',
    requiresPreferredTeam: true,
    supportsScheduleImport: true,
    supportsDateWindow: false,
    supportsStructureTemplates: false,
    defaultWinnerLoserMode: false,
    estimatedGameCountMode: 'league',
    description: 'Use a preferred team and follow its regular-season schedule.'
  },
  single_game: {
    code: 'single_game',
    label: 'Single Game',
    requiresPreferredTeam: true,
    supportsScheduleImport: false,
    supportsDateWindow: true,
    supportsStructureTemplates: false,
    defaultWinnerLoserMode: false,
    estimatedGameCountMode: 'single',
    description: 'Use one preferred-team matchup for a one-off board.'
  },
  playoff_series: {
    code: 'playoff_series',
    label: 'Playoff Series',
    requiresPreferredTeam: true,
    supportsScheduleImport: false,
    supportsDateWindow: true,
    supportsStructureTemplates: false,
    defaultWinnerLoserMode: false,
    estimatedGameCountMode: 'series',
    description: 'Follow one preferred team through a playoff series.'
  },
  tournament: {
    code: 'tournament',
    label: 'Tournament',
    requiresPreferredTeam: false,
    supportsScheduleImport: false,
    supportsDateWindow: true,
    supportsStructureTemplates: true,
    defaultWinnerLoserMode: true,
    estimatedGameCountMode: 'manual',
    description: 'Use generic winner/loser boards for brackets, playoffs, or tournaments.'
  }
}

export const getPoolTypeDefinition = (value?: string | null): PoolTypeDefinition => {
  const normalized = String(value ?? 'season').trim().toLowerCase() as PoolTypeCode
  return poolTypeDefinitions[normalized] ?? poolTypeDefinitions.season
}
