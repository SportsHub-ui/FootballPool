import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

import type { LandingPool } from './LandingMetrics'
import { getPoolLeagueDefinition, getSimulationStepDescriptor, type PayoutSlotKey, type SupportedLeagueCode } from './utils/poolLeagues'
import {
  getPoolStructureMode,
  getPoolTemplateDefinition,
  listAvailablePoolTemplates,
  type PoolStructureMode,
  type PoolTemplateCode
} from './utils/poolStructures'
import {
  findMatchingRoundPayout,
  getPoolPayoutScheduleMode,
  normalizeRoundPayouts,
  type PoolPayoutScheduleMode,
  type RoundPayoutConfig
} from './utils/poolPayoutSchedules'
import { getPoolTypeDefinition, type PoolTypeCode } from './utils/poolTypes'

type TeamRecord = {
  id: number
  team_name: string | null
  has_members_flg?: boolean
}

type SportTeamRecord = {
  id: number
  name: string | null
  abbreviation: string | null
  sport_code: string | null
  league_code: string | null
  espn_team_uid?: string | null
}

type GameRecord = {
  id: number
  pool_id: number
  opponent: string
  game_dt: string
  is_simulation: boolean
  round_label?: string | null
  round_sequence?: number | null
  q1_primary_score: number | null
  q1_opponent_score: number | null
  q2_primary_score: number | null
  q2_opponent_score: number | null
  q3_primary_score: number | null
  q3_opponent_score: number | null
  q4_primary_score: number | null
  q4_opponent_score: number | null
}

type NotificationLevel = 'none' | 'quarter_win' | 'game_total'
type PoolBoardNumberMode = 'per_game' | 'same_for_tournament'

type PoolRecord = {
  id: number
  pool_name: string | null
  team_id: number | null
  season: number | null
  pool_type?: PoolTypeCode | null
  structure_mode?: PoolStructureMode | null
  template_code?: PoolTemplateCode | null
  payout_schedule_mode?: PoolPayoutScheduleMode | null
  board_number_mode?: PoolBoardNumberMode | null
  round_payouts?: RoundPayoutConfig[] | null
  start_date?: string | null
  end_date?: string | null
  primary_team: string | null
  primary_sport_team_id?: number | null
  sport_code?: string | null
  league_code?: string | null
  winner_loser_flg?: boolean
  square_cost: number | null
  q1_payout: number | null
  q2_payout: number | null
  q3_payout: number | null
  q4_payout: number | null
  display_token: string | null
  team_name: string | null
  has_members_flg?: boolean
  contact_notification_level: NotificationLevel
  contact_notify_on_square_lead_flg: boolean
}

type SimulationMode = 'full_year' | 'by_game' | 'by_quarter'
type SimulationProgressAction = 'complete_game' | 'complete_quarter'

type SimulationControlStatus = {
  enabledInEnvironment: boolean
  hasSimulationData: boolean
  hasAssignedSquares: boolean
  userCount: number
  playerCount: number
  canSimulate: boolean
  canCleanup: boolean
  blockers: string[]
  mode: SimulationMode | null
  currentGameId: number | null
  nextQuarter: number | null
  progressAction: SimulationProgressAction | null
  canAdvance: boolean
}

type Props = {
  pools: LandingPool[]
  token: string | null
  authHeaders: Record<string, string>
  apiBase: string
  onRequireSignIn: () => void
}

const DEFAULT_HERO_COLOR = '#8a8f98'
const DEFAULT_HERO_ACCENT = '#ffffff'
const POOL_LIST_MIN_HEIGHT = 120
const POOL_LIST_MAX_HEIGHT = 360
const POOL_LIST_DEFAULT_HEIGHT = 170
const TOTAL_SQUARES = 100
const SHOW_SIMULATION_CONTROLS =
  (import.meta.env.VITE_ENABLE_SIMULATION_CONTROLS ?? 'true').toString().toLowerCase() === 'true'

const formatCurrency = (value: number | null | undefined): string =>
  value == null ? '—' : `$${value.toLocaleString()}`

const formatCurrencyInput = (value: number | null | undefined): string => `$${Math.max(0, Number(value ?? 0)).toLocaleString()}`

const parseCurrencyInput = (value: string): number => {
  const digits = value.replace(/[^\d]/g, '')
  return digits ? Number(digits) : 0
}

const hasRecordedQuarter = (primaryScore: number | null, opponentScore: number | null): boolean =>
  primaryScore != null && opponentScore != null

const formatPoolName = (pool: Pick<PoolRecord, 'id' | 'pool_name'>): string => pool.pool_name?.trim() || 'Unnamed Pool'

const formatNotificationLevel = (level: NotificationLevel): string => {
  if (level === 'quarter_win') return 'Score segment win'
  if (level === 'game_total') return 'Total after game ends'
  return 'None'
}

const formatNotificationSummary = (level: NotificationLevel, notifyOnSquareLead: boolean): string => {
  if (notifyOnSquareLead && level === 'none') {
    return 'Lead alerts only'
  }

  return notifyOnSquareLead ? `${formatNotificationLevel(level)} + lead alerts` : formatNotificationLevel(level)
}

const formatSimulationMode = (mode: SimulationMode | null | undefined, leagueCode?: string | null): string => {
  if (mode === 'by_game') return 'By Game'
  if (mode === 'by_quarter') return getSimulationStepDescriptor({ leagueCode }).modeLabel
  return 'Full Year'
}

const formatDisplayDate = (value?: string | null): string => {
  if (!value) return ''

  const trimmedValue = value.trim()
  if (!trimmedValue) return ''

  const isoDateMatch = trimmedValue.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoDateMatch) {
    return isoDateMatch[1]
  }

  const parsedValue = new Date(trimmedValue)
  if (Number.isNaN(parsedValue.getTime())) {
    return trimmedValue
  }

  return parsedValue.toLocaleDateString()
}

const formatPoolWindow = (startDate?: string | null, endDate?: string | null): string => {
  const formattedStartDate = formatDisplayDate(startDate)
  const formattedEndDate = formatDisplayDate(endDate)

  if (!formattedStartDate && !formattedEndDate) return 'Season-long'
  if (formattedStartDate && formattedEndDate) return `${formattedStartDate} → ${formattedEndDate}`
  return formattedStartDate || formattedEndDate || 'Season-long'
}

const formatStructureSummary = (pool: Pick<PoolRecord, 'structure_mode' | 'template_code'>): string => {
  if (pool.structure_mode === 'template' && pool.template_code) {
    return getPoolTemplateDefinition(pool.template_code)?.label ?? 'Template'
  }

  return 'Manual'
}

const applyTemplateDateDefaults = (
  season: number,
  templateCode: string | null | undefined,
  startDate: string,
  endDate: string
): { startDate: string; endDate: string } => {
  const templateDefinition = getPoolTemplateDefinition(templateCode)
  if (!templateDefinition) {
    return { startDate, endDate }
  }

  const defaults = templateDefinition.getDefaultDateWindow(season)
  return {
    startDate: startDate || defaults.startDate,
    endDate: endDate || defaults.endDate
  }
}

const createEmptyRoundPayout = (roundLabel = '', roundSequence: number | null = null): RoundPayoutConfig => ({
  roundLabel,
  roundSequence,
  q1Payout: 0,
  q2Payout: 0,
  q3Payout: 0,
  q4Payout: 0
})

const buildTemplateRoundPayouts = (
  leagueCode: string,
  templateCode: string | null | undefined,
  currentRoundPayouts: RoundPayoutConfig[]
): RoundPayoutConfig[] => {
  const templateDefinition = getPoolTemplateDefinition(templateCode)
  const normalizedCurrentRoundPayouts = normalizeRoundPayouts(leagueCode, currentRoundPayouts)

  if (!templateDefinition) {
    return normalizedCurrentRoundPayouts
  }

  return templateDefinition.rounds.map((round) => {
    const matchedRound =
      normalizedCurrentRoundPayouts.find(
        (entry) =>
          Number(entry.roundSequence ?? 0) === Number(round.sequence) ||
          entry.roundLabel.trim().toLowerCase() === round.label.trim().toLowerCase()
      ) ?? createEmptyRoundPayout(round.label, round.sequence)

    return {
      ...matchedRound,
      roundLabel: round.label,
      roundSequence: round.sequence
    }
  })
}

