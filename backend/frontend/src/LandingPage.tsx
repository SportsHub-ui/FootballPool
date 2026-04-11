import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { LandingMetrics } from './LandingMetrics'
import { LandingMarketingMaintenance } from './LandingMarketingMaintenance'
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
  home_team_name?: string | null
  home_team_primary_color?: string | null
  home_team_logo_url?: string | null
  away_team_name?: string | null
  away_team_primary_color?: string | null
  away_team_logo_url?: string | null
  opponent: string
  game_dt: string
  state?: string | null
  current_quarter?: number | null
  time_remaining_in_quarter?: string | null
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
  q5_primary_score: number | null
  q5_opponent_score: number | null
  q6_primary_score: number | null
  q6_opponent_score: number | null
  q7_primary_score: number | null
  q7_opponent_score: number | null
  q8_primary_score: number | null
  q8_opponent_score: number | null
  q9_primary_score: number | null
  q9_opponent_score: number | null
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

type AuthUser = {
  id: number
  userId?: string
  firstName: string | null
  lastName: string | null
  email: string | null
  role: string
  isAdmin: boolean
  managedOrganizationIds?: number[]
  accessibleOrganizationIds?: number[]
  permissions?: {
    canManageOrganizations?: boolean
    canManageMembers?: boolean
    canManagePools?: boolean
    canManageNotifications?: boolean
    canManageMarketing?: boolean
    canManageUsers?: boolean
    canApproveOrgAccess?: boolean
    canRunSimulation?: boolean
    canViewMetrics?: boolean
  }
}

type LoginResponse = {
  token?: string
  user: AuthUser
  message?: string
}

