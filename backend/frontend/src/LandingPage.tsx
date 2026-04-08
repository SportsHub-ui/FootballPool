import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { LandingMetrics } from './LandingMetrics'
import { LandingNotificationTemplates } from './LandingNotificationTemplates'
import { LandingPlayerMaintenance } from './LandingPlayerMaintenance'
import { LandingPoolMaintenance } from './LandingPoolMaintenance'
import { LandingScheduleMaintenance } from './LandingScheduleMaintenance'
import { LandingTeamMaintenance } from './LandingTeamMaintenance'
import { LandingUserMaintenance } from './LandingUserMaintenance'
import { PayoutSummaryPanel, type BoardPayoutSummary } from './PayoutSummaryPanel'
import { getScoreSegmentDefinitions, getSimulationStepDescriptor } from './utils/poolLeagues'

type LandingPool = {
  id: number
  pool_name: string | null
  season: number | null
  primary_team_id: number | null // references sport_team.id
  pool_type?: string | null
  winner_loser_flg?: boolean
  default_flg: boolean
  sign_in_req_flg: boolean
  display_token: string | null
  team_name: string | null
  primary_color: string | null
  secondary_color: string | null
  logo_file: string | null
  has_members_flg?: boolean
}

type LandingGame = {
  id: number
  pool_game_id: number // new: pool_game PK
  game_id: number // normalized shared game PK
  pool_id: number
  week_num: number | null
  opponent: string
  game_dt: string
  is_simulation: boolean
  row_numbers: number[] | null
  col_numbers: number[] | null
  q1_primary_score: number | null
  q1_opponent_score: number | null
  q2_primary_score: number | null
  q2_opponent_score: number | null
  q3_primary_score: number | null
  q3_opponent_score: number | null
  q4_primary_score: number | null
  q4_opponent_score: number | null
}

type LandingBoardSquare = {
  id: number
  square_num: number
  participant_id: number | null
  player_id: number | null
  paid_flg: boolean | null
  participant_first_name: string | null
  participant_last_name: string | null
  player_jersey_num: number | null
  current_game_won: number
  season_won_total: number
  is_current_score_leader?: boolean
}

type LandingBoard = {
  poolId: number
  poolName: string
  primaryTeamId: number | null // references nfl_team.id
  primaryTeam: string
  opponent: string
  winnerLoserMode?: boolean
  poolType?: string | null
  gameId: number | null
  gameDate: string | null
  teamName: string | null
  teamPrimaryColor: string
  teamSecondaryColor: string
  teamLogo: string | null
  rowNumbers: Array<number | string> | null
  colNumbers: Array<number | string> | null
  payoutSummary?: BoardPayoutSummary | null
  squares: LandingBoardSquare[]
}

type LoginResponse = {
  token: string
  user: {
    id: number
    firstName: string
    lastName: string
    email: string
    role: string
  }
}

type DisplayBoardLaunchResponse = {
  displayOnly: boolean
  pool: LandingPool | null
  games: LandingGame[]
  selectedGameId: number | null
  board: LandingBoard | null
}

type LandingUserOption = {
  id: number
  first_name: string | null
  last_name: string | null
  email: string | null
}