const hasRecordedPayoutSlot = (game: GameRecord, slot: PayoutSlotKey): boolean => {
  if (slot === 'q1') return hasRecordedQuarter(game.q1_primary_score, game.q1_opponent_score)
  if (slot === 'q2') return hasRecordedQuarter(game.q2_primary_score, game.q2_opponent_score)
  if (slot === 'q3') return hasRecordedQuarter(game.q3_primary_score, game.q3_opponent_score)
  return hasRecordedQuarter(game.q4_primary_score, game.q4_opponent_score)
}

const buildReadonlyPoolRecords = (pools: LandingPool[]): PoolRecord[] =>
  pools.map((pool) => ({
    id: pool.id,
    pool_name: pool.pool_name,
    team_id: null,
    season: pool.season,
    pool_type: (pool.pool_type as PoolTypeCode | null | undefined) ?? 'season',
    structure_mode: 'manual',
    template_code: null,
    payout_schedule_mode: 'uniform',
    board_number_mode: 'per_game',
    round_payouts: [],
    start_date: null,
    end_date: null,
    primary_team: pool.team_name ?? null,
    primary_sport_team_id: pool.primary_sport_team_id ?? null,
    sport_code: pool.sport_code ?? 'FOOTBALL',
    league_code: pool.league_code ?? 'NFL',
    winner_loser_flg: Boolean(pool.winner_loser_flg),
    square_cost: null,
    q1_payout: null,
    q2_payout: null,
    q3_payout: null,
    q4_payout: null,
    display_token: pool.display_token ?? null,
    team_name: pool.team_name,
    contact_notification_level: 'none',
    contact_notify_on_square_lead_flg: false
  }))

