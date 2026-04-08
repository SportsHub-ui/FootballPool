export const poolTypeValues = ['season', 'single_game', 'playoff_series', 'tournament'] as const

export type PoolTypeCode = (typeof poolTypeValues)[number]

export type PoolTypeDefinition = {
  code: PoolTypeCode
  label: string
  requiresPreferredTeam: boolean
  supportsScheduleImport: boolean
  supportsDateWindow: boolean
  supportsStructureTemplates: boolean
  defaultWinnerLoserMode: boolean
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
    description: 'Tracks a preferred team across its regular season schedule.'
  },
  single_game: {
    code: 'single_game',
    label: 'Single Game',
    requiresPreferredTeam: true,
    supportsScheduleImport: false,
    supportsDateWindow: true,
    supportsStructureTemplates: false,
    defaultWinnerLoserMode: false,
    description: 'Runs a pool for one game tied to a preferred team.'
  },
  playoff_series: {
    code: 'playoff_series',
    label: 'Playoff Series',
    requiresPreferredTeam: true,
    supportsScheduleImport: false,
    supportsDateWindow: true,
    supportsStructureTemplates: false,
    defaultWinnerLoserMode: false,
    description: 'Tracks a preferred team through a single playoff series.'
  },
  tournament: {
    code: 'tournament',
    label: 'Tournament',
    requiresPreferredTeam: false,
    supportsScheduleImport: false,
    supportsDateWindow: true,
    supportsStructureTemplates: true,
    defaultWinnerLoserMode: true,
    description: 'Supports generic playoff or tournament boards where matchups can change by round.'
  }
}

export const getPoolTypeDefinition = (value?: string | null): PoolTypeDefinition => {
  const normalized = String(value ?? 'season').trim().toLowerCase() as PoolTypeCode
  return poolTypeDefinitions[normalized] ?? poolTypeDefinitions.season
}