type LandingPlayerOption = {
  id: number
  user_id: number | null
  jersey_num: number | null
  first_name: string | null
  last_name: string | null
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

type TeamBrand = {
  key: string
  color: string
  accent: string
  logo: string
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '')
  .toString()
  .trim()
  .replace(/\/+$/, '')
const DEFAULT_POOL_LOGO = '/football-pool.png'
const SHOW_SIMULATION_CONTROLS =
  (import.meta.env.VITE_ENABLE_SIMULATION_CONTROLS ?? 'true').toString().toLowerCase() === 'true'
const DEFAULT_DISPLAY_REFRESH_SECONDS = Math.max(
  5,
  Number.parseInt((import.meta.env.VITE_DISPLAY_REFRESH_SECONDS ?? '30').toString(), 10) || 30
)
const DEFAULT_DISPLAY_TIME_ZONE = (import.meta.env.VITE_DISPLAY_TIME_ZONE ?? '').toString().trim()

const NFL_TEAM_BRANDS: TeamBrand[] = [
  { key: 'cardinals', color: '#97233f', accent: '#000000', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ari.png' },
  { key: 'falcons', color: '#a71930', accent: '#000000', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/atl.png' },
  { key: 'ravens', color: '#241773', accent: '#000000', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/bal.png' },
  { key: 'bills', color: '#00338d', accent: '#c60c30', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/buf.png' },
  { key: 'panthers', color: '#0085ca', accent: '#101820', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/car.png' },
  { key: 'bears', color: '#0b162a', accent: '#c83803', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/chi.png' },
  { key: 'bengals', color: '#fb4f14', accent: '#000000', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/cin.png' },
  { key: 'browns', color: '#311d00', accent: '#ff3c00', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/cle.png' },
  { key: 'cowboys', color: '#002244', accent: '#869397', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png' },
  { key: 'broncos', color: '#fb4f14', accent: '#002244', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/den.png' },
  { key: 'lions', color: '#0076b6', accent: '#b0b7bc', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png' },
  { key: 'packers', color: '#203731', accent: '#ffb612', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png' },
  { key: 'texans', color: '#03202f', accent: '#a71930', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/hou.png' },
  { key: 'colts', color: '#002c5f', accent: '#a2aaad', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ind.png' },
  { key: 'jaguars', color: '#006778', accent: '#d7a22a', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/jax.png' },
  { key: 'chiefs', color: '#e31837', accent: '#ffb81c', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png' },
  { key: 'raiders', color: '#000000', accent: '#a5acaf', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/lv.png' },
  { key: 'chargers', color: '#0080c6', accent: '#ffc20e', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/lac.png' },
  { key: 'rams', color: '#003594', accent: '#ffd100', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/lar.png' },
  { key: 'dolphins', color: '#008e97', accent: '#fc4c02', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/mia.png' },
  { key: 'vikings', color: '#4f2683', accent: '#ffc62f', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/min.png' },
  { key: 'patriots', color: '#002244', accent: '#c60c30', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ne.png' },
  { key: 'saints', color: '#d3bc8d', accent: '#101820', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/no.png' },
  { key: 'giants', color: '#0b2265', accent: '#a71930', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/nyg.png' },
  { key: 'jets', color: '#125740', accent: '#000000', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/nyj.png' },
  { key: 'eagles', color: '#004c54', accent: '#a5acaf', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/phi.png' },
  { key: 'steelers', color: '#101820', accent: '#ffb612', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/pit.png' },
  { key: '49ers', color: '#aa0000', accent: '#b3995d', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png' },
  { key: 'seahawks', color: '#002244', accent: '#69be28', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sea.png' },
  { key: 'buccaneers', color: '#d50a0a', accent: '#34302b', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/tb.png' },
  { key: 'titans', color: '#0c2340', accent: '#4b92db', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ten.png' },
  { key: 'commanders', color: '#5a1414', accent: '#ffb612', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/wsh.png' }
]

const resolveImageUrl = (value: string): string => {
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  if (value.startsWith('/')) return `${API_BASE}${value}`
  return `${API_BASE}/images/${value}`
}

const resolveTeamBrand = (
  teamName: string,
  fallbackColor: string,
  fallbackAccent: string,
  fallbackLogo: string | null
): TeamBrand => {
  const lowered = teamName.toLowerCase()
  const match = NFL_TEAM_BRANDS.find((team) => lowered.includes(team.key))

  if (match) {
    return match
  }

  return {
    key: teamName,
    color: fallbackColor,
    accent: fallbackAccent,
    logo: fallbackLogo ?? ''
  }
}

const boardMoneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
})

const formatBoardMoney = (value: number | null | undefined): string => boardMoneyFormatter.format(Number(value ?? 0))

const resolveBrowserTimeZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

const resolveDisplayTimeZone = (value: string | null | undefined): string => {
  const candidate = (value ?? '').toString().trim()
  const fallback = DEFAULT_DISPLAY_TIME_ZONE || resolveBrowserTimeZone()

  if (!candidate) {
    return fallback
  }

  try {
    new Intl.DateTimeFormat(undefined, { timeZone: candidate }).format(new Date())
    return candidate
  } catch {
    return fallback
  }
}

const resolveDisplayRefreshSeconds = (value: string | null | undefined): number => {
  const parsed = Number.parseInt((value ?? '').toString(), 10)

  if (!Number.isFinite(parsed) || parsed < 5 || parsed > 3600) {
    return DEFAULT_DISPLAY_REFRESH_SECONDS
  }

  return parsed
}

const formatDate = (value: string | null | undefined, options?: { timeZone?: string | null }): string => {
  const dateValue = value ? new Date(value) : new Date()

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    ...(options?.timeZone ? { timeZone: options.timeZone } : {})
  }).format(dateValue)
}

const formatClockTime = (value: Date, timeZone?: string | null): string => new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  timeZone: timeZone ?? undefined
}).format(value)

const isCompletedGame = (game: LandingGame | null): boolean => {
  if (!game) return false
  return game.q4_primary_score !== null && game.q4_opponent_score !== null
}

const getLatestScoredQuarter = (game: LandingGame | null): number | null => {
  if (!game) return null
  if (game.q4_primary_score !== null && game.q4_opponent_score !== null) return 4
  if (game.q3_primary_score !== null && game.q3_opponent_score !== null) return 3
  if (game.q2_primary_score !== null && game.q2_opponent_score !== null) return 2
  if (game.q1_primary_score !== null && game.q1_opponent_score !== null) return 1
  return null
}

const getQuarterScores = (
  game: LandingGame,
  quarter: number
): { primaryScore: number | null; opponentScore: number | null } => {
  if (quarter === 1) return { primaryScore: game.q1_primary_score, opponentScore: game.q1_opponent_score }
  if (quarter === 2) return { primaryScore: game.q2_primary_score, opponentScore: game.q2_opponent_score }
  if (quarter === 3) return { primaryScore: game.q3_primary_score, opponentScore: game.q3_opponent_score }
  return { primaryScore: game.q4_primary_score, opponentScore: game.q4_opponent_score }
}

const getDisplayScores = (
  primaryScore: number | null,
  opponentScore: number | null,
  winnerLoserMode: boolean
): { topScore: number | null; sideScore: number | null } => {
  if (!winnerLoserMode || primaryScore == null || opponentScore == null) {
    return { topScore: primaryScore, sideScore: opponentScore }
  }

  return {
    topScore: Math.max(Number(primaryScore), Number(opponentScore)),
    sideScore: Math.min(Number(primaryScore), Number(opponentScore))
  }
}

const resolveWinningSquareNumber = (
  rowNumbers: Array<number | string> | null | undefined,
  colNumbers: Array<number | string> | null | undefined,
  opponentScore: number | null,
  primaryScore: number | null,
  winnerLoserMode = false
): number | null => {
  if (opponentScore == null || primaryScore == null) {
    return null
  }

  const normalizedRows = (rowNumbers ?? []).map((entry) => Number(entry))
  const normalizedCols = (colNumbers ?? []).map((entry) => Number(entry))
  const resolvedTopScore = winnerLoserMode ? Math.max(Number(primaryScore), Number(opponentScore)) : Number(primaryScore)
  const resolvedSideScore = winnerLoserMode ? Math.min(Number(primaryScore), Number(opponentScore)) : Number(opponentScore)

  if (
    normalizedRows.length !== 10 ||
    normalizedCols.length !== 10 ||
    normalizedRows.some((entry) => !Number.isFinite(entry)) ||
    normalizedCols.some((entry) => !Number.isFinite(entry))
  ) {
    return null
  }

  const opponentDigit = resolvedSideScore % 10
  const primaryDigit = resolvedTopScore % 10
  const rowIndex = normalizedRows.findIndex((digit) => digit === opponentDigit)
  const colIndex = normalizedCols.findIndex((digit) => digit === primaryDigit)

  if (rowIndex === -1 || colIndex === -1) {
    return null
  }

  return rowIndex * 10 + colIndex + 1
}

const formatQuarterSquareOwner = (square: LandingBoardSquare | null | undefined, squareNum: number | null): string => {
  const fullName = `${square?.participant_first_name ?? ''} ${square?.participant_last_name ?? ''}`.trim()

  if (fullName) {
    return fullName
  }

  if (square?.participant_id != null) {
    return `Participant #${square.participant_id}`
  }

  if (squareNum != null) {
    return `Open square #${squareNum}`
  }

  return 'Awaiting score'
}

const formatGameOption = (game: LandingGame, primaryTeam: string): string => {
  const dateLabel = formatDate(game.game_dt)
  const weekLabel = game.week_num != null ? `Week ${game.week_num} • ` : ''
  const isByeWeek = game.opponent.trim().toUpperCase() === 'BYE'

  if (isCompletedGame(game)) {
    return `${weekLabel}${dateLabel} • ${primaryTeam} ${game.q4_primary_score}-${game.q4_opponent_score} ${game.opponent}`
  }

  if (isByeWeek) {
    return `${weekLabel}${dateLabel} • ${primaryTeam} BYE`
  }

  return `${weekLabel}${dateLabel} • ${primaryTeam} vs ${game.opponent}`
}

const normalizeDigits = (value: Array<number | string> | null | undefined): Array<number | string> => {
  if (!Array.isArray(value) || value.length !== 10) {
    return Array.from({ length: 10 }, () => '???')
  }

  return value.map((entry) => (typeof entry === 'number' || typeof entry === 'string' ? entry : '???'))
}

const pickInitialPoolId = (pools: LandingPool[], currentPoolId: number | null): number | null => {
  if (currentPoolId && pools.some((pool) => pool.id === currentPoolId)) {
    return currentPoolId
  }

  if (pools.length === 1) {
    return pools[0].id
  }

  const defaultPool = pools.find((pool) => pool.default_flg)
  return defaultPool?.id ?? null
}

const pickInitialGameId = (
  games: LandingGame[],
  preferredGameId?: number | null,
  simulationCurrentGameId?: number | null
): number | null => {
  if (preferredGameId && games.some((game) => game.id === preferredGameId)) {
    return preferredGameId
  }

  if (simulationCurrentGameId && games.some((game) => game.id === simulationCurrentGameId)) {
    return simulationCurrentGameId
  }

  const liveOrScoredGame =
    games.find((game) => !isCompletedGame(game) && getLatestScoredQuarter(game) != null) ??
    [...games].reverse().find((game) => getLatestScoredQuarter(game) != null)

  if (liveOrScoredGame) {
    return liveOrScoredGame.id
  }

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const nextScheduled = games.find((game) => {
    const gameDate = new Date(game.game_dt)
    gameDate.setHours(0, 0, 0, 0)
    return gameDate >= today
  })

  return nextScheduled?.id ?? games[0]?.id ?? null
}

const getApiErrorMessage = (payload: unknown, fallback: string): string => {
  if (!payload || typeof payload !== 'object') {
    return fallback
  }

  const data = payload as {
    error?: string | Array<{ path?: Array<string | number>; message?: string }>
    detail?: string
    message?: string
  }

  if (Array.isArray(data.error)) {
    const validationMessage = data.error
      .map((issue) => {
        const field = Array.isArray(issue.path) && issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
        return `${field}${issue.message ?? 'Invalid value'}`
      })
      .join('; ')

    if (validationMessage) {
      return validationMessage
    }
  }

  if (typeof data.detail === 'string' && data.detail.trim()) {
    return data.detail
  }

  if (typeof data.message === 'string' && data.message.trim()) {
    return data.message
  }

  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error
  }

  return fallback
}

export function LandingPage() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth-token'))
  const [displayToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null

    const value = new URLSearchParams(window.location.search).get('display')
    return value?.trim() ? value.trim() : null
  })
  const [displayRefreshSeconds] = useState<number>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_DISPLAY_REFRESH_SECONDS
    }

    const searchParams = new URLSearchParams(window.location.search)
    return resolveDisplayRefreshSeconds(searchParams.get('refresh'))
  })
  const [displayTimeZone] = useState<string>(() => {
    if (typeof window === 'undefined') {
      return resolveDisplayTimeZone(DEFAULT_DISPLAY_TIME_ZONE)
    }

    const searchParams = new URLSearchParams(window.location.search)
    return resolveDisplayTimeZone(searchParams.get('tz') ?? DEFAULT_DISPLAY_TIME_ZONE)
  })
  const displayOnlyMode = Boolean(displayToken)
  const [showLogin, setShowLogin] = useState(false)
  const [activePage, setActivePage] = useState<'Squares' | 'Metrics' | 'Notifications' | 'Players' | 'Teams' | 'Pools' | 'Schedules' | 'Users'>('Squares')
  const [busy, setBusy] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [pageNotice, setPageNotice] = useState<string | null>(null)
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [pools, setPools] = useState<LandingPool[]>([])
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null)
  const [games, setGames] = useState<LandingGame[]>([])
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [board, setBoard] = useState<LandingBoard | null>(null)
  const [selectedSquare, setSelectedSquare] = useState<number | null>(null)
  const [simulationStatus, setSimulationStatus] = useState<SimulationControlStatus | null>(null)
  const simulationAdvanceSource: 'espn' = 'espn'
  const [assignForm, setAssignForm] = useState({
    participantId: '',
    playerId: '',
    paidFlg: false,
    reassign: false
  })
  const [participantOptions, setParticipantOptions] = useState<LandingUserOption[]>([])
  const [playerOptions, setPlayerOptions] = useState<LandingPlayerOption[]>([])
  const [lastDisplayRefreshAt, setLastDisplayRefreshAt] = useState<string | null>(null)
  const liveRefreshTimerRef = useRef<number | null>(null)
  const displayRefreshInFlightRef = useRef(false)

  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    return headers
  }, [token])

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

  const loadBoard = async (poolId: number, gameId: number | null): Promise<void> => {
    const query = gameId ? `?gameId=${gameId}` : ''
    const response = await fetch(`${API_BASE}/api/landing/pools/${poolId}/board${query}`, {
      headers: authHeaders
    })

    if (!response.ok) {
      throw new Error('Failed to load the board')
    }

    const data = await response.json()
    setBoard(data.board ?? null)
  }

  const fetchSimulationStatus = async (poolId: number): Promise<SimulationControlStatus | null> => {
    if (!SHOW_SIMULATION_CONTROLS) {
      return null
    }

    try {
      const response = await fetch(`${API_BASE}/api/setup/pools/${poolId}/simulation`, {
        headers: simulationHeaders
      })

      if (!response.ok) {
        throw new Error('Failed to load simulation status')
      }

      const data = await response.json()
      return data.status ?? null
    } catch {
      return null
    }
  }

  const loadPoolContext = async (poolId: number, preferredGameId?: number | null): Promise<void> => {
    setBusy('loading')
    setPageError(null)
    setSelectedSquare(null)

    try {
      const response = await fetch(`${API_BASE}/api/landing/pools/${poolId}/games`, {
        headers: authHeaders
      })

      if (!response.ok) {
        throw new Error('Failed to load pool games')
      }

      const [data, nextSimulationStatus] = await Promise.all([response.json(), fetchSimulationStatus(poolId)])
      const nextGames: LandingGame[] = data.games ?? []
      const nextGameId = pickInitialGameId(nextGames, preferredGameId, nextSimulationStatus?.currentGameId ?? null)

      setGames(nextGames)
      setSelectedPoolId(poolId)
      setSelectedGameId(nextGameId)
      setSimulationStatus(nextSimulationStatus)

      await loadBoard(poolId, nextGameId)
    } catch (error) {
      setSimulationStatus(null)
      setPageError(error instanceof Error ? error.message : 'Failed to load pool data')
      setGames([])
      setSelectedGameId(null)
      setBoard(null)
    } finally {
      setBusy(null)
    }
  }

  const refreshLivePoolContext = async (poolId: number, preferredGameId?: number | null): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE}/api/landing/pools/${poolId}/games`, {
        headers: authHeaders
      })

      if (!response.ok) {
        throw new Error('Failed to refresh pool games')
      }

      const [data, nextSimulationStatus] = await Promise.all([response.json(), fetchSimulationStatus(poolId)])
      const nextGames: LandingGame[] = data.games ?? []
      const nextGameId = pickInitialGameId(
        nextGames,
        preferredGameId ?? selectedGameId,
        nextSimulationStatus?.currentGameId ?? null
      )

      setGames(nextGames)
      setSelectedGameId(nextGameId)
      setSimulationStatus(nextSimulationStatus)

      await loadBoard(poolId, nextGameId)
    } catch (error) {
      console.error('Failed to refresh live landing board:', error)
    }
  }

  const loadDisplayBoard = async (displayCode: string, options?: { quiet?: boolean }): Promise<void> => {
    const quiet = Boolean(options?.quiet)

    if (quiet && displayRefreshInFlightRef.current) {
      return
    }

    if (quiet) {
      displayRefreshInFlightRef.current = true
    } else {
      setBusy('loading')
      setPageError(null)
      setPageNotice(null)
      setSelectedSquare(null)
    }

    try {
      const response = await fetch(`${API_BASE}/api/landing/display/${encodeURIComponent(displayCode)}`, {
        headers: authHeaders
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to load display board'))
      }

      const launch = data as DisplayBoardLaunchResponse
      const linkedPool = launch.pool ?? null

      setPools(linkedPool ? [linkedPool] : [])
      setSelectedPoolId(linkedPool?.id ?? null)
      setGames(launch.games ?? [])
      setSelectedGameId(launch.selectedGameId ?? null)
      setBoard(launch.board ?? null)
      setSimulationStatus(null)
      setLastDisplayRefreshAt(formatClockTime(new Date(), displayTimeZone))
    } catch (error) {
      setSimulationStatus(null)

      if (quiet) {
        console.error('Failed to auto-refresh display board:', error)
      } else {
        setPageError(error instanceof Error ? error.message : 'Failed to load display board')
        setPools([])
        setSelectedPoolId(null)
        setGames([])
        setSelectedGameId(null)
        setBoard(null)
      }
    } finally {
      if (quiet) {
        displayRefreshInFlightRef.current = false
      } else {
        setBusy(null)
      }
    }
  }

  const loadPools = async (preferredPoolId?: number | null): Promise<void> => {
    setBusy('loading')
    setPageError(null)

    try {
      const response = await fetch(`${API_BASE}/api/landing/pools`, { headers: authHeaders })

      if (!response.ok) {
        throw new Error('Failed to load pools')
      }

      const data = await response.json()
      const nextPools: LandingPool[] = data.pools ?? []
      const nextPoolId = pickInitialPoolId(nextPools, preferredPoolId ?? selectedPoolId)

      setPools(nextPools)

      if (nextPoolId) {
        await loadPoolContext(nextPoolId)
      } else {
        setSelectedPoolId(null)
        setGames([])
        setSelectedGameId(null)
        setBoard(null)
        setSimulationStatus(null)
      }
    } catch (error) {
      setSimulationStatus(null)
      setPageError(error instanceof Error ? error.message : 'Failed to load landing page')
      setPools([])
      setSelectedPoolId(null)
      setGames([])
      setSelectedGameId(null)
      setBoard(null)
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    if (displayOnlyMode && displayToken) {
      void loadDisplayBoard(displayToken)
      return
    }

    void loadPools(selectedPoolId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayOnlyMode, displayToken, token])

  useEffect(() => {
    if (typeof window === 'undefined' || (!displayOnlyMode && activePage !== 'Squares')) {
      return
    }

    let intervalId: number | null = null

    if (displayOnlyMode && displayToken) {
      intervalId = window.setInterval(() => {
        void loadDisplayBoard(displayToken, { quiet: true })
      }, displayRefreshSeconds * 1000)
    }

    if (displayOnlyMode ? !displayToken : !selectedPoolId) {
      return () => {
        if (intervalId != null) {
          window.clearInterval(intervalId)
        }
      }
    }

    const eventSource = new EventSource(`${API_BASE}/api/ingestion/events`)

    const scheduleRefresh = () => {
      if (liveRefreshTimerRef.current != null) {
        window.clearTimeout(liveRefreshTimerRef.current)
      }

      liveRefreshTimerRef.current = window.setTimeout(() => {
        liveRefreshTimerRef.current = null

        if (displayOnlyMode && displayToken) {
          void loadDisplayBoard(displayToken)
          return
        }

        if (selectedPoolId) {
          void refreshLivePoolContext(selectedPoolId, selectedGameId)
        }
      }, 750)
    }

    const handleGameUpdated = (event: MessageEvent) => {
      try {
        const payload = JSON.parse(event.data) as { payload?: { gameId?: unknown } }
        const gameId = Number(payload?.payload?.gameId)

        if (!Number.isFinite(gameId)) {
          return
        }

        const isRelevant =
          games.some((game) => Number(game.id) === gameId || Number(game.game_id) === gameId) ||
          Number(selectedGameId ?? board?.gameId ?? 0) === gameId

        if (isRelevant) {
          scheduleRefresh()
        }
      } catch (error) {
        console.warn('Ignoring malformed live score event', error)
      }
    }

    eventSource.addEventListener('game-updated', handleGameUpdated as EventListener)

    return () => {
      if (intervalId != null) {
        window.clearInterval(intervalId)
      }

      if (liveRefreshTimerRef.current != null) {
        window.clearTimeout(liveRefreshTimerRef.current)
        liveRefreshTimerRef.current = null
      }

      eventSource.removeEventListener('game-updated', handleGameUpdated as EventListener)
      eventSource.close()
    }
  }, [activePage, board?.gameId, displayOnlyMode, displayRefreshSeconds, displayToken, games, selectedGameId, selectedPoolId, token])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy('login')
    setLoginError(null)

    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      })

      const data: LoginResponse | { error?: string } = await response.json()

      if (!response.ok || !('token' in data)) {
        throw new Error(('error' in data && data.error) || 'Login failed')
      }

      localStorage.setItem('auth-token', data.token)
      setToken(data.token)
      setShowLogin(false)
      setLoginForm({ email: '', password: '' })
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Login failed')
    } finally {
      setBusy(null)
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('auth-token')
    setToken(null)
    setShowLogin(false)
    setLoginError(null)
    setSelectedSquare(null)
    setParticipantOptions([])
    setPlayerOptions([])
    setAssignForm({
      participantId: '',
      playerId: '',
      paidFlg: false,
      reassign: false
    })
  }

  const handlePoolChange = async (poolId: number | null) => {
    if (!poolId) {
      setSelectedPoolId(null)
      setGames([])
      setSelectedGameId(null)
      setBoard(null)
      setSimulationStatus(null)
      return
    }

    await loadPoolContext(poolId)
  }

  const handleGameChange = async (gameId: number | null) => {
    setSelectedGameId(gameId)

    if (!selectedPoolId) {
      return
    }

    setBusy('loading')
    setPageError(null)

    try {
      await loadBoard(selectedPoolId, gameId)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Failed to load game board')
    } finally {
      setBusy(null)
    }
  }

  const loadSquareOptions = async (poolId: number): Promise<void> => {
    const [usersResponse, playersResponse] = await Promise.all([
      fetch(`${API_BASE}/api/setup/users`, { headers: authHeaders }),
      fetch(`${API_BASE}/api/setup/pools/${poolId}/players`, { headers: authHeaders })
    ])

    const usersData = await usersResponse.json().catch(() => null)
    const playersData = await playersResponse.json().catch(() => null)

    if (!usersResponse.ok) {
      throw new Error(getApiErrorMessage(usersData, 'Failed to load users'))
    }

    if (!playersResponse.ok) {
      throw new Error(getApiErrorMessage(playersData, 'Failed to load players'))
    }

    setParticipantOptions(usersData?.users ?? [])
    setPlayerOptions(playersData?.players ?? [])
  }

  const handleOpenSquareAssignment = async (square: LandingBoardSquare) => {
    if (!token) {
      setShowLogin(true)
      return
    }

    if (!selectedPoolId) {
      return
    }

    setSelectedSquare(square.square_num)
    setAssignForm({
      participantId: square.participant_id != null ? String(square.participant_id) : '',
      playerId: square.player_id != null ? String(square.player_id) : '',
      paidFlg: Boolean(square.paid_flg),
      reassign: false
    })
    setBusy('square-options')
    setPageError(null)

    try {
      await loadSquareOptions(selectedPoolId)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Failed to load square assignment options')
      setSelectedSquare(null)
    } finally {
      setBusy(null)
    }
  }

  const handleCloseSquareAssignment = () => {
    setSelectedSquare(null)
  }

  const handleAssignSquare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedPoolId || selectedSquare == null) {
      setPageError('Select a square first')
      return
    }

    setBusy('assign-square')
    setPageError(null)

    try {
      const response = await fetch(`${API_BASE}/api/setup/pools/${selectedPoolId}/squares/${selectedSquare}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          participantId: assignForm.participantId ? Number(assignForm.participantId) : null,
          playerId: assignForm.playerId ? Number(assignForm.playerId) : null,
          paidFlg: assignForm.paidFlg,
          reassign: assignForm.reassign
        })
      })

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to update square assignment'))
      }

      await loadBoard(selectedPoolId, selectedGameId)
      setSelectedSquare(null)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Failed to update square assignment')
    } finally {
      setBusy(null)
    }
  }

  const handleClearSquareAssignment = async () => {
    if (!selectedPoolId || selectedSquare == null) {
      setPageError('Select a square first')
      return
    }

    setBusy('clear-square')
    setPageError(null)

    try {
      const response = await fetch(`${API_BASE}/api/setup/pools/${selectedPoolId}/squares/${selectedSquare}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          participantId: null,
          playerId: null,
          paidFlg: false,
          reassign: true
        })
      })

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to clear square assignment'))
      }

      setAssignForm({
        participantId: '',
        playerId: '',
        paidFlg: false,
        reassign: false
      })
      await loadBoard(selectedPoolId, selectedGameId)
      setSelectedSquare(null)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Failed to clear square assignment')
    } finally {
      setBusy(null)
    }
  }

  const handleSimulationAdvance = async (action: 'complete' | 'live' = 'complete'): Promise<void> => {
    if (!selectedPoolId || !simulationStatus?.canAdvance) {
      return
    }

    setBusy(action === 'live' ? 'live-simulation' : 'advance-simulation')
    setPageError(null)
    setPageNotice(null)

    try {
      const response = await fetch(`${API_BASE}/api/setup/pools/${selectedPoolId}/simulation/advance`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...simulationHeaders
        },
        body: JSON.stringify({ source: simulationAdvanceSource, action })
      })

      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to advance simulation'))
      }

      setPageNotice(
        typeof data?.message === 'string' && data.message.trim()
          ? data.message
          : `${simulationStatus.progressAction === 'complete_game' ? 'Game' : simulationStepDescriptor.singularLabel} completed.`
      )

      await loadPoolContext(selectedPoolId, data?.status?.currentGameId ?? selectedGameId)
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : action === 'live'
            ? 'Failed to refresh the live score'
            : 'Failed to advance simulation'
      )
    } finally {
      setBusy(null)
    }
  }

  const formatUserName = (user: LandingUserOption): string => {
    const fullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
    if (fullName) return fullName
    return user.email ?? `User #${user.id}`
  }

  const formatPlayerName = (player: LandingPlayerOption): string => {
    const fullName = `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim() || 'Unnamed member'
    return player.jersey_num != null ? `#${player.jersey_num} ${fullName}` : fullName
  }

  const selectedPool = useMemo(
    () => pools.find((pool) => pool.id === selectedPoolId) ?? null,
    [pools, selectedPoolId]
  )

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedGameId) ?? null,
    [games, selectedGameId]
  )

  const primaryBrand = useMemo(() => {
    if (board?.winnerLoserMode) {
      return {
        key: 'winner-score',
        color: board?.teamPrimaryColor ?? selectedPool?.primary_color ?? '#8a8f98',
        accent: board?.teamSecondaryColor ?? selectedPool?.secondary_color ?? '#233042',
        logo: ''
      }
    }

    const teamName = board?.primaryTeam ?? selectedPool?.team_name ?? 'Preferred Team'
    const fallbackLogo = selectedPool?.logo_file ? resolveImageUrl(selectedPool.logo_file) : null

    return resolveTeamBrand(
      teamName,
      board?.teamPrimaryColor ?? selectedPool?.primary_color ?? '#8a8f98',
      board?.teamSecondaryColor ?? selectedPool?.secondary_color ?? '#233042',
      fallbackLogo
    )
  }, [board, selectedPool])

  const opponentBrand = useMemo(() => {
    if (board?.winnerLoserMode) {
      return {
        key: 'losing-score',
        color: '#5f6368',
        accent: '#ffffff',
        logo: ''
      }
    }

    const opponentName = board?.opponent ?? selectedGame?.opponent ?? 'Opponent'
    return resolveTeamBrand(opponentName, '#5f6368', '#ffffff', null)
  }, [board, selectedGame])

  const logoSrc = selectedPool?.logo_file ? resolveImageUrl(selectedPool.logo_file) : DEFAULT_POOL_LOGO
  const topDigits = normalizeDigits(board?.colNumbers)
  const leftDigits = normalizeDigits(board?.rowNumbers)
  const hasActiveSelection = Boolean(selectedPool && selectedGame && board && !displayOnlyMode)

  const boardRows = useMemo(() => {
    const byNumber = new Map<number, LandingBoardSquare>()

    for (const square of board?.squares ?? []) {
      byNumber.set(square.square_num, square)
    }

    return Array.from({ length: 10 }, (_, rowIndex) =>
      Array.from({ length: 10 }, (_, colIndex) => {
        const squareNum = rowIndex * 10 + colIndex + 1

        return byNumber.get(squareNum) ?? {
          id: squareNum,
          square_num: squareNum,
          participant_id: null,
          player_id: null,
          paid_flg: null,
          participant_first_name: null,
          participant_last_name: null,
          player_jersey_num: null,
          current_game_won: 0,
          season_won_total: 0
        }
      })
    )
  }, [board])

  const selectedBoardSquare = useMemo(() => {
    if (!board || selectedSquare == null) {
      return null
    }

    return board.squares.find((square) => square.square_num === selectedSquare) ?? null
  }, [board, selectedSquare])

  const latestScoredQuarter = getLatestScoredQuarter(selectedGame)
  const scoreSegments = useMemo(
    () => getScoreSegmentDefinitions({ activeSlots: board?.payoutSummary?.activeSlots, payoutLabels: board?.payoutSummary?.payoutLabels }),
    [board?.payoutSummary]
  )
  const simulationStepDescriptor = useMemo(
    () => getSimulationStepDescriptor({ activeSlots: board?.payoutSummary?.activeSlots, payoutLabels: board?.payoutSummary?.payoutLabels }),
    [board?.payoutSummary]
  )

  const quarterSummaries = useMemo(() => {
    if (!board || !selectedGame) {
      return []
    }

    const winnerLoserMode = Boolean(board?.winnerLoserMode ?? selectedPool?.winner_loser_flg)
    const activeSimulationQuarter =
      simulationStatus?.mode === 'by_quarter' && Number(simulationStatus.currentGameId ?? 0) === Number(selectedGame.id)
        ? Number(simulationStatus.nextQuarter ?? 1)
        : null

    if (latestScoredQuarter == null && activeSimulationQuarter == null) {
      return []
    }

    const squaresByNumber = new Map<number, LandingBoardSquare>()

    for (const square of board.squares) {
      squaresByNumber.set(square.square_num, square)
    }

    const gameComplete = isCompletedGame(selectedGame)

    return scoreSegments.map((segment) => {
      const quarter = segment.quarter
      const { primaryScore, opponentScore } = getQuarterScores(selectedGame, quarter)
      const displayScores = getDisplayScores(primaryScore, opponentScore, winnerLoserMode)
      const hasScore = primaryScore !== null && opponentScore !== null
      const squareNum = hasScore
        ? resolveWinningSquareNumber(board.rowNumbers, board.colNumbers, opponentScore, primaryScore, winnerLoserMode)
        : null
      const matchingSquare = squareNum != null ? squaresByNumber.get(squareNum) ?? null : null
      const isActiveQuarter =
        activeSimulationQuarter != null
          ? quarter === activeSimulationQuarter
          : !gameComplete && quarter === latestScoredQuarter

      return {
        id: segment.slot,
        label: segment.shortLabel,
        quarter,
        status: !hasScore ? (isActiveQuarter ? 'active' : 'pending') : !gameComplete && isActiveQuarter ? 'active' : 'completed',
        primaryScore: displayScores.topScore,
        opponentScore: displayScores.sideScore,
        squareNum,
        ownerName: hasScore ? formatQuarterSquareOwner(matchingSquare, squareNum) : isActiveQuarter ? 'Live scoring in progress' : 'Awaiting score'
      }
    })
  }, [board, latestScoredQuarter, scoreSegments, selectedGame, selectedPool, simulationStatus])

  const showQuarterSummaries = quarterSummaries.length > 0
  const featuredDisplaySummary = useMemo(() => {
    if (!displayOnlyMode || quarterSummaries.length === 0) {
      return null
    }

    return quarterSummaries.find((summary) => summary.status === 'active')
      ?? [...quarterSummaries].reverse().find((summary) => summary.status === 'completed')
      ?? quarterSummaries[0]
  }, [displayOnlyMode, quarterSummaries])

  const currentGameIndex = useMemo(
    () => games.findIndex((game) => game.id === selectedGameId),
    [games, selectedGameId]
  )

  const previousGameId = currentGameIndex > 0 ? games[currentGameIndex - 1]?.id ?? null : null
  const nextGameId = currentGameIndex >= 0 && currentGameIndex < games.length - 1 ? games[currentGameIndex + 1]?.id ?? null : null

  const canManageSquares = Boolean(!displayOnlyMode && token && selectedPoolId && board)
  const poolTracksMembers = Boolean(selectedPool?.has_members_flg ?? true)
  const showMemberSelector = poolTracksMembers && playerOptions.length > 0
  const showSimulationAdvance = !displayOnlyMode && SHOW_SIMULATION_CONTROLS && Boolean(simulationStatus?.progressAction)
  const canRefreshLiveQuarter = simulationStatus?.progressAction === 'complete_quarter'
  const simulationAdvanceLabel = simulationStatus?.progressAction === 'complete_game' ? 'Complete Game' : `Complete ${simulationStepDescriptor.singularLabel}`
  const primaryTeamLabel = board?.primaryTeam ?? selectedPool?.team_name ?? 'Preferred Team'
  const opponentTeamLabel = board?.opponent ?? selectedGame?.opponent ?? 'Opponent'
  const primaryTeamLogo = primaryBrand.logo
  const opponentTeamLogo = opponentBrand.logo

  const heroTitle = selectedPool
    ? `${selectedPool.team_name ?? 'Team'} • ${selectedPool.pool_name ?? 'Pool'}`
    : pools.length > 1
      ? 'Select Pool'
      : pools.length === 1
        ? `${pools[0].team_name ?? 'Team'} • ${pools[0].pool_name ?? 'Pool'}`
        : 'Football Pool'

  const heroDate = selectedPool
    ? formatDate(selectedGame?.game_dt ?? board?.gameDate, { timeZone: displayOnlyMode ? displayTimeZone : null })
    : formatDate(null, { timeZone: displayOnlyMode ? displayTimeZone : null })

  return (
    <div className={`landing-page-shell ${activePage === 'Squares' ? 'is-squares-page' : 'is-scroll-page'} ${displayOnlyMode ? 'is-display-only' : ''}`}>
      {!displayOnlyMode ? (
        <>
          <nav className="landing-nav-bar">
            <div className="landing-nav-links">
              {(['Squares', 'Notifications', 'Players', 'Teams', 'Pools', 'Schedules', 'Users'] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`landing-nav-link ${activePage === item ? 'is-active' : ''}`}
                  onClick={() => setActivePage(item)}
                >
                  {item === 'Players' ? 'Members' : item === 'Teams' ? 'Organizations' : item}
                </button>
              ))}
              <button
                type="button"
                className={`landing-nav-link ${activePage === 'Metrics' ? 'is-active' : ''}`}
                onClick={() => setActivePage('Metrics')}
              >
                Metrics
              </button>
            </div>

            <button
              type="button"
              className="landing-signin-btn"
              onClick={() => (token ? handleLogout() : setShowLogin((current) => !current))}
            >
              {token ? 'Sign Out' : 'Sign In'}
            </button>
          </nav>

          {showLogin && !token ? (
            <section className="landing-login-card">
              <div>
                <h2>Sign in</h2>
                <p>Access follower pools and keep your view personalized.</p>
              </div>
              <form className="landing-login-form" onSubmit={handleLogin}>
                <input
                  type="email"
                  placeholder="Email"
                  value={loginForm.email}
                  onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))}
                  required
                  disabled={busy !== null}
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={loginForm.password}
                  onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))}
                  required
                  disabled={busy !== null}
                />
                <div className="landing-login-actions">
                  <button type="submit" className="primary" disabled={busy !== null}>
                    {busy === 'login' ? 'Signing in...' : 'Sign In'}
                  </button>
                </div>
              </form>
              {loginError ? <div className="error-banner">{loginError}</div> : null}
            </section>
          ) : null}
        </>
      ) : null}

      {pageError ? <div className="error-banner landing-error-banner">{pageError}</div> : null}
      {pageNotice && !displayOnlyMode ? (
        <article className="panel">
          <p className="small landing-readonly-note">{pageNotice}</p>
        </article>
      ) : null}

      {activePage === 'Squares' ? (
        <section className={`landing-placeholder-card ${displayOnlyMode ? 'is-display-only' : ''}`}>
          {!displayOnlyMode ? (
            <div className="board-game-selector landing-board-selector-bar">
              <label className="field-block">
                <span>Pool</span>
                <select
                  value={selectedPoolId ?? ''}
                  onChange={(event) => {
                    const value = event.target.value ? Number(event.target.value) : null
                    void handlePoolChange(value)
                  }}
                  disabled={busy === 'loading' || pools.length === 0}
                >
                  <option value="">{pools.length > 0 ? 'Select Pool' : 'No Pools Available'}</option>
                  {pools.map((pool) => (
                    <option key={pool.id} value={pool.id}>
                      {pool.team_name ?? 'Team'} • {pool.pool_name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field-block">
                <span>Week / Game</span>
                <select
                  value={selectedGameId ?? ''}
                  onChange={(event) => {
                    const value = event.target.value ? Number(event.target.value) : null
                    void handleGameChange(value)
                  }}
                  disabled={busy === 'loading' || !selectedPool || games.length === 0}
                >
                  {!selectedPool ? <option value="">Select pool first</option> : null}
                  {selectedPool && games.length === 0 ? <option value="">No games available</option> : null}
                  {selectedPool
                    ? games.map((game) => (
                        <option key={game.id} value={game.id}>
                          {formatGameOption(game, board?.primaryTeam ?? selectedPool.team_name ?? 'Team')}
                        </option>
                      ))
                    : null}
                </select>
              </label>

              {SHOW_SIMULATION_CONTROLS ? (
                <div className="square-toolbar">
                  {showSimulationAdvance ? (
                    <>
                      {canRefreshLiveQuarter ? (
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => void handleSimulationAdvance('live')}
                          disabled={busy !== null || !(simulationStatus?.canAdvance ?? false)}
                        >
                          {busy === 'live-simulation' ? 'Updating...' : 'Update Live Score'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="primary"
                        onClick={() => void handleSimulationAdvance('complete')}
                        disabled={busy !== null || !(simulationStatus?.canAdvance ?? false)}
                      >
                        {busy === 'advance-simulation' ? 'Completing...' : simulationAdvanceLabel}
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedPool && board ? (
            <>
              <div
                className={`pool-board ${displayOnlyMode ? 'is-display-only' : ''}`}
              style={{
                ['--team-primary' as string]: board.teamPrimaryColor ?? primaryBrand.color,
                ['--team-secondary' as string]: board.teamSecondaryColor ?? '#111'
              }}
            >
              <div className="pool-board-header">
                {!displayOnlyMode ? (
                  <button
                    type="button"
                    className="pool-board-nav-arrow"
                    onClick={() => void handleGameChange(previousGameId)}
                    disabled={!previousGameId || busy === 'loading'}
                    aria-label="Previous week"
                    title="Previous week"
                  >
                    ←
                  </button>
                ) : null}
                <div className="pool-board-header-copy">
                  <span className="pool-board-header-title">{`${heroTitle} • ${heroDate}`}</span>
                  {displayOnlyMode ? (
                    <span className="pool-board-header-meta">
                      Auto-refresh every {displayRefreshSeconds}s{lastDisplayRefreshAt ? ` • Updated ${lastDisplayRefreshAt}` : ''}
                    </span>
                  ) : null}
                </div>
                {!displayOnlyMode ? (
                  <button
                    type="button"
                    className="pool-board-nav-arrow"
                    onClick={() => void handleGameChange(nextGameId)}
                    disabled={!nextGameId || busy === 'loading'}
                    aria-label="Next week"
                    title="Next week"
                  >
                    →
                  </button>
                ) : null}
              </div>

              {displayOnlyMode && featuredDisplaySummary ? (
                <section className={`display-scoreboard-spotlight is-${featuredDisplaySummary.status}`} aria-label="Featured live scoreboard">
                  <div className="display-scoreboard-team">
                    <div className="display-scoreboard-team-brand">
                      {primaryTeamLogo ? <img src={primaryTeamLogo} alt={primaryTeamLabel} className="display-scoreboard-team-logo" /> : null}
                      <span className="display-scoreboard-team-name">{primaryTeamLabel}</span>
                    </div>
                    <strong className="display-scoreboard-team-score">{featuredDisplaySummary.primaryScore ?? '—'}</strong>
                  </div>

                  <div className="display-scoreboard-meta">
                    <span className="display-scoreboard-meta-label">{featuredDisplaySummary.label} • {featuredDisplaySummary.status === 'completed' ? 'Winner' : featuredDisplaySummary.status === 'active' ? 'Leader' : 'Pending'}</span>
                    <strong>{featuredDisplaySummary.ownerName}</strong>
                    {featuredDisplaySummary.squareNum != null ? <span>Square {featuredDisplaySummary.squareNum}</span> : null}
                  </div>

                  <div className="display-scoreboard-team is-opponent">
                    <div className="display-scoreboard-team-brand">
                      {opponentTeamLogo ? <img src={opponentTeamLogo} alt={opponentTeamLabel} className="display-scoreboard-team-logo" /> : null}
                      <span className="display-scoreboard-team-name">{opponentTeamLabel}</span>
                    </div>
                    <strong className="display-scoreboard-team-score">{featuredDisplaySummary.opponentScore ?? '—'}</strong>
                  </div>
                </section>
              ) : null}

              <div className="pool-board-main">
                <div className="pool-board-brand">
                  <img src={logoSrc} alt={selectedPool?.team_name ?? 'Football Pool'} />
                </div>

                <div className="pool-board-grid-wrap">
                  <div className="board-axis-title board-axis-top" style={{ backgroundColor: primaryBrand.color, color: primaryBrand.accent }}>
                    {primaryBrand.logo ? <img className="axis-team-logo" src={primaryBrand.logo} alt={primaryTeamLabel} /> : null}
                    <span>{primaryTeamLabel}</span>
                  </div>

                  <div className={`board-top-digits ${showQuarterSummaries ? 'with-quarter-summaries' : ''}`}>
                    {topDigits.map((digit, index) => (
                      <div key={`top-digit-${index}`} className="digit-cell">{digit}</div>
                    ))}
                  </div>

                  <div className={`board-middle ${showQuarterSummaries ? 'with-quarter-summaries' : ''}`}>
                    <div
                      className="board-axis-title board-axis-left"
                      style={selectedGame ? { backgroundColor: opponentBrand.color, color: opponentBrand.accent } : undefined}
                    >
                      {selectedGame && opponentBrand.logo ? <img className="axis-team-logo" src={opponentBrand.logo} alt={opponentTeamLabel} /> : null}
                      <span>{opponentTeamLabel}</span>
                    </div>

                    <div className="board-grid">
                      {boardRows.map((row, rowIndex) => (
                        <div key={`landing-row-${rowIndex}`} className="board-row">
                          <div className="digit-cell digit-row">{leftDigits[rowIndex]}</div>

                          {row.map((square) => {
                            const hasWeekWin = square.current_game_won > 0
                            const hasSeasonWin = square.season_won_total > 0
                            const isCurrentLeader = Boolean(square.is_current_score_leader)
                            const winClass = hasWeekWin ? 'win-3' : hasSeasonWin ? 'win-1' : 'win-0'
                            const winStateClass = hasWeekWin ? 'is-week-win' : hasSeasonWin ? 'is-season-win' : ''
                            const isSelectedSquare = selectedSquare === square.square_num
                            const displayOwnerName = displayOnlyMode
                              ? `${square.participant_first_name ?? ''} ${square.participant_last_name ? `${square.participant_last_name.charAt(0)}.` : ''}`.trim()
                              : ''
                            const displayOwnerLabel = displayOwnerName || square.participant_first_name || square.participant_last_name || 'Assigned'
                            const showPayoutTooltip = !displayOnlyMode && (hasWeekWin || hasSeasonWin || isCurrentLeader)
                            const squareTooltip = showPayoutTooltip
                              ? `${isCurrentLeader ? 'Currently leading • ' : ''}Week: ${formatBoardMoney(square.current_game_won)} • YTD: ${formatBoardMoney(square.season_won_total)}${hasActiveSelection ? ' • Click to manage assignment' : ''}`
                              : undefined

                            return (
                              <button
                                key={square.square_num}
                                type="button"
                                className={`landing-square-card ${square.participant_id ? 'owned' : 'open'} ${square.paid_flg ? 'paid' : ''} ${winClass} ${winStateClass} ${isCurrentLeader ? 'is-current-win' : ''} ${isSelectedSquare ? 'is-selected' : ''} ${hasActiveSelection ? 'is-manageable' : ''}`}
                                onClick={hasActiveSelection ? () => void handleOpenSquareAssignment(square) : undefined}
                                aria-label={squareTooltip}
                              >
                                {square.participant_id ? (
                                  <span className={`square-owner ${displayOnlyMode ? 'is-display-only' : ''}`}>
                                    <span>{displayOnlyMode ? displayOwnerLabel : square.participant_first_name ?? ''}</span>
                                    {!displayOnlyMode ? <span>{square.participant_last_name ?? ''}</span> : null}
                                    {!displayOnlyMode ? <span className="square-player-num">{square.player_jersey_num != null ? `#${square.player_jersey_num}` : ''}</span> : null}
                                  </span>
                                ) : (
                                  <span className="square-open-number">{square.square_num}</span>
                                )}

                                {showPayoutTooltip ? (
                                  <span className="square-hover-tooltip" aria-hidden="true">
                                    <span><strong>Week</strong>{formatBoardMoney(square.current_game_won)}</span>
                                    <span><strong>YTD</strong>{formatBoardMoney(square.season_won_total)}</span>
                                  </span>
                                ) : null}
                              </button>
                            )
                          })}
                        </div>
                      ))}
                    </div>

                    {showQuarterSummaries ? (
                      <aside className="board-quarter-summary-panel" aria-label="Current score winners and leaders">
                        {quarterSummaries.map((summary) => (
                          <article key={summary.id} className={`board-quarter-card is-${summary.status}`}>
                            <div className="board-quarter-card-header">
                              <span>{summary.label}</span>
                              <span className="board-quarter-card-square">{summary.squareNum != null ? `Sq ${summary.squareNum}` : '—'}</span>
                            </div>

                            <div className="board-quarter-scoreline">
                              <div>
                                {primaryTeamLogo ? (
                                  <img src={primaryTeamLogo} alt={primaryTeamLabel} className="quarter-team-logo" />
                                ) : null}
                                <span>{summary.primaryScore ?? '—'}</span>
                              </div>
                              <div>
                                {opponentTeamLogo ? (
                                  <img src={opponentTeamLogo} alt={opponentTeamLabel} className="quarter-team-logo" />
                                ) : null}
                                <span>{summary.opponentScore ?? '—'}</span>
                              </div>
                            </div>

                            <div className="board-quarter-winner">
                              <span className="board-quarter-winner-label">
                                {summary.status === 'completed' ? 'Winner' : summary.status === 'active' ? 'Leader' : 'Pending'}
                              </span>
                              <strong>{summary.ownerName}</strong>
                            </div>
                          </article>
                        ))}
                      </aside>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

              {!displayOnlyMode && board?.payoutSummary ? <PayoutSummaryPanel summary={board.payoutSummary} title="Pool payout schedule" /> : null}
            </>
          ) : (
            <article className="panel">
              <h2>{pools.length > 0 ? 'Select Pool' : 'No Pools Available'}</h2>
              <p className="small">
                {pools.length > 0 ? 'Choose a pool and week above to load the board.' : 'No squares board is available yet.'}
              </p>
            </article>
          )}

          {selectedSquare != null && canManageSquares ? (
            <div className="modal-backdrop" onClick={handleCloseSquareAssignment}>
              <div
                className="modal-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="landing-square-modal-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="modal-header">
                  <h3 id="landing-square-modal-title">Square {selectedSquare}</h3>
                  <button type="button" className="secondary compact" onClick={handleCloseSquareAssignment}>
                    Close
                  </button>
                </div>

                <p className="small">
                  Current owner:{' '}
                  {selectedBoardSquare?.participant_id
                    ? `${selectedBoardSquare.participant_first_name ?? ''} ${selectedBoardSquare.participant_last_name ?? ''}`.trim() || `User #${selectedBoardSquare.participant_id}`
                    : 'Unassigned'}
                </p>

                <form onSubmit={handleAssignSquare} className="assign-form modal-assign-form">
                  <select
                    value={assignForm.participantId}
                    onChange={(event) => setAssignForm((current) => ({ ...current, participantId: event.target.value }))}
                    disabled={busy !== null}
                  >
                    <option value="">Unassigned participant</option>
                    {participantOptions.map((user) => (
                      <option key={user.id} value={user.id}>
                        {formatUserName(user)}
                      </option>
                    ))}
                  </select>

                  {showMemberSelector ? (
                    <select
                      value={assignForm.playerId}
                      onChange={(event) => setAssignForm((current) => ({ ...current, playerId: event.target.value }))}
                      disabled={busy !== null}
                    >
                      <option value="">No member</option>
                      {playerOptions.map((player) => (
                        <option key={player.id} value={player.id}>
                          {formatPlayerName(player)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="small">
                      {poolTracksMembers
                        ? 'No members are available for this organization yet.'
                        : 'This organization is configured without tracked members.'}
                    </p>
                  )}

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={assignForm.paidFlg}
                      onChange={(event) => setAssignForm((current) => ({ ...current, paidFlg: event.target.checked }))}
                      disabled={busy !== null}
                    />
                    Mark as paid
                  </label>

                  <div className="modal-actions">
                    <button
                      className="secondary"
                      type="button"
                      onClick={handleClearSquareAssignment}
                      disabled={busy !== null || !selectedPoolId}
                    >
                      {busy === 'clear-square' ? 'Clearing...' : 'Clear square'}
                    </button>
                    <button className="primary" type="submit" disabled={busy !== null || !selectedPoolId}>
                      {busy === 'assign-square' ? 'Saving...' : 'Save assignment'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
        </section>
      ) : activePage === 'Metrics' ? (
        <LandingMetrics
          pools={pools}
          token={token}
          authHeaders={authHeaders}
          apiBase={API_BASE}
          selectedPoolId={selectedPoolId}
          onSelectPool={handlePoolChange}
          onRequireSignIn={() => setShowLogin(true)}
        />
      ) : activePage === 'Notifications' ? (
        <LandingNotificationTemplates
          pools={pools}
          token={token}
          authHeaders={authHeaders}
          apiBase={API_BASE}
          onRequireSignIn={() => setShowLogin(true)}
        />
      ) : activePage === 'Players' ? (
        <LandingPlayerMaintenance
          pools={pools}
          token={token}
          authHeaders={authHeaders}
          apiBase={API_BASE}
          onRequireSignIn={() => setShowLogin(true)}
        />
      ) : activePage === 'Teams' ? (
        <LandingTeamMaintenance
          pools={pools}
          token={token}
          authHeaders={authHeaders}
          apiBase={API_BASE}
          onRequireSignIn={() => setShowLogin(true)}
        />
      ) : activePage === 'Pools' ? (
        <LandingPoolMaintenance
          pools={pools}
          token={token}
          authHeaders={authHeaders}
          apiBase={API_BASE}
          onRequireSignIn={() => setShowLogin(true)}
        />
      ) : activePage === 'Schedules' ? (
        <LandingScheduleMaintenance
          pools={pools}
          token={token}
          authHeaders={authHeaders}
          apiBase={API_BASE}
          onRequireSignIn={() => setShowLogin(true)}
        />
      ) : activePage === 'Users' ? (
        <LandingUserMaintenance
          pools={pools}
          token={token}
          authHeaders={authHeaders}
          apiBase={API_BASE}
          onRequireSignIn={() => setShowLogin(true)}
          onOpenPlayerMaintenance={() => setActivePage('Players')}
        />
      ) : (
        <section className="landing-placeholder-card">
          <div className="landing-hero-bar is-empty">
            <div>
              <p className="landing-eyebrow">Coming Soon</p>
              <h1>{activePage}</h1>
              <p>This section is not wired up yet. Use `Squares`, `Notifications`, `Players`, `Pools`, or `Users` for now.</p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