type DisplayBoardLaunchResponse = {
  displayOnly: boolean
  pool: LandingPool | null
  games: LandingGame[]
  selectedGameId: number | null
  board: LandingBoard | null
  displayAds?: DisplayAdItem[]
  displayAdSettings?: Partial<DisplayAdSettings> | null
  postgameRotationSeconds?: number | null
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

type DisplayAdPlacement = 'sidebar' | 'banner'

type DisplayAdItem = {
  id: string | number
  title: string
  body?: string
  footer?: string
  imageUrl?: string
  accentColor?: string
  placement?: DisplayAdPlacement
  label?: string
}

type DisplayAdSettings = {
  adsEnabled: boolean
  frequencySeconds: number
  durationSeconds: number
  shrinkPercent: number
  sidebarCount: number
  bannerCount: number
  defaultBannerMessage: string
  hideAdsForOrganization: boolean
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
const DEFAULT_DISPLAY_AD_SETTINGS: DisplayAdSettings = {
  adsEnabled: false,
  frequencySeconds: 180,
  durationSeconds: 30,
  shrinkPercent: 80,
  sidebarCount: 1,
  bannerCount: 1,
  defaultBannerMessage: '',
  hideAdsForOrganization: false
}

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

const parseHexColor = (value: string | null | undefined): { r: number; g: number; b: number } | null => {
  const cleaned = String(value ?? '').trim().replace(/^#/, '')

  if (/^[0-9a-fA-F]{3}$/.test(cleaned)) {
    return {
      r: Number.parseInt(`${cleaned[0]}${cleaned[0]}`, 16),
      g: Number.parseInt(`${cleaned[1]}${cleaned[1]}`, 16),
      b: Number.parseInt(`${cleaned[2]}${cleaned[2]}`, 16)
    }
  }

  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) {
    return null
  }

  return {
    r: Number.parseInt(cleaned.slice(0, 2), 16),
    g: Number.parseInt(cleaned.slice(2, 4), 16),
    b: Number.parseInt(cleaned.slice(4, 6), 16)
  }
}

const getRelativeLuminance = (channel: number): number => {
  const normalized = channel / 255
  return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
}

const getContrastRatio = (backgroundColor: string | null | undefined, foregroundColor: string | null | undefined): number | null => {
  const background = parseHexColor(backgroundColor)
  const foreground = parseHexColor(foregroundColor)

  if (!background || !foreground) {
    return null
  }

  const backgroundLuminance =
    0.2126 * getRelativeLuminance(background.r) +
    0.7152 * getRelativeLuminance(background.g) +
    0.0722 * getRelativeLuminance(background.b)
  const foregroundLuminance =
    0.2126 * getRelativeLuminance(foreground.r) +
    0.7152 * getRelativeLuminance(foreground.g) +
    0.0722 * getRelativeLuminance(foreground.b)

  const lighter = Math.max(backgroundLuminance, foregroundLuminance)
  const darker = Math.min(backgroundLuminance, foregroundLuminance)

  return (lighter + 0.05) / (darker + 0.05)
}

const getReadableTextColor = (backgroundColor: string | null | undefined, preferredColor: string | null | undefined): string => {
  const preferred = String(preferredColor ?? '').trim()
  const preferredContrast = getContrastRatio(backgroundColor, preferred)

  if (preferred && preferredContrast != null && preferredContrast >= 4.5) {
    return preferred
  }

  const darkCandidate = '#111827'
  const lightCandidate = '#FFFFFF'
  const darkContrast = getContrastRatio(backgroundColor, darkCandidate) ?? 0
  const lightContrast = getContrastRatio(backgroundColor, lightCandidate) ?? 0

  return lightContrast >= darkContrast ? lightCandidate : darkCandidate
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
    return {
      ...match,
      accent: getReadableTextColor(match.color, match.accent)
    }
  }

  return {
    key: teamName,
    color: fallbackColor,
    accent: getReadableTextColor(fallbackColor, fallbackAccent),
    logo: fallbackLogo ?? ''
  }
}

const normalizeTeamKey = (value: string | null | undefined): string =>
  String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

const resolveMatchupBranding = (
  game: LandingGame | null | undefined,
  primaryTeamName: string | null | undefined
): {
  primaryColor: string | null
  primaryLogo: string | null
  opponentColor: string | null
  opponentLogo: string | null
} => {
  const normalizedPrimary = normalizeTeamKey(primaryTeamName)
  const normalizedHome = normalizeTeamKey(game?.home_team_name)
  const normalizedAway = normalizeTeamKey(game?.away_team_name)

  if (normalizedPrimary && normalizedAway === normalizedPrimary && normalizedHome !== normalizedPrimary) {
    return {
      primaryColor: game?.away_team_primary_color ?? null,
      primaryLogo: game?.away_team_logo_url ?? null,
      opponentColor: game?.home_team_primary_color ?? null,
      opponentLogo: game?.home_team_logo_url ?? null
    }
  }

  return {
    primaryColor: game?.home_team_primary_color ?? null,
    primaryLogo: game?.home_team_logo_url ?? null,
    opponentColor: game?.away_team_primary_color ?? null,
    opponentLogo: game?.away_team_logo_url ?? null
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

const normalizeDisplayAdSettings = (
  value?: Partial<DisplayAdSettings> | null,
  items?: DisplayAdItem[] | null
): DisplayAdSettings => {
  const adItems = Array.isArray(items) ? items : []
  const inferredSidebarCount = Math.min(4, Math.max(1, adItems.filter((item) => (item.placement ?? 'sidebar') === 'sidebar').length || 1))
  const inferredBannerCount = Math.min(6, Math.max(1, adItems.filter((item) => item.placement === 'banner').length || 1))

  return {
    adsEnabled: Boolean(value?.adsEnabled ?? DEFAULT_DISPLAY_AD_SETTINGS.adsEnabled),
    frequencySeconds: Math.min(
      3600,
      Math.max(15, Number(value?.frequencySeconds ?? DEFAULT_DISPLAY_AD_SETTINGS.frequencySeconds) || DEFAULT_DISPLAY_AD_SETTINGS.frequencySeconds)
    ),
    durationSeconds: Math.min(
      600,
      Math.max(5, Number(value?.durationSeconds ?? DEFAULT_DISPLAY_AD_SETTINGS.durationSeconds) || DEFAULT_DISPLAY_AD_SETTINGS.durationSeconds)
    ),
    shrinkPercent: Math.min(
      95,
      Math.max(50, Number(value?.shrinkPercent ?? DEFAULT_DISPLAY_AD_SETTINGS.shrinkPercent) || DEFAULT_DISPLAY_AD_SETTINGS.shrinkPercent)
    ),
    sidebarCount: Math.min(
      4,
      Math.max(
        0,
        Number(
          value?.sidebarCount ?? (adItems.some((item) => (item.placement ?? 'sidebar') === 'sidebar') ? inferredSidebarCount : DEFAULT_DISPLAY_AD_SETTINGS.sidebarCount)
        ) || 0
      )
    ),
    bannerCount: Math.min(
      6,
      Math.max(
        0,
        Number(
          value?.bannerCount ?? (adItems.some((item) => item.placement === 'banner') ? inferredBannerCount : DEFAULT_DISPLAY_AD_SETTINGS.bannerCount)
        ) || 0
      )
    ),
    defaultBannerMessage: (value?.defaultBannerMessage ?? DEFAULT_DISPLAY_AD_SETTINGS.defaultBannerMessage).toString().trim(),
    hideAdsForOrganization: Boolean(value?.hideAdsForOrganization ?? DEFAULT_DISPLAY_AD_SETTINGS.hideAdsForOrganization)
  }
}

const normalizeDisplayAdItems = (value?: DisplayAdItem[] | null): DisplayAdItem[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item, index) => ({
      id: item.id ?? `display-ad-${index}`,
      title: (item.title ?? '').toString().trim(),
      body: item.body?.toString().trim() || undefined,
      footer: item.footer?.toString().trim() || undefined,
      imageUrl: item.imageUrl?.toString().trim() || undefined,
      accentColor: item.accentColor?.toString().trim() || undefined,
      placement: (item.placement === 'banner' ? 'banner' : 'sidebar') as DisplayAdPlacement,
      label: item.label?.toString().trim() || undefined
    }))
    .filter((item) => item.title)
}

const buildDisplayAdWindow = (items: DisplayAdItem[], count: number, startIndex: number): DisplayAdItem[] => {
  if (count <= 0 || items.length === 0) {
    return []
  }

  if (items.length <= count) {
    return items.slice(0, count)
  }

  return Array.from({ length: Math.min(count, items.length) }, (_, offset) => items[(startIndex + offset) % items.length])
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

function DisplayAdCard({ ad, compact = false }: { ad: DisplayAdItem; compact?: boolean }) {
  const imageSrc = ad.imageUrl ? resolveImageUrl(ad.imageUrl) : ''
  const adLabel = ad.label?.trim() || 'Sponsored'
  const placeholderText = adLabel === 'Pool message' ? 'INFO' : 'AD'

  return (
    <article
      className={`display-ad-card ${compact ? 'is-compact' : ''}`}
      style={{ ['--display-ad-accent' as string]: ad.accentColor ?? '#ffd54f' }}
    >
      {imageSrc ? (
        <div className="display-ad-card-visual">
          <img src={imageSrc} alt={ad.title} className="display-ad-card-image" />
        </div>
      ) : (
        <div className="display-ad-card-visual is-placeholder">
          <span>{placeholderText}</span>
        </div>
      )}

      <div className="display-ad-card-copy">
        <span className="display-ad-card-label">{adLabel}</span>
        <strong className="display-ad-card-title">{ad.title}</strong>
        {ad.body ? <p className="display-ad-card-body">{ad.body}</p> : null}
        {ad.footer ? <span className="display-ad-card-footer">{ad.footer}</span> : null}
      </div>
    </article>
  )
}

const isCompletedGame = (game: LandingGame | null): boolean => {
  if (!game) return false

  const normalizedState = String(game.state ?? '').trim().toLowerCase()
  if (['completed', 'complete', 'closed', 'finished', 'final', 'post'].includes(normalizedState)) {
    return true
  }

  if (normalizedState) {
    return false
  }

  return game.q9_primary_score !== null && game.q9_opponent_score !== null
}

const isLiveGame = (game: LandingGame | null): boolean => {
  if (!game) return false

  const normalizedState = String(game.state ?? '').trim().toLowerCase()
  if (
    [
      'in_progress',
      'in progress',
      'live',
      'active',
      'ongoing',
      'underway',
      'midgame',
      'halftime',
      'delayed',
      'delay',
      'rain_delay',
      'rain delay',
      'suspended'
    ].includes(normalizedState)
  ) {
    return true
  }

  return !isCompletedGame(game) && getLatestScoredQuarter(game) !== null
}

const getLatestScoredQuarter = (game: LandingGame | null): number | null => {
  if (!game) return null
  if (game.q9_primary_score !== null || game.q9_opponent_score !== null) return 9
  if (game.q8_primary_score !== null || game.q8_opponent_score !== null) return 8
  if (game.q7_primary_score !== null || game.q7_opponent_score !== null) return 7
  if (game.q6_primary_score !== null || game.q6_opponent_score !== null) return 6
  if (game.q5_primary_score !== null || game.q5_opponent_score !== null) return 5
  if (game.q4_primary_score !== null || game.q4_opponent_score !== null) return 4
  if (game.q3_primary_score !== null || game.q3_opponent_score !== null) return 3
  if (game.q2_primary_score !== null || game.q2_opponent_score !== null) return 2
  if (game.q1_primary_score !== null || game.q1_opponent_score !== null) return 1
  return null
}

const getQuarterScores = (
  game: LandingGame,
  quarter: number
): { primaryScore: number | null; opponentScore: number | null } => {
  if (quarter === 1) return { primaryScore: game.q1_primary_score, opponentScore: game.q1_opponent_score }
  if (quarter === 2) return { primaryScore: game.q2_primary_score, opponentScore: game.q2_opponent_score }
  if (quarter === 3) return { primaryScore: game.q3_primary_score, opponentScore: game.q3_opponent_score }
  if (quarter === 4) return { primaryScore: game.q4_primary_score, opponentScore: game.q4_opponent_score }
  if (quarter === 5) return { primaryScore: game.q5_primary_score, opponentScore: game.q5_opponent_score }
  if (quarter === 6) return { primaryScore: game.q6_primary_score, opponentScore: game.q6_opponent_score }
  if (quarter === 7) return { primaryScore: game.q7_primary_score, opponentScore: game.q7_opponent_score }
  if (quarter === 8) return { primaryScore: game.q8_primary_score, opponentScore: game.q8_opponent_score }
  return { primaryScore: game.q9_primary_score, opponentScore: game.q9_opponent_score }
}

const getDisplayQuarterScores = (
  game: LandingGame,
  quarter: number,
  currentQuarter?: number | null
): { primaryScore: number | null; opponentScore: number | null } => {
  const normalizedCurrentQuarter = Number(currentQuarter ?? 0) || null

  if (!isCompletedGame(game) && normalizedCurrentQuarter != null && quarter > normalizedCurrentQuarter) {
    return { primaryScore: null, opponentScore: null }
  }

  let primaryScore: number | null = null
  let opponentScore: number | null = null
  const cappedQuarter = Math.min(Math.max(quarter, 1), 9)

  for (let index = 1; index <= cappedQuarter; index += 1) {
    const scoreEntry = getQuarterScores(game, index)
    if (scoreEntry.primaryScore != null) primaryScore = scoreEntry.primaryScore
    if (scoreEntry.opponentScore != null) opponentScore = scoreEntry.opponentScore
  }

  return { primaryScore, opponentScore }
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
  const weekLabel = game.week_num != null ? `Game ${game.week_num} • ` : ''
  const isByeWeek = game.opponent.trim().toUpperCase() === 'BYE'
  const finalQuarter = getLatestScoredQuarter(game)
  const finalScores = finalQuarter != null ? getQuarterScores(game, finalQuarter) : { primaryScore: null, opponentScore: null }

  if (isCompletedGame(game) && finalScores.primaryScore != null && finalScores.opponentScore != null) {
    return `${weekLabel}${dateLabel} • ${primaryTeam} ${finalScores.primaryScore}-${finalScores.opponentScore} ${game.opponent}`
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

  const liveGame = games.find((game) => isLiveGame(game))
  if (liveGame) {
    return liveGame.id
  }

  if (simulationCurrentGameId && games.some((game) => game.id === simulationCurrentGameId)) {
    return simulationCurrentGameId
  }

  const recentScoredGame = [...games].reverse().find((game) => getLatestScoredQuarter(game) != null)

  if (recentScoredGame) {
    return recentScoredGame.id
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
  const [token, setToken] = useState<string | null>(null)
  const [authUser, setAuthUser] = useState<AuthUser | null>(null)
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
  const [activePage, setActivePage] = useState<'Squares' | 'Metrics' | 'Marketing' | 'Notifications' | 'Players' | 'Teams' | 'Pools' | 'Schedules' | 'Users'>('Squares')
  const [busy, setBusy] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [pageNotice, setPageNotice] = useState<string | null>(null)
  const [displayAdVisible, setDisplayAdVisible] = useState(false)
  const [activeDisplayAdIndex, setActiveDisplayAdIndex] = useState(0)
  const [displayAdItems, setDisplayAdItems] = useState<DisplayAdItem[]>([])
  const [displayAdSettings, setDisplayAdSettings] = useState<DisplayAdSettings>(DEFAULT_DISPLAY_AD_SETTINGS)
  const [postgameRotationSeconds, setPostgameRotationSeconds] = useState<number | null>(null)
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [pools, setPools] = useState<LandingPool[]>([])
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null)
  const [games, setGames] = useState<LandingGame[]>([])
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [board, setBoard] = useState<LandingBoard | null>(null)
  const [selectedSquare, setSelectedSquare] = useState<number | null>(null)
  const [selectedSquares, setSelectedSquares] = useState<number[]>([])
  const [showSquareAssignmentModal, setShowSquareAssignmentModal] = useState(false)
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

  const authHeaders = useMemo(() => ({ 'Content-Type': 'application/json' }), [])

  const simulationHeaders = useMemo(() => authHeaders, [authHeaders])

  const verifySession = async (): Promise<void> => {
    if (displayOnlyMode) {
      return
    }

    try {
      const response = await fetch(`${API_BASE}/api/auth/verify`, { credentials: 'include' })

      if (!response.ok) {
        setToken(null)
        setAuthUser(null)
        return
      }

      const data = await response.json().catch(() => null)
      if (data?.authenticated && data.user) {
        setToken('session-authenticated')
        setAuthUser(data.user as AuthUser)
      } else {
        setToken(null)
        setAuthUser(null)
      }
    } catch {
      setToken(null)
      setAuthUser(null)
    }
  }

  const loadBoard = async (poolId: number, gameId: number | null): Promise<void> => {
    const query = gameId ? `?gameId=${gameId}` : ''
    const response = await fetch(`${API_BASE}/api/landing/pools/${poolId}/board${query}`, {
      headers: authHeaders,
      credentials: 'include'
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
        headers: simulationHeaders,
        credentials: 'include'
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
    setSelectedSquares([])
    setShowSquareAssignmentModal(false)

    try {
      const response = await fetch(`${API_BASE}/api/landing/pools/${poolId}/games`, {
        headers: authHeaders,
        credentials: 'include'
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
        headers: authHeaders,
        credentials: 'include'
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
      setSelectedSquares([])
      setShowSquareAssignmentModal(false)
    }

    try {
      const response = await fetch(`${API_BASE}/api/landing/display/${encodeURIComponent(displayCode)}`, {
        headers: authHeaders,
        credentials: 'include'
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(getApiErrorMessage(data, 'Failed to load display board'))
      }

      const launch = data as DisplayBoardLaunchResponse
      const linkedPool = launch.pool ?? null
      const nextDisplayAdItems = normalizeDisplayAdItems(launch.displayAds)
      const nextDisplayAdSettings = normalizeDisplayAdSettings(launch.displayAdSettings, nextDisplayAdItems)
      const nextDisplayFallbackEnabled = Boolean(nextDisplayAdSettings.defaultBannerMessage) && nextDisplayAdSettings.bannerCount > 0
      const nextDisplayAdInventoryCount = nextDisplayAdItems.length + (nextDisplayFallbackEnabled ? 1 : 0)

      setPools(linkedPool ? [linkedPool] : [])
      setSelectedPoolId(linkedPool?.id ?? null)
      setGames(launch.games ?? [])
      setSelectedGameId(launch.selectedGameId ?? null)
      setBoard(launch.board ?? null)
      setDisplayAdItems(nextDisplayAdItems)
      setDisplayAdSettings(nextDisplayAdSettings)
      setPostgameRotationSeconds(
        typeof launch.postgameRotationSeconds === 'number' && Number.isFinite(launch.postgameRotationSeconds)
          ? Math.max(5, Math.floor(launch.postgameRotationSeconds))
          : null
      )
      setActiveDisplayAdIndex((current) => (nextDisplayAdInventoryCount > 0 ? current % nextDisplayAdInventoryCount : 0))
      if (!nextDisplayAdSettings.adsEnabled || nextDisplayAdSettings.hideAdsForOrganization || nextDisplayAdInventoryCount === 0) {
        setDisplayAdVisible(false)
      }
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
        setDisplayAdItems([])
        setDisplayAdSettings(DEFAULT_DISPLAY_AD_SETTINGS)
        setDisplayAdVisible(false)
        setPostgameRotationSeconds(null)
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
      const response = await fetch(`${API_BASE}/api/landing/pools`, { headers: authHeaders, credentials: 'include' })

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
    void verifySession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayOnlyMode])

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
      const effectiveDisplayRefreshSeconds = postgameRotationSeconds != null
        ? Math.max(5, Math.min(displayRefreshSeconds, postgameRotationSeconds))
        : displayRefreshSeconds

      intervalId = window.setInterval(() => {
        void loadDisplayBoard(displayToken, { quiet: true })
      }, effectiveDisplayRefreshSeconds * 1000)
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
  }, [activePage, board?.gameId, displayOnlyMode, displayRefreshSeconds, displayToken, games, postgameRotationSeconds, selectedGameId, selectedPoolId, token])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }

    const rootElement = document.documentElement
    const bodyElement = document.body

    if (displayOnlyMode) {
      rootElement.classList.add('kiosk-display-mode')
      bodyElement.classList.add('kiosk-display-mode')
    } else {
      rootElement.classList.remove('kiosk-display-mode')
      bodyElement.classList.remove('kiosk-display-mode')
    }

    return () => {
      rootElement.classList.remove('kiosk-display-mode')
      bodyElement.classList.remove('kiosk-display-mode')
    }
  }, [displayOnlyMode])

  useEffect(() => {
    const hasFallbackBannerMessage = Boolean(displayAdSettings.defaultBannerMessage?.trim()) && displayAdSettings.bannerCount > 0
    const totalDisplayAdWindows = displayAdItems.length + (hasFallbackBannerMessage ? 1 : 0)

    if (
      typeof window === 'undefined' ||
      !displayOnlyMode ||
      !displayAdSettings.adsEnabled ||
      displayAdSettings.hideAdsForOrganization ||
      totalDisplayAdWindows === 0
    ) {
      setDisplayAdVisible(false)
      setActiveDisplayAdIndex(0)
      return
    }

    let showTimer: number | null = null
    let hideTimer: number | null = null
    let cancelled = false

    const scheduleNextAdWindow = () => {
      showTimer = window.setTimeout(() => {
        if (cancelled) {
          return
        }

        setDisplayAdVisible(true)

        hideTimer = window.setTimeout(() => {
          if (cancelled) {
            return
          }

          setDisplayAdVisible(false)
          setActiveDisplayAdIndex((current) => (current + 1) % totalDisplayAdWindows)
          scheduleNextAdWindow()
        }, displayAdSettings.durationSeconds * 1000)
      }, displayAdSettings.frequencySeconds * 1000)
    }

    scheduleNextAdWindow()

    return () => {
      cancelled = true

      if (showTimer != null) {
        window.clearTimeout(showTimer)
      }

      if (hideTimer != null) {
        window.clearTimeout(hideTimer)
      }
    }
  }, [
    displayAdItems.length,
    displayAdSettings.adsEnabled,
    displayAdSettings.bannerCount,
    displayAdSettings.defaultBannerMessage,
    displayAdSettings.durationSeconds,
    displayAdSettings.frequencySeconds,
    displayAdSettings.hideAdsForOrganization,
    displayOnlyMode
  ])

  const completePasswordResetWithToken = async (resetToken: string): Promise<boolean> => {
    if (typeof window === 'undefined') {
      return false
    }

    const password = window.prompt('Enter a new strong password (12+ characters with upper/lowercase letters, a number, and a symbol).') ?? ''
    if (!password) {
      return false
    }

    const confirmPassword = window.prompt('Confirm the new password.') ?? ''
    if (!confirmPassword) {
      return false
    }

    setBusy('reset-password')
    setLoginError(null)

    try {
      const response = await fetch(`${API_BASE}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ token: resetToken, password, confirmPassword })
      })

      const data = await response.json().catch(() => ({})) as LoginResponse & { error?: string; message?: string }
      if (!response.ok || !data.user) {
        throw new Error(data.error ?? data.message ?? 'Failed to set the password.')
      }

      setToken('session-authenticated')
      setAuthUser(data.user)
      setShowLogin(false)
      setPageNotice(data.message ?? 'Your password was updated successfully.')
      setLoginForm({ email: '', password: '' })
      return true
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Failed to set the password.')
      return false
    } finally {
      setBusy(null)
    }
  }

  const handlePasswordResetFlow = async (): Promise<void> => {
    if (typeof window === 'undefined') {
      return
    }

    const email = window.prompt('Enter the email address for the account you want to set or reset.')?.trim() ?? ''
    if (!email) {
      return
    }

    setBusy('forgot-password')
    setLoginError(null)

    try {
      const response = await fetch(`${API_BASE}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email })
      })

      const data = await response.json().catch(() => ({})) as { error?: string; message?: string; resetToken?: string }
      if (!response.ok) {
        throw new Error(data.error ?? data.message ?? 'Failed to start the password reset flow.')
      }

      setPageNotice(data.message ?? 'If that account exists, password setup instructions were generated.')

      if (data.resetToken) {
        await completePasswordResetWithToken(data.resetToken)
      }
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Failed to start the password reset flow.')
    } finally {
      setBusy(null)
    }
  }

  const handleRequestAccessFlow = async (): Promise<void> => {
    if (typeof window === 'undefined') {
      return
    }

    setBusy('request-access')
    setLoginError(null)

    try {
      const orgResponse = await fetch(`${API_BASE}/api/auth/organizations`, { credentials: 'include' })
      const orgData = await orgResponse.json().catch(() => ({ organizations: [] })) as {
        organizations?: Array<{ id: number; team_name: string | null }>
      }

      if (!orgResponse.ok) {
        throw new Error('Failed to load organizations for the access request flow.')
      }

      const organizations = Array.isArray(orgData.organizations) ? orgData.organizations : []
      const orgListing = organizations.map((org) => `${org.id}: ${org.team_name ?? `Organization ${org.id}`}`).join('\n')

      const firstName = window.prompt('First name')?.trim() ?? ''
      const lastName = window.prompt('Last name')?.trim() ?? ''
      const email = window.prompt('Email address')?.trim() ?? ''
      const phone = window.prompt('Phone number (optional)')?.trim() ?? ''
      const organizationIdValue = window.prompt(`Enter the organization ID you want access to:\n\n${orgListing || 'No organizations are currently available.'}`)?.trim() ?? ''
      const requestNote = window.prompt('Add a short note for the organization manager (optional).')?.trim() ?? ''

      const organizationId = Number(organizationIdValue)
      if (!firstName || !lastName || !email || !Number.isFinite(organizationId) || organizationId <= 0) {
        throw new Error('First name, last name, email, and a valid organization ID are required.')
      }

      const response = await fetch(`${API_BASE}/api/auth/request-access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          firstName,
          lastName,
          email,
          phone: phone || undefined,
          organizationId,
          requestNote: requestNote || undefined
        })
      })

      const data = await response.json().catch(() => ({})) as { error?: string; message?: string; resetToken?: string }
      if (!response.ok) {
        throw new Error(data.error ?? data.message ?? 'Failed to submit the access request.')
      }

      setPageNotice(data.message ?? 'Your access request has been submitted.')
      if (data.resetToken) {
        await completePasswordResetWithToken(data.resetToken)
      }
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Failed to submit the access request.')
    } finally {
      setBusy(null)
    }
  }

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy('login')
    setLoginError(null)

    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(loginForm)
      })

      const data = await response.json().catch(() => ({})) as LoginResponse & { error?: string; message?: string }

      if (!response.ok || !data.user) {
        throw new Error(data.error ?? data.message ?? 'Login failed')
      }

      setToken('session-authenticated')
      setAuthUser(data.user)
      setShowLogin(false)
      setLoginForm({ email: '', password: '' })
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : 'Login failed')
    } finally {
      setBusy(null)
    }
  }

  const handleLogout = async () => {
    try {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      })
    } catch {
      // ignore sign-out transport errors and clear local state anyway
    }

    setToken(null)
    setAuthUser(null)
    setShowLogin(false)
    setLoginError(null)
    setSelectedSquare(null)
    setSelectedSquares([])
    setShowSquareAssignmentModal(false)
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
      setSelectedSquare(null)
      setSelectedSquares([])
      setShowSquareAssignmentModal(false)
      setSimulationStatus(null)
      return
    }

    await loadPoolContext(poolId)
  }

  const handleGameChange = async (gameId: number | null) => {
    setSelectedGameId(gameId)
    setSelectedSquare(null)
    setSelectedSquares([])
    setShowSquareAssignmentModal(false)

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
      fetch(`${API_BASE}/api/setup/users`, { headers: authHeaders, credentials: 'include' }),
      fetch(`${API_BASE}/api/setup/pools/${poolId}/players`, { headers: authHeaders, credentials: 'include' })
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

  const handleToggleSquareSelection = async (square: LandingBoardSquare) => {
    if (!token) {
      setShowLogin(true)
      return
    }

    if (!selectedPoolId) {
      return
    }

    const isSelected = selectedSquares.includes(square.square_num)
    const nextSelection = isSelected
      ? selectedSquares.filter((value) => value !== square.square_num)
      : [...selectedSquares, square.square_num].sort((left, right) => left - right)
    const nextPrimarySquare = isSelected ? (nextSelection[0] ?? null) : square.square_num

    setSelectedSquares(nextSelection)
    setSelectedSquare(nextPrimarySquare)
    setShowSquareAssignmentModal(false)
    setAssignForm({
      participantId: square.participant_id != null ? String(square.participant_id) : '',
      playerId: square.player_id != null ? String(square.player_id) : '',
      paidFlg: Boolean(square.paid_flg),
      reassign: false
    })
    setPageError(null)

    if (participantOptions.length > 0 || playerOptions.length > 0) {
      return
    }

    setBusy('square-options')

    try {
      await loadSquareOptions(selectedPoolId)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Failed to load square assignment options')
      setSelectedSquare(null)
      setSelectedSquares([])
    } finally {
      setBusy(null)
    }
  }

  const handleOpenSelectedSquareAssignment = async () => {
    if (!token) {
      setShowLogin(true)
      return
    }

    if (!selectedPoolId || selectedSquares.length === 0) {
      setPageError('Select one or more squares first')
      return
    }

    setShowSquareAssignmentModal(true)
    setPageError(null)

    if (participantOptions.length > 0 || playerOptions.length > 0) {
      return
    }

    setBusy('square-options')

    try {
      await loadSquareOptions(selectedPoolId)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Failed to load square assignment options')
      setShowSquareAssignmentModal(false)
    } finally {
      setBusy(null)
    }
  }

  const handleCloseSquareAssignment = () => {
    setShowSquareAssignmentModal(false)
    setSelectedSquare(null)
    setSelectedSquares([])
  }

  const handleAssignSquare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedPoolId || selectedSquares.length === 0) {
      setPageError('Select one or more squares first')
      return
    }

    setBusy('assign-square')
    setPageError(null)

    try {
      for (const squareNum of selectedSquares) {
        const response = await fetch(`${API_BASE}/api/setup/pools/${selectedPoolId}/squares/${squareNum}`, {
          method: 'PATCH',
          headers: authHeaders,
          credentials: 'include',
          body: JSON.stringify({
            participantId: assignForm.participantId ? Number(assignForm.participantId) : null,
            playerId: assignForm.playerId ? Number(assignForm.playerId) : null,
            paidFlg: assignForm.paidFlg,
            reassign: assignForm.reassign
          })
        })

        const data = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(getApiErrorMessage(data, `Failed to update square ${squareNum}`))
        }
      }

      await loadBoard(selectedPoolId, selectedGameId)
      setPageNotice(selectedSquares.length > 1 ? `Updated ${selectedSquares.length} squares.` : `Updated square ${selectedSquares[0]}.`)
      setShowSquareAssignmentModal(false)
      setSelectedSquare(null)
      setSelectedSquares([])
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Failed to update square assignment')
    } finally {
      setBusy(null)
    }
  }

  const handleClearSquareAssignment = async () => {
    if (!selectedPoolId || selectedSquares.length === 0) {
      setPageError('Select one or more squares first')
      return
    }

    setBusy('clear-square')
    setPageError(null)

    try {
      for (const squareNum of selectedSquares) {
        const response = await fetch(`${API_BASE}/api/setup/pools/${selectedPoolId}/squares/${squareNum}`, {
          method: 'PATCH',
          headers: authHeaders,
          credentials: 'include',
          body: JSON.stringify({
            participantId: null,
            playerId: null,
            paidFlg: false,
            reassign: true
          })
        })

        const data = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(getApiErrorMessage(data, `Failed to clear square ${squareNum}`))
        }
      }

      setAssignForm({
        participantId: '',
        playerId: '',
        paidFlg: false,
        reassign: false
      })
      await loadBoard(selectedPoolId, selectedGameId)
      setPageNotice(selectedSquares.length > 1 ? `Cleared ${selectedSquares.length} squares.` : `Cleared square ${selectedSquares[0]}.`)
      setShowSquareAssignmentModal(false)
      setSelectedSquare(null)
      setSelectedSquares([])
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
        headers: simulationHeaders,
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

  const selectedGameBranding = useMemo(
    () => resolveMatchupBranding(selectedGame, board?.primaryTeam ?? null),
    [selectedGame, board?.primaryTeam]
  )

  const primaryBrand = useMemo(() => {
    if (board?.winnerLoserMode) {
      const winnerBarColor = board?.teamPrimaryColor ?? selectedPool?.primary_color ?? '#8a8f98'
      return {
        key: 'winner-score',
        color: winnerBarColor,
        accent: getReadableTextColor(winnerBarColor, board?.teamSecondaryColor ?? selectedPool?.secondary_color ?? '#233042'),
        logo: ''
      }
    }

    const teamName = board?.primaryTeam ?? selectedPool?.team_name ?? 'Preferred Team'
    const fallbackLogo = board?.teamLogo
      ? resolveImageUrl(board.teamLogo)
      : selectedGameBranding.primaryLogo
        ? resolveImageUrl(selectedGameBranding.primaryLogo)
        : selectedPool?.logo_file
          ? resolveImageUrl(selectedPool.logo_file)
          : null

    return resolveTeamBrand(
      teamName,
      selectedGameBranding.primaryColor ?? board?.teamPrimaryColor ?? selectedPool?.primary_color ?? '#8a8f98',
      board?.teamSecondaryColor ?? selectedPool?.secondary_color ?? '#233042',
      fallbackLogo
    )
  }, [board, selectedGameBranding, selectedPool])

  const opponentBrand = useMemo(() => {
    if (board?.winnerLoserMode) {
      return {
        key: 'losing-score',
        color: '#5f6368',
        accent: getReadableTextColor('#5f6368', '#ffffff'),
        logo: ''
      }
    }

    const opponentName = board?.opponent ?? selectedGame?.opponent ?? 'Opponent'
    const fallbackLogo = selectedGameBranding.opponentLogo ? resolveImageUrl(selectedGameBranding.opponentLogo) : null
    return resolveTeamBrand(
      opponentName,
      selectedGameBranding.opponentColor ?? '#5f6368',
      '#ffffff',
      fallbackLogo
    )
  }, [board, selectedGame, selectedGameBranding])

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

  const selectedSquareSummary = selectedSquares.length > 10
    ? `${selectedSquares.slice(0, 10).join(', ')} +${selectedSquares.length - 10} more`
    : selectedSquares.join(', ')

  const latestScoredQuarter = getLatestScoredQuarter(selectedGame)
  const scoreSegments = useMemo(
    () => getScoreSegmentDefinitions({ activeSlots: board?.payoutSummary?.activeSlots, payoutLabels: board?.payoutSummary?.payoutLabels }),
    [board?.payoutSummary]
  )
  const simulationStepDescriptor = useMemo(
    () => getSimulationStepDescriptor({ activeSlots: board?.payoutSummary?.activeSlots, payoutLabels: board?.payoutSummary?.payoutLabels }),
    [board?.payoutSummary]
  )

  const primaryTeamIsAway = useMemo(() => {
    const normalizedPrimaryTeam = normalizeTeamKey(board?.primaryTeam)
    const normalizedAwayTeam = normalizeTeamKey(selectedGame?.away_team_name)
    const normalizedHomeTeam = normalizeTeamKey(selectedGame?.home_team_name)

    return Boolean(
      normalizedPrimaryTeam &&
      normalizedAwayTeam === normalizedPrimaryTeam &&
      normalizedHomeTeam !== normalizedPrimaryTeam
    )
  }, [board?.primaryTeam, selectedGame?.away_team_name, selectedGame?.home_team_name])

  const quarterSummaries = useMemo(() => {
    if (!board || !selectedGame) {
      return []
    }

    const winnerLoserMode = Boolean(board?.winnerLoserMode ?? selectedPool?.winner_loser_flg)
    const activeSimulationQuarter =
      simulationStatus?.mode === 'by_quarter' && Number(simulationStatus.currentGameId ?? 0) === Number(selectedGame.id)
        ? Number(simulationStatus.nextQuarter ?? 1)
        : null
    const activeLiveQuarter =
      activeSimulationQuarter == null && !isCompletedGame(selectedGame)
        ? Number(selectedGame.current_quarter ?? 0) || null
        : null
    const activeDisplayQuarter = activeSimulationQuarter ?? activeLiveQuarter ?? latestScoredQuarter

    if (latestScoredQuarter == null && activeDisplayQuarter == null) {
      return []
    }

    const squaresByNumber = new Map<number, LandingBoardSquare>()

    for (const square of board.squares) {
      squaresByNumber.set(square.square_num, square)
    }

    const gameComplete = isCompletedGame(selectedGame)

    return scoreSegments.map((segment) => {
      const quarter = segment.quarter
      const { primaryScore, opponentScore } = getDisplayQuarterScores(selectedGame, quarter, activeDisplayQuarter)
      const displayScores = getDisplayScores(primaryScore, opponentScore, winnerLoserMode)
      const hasScore = primaryScore !== null && opponentScore !== null
      const squareNum = hasScore
        ? resolveWinningSquareNumber(board.rowNumbers, board.colNumbers, opponentScore, primaryScore, winnerLoserMode)
        : null
      const matchingSquare = squareNum != null ? squaresByNumber.get(squareNum) ?? null : null
      const isActiveQuarter = !gameComplete && activeDisplayQuarter != null
        ? quarter === activeDisplayQuarter
        : false

      return {
        id: segment.slot,
        label: segment.shortLabel,
        quarter,
        status: !hasScore ? (isActiveQuarter ? 'active' : 'pending') : !gameComplete && isActiveQuarter ? 'active' : 'completed',
        primaryScore: displayScores.topScore,
        opponentScore: displayScores.sideScore,
        awayScore: primaryTeamIsAway ? displayScores.topScore : displayScores.sideScore,
        homeScore: primaryTeamIsAway ? displayScores.sideScore : displayScores.topScore,
        squareNum,
        ownerName: hasScore ? formatQuarterSquareOwner(matchingSquare, squareNum) : isActiveQuarter ? 'Live scoring in progress' : 'Awaiting score'
      }
    })
  }, [board, latestScoredQuarter, primaryTeamIsAway, scoreSegments, selectedGame, selectedPool, simulationStatus])

  const hasCompactQuarterSummaryLayout = quarterSummaries.length >= 6
  const showQuarterSummaries = quarterSummaries.length > 0
  const displayAdScale = Math.min(0.95, Math.max(0.5, displayAdSettings.shrinkPercent / 100))
  const displayAdSidebarCount = Math.min(4, Math.max(0, Number(displayAdSettings.sidebarCount ?? 1) || 0))
  const displayAdBannerCount = Math.min(6, Math.max(0, Number(displayAdSettings.bannerCount ?? 1) || 0))
  const displayAdFallbackMessage = displayAdSettings.defaultBannerMessage?.trim() ?? ''
  const sidebarDisplayAdItems = useMemo(
    () => displayAdItems.filter((item) => (item.placement ?? 'sidebar') === 'sidebar'),
    [displayAdItems]
  )
  const bannerDisplayAdItems = useMemo(
    () => displayAdItems.filter((item) => item.placement === 'banner'),
    [displayAdItems]
  )
  const hasDisplayAdContent = !displayAdSettings.hideAdsForOrganization && (
    (displayAdSidebarCount > 0 && sidebarDisplayAdItems.length > 0) ||
    (displayAdBannerCount > 0 && (bannerDisplayAdItems.length > 0 || Boolean(displayAdFallbackMessage)))
  )
  const showDisplayAds = displayOnlyMode && displayAdSettings.adsEnabled && hasDisplayAdContent && displayAdVisible
  const visibleSidebarAds = useMemo(
    () => (showDisplayAds ? buildDisplayAdWindow(sidebarDisplayAdItems, displayAdSidebarCount, activeDisplayAdIndex) : []),
    [activeDisplayAdIndex, displayAdSidebarCount, showDisplayAds, sidebarDisplayAdItems]
  )
  const visibleBannerAds = useMemo(() => {
    if (!showDisplayAds || displayAdBannerCount <= 0) {
      return []
    }

    const items = buildDisplayAdWindow(bannerDisplayAdItems, displayAdBannerCount, activeDisplayAdIndex)

    if (!displayAdFallbackMessage) {
      return items
    }

    const fallbackAccent = board?.teamSecondaryColor ?? '#93c5fd'
    const fallbackFooter = board?.poolName ? `${board.poolName} display update` : 'Community spotlight'

    while (items.length < displayAdBannerCount) {
      items.push({
        id: `default-banner-message-${items.length}`,
        title: displayAdFallbackMessage,
        footer: fallbackFooter,
        accentColor: fallbackAccent,
        placement: 'banner',
        label: 'Pool message'
      })
    }

    return items
  }, [
    activeDisplayAdIndex,
    bannerDisplayAdItems,
    board?.poolName,
    board?.teamSecondaryColor,
    displayAdBannerCount,
    displayAdFallbackMessage,
    showDisplayAds
  ])
  const showDisplaySidebar = showDisplayAds && visibleSidebarAds.length > 0 && displayAdSidebarCount > 0
  const showDisplayBanner = showDisplayAds && visibleBannerAds.length > 0 && displayAdBannerCount > 0
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

  const canManageSquares = Boolean(
    !displayOnlyMode &&
      token &&
      selectedPoolId &&
      board &&
      (authUser?.isAdmin || authUser?.permissions?.canManagePools)
  )
  const poolTracksMembers = Boolean(selectedPool?.has_members_flg ?? true)
  const showMemberSelector = poolTracksMembers && playerOptions.length > 0
  const showSimulationAdvance = !displayOnlyMode && SHOW_SIMULATION_CONTROLS && Boolean(simulationStatus?.progressAction)
  const canRefreshLiveQuarter = simulationStatus?.progressAction === 'complete_quarter'
  const simulationAdvanceLabel = simulationStatus?.progressAction === 'complete_game' ? 'Complete Game' : `Complete ${simulationStepDescriptor.singularLabel}`
  const primaryTeamLabel = board?.primaryTeam ?? selectedPool?.team_name ?? 'Preferred Team'
  const opponentTeamLabel = board?.opponent ?? selectedGame?.opponent ?? 'Opponent'
  const primaryTeamLogo = primaryBrand.logo
  const opponentTeamLogo = opponentBrand.logo
  const awayTeamLabel = selectedGame?.away_team_name ?? (primaryTeamIsAway ? primaryTeamLabel : opponentTeamLabel)
  const homeTeamLabel = selectedGame?.home_team_name ?? (primaryTeamIsAway ? opponentTeamLabel : primaryTeamLabel)
  const awayTeamLogo = selectedGame?.away_team_logo_url ? resolveImageUrl(selectedGame.away_team_logo_url) : (primaryTeamIsAway ? primaryTeamLogo : opponentTeamLogo)
  const homeTeamLogo = selectedGame?.home_team_logo_url ? resolveImageUrl(selectedGame.home_team_logo_url) : (primaryTeamIsAway ? opponentTeamLogo : primaryTeamLogo)

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
              {(['Squares', 'Notifications', 'Marketing', 'Players', 'Teams', 'Pools', 'Schedules', 'Users'] as const).map((item) => (
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
              onClick={() => (token ? void handleLogout() : setShowLogin((current) => !current))}
            >
              {token ? `Sign Out${authUser?.firstName ? ` • ${authUser.firstName}` : ''}` : 'Sign In'}
            </button>
          </nav>

          {showLogin && !token ? (
            <section className="landing-login-card">
              <div>
                <h2>Sign in</h2>
                <p>Use your account email and secure password. New users can request organization access and set a password from here.</p>
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
                  <button type="button" className="secondary" onClick={() => void handlePasswordResetFlow()} disabled={busy !== null}>
                    Set / Reset Password
                  </button>
                  <button type="button" className="secondary" onClick={() => void handleRequestAccessFlow()} disabled={busy !== null}>
                    Request Access
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
                <span>Game</span>
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

              {hasActiveSelection ? (
                <div className="landing-board-dev-actions">
                  <p className="small landing-selection-hint">
                    {selectedSquares.length > 0
                      ? `Selected squares: ${selectedSquareSummary}`
                      : 'Click one or more squares, then assign them together with one save.'}
                  </p>
                  <div className="landing-selection-actions">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void handleOpenSelectedSquareAssignment()}
                      disabled={busy !== null || selectedSquares.length === 0}
                    >
                      {selectedSquares.length > 1
                        ? `Assign ${selectedSquares.length} squares`
                        : selectedSquares.length === 1
                          ? `Assign square ${selectedSquares[0]}`
                          : 'Select squares to assign'}
                    </button>
                    {selectedSquares.length > 0 ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={handleCloseSquareAssignment}
                        disabled={busy !== null}
                      >
                        Clear selection
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {selectedPool && board ? (
            <>
              <div
                className={[
                  'display-ad-layout',
                  showDisplayAds ? 'is-ad-mode' : '',
                  showDisplaySidebar ? 'has-sidebar-ads' : '',
                  showDisplayBanner ? 'has-banner-ads' : ''
                ].filter(Boolean).join(' ')}
              >
                <div className="display-board-stage">
                  <div
                    className={`pool-board ${displayOnlyMode ? 'is-display-only' : ''} ${showDisplayAds ? 'is-ad-mode' : ''}`}
                  style={{
                    ['--team-primary' as string]: board.teamPrimaryColor ?? primaryBrand.color,
                    ['--team-secondary' as string]: board.teamSecondaryColor ?? '#111',
                    ['--display-ad-scale' as string]: `${displayAdScale}`
                  }}
                >
              <div className="pool-board-header">
                {!displayOnlyMode ? (
                  <button
                    type="button"
                    className="pool-board-nav-arrow"
                    onClick={() => void handleGameChange(previousGameId)}
                    disabled={!previousGameId || busy === 'loading'}
                    aria-label="Previous game"
                    title="Previous game"
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
                    aria-label="Next game"
                    title="Next game"
                  >
                    →
                  </button>
                ) : null}
              </div>

              {displayOnlyMode && featuredDisplaySummary ? (
                <section className={`display-scoreboard-spotlight is-${featuredDisplaySummary.status}`} aria-label="Featured live scoreboard">
                  <div className="display-scoreboard-team">
                    <div className="display-scoreboard-team-brand">
                      {awayTeamLogo ? <img src={awayTeamLogo} alt={awayTeamLabel} className="display-scoreboard-team-logo" /> : null}
                      <span className="display-scoreboard-team-name">{awayTeamLabel}</span>
                    </div>
                    <strong className="display-scoreboard-team-score">{featuredDisplaySummary.awayScore ?? '—'}</strong>
                  </div>

                  <div className="display-scoreboard-meta">
                    <span className="display-scoreboard-meta-label">{featuredDisplaySummary.label} • {featuredDisplaySummary.status === 'completed' ? 'Winner' : featuredDisplaySummary.status === 'active' ? 'Leader' : 'Pending'}</span>
                    <strong>{featuredDisplaySummary.ownerName}</strong>
                    {featuredDisplaySummary.squareNum != null ? <span>Square {featuredDisplaySummary.squareNum}</span> : null}
                  </div>

                  <div className="display-scoreboard-team is-opponent">
                    <strong className="display-scoreboard-team-score">{featuredDisplaySummary.homeScore ?? '—'}</strong>
                    <div className="display-scoreboard-team-brand">
                      {homeTeamLogo ? <img src={homeTeamLogo} alt={homeTeamLabel} className="display-scoreboard-team-logo" /> : null}
                      <span className="display-scoreboard-team-name">{homeTeamLabel}</span>
                    </div>
                  </div>
                </section>
              ) : null}

              <div className="pool-board-main">
                <div className={`pool-board-grid-wrap ${displayOnlyMode ? 'is-display-only' : ''}`}>
                  {displayOnlyMode ? (
                    <div className={`board-display-shell ${showQuarterSummaries ? 'with-quarter-summaries' : ''}`}>
                      <div className="board-display-main">
                        <div className="board-display-logo">
                          {logoSrc ? (
                            <img src={logoSrc} alt={selectedPool?.team_name ?? 'Football Pool'} />
                          ) : (
                            <div className="pool-board-logo-fallback">{selectedPool?.team_name ?? 'Football Pool'}</div>
                          )}
                        </div>

                        <div className="board-axis-title board-axis-top" style={{ backgroundColor: primaryBrand.color, color: primaryBrand.accent }}>
                          {primaryBrand.logo ? <img className="axis-team-logo" src={primaryBrand.logo} alt={primaryTeamLabel} /> : null}
                          <span>{primaryTeamLabel}</span>
                        </div>

                        <div className="board-top-digits">
                          {topDigits.map((digit, index) => (
                            <div key={`top-digit-${index}`} className="digit-cell">{digit}</div>
                          ))}
                        </div>

                        <div className="board-middle">
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
                                  const isSelectedSquare = selectedSquares.includes(square.square_num)
                                  const ownershipClass = square.participant_id ? 'owned' : 'open'
                                  const paymentStateClass = !square.participant_id
                                    ? 'is-open'
                                    : square.paid_flg
                                      ? 'is-filled'
                                      : 'is-unpaid'
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
                                      className={`landing-square-card ${ownershipClass} ${paymentStateClass} ${square.paid_flg ? 'paid' : ''} ${winClass} ${winStateClass} ${isCurrentLeader ? 'is-current-win' : ''} ${isSelectedSquare ? 'is-selected' : ''} ${hasActiveSelection ? 'is-manageable' : ''}`}
                                      onClick={hasActiveSelection ? () => void handleToggleSquareSelection(square) : undefined}
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
                        </div>
                      </div>

                      {showQuarterSummaries ? (
                        <aside className={`board-quarter-summary-panel ${hasCompactQuarterSummaryLayout ? 'is-compact' : ''}`} aria-label="Current score winners and leaders">
                          {quarterSummaries.map((summary) => (
                            <article key={summary.id} className={`board-quarter-card is-${summary.status}`}>
                              <div className="board-quarter-card-header">
                                <span>{summary.label}</span>
                                <span className="board-quarter-card-square">{summary.squareNum != null ? `Sq ${summary.squareNum}` : '—'}</span>
                              </div>

                              <div className="board-quarter-scoreline">
                                <div className="board-quarter-score-item">
                                  {awayTeamLogo ? (
                                    <img src={awayTeamLogo} alt={awayTeamLabel} className="quarter-team-logo" />
                                  ) : null}
                                  <span>{summary.awayScore ?? '—'}</span>
                                </div>
                                <div className="board-quarter-score-item">
                                  {homeTeamLogo ? (
                                    <img src={homeTeamLogo} alt={homeTeamLabel} className="quarter-team-logo" />
                                  ) : null}
                                  <span>{summary.homeScore ?? '—'}</span>
                                </div>
                              </div>

                              <div className="board-quarter-winner">
                                <strong>{summary.ownerName}</strong>
                              </div>
                            </article>
                          ))}
                        </aside>
                      ) : null}
                    </div>
                  ) : (
                    <div className={`board-display-shell ${showQuarterSummaries ? 'with-quarter-summaries' : ''}`}>
                      <div className="board-display-main">
                        <div className="board-display-logo">
                          {logoSrc ? (
                            <img src={logoSrc} alt={selectedPool?.team_name ?? 'Football Pool'} />
                          ) : (
                            <div className="pool-board-logo-fallback">{selectedPool?.team_name ?? 'Football Pool'}</div>
                          )}
                        </div>

                        <div className="board-axis-title board-axis-top" style={{ backgroundColor: primaryBrand.color, color: primaryBrand.accent }}>
                          {primaryBrand.logo ? <img className="axis-team-logo" src={primaryBrand.logo} alt={primaryTeamLabel} /> : null}
                          <span>{primaryTeamLabel}</span>
                        </div>

                        <div className="board-top-digits">
                          {topDigits.map((digit, index) => (
                            <div key={`top-digit-${index}`} className="digit-cell">{digit}</div>
                          ))}
                        </div>

                        <div className="board-middle">
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
                                  const isSelectedSquare = selectedSquares.includes(square.square_num)
                                  const ownershipClass = square.participant_id ? 'owned' : 'open'
                                  const paymentStateClass = !square.participant_id
                                    ? 'is-open'
                                    : square.paid_flg
                                      ? 'is-filled'
                                      : 'is-unpaid'
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
                                      className={`landing-square-card ${ownershipClass} ${paymentStateClass} ${square.paid_flg ? 'paid' : ''} ${winClass} ${winStateClass} ${isCurrentLeader ? 'is-current-win' : ''} ${isSelectedSquare ? 'is-selected' : ''} ${hasActiveSelection ? 'is-manageable' : ''}`}
                                      onClick={hasActiveSelection ? () => void handleToggleSquareSelection(square) : undefined}
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
                        </div>
                      </div>

                      {showQuarterSummaries ? (
                        <aside className={`board-quarter-summary-panel ${hasCompactQuarterSummaryLayout ? 'is-compact' : ''}`} aria-label="Current score winners and leaders">
                          {quarterSummaries.map((summary) => (
                            <article key={summary.id} className={`board-quarter-card is-${summary.status}`}>
                              <div className="board-quarter-card-header">
                                <span>{summary.label}</span>
                                <span className="board-quarter-card-square">{summary.squareNum != null ? `Sq ${summary.squareNum}` : '—'}</span>
                              </div>

                              <div className="board-quarter-scoreline">
                                <div className="board-quarter-score-item">
                                  {awayTeamLogo ? (
                                    <img src={awayTeamLogo} alt={awayTeamLabel} className="quarter-team-logo" />
                                  ) : null}
                                  <span>{summary.awayScore ?? '—'}</span>
                                </div>
                                <div className="board-quarter-score-item">
                                  {homeTeamLogo ? (
                                    <img src={homeTeamLogo} alt={homeTeamLabel} className="quarter-team-logo" />
                                  ) : null}
                                  <span>{summary.homeScore ?? '—'}</span>
                                </div>
                              </div>

                              <div className="board-quarter-winner">
                                <strong>{summary.ownerName}</strong>
                              </div>
                            </article>
                          ))}
                        </aside>
                      ) : null}
                    </div>
                  )}
                </div>
              </div>
                  </div>
                </div>

                {showDisplaySidebar ? (
                  <aside className="display-ad-sidebar display-ad-rail" aria-label="Display advertising right rail">
                    <div
                      className="display-ad-rail-content"
                      style={{ gridTemplateRows: `repeat(${visibleSidebarAds.length}, minmax(0, 1fr))` }}
                    >
                      {visibleSidebarAds.map((ad, index) => (
                        <DisplayAdCard key={`${ad.id}-sidebar-${index}`} ad={ad} />
                      ))}
                    </div>
                  </aside>
                ) : null}

                {showDisplayBanner ? (
                  <section className="display-ad-banner display-ad-rail" aria-label="Display advertising bottom rail">
                    <div
                      className="display-ad-banner-grid"
                      style={{ gridTemplateColumns: `repeat(${visibleBannerAds.length}, minmax(0, 1fr))` }}
                    >
                      {visibleBannerAds.map((ad, index) => (
                        <DisplayAdCard key={`${ad.id}-banner-${index}`} ad={ad} compact />
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>

              {!displayOnlyMode && board?.payoutSummary ? <PayoutSummaryPanel summary={board.payoutSummary} title="Pool payout schedule" /> : null}
            </>
          ) : (
            <article className="panel">
              <h2>{pools.length > 0 ? 'Select Pool' : 'No Pools Available'}</h2>
              <p className="small">
                {pools.length > 0 ? 'Choose a pool and game above to load the board.' : 'No squares board is available yet.'}
              </p>
            </article>
          )}

          {showSquareAssignmentModal && selectedSquares.length > 0 && canManageSquares ? (
            <div className="modal-backdrop" onClick={handleCloseSquareAssignment}>
              <div
                className="modal-card"
                role="dialog"
                aria-modal="true"
                aria-labelledby="landing-square-modal-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="modal-header">
                  <h3 id="landing-square-modal-title">
                    {selectedSquares.length > 1 ? `Assign ${selectedSquares.length} Squares` : `Square ${selectedSquare}`}
                  </h3>
                  <button type="button" className="secondary compact" onClick={handleCloseSquareAssignment}>
                    Close
                  </button>
                </div>

                <p className="small">
                  <strong>Selected:</strong> {selectedSquareSummary}
                </p>
                <p className="small">
                  {selectedSquares.length > 1
                    ? 'These squares will all be updated with the same participant, member, and payment status.'
                    : selectedBoardSquare?.participant_id
                      ? `Current owner: ${`${selectedBoardSquare.participant_first_name ?? ''} ${selectedBoardSquare.participant_last_name ?? ''}`.trim() || `User #${selectedBoardSquare.participant_id}`}`
                      : 'Current owner: Unassigned'}
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
                      {busy === 'clear-square' ? 'Clearing...' : selectedSquares.length > 1 ? 'Clear selected' : 'Clear square'}
                    </button>
                    <button className="primary" type="submit" disabled={busy !== null || !selectedPoolId}>
                      {busy === 'assign-square' ? 'Saving...' : selectedSquares.length > 1 ? 'Save assignments' : 'Save assignment'}
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
      ) : activePage === 'Marketing' ? (
        <LandingMarketingMaintenance
          pools={pools}
          token={token}
          authHeaders={authHeaders}
          apiBase={API_BASE}
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