export function LandingPoolMaintenance({ pools, token, authHeaders, apiBase, onRequireSignIn }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [teamOptions, setTeamOptions] = useState<TeamRecord[]>([])
  const [sportTeamOptions, setSportTeamOptions] = useState<SportTeamRecord[]>([])
  const [poolRecords, setPoolRecords] = useState<PoolRecord[]>([])
  const [poolGames, setPoolGames] = useState<GameRecord[]>([])
  const [hasOrganizerAccess, setHasOrganizerAccess] = useState(false)
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null)
  const [simulationStatus, setSimulationStatus] = useState<SimulationControlStatus | null>(null)
  const [simulationMode, setSimulationMode] = useState<SimulationMode>('full_year')
  const simulationAdvanceSource: 'espn' = 'espn'
  const [simulationBusy, setSimulationBusy] = useState<'create-simulation' | 'cleanup-simulation' | 'advance-simulation' | 'live-simulation' | null>(null)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [isPoolListExpanded, setIsPoolListExpanded] = useState(true)
  const [poolListHeight, setPoolListHeight] = useState(POOL_LIST_DEFAULT_HEIGHT)
  const [poolForm, setPoolForm] = useState({
    poolName: '',
    teamId: '',
    season: new Date().getFullYear(),
    poolType: 'season' as PoolTypeCode,
    structureMode: 'manual' as PoolStructureMode,
    templateCode: '' as PoolTemplateCode | '',
    payoutScheduleMode: 'uniform' as PoolPayoutScheduleMode,
    boardNumberMode: 'per_game' as PoolBoardNumberMode,
    roundPayouts: [] as RoundPayoutConfig[],
    startDate: '',
    endDate: '',
    leagueCode: 'NFL' as SupportedLeagueCode,
    sportCode: 'FOOTBALL',
    primarySportTeamId: '',
    primaryTeam: '',
    winnerLoserMode: false,
    squareCost: 0,
    q1Payout: 0,
    q2Payout: 0,
    q3Payout: 0,
    q4Payout: 0,
    contactNotificationLevel: 'none' as NotificationLevel,
    contactNotifyOnSquareLead: false
  })

  const canManagePools = hasOrganizerAccess
  const selectedLeagueDefinition = useMemo(() => getPoolLeagueDefinition(poolForm.leagueCode), [poolForm.leagueCode])
  const simulationStepDescriptor = useMemo(() => getSimulationStepDescriptor({ leagueCode: poolForm.leagueCode }), [poolForm.leagueCode])
  const selectedPoolTypeDefinition = useMemo(() => getPoolTypeDefinition(poolForm.poolType), [poolForm.poolType])
  const availablePoolTemplates = useMemo(
    () => listAvailablePoolTemplates({ poolType: poolForm.poolType, leagueCode: poolForm.leagueCode }),
    [poolForm.leagueCode, poolForm.poolType]
  )
  const selectedTemplateDefinition = useMemo(
    () => getPoolTemplateDefinition(poolForm.templateCode || null),
    [poolForm.templateCode]
  )

  const simulationHeaders = useMemo(() => {
    if (!SHOW_SIMULATION_CONTROLS || token) {
      return authHeaders
    }

    return {
      ...authHeaders,
      'x-user-id': 'dev-simulation-user',
      'x-user-role': 'organizer'
    }
  }, [authHeaders, token])

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, init)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const reason = data?.detail || data?.message || data?.error || `Request failed with status ${response.status}`
      throw new Error(reason)
    }

    return data as T
  }

  const loadPoolIntoForm = (pool: PoolRecord | null) => {
    const leagueDefinition = getPoolLeagueDefinition(pool?.league_code)
    const poolTypeDefinition = getPoolTypeDefinition(pool?.pool_type)
    const structureMode = getPoolStructureMode(pool?.structure_mode)
    const payoutScheduleMode = getPoolPayoutScheduleMode(pool?.payout_schedule_mode)
    const rawRoundPayouts = Array.isArray(pool?.round_payouts) ? pool.round_payouts : []

    setSelectedPoolId(pool?.id ?? null)
    setIsCreatingNew(pool == null)
    setPoolForm({
      poolName: pool?.pool_name ?? '',
      teamId: pool?.team_id != null ? String(pool.team_id) : '',
      season: pool?.season ?? new Date().getFullYear(),
      poolType: poolTypeDefinition.code,
      structureMode,
      templateCode: (pool?.template_code as PoolTemplateCode | null | undefined) ?? '',
      payoutScheduleMode,
      boardNumberMode: pool?.board_number_mode === 'same_for_tournament' ? 'same_for_tournament' : 'per_game',
      roundPayouts: normalizeRoundPayouts(
        leagueDefinition.leagueCode,
        rawRoundPayouts.map((entry) => ({
          roundLabel: String(entry?.roundLabel ?? ''),
          roundSequence: entry?.roundSequence != null ? Number(entry.roundSequence) : null,
          q1Payout: Number(entry?.q1Payout ?? 0),
          q2Payout: Number(entry?.q2Payout ?? 0),
          q3Payout: Number(entry?.q3Payout ?? 0),
          q4Payout: Number(entry?.q4Payout ?? 0)
        }))
      ),
      startDate: pool?.start_date?.slice(0, 10) ?? '',
      endDate: pool?.end_date?.slice(0, 10) ?? '',
      leagueCode: leagueDefinition.leagueCode,
      sportCode: pool?.sport_code?.trim() || leagueDefinition.sportCode,
      primarySportTeamId: pool?.primary_sport_team_id != null ? String(pool.primary_sport_team_id) : '',
      primaryTeam: pool?.primary_team?.trim() || '',
      winnerLoserMode: Boolean(pool?.winner_loser_flg ?? poolTypeDefinition.defaultWinnerLoserMode),
      squareCost: pool?.square_cost ?? 0,
      q1Payout: pool?.q1_payout ?? 0,
      q2Payout: pool?.q2_payout ?? 0,
      q3Payout: pool?.q3_payout ?? 0,
      q4Payout: pool?.q4_payout ?? 0,
      contactNotificationLevel: pool?.contact_notification_level ?? 'none',
      contactNotifyOnSquareLead: Boolean(pool?.contact_notify_on_square_lead_flg)
    })
  }

  const loadPoolData = async (preferredPoolId?: number | null): Promise<void> => {
    const readonlyPools = buildReadonlyPoolRecords(pools)

    if (!token) {
      setHasOrganizerAccess(false)
      setPoolRecords(readonlyPools)
      setTeamOptions([])
      const nextPool =
        (preferredPoolId ? readonlyPools.find((pool) => pool.id === preferredPoolId) : null) ?? readonlyPools[0] ?? null
      loadPoolIntoForm(nextPool)
      setError(null)
      setNotice(null)
      return
    }

    setLoading(true)
    setError(null)
    setNotice(null)

    try {
      const [teamResult, poolResult] = await Promise.all([
        request<{ teams: TeamRecord[] }>('/api/setup/teams', { headers: authHeaders }),
        request<{ pools: PoolRecord[] }>('/api/setup/pools', { headers: authHeaders })
      ])

      setHasOrganizerAccess(true)
      setTeamOptions(teamResult.teams)
      setPoolRecords(poolResult.pools)

      const nextSelectedPoolId =
        preferredPoolId && poolResult.pools.some((pool) => pool.id === preferredPoolId)
          ? preferredPoolId
          : poolResult.pools[0]?.id ?? null

      const nextPool = poolResult.pools.find((pool) => pool.id === nextSelectedPoolId) ?? null
      loadPoolIntoForm(nextPool)
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : 'Failed to load pools'
      const isAuthIssue = /forbidden|unauthorized|sign in/i.test(message)

      if (isAuthIssue) {
        setHasOrganizerAccess(false)
        setPoolRecords(readonlyPools)
        setTeamOptions([])
        const nextPool =
          (preferredPoolId ? readonlyPools.find((pool) => pool.id === preferredPoolId) : null) ?? readonlyPools[0] ?? null
        loadPoolIntoForm(nextPool)
        setError(null)
        setNotice('Sign in as an organizer to edit pool records.')
      } else {
        setError(message)
        setPoolRecords([])
        setTeamOptions([])
        loadPoolIntoForm(null)
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPoolData(selectedPoolId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pools, token])

  useEffect(() => {
    if (!canManagePools || !token) {
      setSportTeamOptions([])
      return
    }

    let isActive = true

    const loadSportTeams = async (): Promise<void> => {
      try {
        const result = await request<{ sportTeams: SportTeamRecord[] }>(
          `/api/setup/sport-teams?leagueCode=${encodeURIComponent(poolForm.leagueCode)}`,
          { headers: authHeaders }
        )

        if (!isActive) {
          return
        }

        setSportTeamOptions(result.sportTeams)
        setPoolForm((current) => {
          if (current.primarySportTeamId) {
            return current
          }

          const matchedTeam = result.sportTeams.find((team) => {
            const currentPrimaryTeam = current.primaryTeam.trim().toLowerCase()
            return currentPrimaryTeam.length > 0 && (team.name?.trim().toLowerCase() ?? '') === currentPrimaryTeam
          })

          return matchedTeam
            ? {
                ...current,
                primarySportTeamId: String(matchedTeam.id),
                primaryTeam: matchedTeam.name?.trim() || current.primaryTeam
              }
            : current
        })
      } catch (loadError) {
        if (isActive) {
          setSportTeamOptions([])
          setError((current) => current ?? (loadError instanceof Error ? loadError.message : 'Failed to load sport teams'))
        }
      }
    }

    void loadSportTeams()

    return () => {
      isActive = false
    }
  }, [authHeaders, canManagePools, poolForm.leagueCode, token])

  const authorizedHeroPool = useMemo(() => {
    const defaultPool = pools.find((pool) => pool.default_flg)
    if (defaultPool) return defaultPool
    return pools.length === 1 ? pools[0] : null
  }, [pools])

  const heroStyle = useMemo(
    () => ({
      backgroundColor: authorizedHeroPool?.primary_color ?? DEFAULT_HERO_COLOR,
      color: authorizedHeroPool?.secondary_color ?? DEFAULT_HERO_ACCENT
    }),
    [authorizedHeroPool]
  )

  const heroSubtitle = useMemo(() => {
    if (!canManagePools) {
      return poolRecords.length > 0
        ? 'You can review visible pools below. Sign in as an organizer to make changes.'
        : 'Sign in as an organizer to review and maintain pools.'
    }

    return `${poolRecords.length} pool record${poolRecords.length === 1 ? '' : 's'} ready for maintenance.`
  }, [canManagePools, poolRecords.length])

  const selectedPool = useMemo(
    () => poolRecords.find((pool) => pool.id === selectedPoolId) ?? null,
    [poolRecords, selectedPoolId]
  )

  const displayUrl = useMemo(() => {
    if (!selectedPool?.display_token) {
      return ''
    }

    if (typeof window === 'undefined') {
      return `?display=${selectedPool.display_token}`
    }

    const url = new URL(window.location.pathname, window.location.origin)
    url.searchParams.set('display', selectedPool.display_token)
    return url.toString()
  }, [selectedPool])

  const loadPoolGames = async (poolId: number): Promise<GameRecord[]> => {
    if (!canManagePools) {
      setPoolGames([])
      return []
    }

    const games = await request<GameRecord[]>(`/api/games?poolId=${poolId}`, {
      headers: authHeaders
    })

    setPoolGames(games)
    return games
  }

  useEffect(() => {
    if (!canManagePools || !selectedPoolId) {
      setPoolGames([])
      return
    }

    let isActive = true

    const hydratePoolGames = async (): Promise<void> => {
      try {
        const games = await request<GameRecord[]>(`/api/games?poolId=${selectedPoolId}`, {
          headers: authHeaders
        })

        if (isActive) {
          setPoolGames(games)
        }
      } catch (fetchError) {
        if (isActive) {
          setPoolGames([])
          setError((current) => current ?? (fetchError instanceof Error ? fetchError.message : 'Failed to load payout progress'))
        }
      }
    }

    void hydratePoolGames()

    return () => {
      isActive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPoolId, token])

  useEffect(() => {
    if (!SHOW_SIMULATION_CONTROLS || !canManagePools || !selectedPoolId) {
      setSimulationStatus(null)
      return
    }

    let isActive = true

    const loadSimulationStatus = async (): Promise<void> => {
      try {
        const data = await request<{ status?: SimulationControlStatus }>(`/api/setup/pools/${selectedPoolId}/simulation`, {
          headers: simulationHeaders
        })

        if (isActive) {
          setSimulationStatus(data.status ?? null)
        }
      } catch (fetchError) {
        if (isActive) {
          setSimulationStatus({
            enabledInEnvironment: true,
            hasSimulationData: poolGames.some((game) => game.is_simulation),
            hasAssignedSquares: false,
            userCount: 0,
            playerCount: 0,
            canSimulate: false,
            canCleanup: poolGames.some((game) => game.is_simulation),
            blockers: [fetchError instanceof Error ? fetchError.message : 'Failed to load simulation status'],
            mode: null,
            currentGameId: null,
            nextQuarter: null,
            progressAction: null,
            canAdvance: false
          })
        }
      }
    }

    void loadSimulationStatus()

    return () => {
      isActive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolGames, selectedPoolId, simulationHeaders])

  const payoutSummary = useMemo(() => {
    const squareCost = Math.max(0, Number(poolForm.squareCost) || 0)
    const payoutValues = {
      q1Payout: Math.max(0, Number(poolForm.q1Payout) || 0),
      q2Payout: Math.max(0, Number(poolForm.q2Payout) || 0),
      q3Payout: Math.max(0, Number(poolForm.q3Payout) || 0),
      q4Payout: Math.max(0, Number(poolForm.q4Payout) || 0)
    }
    const normalizedRoundPayouts = normalizeRoundPayouts(poolForm.leagueCode, poolForm.roundPayouts)
    const totalRevenue = squareCost * TOTAL_SQUARES
    const estimatedGameCount =
      selectedPoolTypeDefinition.estimatedGameCountMode === 'single'
        ? 1
        : selectedPoolTypeDefinition.estimatedGameCountMode === 'series'
          ? Math.max(poolGames.length, 7)
          : selectedPoolTypeDefinition.estimatedGameCountMode === 'manual'
            ? Math.max(poolGames.length, selectedTemplateDefinition?.expectedGameCount ?? 0)
            : selectedLeagueDefinition.regularSeasonGameCount

    const getPayoutTotalForEntry = (entry: { q1Payout: number; q2Payout: number; q3Payout: number; q4Payout: number }): number =>
      selectedLeagueDefinition.activePayoutSlots.reduce((sum, slot) => {
        const slotValue = slot === 'q1' ? entry.q1Payout : slot === 'q2' ? entry.q2Payout : slot === 'q3' ? entry.q3Payout : entry.q4Payout
        return sum + Number(slotValue ?? 0)
      }, 0)

    const totalPayoutPerGame = getPayoutTotalForEntry(payoutValues)
    const roundGameCountMap = new Map<string, number>()
    selectedTemplateDefinition?.rounds.forEach((round) => {
      roundGameCountMap.set(`seq:${round.sequence}`, round.gameCount)
      roundGameCountMap.set(`label:${round.label.trim().toLowerCase()}`, round.gameCount)
    })

    if (!selectedTemplateDefinition) {
      poolGames.forEach((game) => {
        const labelKey = String(game.round_label ?? '').trim().toLowerCase()
        if (game.round_sequence != null) {
          roundGameCountMap.set(`seq:${Number(game.round_sequence)}`, (roundGameCountMap.get(`seq:${Number(game.round_sequence)}`) ?? 0) + 1)
        } else if (labelKey) {
          roundGameCountMap.set(`label:${labelKey}`, (roundGameCountMap.get(`label:${labelKey}`) ?? 0) + 1)
        }
      })
    }

    const totalPayout =
      poolForm.payoutScheduleMode === 'by_round' && selectedPoolTypeDefinition.code === 'tournament'
        ? normalizedRoundPayouts.reduce((sum, roundPayout) => {
            const matchingGameCount =
              (roundPayout.roundSequence != null ? roundGameCountMap.get(`seq:${Number(roundPayout.roundSequence)}`) : undefined) ??
              roundGameCountMap.get(`label:${roundPayout.roundLabel.trim().toLowerCase()}`) ??
              1
            return sum + getPayoutTotalForEntry(roundPayout) * matchingGameCount
          }, 0)
        : totalPayoutPerGame * estimatedGameCount

    const rawPaidOutToDate = poolGames.reduce((sum, game) => {
      const matchingRoundPayout =
        poolForm.payoutScheduleMode === 'by_round' && selectedPoolTypeDefinition.code === 'tournament'
          ? findMatchingRoundPayout(normalizedRoundPayouts, game.round_label, game.round_sequence)
          : null
      const activePayoutEntry = matchingRoundPayout ?? payoutValues

      return (
        sum +
        selectedLeagueDefinition.activePayoutSlots.reduce((slotSum, slot) => {
          const slotValue =
            slot === 'q1'
              ? activePayoutEntry.q1Payout
              : slot === 'q2'
                ? activePayoutEntry.q2Payout
                : slot === 'q3'
                  ? activePayoutEntry.q3Payout
                  : activePayoutEntry.q4Payout
          return slotSum + (hasRecordedPayoutSlot(game, slot) ? Number(slotValue ?? 0) : 0)
        }, 0)
      )
    }, 0)

    const paidOutToDate = Math.min(rawPaidOutToDate, totalPayout)

    return {
      totalRevenue,
      totalPayout,
      totalRaisedForTeam: totalRevenue - totalPayout,
      paidOutToDate,
      remainingToBePaid: Math.max(0, totalPayout - paidOutToDate),
      estimatedGameCount
    }
  }, [
    poolForm.leagueCode,
    poolForm.payoutScheduleMode,
    poolForm.q1Payout,
    poolForm.q2Payout,
    poolForm.q3Payout,
    poolForm.q4Payout,
    poolForm.roundPayouts,
    poolForm.squareCost,
    poolGames,
    selectedLeagueDefinition,
    selectedPoolTypeDefinition,
    selectedTemplateDefinition
  ])

  const onSelectPool = (poolId: number): void => {
    const pool = poolRecords.find((entry) => entry.id === poolId) ?? null
    loadPoolIntoForm(pool)
  }

  const onAddPool = (): void => {
    setError(null)
    loadPoolIntoForm(null)
  }

  const setPayoutForSlot = (slot: PayoutSlotKey, value: number): void => {
    setPoolForm((current) => ({
      ...current,
      q1Payout: slot === 'q1' ? value : current.q1Payout,
      q2Payout: slot === 'q2' ? value : current.q2Payout,
      q3Payout: slot === 'q3' ? value : current.q3Payout,
      q4Payout: slot === 'q4' ? value : current.q4Payout
    }))
  }

  const setRoundPayoutField = (index: number, updates: Partial<RoundPayoutConfig>): void => {
    setPoolForm((current) => ({
      ...current,
      roundPayouts: current.roundPayouts.map((roundPayout, roundIndex) =>
        roundIndex === index ? { ...roundPayout, ...updates } : roundPayout
      )
    }))
  }

  const addRoundPayoutRow = (): void => {
    setPoolForm((current) => ({
      ...current,
      roundPayouts: [...current.roundPayouts, createEmptyRoundPayout('', current.roundPayouts.length + 1)]
    }))
  }

  const removeRoundPayoutRow = (index: number): void => {
    setPoolForm((current) => ({
      ...current,
      roundPayouts: current.roundPayouts.filter((_, roundIndex) => roundIndex !== index)
    }))
  }

  const applyTemplateRoundPayoutRows = (): void => {
    setPoolForm((current) => ({
      ...current,
      roundPayouts: buildTemplateRoundPayouts(current.leagueCode, current.templateCode, current.roundPayouts)
    }))
  }

  const togglePoolListExpanded = (): void => {
    setIsPoolListExpanded((current) => !current)
  }

  const startPoolListResize = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault()

    const startY = event.clientY
    const startHeight = poolListHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = Math.min(
        POOL_LIST_MAX_HEIGHT,
        Math.max(POOL_LIST_MIN_HEIGHT, startHeight + (moveEvent.clientY - startY))
      )
      setPoolListHeight(nextHeight)
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp, { once: true })
  }

  const onSavePool = async (): Promise<void> => {
    if (!poolForm.poolName.trim() || !poolForm.teamId) {
      setError('Pool name and organization are required.')
      return
    }

    if (selectedPoolTypeDefinition.requiresPreferredTeam && !poolForm.primaryTeam.trim()) {
      setError('A preferred sport team is required for Season, Single Game, and Playoff Series pools.')
      return
    }

    if ((poolForm.startDate && !poolForm.endDate) || (!poolForm.startDate && poolForm.endDate)) {
      setError('Enter both a start date and an end date for a date-bounded pool.')
      return
    }

    if (poolForm.startDate && poolForm.endDate && poolForm.endDate < poolForm.startDate) {
      setError('End date must be on or after the start date.')
      return
    }

    if (poolForm.structureMode === 'template' && !poolForm.templateCode) {
      setError('Choose a template when template mode is selected.')
      return
    }

    if (poolForm.payoutScheduleMode === 'by_round') {
      if (poolForm.poolType !== 'tournament') {
        setError('Round-based payout schedules are currently only supported for tournament pools.')
        return
      }

      if (poolForm.roundPayouts.some((roundPayout) => !roundPayout.roundLabel.trim())) {
        setError('Give each round payout row a round name before saving.')
        return
      }

      if (normalizeRoundPayouts(poolForm.leagueCode, poolForm.roundPayouts).length === 0) {
        setError('Add at least one round payout when using by-round tournament payouts.')
        return
      }
    }

    if (!canManagePools) {
      setError('Sign in as an organizer to save pools.')
      onRequireSignIn()
      return
    }

    setSaving(true)
    setError(null)

    try {
      const normalizedRoundPayoutEntries = normalizeRoundPayouts(poolForm.leagueCode, poolForm.roundPayouts)
      const payload = {
        poolName: poolForm.poolName.trim(),
        teamId: Number(poolForm.teamId),
        season: Number(poolForm.season),
        poolType: poolForm.poolType,
        structureMode: poolForm.structureMode,
        templateCode: poolForm.templateCode || undefined,
        payoutScheduleMode: poolForm.payoutScheduleMode,
        boardNumberMode: poolForm.boardNumberMode,
        roundPayouts: poolForm.payoutScheduleMode === 'by_round' ? normalizedRoundPayoutEntries : [],
        startDate: poolForm.startDate || undefined,
        endDate: poolForm.endDate || undefined,
        leagueCode: poolForm.leagueCode,
        primarySportTeamId: poolForm.primarySportTeamId ? Number(poolForm.primarySportTeamId) : undefined,
        primaryTeam: poolForm.primaryTeam.trim() || undefined,
        winnerLoserMode: poolForm.winnerLoserMode,
        squareCost: Number(poolForm.squareCost),
        q1Payout: Number(poolForm.q1Payout),
        q2Payout: Number(poolForm.q2Payout),
        q3Payout: Number(poolForm.q3Payout),
        q4Payout: Number(poolForm.q4Payout),
        contactNotificationLevel: poolForm.contactNotificationLevel,
        contactNotifyOnSquareLead: poolForm.contactNotifyOnSquareLead
      }

      if (isCreatingNew) {
        const created = await request<{ id: number }>('/api/setup/pools', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(payload)
        })

        await loadPoolData(created.id)
        return
      }

      if (!selectedPoolId) {
        setError('Choose a pool first.')
        return
      }

      await request(`/api/setup/pools/${selectedPoolId}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify(payload)
      })

      await loadPoolData(selectedPoolId)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save pool')
    } finally {
      setSaving(false)
    }
  }

  const onFillSchedule = async (): Promise<void> => {
    if (!selectedPoolId) {
      setError('Save or select a pool first before filling its schedule.')
      return
    }

    if (!selectedPoolTypeDefinition.supportsScheduleImport) {
      setError('Fill Schedule currently supports season pools only. Add playoff or tournament matchups manually on the Schedules page.')
      return
    }

    if (!canManagePools) {
      setError('Sign in as an organizer to fill schedules.')
      onRequireSignIn()
      return
    }

    const confirmed = window.confirm(
      `Fill in the missing schedule games for ${formatPoolName(selectedPool ?? { id: selectedPoolId, pool_name: null })}? Existing games will be skipped.`
    )

    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const result = await request<{
        message?: string
        result?: { created?: number; skipped?: number; byeWeeks?: number[]; teamName?: string; season?: number }
      }>(`/api/games/import/pool/${selectedPoolId}`, {
        method: 'POST',
        headers: authHeaders
      })

      const created = result.result?.created ?? 0
      const skipped = result.result?.skipped ?? 0
      const byeWeeks = result.result?.byeWeeks ?? []
      const byeLabel = byeWeeks.length > 0 ? ` BYE week${byeWeeks.length === 1 ? '' : 's'}: ${byeWeeks.join(', ')}.` : ''

      await loadPoolData(selectedPoolId)

      setNotice(
        result.message ?? `Fill Schedule complete. Added ${created} missing game${created === 1 ? '' : 's'} and skipped ${skipped} existing game${skipped === 1 ? '' : 's'}.${byeLabel}`
      )
    } catch (fillError) {
      setError(fillError instanceof Error ? fillError.message : 'Failed to fill schedule')
    } finally {
      setSaving(false)
    }
  }

  const hasSimulationData = Boolean(simulationStatus?.hasSimulationData || poolGames.some((game) => game.is_simulation))
  const simulationButtonLabel = hasSimulationData ? 'End Simulation' : `Start ${formatSimulationMode(simulationMode, poolForm.leagueCode)}`
  const simulationButtonDisabled = hasSimulationData
    ? !selectedPoolId || saving || simulationBusy !== null || !(simulationStatus?.canCleanup || hasSimulationData)
    : !selectedPoolId || saving || simulationBusy !== null || !(simulationStatus?.canSimulate ?? false)
  const simulationButtonTitle = !selectedPoolId
    ? 'Select a pool to enable simulation.'
    : hasSimulationData
      ? 'End the simulation and clear the simulated season data for this pool.'
      : simulationStatus?.canSimulate
        ? simulationMode === 'full_year'
          ? 'Create the full season simulation for this pool.'
          : simulationMode === 'by_game'
            ? 'Start a simulation that advances one game at a time.'
            : `Start a simulation that advances one ${simulationStepDescriptor.singularLabel.toLowerCase()} at a time.`
        : simulationStatus?.blockers.join(' ') || 'Simulation unavailable for this pool.'
  const showSimulationTooltip = simulationButtonDisabled && Boolean(simulationButtonTitle)
  const simulationProgressNote = simulationStatus?.hasSimulationData
    ? simulationStatus.mode
      ? `Active simulation: ${formatSimulationMode(simulationStatus.mode, poolForm.leagueCode)}.`
      : null
    : null
  const showSimulationAdvance = Boolean(simulationStatus?.progressAction)
  const canRefreshLiveQuarter = simulationStatus?.progressAction === 'complete_quarter'
  const simulationAdvanceLabel = simulationStatus?.progressAction === 'complete_game' ? 'Complete Game' : `Complete ${simulationStepDescriptor.singularLabel}`

  const handleSimulationAction = async (): Promise<void> => {
    if (!selectedPoolId || !simulationStatus) {
      return
    }

    const isCleanup = simulationStatus.hasSimulationData
    const confirmed = window.confirm(
      isCleanup
        ? 'Remove the simulated season data for this pool and clear all simulated square assignments?'
        : simulationMode === 'full_year'
          ? 'Create a full season simulation for this pool? This will assign all squares, generate games, row/col numbers, and scores.'
          : simulationMode === 'by_game'
            ? 'Start a By Game simulation for this pool? The first game will get row/col numbers now, then Complete Game on the Scores page will finish one game at a time.'
            : `Start a ${simulationStepDescriptor.modeLabel} simulation for this pool? The first game will get row/col numbers now, then ${simulationAdvanceLabel} on the Scores page will progress one ${simulationStepDescriptor.singularLabel.toLowerCase()} at a time.`
    )

    if (!confirmed) {
      return
    }

    setSimulationBusy(isCleanup ? 'cleanup-simulation' : 'create-simulation')
    setError(null)
    setNotice(null)

    try {
      const result = await request<{ message?: string }>(`/api/setup/pools/${selectedPoolId}/simulation`, {
        method: isCleanup ? 'DELETE' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...simulationHeaders
        },
        body: isCleanup ? undefined : JSON.stringify({ mode: simulationMode })
      })

      await loadPoolData(selectedPoolId)
      await loadPoolGames(selectedPoolId)

      const statusResult = await request<{ status?: SimulationControlStatus }>(`/api/setup/pools/${selectedPoolId}/simulation`, {
        headers: simulationHeaders
      })
      setSimulationStatus(statusResult.status ?? null)

      if (result.message) {
        setNotice(result.message)
      }
    } catch (simulationError) {
      setError(simulationError instanceof Error ? simulationError.message : isCleanup ? 'Failed to clean up simulation' : 'Failed to create simulation')
    } finally {
      setSimulationBusy(null)
    }
  }

  const handleSimulationAdvance = async (action: 'complete' | 'live' = 'complete'): Promise<void> => {
    if (!selectedPoolId || !simulationStatus?.canAdvance) {
      return
    }

    setSimulationBusy(action === 'live' ? 'live-simulation' : 'advance-simulation')
    setError(null)
    setNotice(null)

    try {
      const result = await request<{ message?: string; status?: SimulationControlStatus }>(
        `/api/setup/pools/${selectedPoolId}/simulation/advance`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...simulationHeaders
          },
          body: JSON.stringify({ source: simulationAdvanceSource, action })
        }
      )

      await loadPoolData(selectedPoolId)
      await loadPoolGames(selectedPoolId)
      setSimulationStatus(result.status ?? null)
      setNotice(result.message ?? `${action === 'live' ? 'Live score updated' : simulationAdvanceLabel + ' complete.'}`)
    } catch (simulationError) {
      setError(
        simulationError instanceof Error
          ? simulationError.message
          : action === 'live'
            ? 'Failed to update the live score'
            : `Failed to ${simulationAdvanceLabel.toLowerCase()}`
      )
    } finally {
      setSimulationBusy(null)
    }
  }

  const onDeletePool = async (): Promise<void> => {
    if (!selectedPoolId) {
      setError('Select a pool to delete.')
      return
    }

    if (!canManagePools) {
      setError('Sign in as an organizer to delete pools.')
      onRequireSignIn()
      return
    }

    const confirmed = window.confirm('Delete this pool?')
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      await request(`/api/setup/pools/${selectedPoolId}`, {
        method: 'DELETE',
        headers: authHeaders
      })

      await loadPoolData()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete pool')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="player-maintenance-shell">
      <div className="landing-hero-bar landing-player-hero" style={heroStyle}>
        <div>
          <h1>Pool Maintenance</h1>
          <p>{heroSubtitle}</p>
        </div>
      </div>

      {error ? <div className="error-banner landing-error-banner">{error}</div> : null}
      {notice ? (
        <article className="panel">
          <p className="small landing-readonly-note">{notice}</p>
        </article>
      ) : null}

      <details className="landing-collapsible" open={isPoolListExpanded}>
        <summary
          onClick={(event) => {
            event.preventDefault()
            togglePoolListExpanded()
          }}
        >
          <span className="landing-summary-main">
            <button
              type="button"
              className="landing-collapse-btn"
              aria-label={isPoolListExpanded ? 'Collapse pools list' : 'Expand pools list'}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                togglePoolListExpanded()
              }}
            >
              {isPoolListExpanded ? '−' : '+'}
            </button>
            <span>Pools</span>
          </span>
          <span className="landing-collapsible-count">{poolRecords.length}</span>
        </summary>

        <div className="landing-player-list-wrap is-scrollable" style={isPoolListExpanded ? { height: `${poolListHeight}px` } : undefined}>
          {loading ? (
            <p className="small">Loading pools...</p>
          ) : poolRecords.length === 0 ? (
            <p className="small">{canManagePools ? 'No pools are available yet.' : 'No visible pools are available.'}</p>
          ) : (
            <table className="landing-player-table">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th>Organization</th>
                  <th>Season</th>
                  <th>Type</th>
                  <th>Structure</th>
                  <th>Window</th>
                  <th>League</th>
                  <th>Scoring</th>
                  <th>Notifications</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {poolRecords.map((pool) => (
                  <tr
                    key={pool.id}
                    className={pool.id === selectedPoolId ? 'is-selected' : ''}
                    onClick={() => onSelectPool(pool.id)}
                  >
                    <td>{formatPoolName(pool)}</td>
                    <td>{pool.team_name ?? '—'}</td>
                    <td>{pool.season ?? '—'}</td>
                    <td>{getPoolTypeDefinition(pool.pool_type).label}</td>
                    <td>{formatStructureSummary(pool)}</td>
                    <td>{formatPoolWindow(pool.start_date, pool.end_date)}</td>
                    <td>{pool.league_code ?? 'NFL'}</td>
                    <td>{pool.winner_loser_flg ? 'Winner/Loser' : 'Preferred vs Opponent'}</td>
                    <td>{formatNotificationSummary(pool.contact_notification_level, pool.contact_notify_on_square_lead_flg)}</td>
                    <td>{formatCurrency(pool.square_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </details>

      {isPoolListExpanded ? (
        <div
          className="landing-resize-bar"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize pools list"
          onMouseDown={startPoolListResize}
          title="Drag to resize the pools list"
        >
          <span />
        </div>
      ) : null}

      <div className="landing-player-maintenance-grid">
        <article className="landing-maintenance-card">
          <div className="landing-maintenance-header">
            <div>
              <h2>{isCreatingNew ? 'Add Pool' : 'Maintain Pool'}</h2>
              <p className="small">Create a new pool or update the selected one.</p>
            </div>
            <div className="landing-maintenance-actions">
              <button type="button" className="secondary compact" onClick={onAddPool} disabled={saving || simulationBusy !== null}>
                Add
              </button>
              <button
                type="button"
                className="secondary"
                onClick={onFillSchedule}
                disabled={saving || simulationBusy !== null || !selectedPoolId || !selectedPoolTypeDefinition.supportsScheduleImport}
                title={selectedPoolTypeDefinition.supportsScheduleImport ? 'Import the regular-season schedule for the preferred team.' : 'Fill Schedule is currently available for season pools only.'}
              >
                {saving ? 'Filling...' : 'Fill Schedule'}
              </button>
              {SHOW_SIMULATION_CONTROLS ? (
                <>
                  {!hasSimulationData ? (
                    <select
                      value={simulationMode}
                      onChange={(event) => setSimulationMode(event.target.value as SimulationMode)}
                      disabled={saving || simulationBusy !== null || !selectedPoolId}
                      aria-label="Simulation mode"
                    >
                      <option value="full_year">Full Year</option>
                      <option value="by_game">By Game</option>
                      <option value="by_quarter">{simulationStepDescriptor.modeLabel}</option>
                    </select>
                  ) : null}
                                    <span className="landing-hover-tooltip-wrap">
                    <button
                      type="button"
                      className={hasSimulationData ? 'secondary' : 'primary'}
                      onClick={() => void handleSimulationAction()}
                      disabled={simulationButtonDisabled}
                      aria-label={simulationButtonTitle}
                    >
                      {simulationBusy === 'create-simulation'
                        ? 'Simulating...'
                        : simulationBusy === 'cleanup-simulation'
                          ? 'Cleaning up...'
                          : simulationButtonLabel}
                    </button>
                    {showSimulationTooltip ? (
                      <span className="landing-hover-tooltip" role="tooltip">
                        {simulationButtonTitle}
                      </span>
                    ) : null}
                  </span>
                  {showSimulationAdvance ? (
                    <>
                      {canRefreshLiveQuarter ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void handleSimulationAdvance('live')}
                          disabled={saving || simulationBusy !== null || !selectedPoolId || !(simulationStatus?.canAdvance ?? false)}
                        >
                          {simulationBusy === 'live-simulation' ? 'Updating...' : 'Update Live Score'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void handleSimulationAdvance('complete')}
                        disabled={saving || simulationBusy !== null || !selectedPoolId || !(simulationStatus?.canAdvance ?? false)}
                      >
                        {simulationBusy === 'advance-simulation' ? 'Completing...' : simulationAdvanceLabel}
                      </button>
                    </>
                  ) : null}
                </>
              ) : null}
              <button type="button" className="primary" onClick={onSavePool} disabled={saving || simulationBusy !== null}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" className="secondary" onClick={onDeletePool} disabled={saving || simulationBusy !== null || !selectedPoolId}>
                Delete
              </button>
            </div>
          </div>

          <div className="landing-selected-summary">
            <div className="landing-selected-summary-header">
              <div>
                <strong>{selectedPool ? formatPoolName(selectedPool) : 'New pool'}</strong>
                <p className="small">
                  {selectedPool
                    ? 'Update the pool details below or use Fill Schedule to add only the missing weeks.'
                    : 'Enter the pool details below. Save the pool before using Fill Schedule.'}
                </p>
                <p className="small landing-readonly-note">{selectedPoolTypeDefinition.description}</p>
                <p className="small landing-readonly-note">Pool notification emails go to the primary and secondary contacts for the selected organization.</p>
                {simulationProgressNote ? <p className="small landing-readonly-note">{simulationProgressNote}</p> : null}
                {selectedPool ? (
                  displayUrl ? (
                    <div>
                      <p className="small landing-readonly-note">Display link opens the Squares board in read-only mode on the last completed game.</p>
                      <label className="field-block">
                        <span>Display URL</span>
                        <input value={displayUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
                      </label>
                      <a href={displayUrl} target="_blank" rel="noreferrer">Open display view</a>
                    </div>
                  ) : (
                    <p className="small">Save the pool to generate its display URL.</p>
                  )
                ) : null}
              </div>
            </div>
          </div>

          <div className="landing-player-fields">
            <label className="field-block">
              <span>Pool name</span>
              <input
                value={poolForm.poolName}
                onChange={(event) => setPoolForm((current) => ({ ...current, poolName: event.target.value }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Organization</span>
              <select
                value={poolForm.teamId}
                onChange={(event) => setPoolForm((current) => ({ ...current, teamId: event.target.value }))}
                disabled={saving}
              >
                <option value="">Select organization</option>
                {teamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.team_name ?? `Team ${team.id}`}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-block">
              <span>Pool type</span>
              <select
                value={poolForm.poolType}
                onChange={(event) => {
                  const nextType = getPoolTypeDefinition(event.target.value as PoolTypeCode)
                  setPoolForm((current) => {
                    const nextTemplateOptions = listAvailablePoolTemplates({
                      poolType: nextType.code,
                      leagueCode: current.leagueCode
                    })
                    const nextTemplateCode = nextType.supportsStructureTemplates
                      ? (current.templateCode || nextTemplateOptions[0]?.code || '')
                      : ''
                    const nextStructureMode: PoolStructureMode = nextType.supportsStructureTemplates && nextTemplateCode ? 'template' : 'manual'
                    const nextDates =
                      nextStructureMode === 'template'
                        ? applyTemplateDateDefaults(current.season, nextTemplateCode, current.startDate, current.endDate)
                        : { startDate: current.startDate, endDate: current.endDate }

                    return {
                      ...current,
                      poolType: nextType.code,
                      structureMode: nextStructureMode,
                      templateCode: nextTemplateCode,
                      payoutScheduleMode: nextType.code === 'tournament' ? current.payoutScheduleMode : 'uniform',
                      boardNumberMode: nextType.code === 'tournament' ? current.boardNumberMode : 'per_game',
                      roundPayouts:
                        nextType.code === 'tournament'
                          ? current.payoutScheduleMode === 'by_round'
                            ? buildTemplateRoundPayouts(current.leagueCode, nextTemplateCode, current.roundPayouts)
                            : current.roundPayouts
                          : [],
                      startDate: nextType.supportsDateWindow ? nextDates.startDate : '',
                      endDate: nextType.supportsDateWindow ? nextDates.endDate : '',
                      winnerLoserMode: current.winnerLoserMode || nextType.defaultWinnerLoserMode
                    }
                  })
                }}
                disabled={saving}
              >
                <option value="season">Season</option>
                <option value="single_game">Single Game</option>
                <option value="playoff_series">Playoff Series</option>
                <option value="tournament">Tournament</option>
              </select>
            </label>

            <label className="field-block">
              <span>Season / year</span>
              <input
                type="number"
                value={poolForm.season}
                onChange={(event) =>
                  setPoolForm((current) => {
                    const nextSeason = Number(event.target.value)
                    const nextDates =
                      current.structureMode === 'template'
                        ? applyTemplateDateDefaults(nextSeason, current.templateCode, current.startDate, current.endDate)
                        : { startDate: current.startDate, endDate: current.endDate }

                    return {
                      ...current,
                      season: nextSeason,
                      startDate: nextDates.startDate,
                      endDate: nextDates.endDate
                    }
                  })
                }
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>League</span>
              <select
                value={poolForm.leagueCode}
                onChange={(event) => {
                  const nextLeague = getPoolLeagueDefinition(event.target.value as SupportedLeagueCode)
                  setPoolForm((current) => {
                    const nextTemplateOptions = listAvailablePoolTemplates({
                      poolType: current.poolType,
                      leagueCode: nextLeague.leagueCode
                    })
                    const nextTemplateCode = nextTemplateOptions.some((template) => template.code === current.templateCode)
                      ? current.templateCode
                      : (nextTemplateOptions[0]?.code ?? '')
                    const nextStructureMode: PoolStructureMode =
                      current.poolType === 'tournament' && nextTemplateCode ? 'template' : current.structureMode === 'template' ? 'manual' : current.structureMode
                    const nextDates =
                      nextStructureMode === 'template'
                        ? applyTemplateDateDefaults(current.season, nextTemplateCode, current.startDate, current.endDate)
                        : { startDate: current.startDate, endDate: current.endDate }

                    return {
                      ...current,
                      leagueCode: nextLeague.leagueCode,
                      sportCode: nextLeague.sportCode,
                      structureMode: nextStructureMode,
                      templateCode: nextStructureMode === 'template' ? nextTemplateCode : '',
                      startDate: nextDates.startDate,
                      endDate: nextDates.endDate,
                      primarySportTeamId: '',
                      primaryTeam: '',
                      roundPayouts: normalizeRoundPayouts(nextLeague.leagueCode, current.roundPayouts),
                      q1Payout: nextLeague.activePayoutSlots.includes('q1') ? current.q1Payout : 0,
                      q2Payout: nextLeague.activePayoutSlots.includes('q2') ? current.q2Payout : 0,
                      q3Payout: nextLeague.activePayoutSlots.includes('q3') ? current.q3Payout : 0,
                      q4Payout: nextLeague.activePayoutSlots.includes('q4') ? current.q4Payout : 0
                    }
                  })
                }}
                disabled={saving}
              >
                <option value="NFL">NFL</option>
                <option value="NCAAF">NCAAF</option>
                <option value="NCAAB">NCAAB</option>
                <option value="MLB">MLB</option>
                <option value="NBA">NBA</option>
                <option value="NHL">NHL</option>
              </select>
            </label>

            <label className="field-block">
              <span>Sport</span>
              <input value={poolForm.sportCode} readOnly disabled />
            </label>

            {selectedPoolTypeDefinition.supportsStructureTemplates ? (
              <label className="field-block">
                <span>Schedule setup</span>
                <select
                  value={poolForm.structureMode}
                  onChange={(event) => {
                    const nextMode = event.target.value as PoolStructureMode
                    setPoolForm((current) => {
                      const nextTemplateCode = nextMode === 'template' ? (current.templateCode || availablePoolTemplates[0]?.code || '') : ''
                      const nextDates =
                        nextMode === 'template'
                          ? applyTemplateDateDefaults(current.season, nextTemplateCode, current.startDate, current.endDate)
                          : { startDate: current.startDate, endDate: current.endDate }

                      return {
                        ...current,
                        structureMode: nextMode,
                        templateCode: nextTemplateCode,
                        roundPayouts:
                          current.payoutScheduleMode === 'by_round' && nextMode === 'template'
                            ? buildTemplateRoundPayouts(current.leagueCode, nextTemplateCode, current.roundPayouts)
                            : current.roundPayouts,
                        startDate: nextDates.startDate,
                        endDate: nextDates.endDate
                      }
                    })
                  }}
                  disabled={saving}
                >
                  <option value="manual">Manual / custom bracket</option>
                  <option value="template">Template-guided</option>
                </select>
              </label>
            ) : null}

            {poolForm.structureMode === 'template' && availablePoolTemplates.length > 0 ? (
              <label className="field-block">
                <span>Template</span>
                <select
                  value={poolForm.templateCode}
                  onChange={(event) => {
                    const nextTemplateCode = event.target.value as PoolTemplateCode | ''
                    setPoolForm((current) => {
                      const nextDates = applyTemplateDateDefaults(current.season, nextTemplateCode, current.startDate, current.endDate)
                      return {
                        ...current,
                        templateCode: nextTemplateCode,
                        roundPayouts:
                          current.payoutScheduleMode === 'by_round'
                            ? buildTemplateRoundPayouts(current.leagueCode, nextTemplateCode, current.roundPayouts)
                            : current.roundPayouts,
                        startDate: nextDates.startDate,
                        endDate: nextDates.endDate
                      }
                    })
                  }}
                  disabled={saving}
                >
                  <option value="">Select template</option>
                  {availablePoolTemplates.map((template) => (
                    <option key={template.code} value={template.code}>
                      {template.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {poolForm.poolType === 'tournament' ? (
              <label className="field-block">
                <span>Board numbers</span>
                <select
                  value={poolForm.boardNumberMode}
                  onChange={(event) =>
                    setPoolForm((current) => ({
                      ...current,
                      boardNumberMode: event.target.value as PoolBoardNumberMode
                    }))
                  }
                  disabled={saving}
                >
                  <option value="per_game">Change for each game</option>
                  <option value="same_for_tournament">Keep the same for the whole tournament</option>
                </select>
              </label>
            ) : null}

            {selectedPoolTypeDefinition.supportsDateWindow ? (
              <>
                <label className="field-block">
                  <span>Start date</span>
                  <input
                    type="date"
                    value={poolForm.startDate}
                    onChange={(event) => setPoolForm((current) => ({ ...current, startDate: event.target.value }))}
                    disabled={saving}
                  />
                </label>

                <label className="field-block">
                  <span>End date</span>
                  <input
                    type="date"
                    value={poolForm.endDate}
                    onChange={(event) => setPoolForm((current) => ({ ...current, endDate: event.target.value }))}
                    disabled={saving}
                  />
                </label>
              </>
            ) : null}

            <label className="field-block">
              <span>{selectedPoolTypeDefinition.requiresPreferredTeam ? 'Preferred sport team' : 'Preferred sport team (optional)'}</span>
              <select
                value={poolForm.primarySportTeamId}
                onChange={(event) => {
                  const selectedId = event.target.value
                  const selectedSportTeam = sportTeamOptions.find((team) => String(team.id) === selectedId)
                  setPoolForm((current) => ({
                    ...current,
                    primarySportTeamId: selectedId,
                    primaryTeam: selectedSportTeam?.name?.trim() || ''
                  }))
                }}
                disabled={saving || sportTeamOptions.length === 0}
              >
                <option value="">{sportTeamOptions.length > 0 ? 'Select preferred sport team' : `No ${poolForm.leagueCode} teams available`}</option>
                {sportTeamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name ?? `Sport Team ${team.id}`}
                    {team.abbreviation ? ` (${team.abbreviation})` : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className="checkbox-row landing-inline-checkbox landing-field-span">
              <input
                type="checkbox"
                checked={poolForm.winnerLoserMode}
                onChange={(event) => setPoolForm((current) => ({ ...current, winnerLoserMode: event.target.checked }))}
                disabled={saving}
              />
              <span>Use winner/loser scoring so the winning score is shown across the top and the losing score is shown on the side.</span>
            </label>

            <p className="small landing-readonly-note landing-field-span">
              {selectedPoolTypeDefinition.requiresPreferredTeam
                ? 'Season, single-game, and playoff-series pools follow a preferred team. Tournament pools can leave the preferred team blank and use manual matchup entries.'
                : 'Tournament pools can be kept generic and scored as winner vs loser for brackets, playoff rounds, or championship games.'}
            </p>

            <p className="small landing-readonly-note landing-field-span">
              {selectedPoolTypeDefinition.supportsDateWindow
                ? 'Use the start and end dates to bound non-season pools. Template mode can prefill the event window for common formats like March Madness.'
                : 'Season pools stay open-ended and can keep using Fill Schedule for the regular season.'}
            </p>

            {selectedTemplateDefinition ? (
              <p className="small landing-readonly-note landing-field-span">{selectedTemplateDefinition.description}</p>
            ) : null}

            <label className="field-block">
              <span>Square cost</span>
              <input
                type="text"
                inputMode="numeric"
                value={formatCurrencyInput(poolForm.squareCost)}
                onChange={(event) => setPoolForm((current) => ({ ...current, squareCost: parseCurrencyInput(event.target.value) }))}
                disabled={saving}
              />
            </label>

            {poolForm.poolType === 'tournament' ? (
              <label className="field-block">
                <span>Payout schedule</span>
                <select
                  value={poolForm.payoutScheduleMode}
                  onChange={(event) => {
                    const nextMode = event.target.value as PoolPayoutScheduleMode
                    setPoolForm((current) => ({
                      ...current,
                      payoutScheduleMode: nextMode,
                      roundPayouts:
                        nextMode === 'by_round'
                          ? current.roundPayouts.length > 0
                            ? normalizeRoundPayouts(current.leagueCode, current.roundPayouts)
                            : buildTemplateRoundPayouts(current.leagueCode, current.templateCode, [])
                          : current.roundPayouts
                    }))
                  }}
                  disabled={saving}
                >
                  <option value="uniform">Same payout for every game</option>
                  <option value="by_round">Custom payout by round</option>
                </select>
              </label>
            ) : null}

            {poolForm.payoutScheduleMode === 'by_round' && poolForm.poolType === 'tournament' ? (
              <div className="landing-field-span landing-round-payout-editor">
                <p className="small landing-readonly-note">
                  Enter the tournament payouts by round. For NCAA basketball, you can leave the 1st-half amount at `$0` and only set the final amount for each round.
                </p>

                <div className="landing-round-payout-actions">
                  <button
                    type="button"
                    className="secondary compact"
                    onClick={applyTemplateRoundPayoutRows}
                    disabled={saving || !selectedTemplateDefinition}
                  >
                    {selectedTemplateDefinition ? 'Load template rounds' : 'Select a template to preload rounds'}
                  </button>
                  <button type="button" className="secondary compact" onClick={addRoundPayoutRow} disabled={saving}>
                    Add round
                  </button>
                </div>

                {poolForm.roundPayouts.length === 0 ? (
                  <p className="small">No round payouts added yet. Add a round or load the template defaults.</p>
                ) : (
                  <div className="landing-round-payout-list">
                    {poolForm.roundPayouts.map((roundPayout, index) => (
                      <div key={`${roundPayout.roundLabel || 'round'}-${index}`} className="landing-round-payout-card">
                        <div className="landing-round-payout-header">
                          <strong>{roundPayout.roundLabel.trim() || `Round ${index + 1}`}</strong>
                          <button
                            type="button"
                            className="secondary compact"
                            onClick={() => removeRoundPayoutRow(index)}
                            disabled={saving}
                          >
                            Remove
                          </button>
                        </div>

                        <div className="landing-player-fields">
                          <label className="field-block">
                            <span>Round / stage</span>
                            <input
                              value={roundPayout.roundLabel}
                              onChange={(event) => setRoundPayoutField(index, { roundLabel: event.target.value })}
                              disabled={saving}
                            />
                          </label>

                          <label className="field-block">
                            <span>Round order</span>
                            <input
                              type="number"
                              min={1}
                              value={roundPayout.roundSequence ?? ''}
                              onChange={(event) =>
                                setRoundPayoutField(index, {
                                  roundSequence: event.target.value ? Number(event.target.value) : null
                                })
                              }
                              disabled={saving}
                            />
                          </label>

                          {selectedLeagueDefinition.activePayoutSlots.map((slot) => {
                            const payoutValue =
                              slot === 'q1'
                                ? roundPayout.q1Payout
                                : slot === 'q2'
                                  ? roundPayout.q2Payout
                                  : slot === 'q3'
                                    ? roundPayout.q3Payout
                                    : roundPayout.q4Payout

                            return (
                              <label key={`${slot}-${index}`} className="field-block">
                                <span>{selectedLeagueDefinition.payoutLabels[slot]}</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  value={formatCurrencyInput(payoutValue)}
                                  onChange={(event) =>
                                    setRoundPayoutField(index, {
                                      q1Payout: slot === 'q1' ? parseCurrencyInput(event.target.value) : roundPayout.q1Payout,
                                      q2Payout: slot === 'q2' ? parseCurrencyInput(event.target.value) : roundPayout.q2Payout,
                                      q3Payout: slot === 'q3' ? parseCurrencyInput(event.target.value) : roundPayout.q3Payout,
                                      q4Payout: slot === 'q4' ? parseCurrencyInput(event.target.value) : roundPayout.q4Payout
                                    })
                                  }
                                  disabled={saving}
                                />
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              selectedLeagueDefinition.activePayoutSlots.map((slot) => {
                const payoutValue =
                  slot === 'q1' ? poolForm.q1Payout : slot === 'q2' ? poolForm.q2Payout : slot === 'q3' ? poolForm.q3Payout : poolForm.q4Payout

                return (
                  <label key={slot} className="field-block">
                    <span>{selectedLeagueDefinition.payoutLabels[slot]}</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={formatCurrencyInput(payoutValue)}
                      onChange={(event) => setPayoutForSlot(slot, parseCurrencyInput(event.target.value))}
                      disabled={saving}
                    />
                  </label>
                )
              })
            )}

            <p className="small landing-readonly-note landing-field-span">
              {poolForm.payoutScheduleMode === 'by_round' && poolForm.poolType === 'tournament'
                ? 'Use by-round payouts for escalating tournament prizes like $10 in the opening round and $500 in the championship.'
                : 'Payout checkpoints follow the selected league. NCAA basketball uses 1st half and final, MLB uses final only, and playoff/tournament pools are estimated from the games you add.'}
            </p>

            <label className="field-block">
              <span>Contact notification level</span>
              <select
                value={poolForm.contactNotificationLevel}
                onChange={(event) =>
                  setPoolForm((current) => ({ ...current, contactNotificationLevel: event.target.value as NotificationLevel }))
                }
                disabled={saving}
              >
                <option value="none">None</option>
                <option value="quarter_win">Score segment win</option>
                <option value="game_total">Total win after game ends</option>
              </select>
            </label>

            <label className="checkbox-row landing-inline-checkbox landing-field-span">
              <input
                type="checkbox"
                checked={poolForm.contactNotifyOnSquareLead}
                onChange={(event) => setPoolForm((current) => ({ ...current, contactNotifyOnSquareLead: event.target.checked }))}
                disabled={saving}
              />
              <span>Email pool contacts when a score change makes a square the current live leader</span>
            </label>
          </div>

        </article>

        <aside className="landing-maintenance-card">
          <div className="landing-maintenance-header">
            <div>
              <h2>Payout Summary</h2>
              <p className="small">Quick reference for the selected pool.</p>
            </div>
          </div>

          <div className="landing-readonly-panel">
            <div className="landing-payout-summary-block">
              <div className="landing-payout-summary-line">
                <span>Total Revenue:</span>
                <strong>{formatCurrency(payoutSummary.totalRevenue)}</strong>
              </div>

              <div className="landing-payout-summary-line">
                <span>Total Payout:</span>
                <strong>{formatCurrency(payoutSummary.totalPayout)}</strong>
              </div>

              <div className="landing-payout-summary-line">
                <span>Estimated Games:</span>
                <strong>{payoutSummary.estimatedGameCount}</strong>
              </div>

              <div className="landing-payout-summary-divider" />

              <div className="landing-payout-summary-line is-total">
                <span>Total Raised:</span>
                <strong>{formatCurrency(payoutSummary.totalRaisedForTeam)}</strong>
              </div>
            </div>

            <div className="landing-payout-summary-block">
              <div className="landing-payout-summary-line">
                <span>Total Paid To Date:</span>
                <strong>{formatCurrency(payoutSummary.paidOutToDate)}</strong>
              </div>

              <div className="landing-payout-summary-line">
                <span>Remaining To Be Paid:</span>
                <strong>{formatCurrency(payoutSummary.remainingToBePaid)}</strong>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
