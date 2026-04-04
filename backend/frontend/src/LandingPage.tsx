import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { LandingPlayerMaintenance } from './LandingPlayerMaintenance'
import { LandingPoolMaintenance } from './LandingPoolMaintenance'
import { LandingScheduleMaintenance } from './LandingScheduleMaintenance'
import { LandingTeamMaintenance } from './LandingTeamMaintenance'
import { LandingUserMaintenance } from './LandingUserMaintenance'

type LandingPool = {
  id: number
  pool_name: string | null
  season: number | null
  primary_team: string | null
  default_flg: boolean
  sign_in_req_flg: boolean
  team_name: string | null
  primary_color: string | null
  secondary_color: string | null
  logo_file: string | null
}

type LandingGame = {
  id: number
  pool_id: number
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
}

type LandingBoard = {
  poolId: number
  poolName: string
  primaryTeam: string
  opponent: string
  gameId: number | null
  gameDate: string | null
  teamName: string | null
  teamPrimaryColor: string
  teamSecondaryColor: string
  teamLogo: string | null
  rowNumbers: Array<number | string> | null
  colNumbers: Array<number | string> | null
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

type TeamBrand = {
  key: string
  color: string
  accent: string
  logo: string
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'
const DEFAULT_POOL_LOGO = '/football-pool.png'

const NFL_TEAM_BRANDS: TeamBrand[] = [
  { key: 'cardinals', color: '#97233f', accent: '#ffffff', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/ari.png' },
  { key: 'bears', color: '#0b162a', accent: '#f7a33c', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/chi.png' },
  { key: 'chiefs', color: '#e31837', accent: '#ffb81c', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png' },
  { key: 'cowboys', color: '#002244', accent: '#d7e3f2', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png' },
  { key: 'eagles', color: '#004c54', accent: '#dfe9ea', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/phi.png' },
  { key: 'lions', color: '#0076b6', accent: '#d7effc', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png' },
  { key: 'packers', color: '#203731', accent: '#ffb612', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png' },
  { key: 'vikings', color: '#4f2683', accent: '#ffc62f', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/min.png' }
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

const formatDate = (value: string | null | undefined): string => {
  if (!value) return new Date().toLocaleDateString()
  return new Date(value).toLocaleDateString()
}

const isCompletedGame = (game: LandingGame | null): boolean => {
  if (!game) return false
  return game.q4_primary_score !== null && game.q4_opponent_score !== null
}

const formatGameOption = (game: LandingGame, primaryTeam: string): string => {
  const dateLabel = formatDate(game.game_dt)

  if (isCompletedGame(game)) {
    return `${dateLabel} • ${primaryTeam} ${game.q4_primary_score}-${game.q4_opponent_score} ${game.opponent}`
  }

  return `${dateLabel} • ${primaryTeam} vs ${game.opponent}`
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

const pickInitialGameId = (games: LandingGame[], preferredGameId?: number | null): number | null => {
  if (preferredGameId && games.some((game) => game.id === preferredGameId)) {
    return preferredGameId
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

  if (typeof data.error === 'string' && data.error.trim()) {
    return data.error
  }

  return data.detail || data.message || fallback
}

export function LandingPage({ onOpenAdmin }: { onOpenAdmin: () => void }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth-token'))
  const [showLogin, setShowLogin] = useState(false)
  const [activePage, setActivePage] = useState<'Squares' | 'Players' | 'Teams' | 'Pools' | 'Schedules' | 'Users'>('Squares')
  const [busy, setBusy] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [pools, setPools] = useState<LandingPool[]>([])
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null)
  const [games, setGames] = useState<LandingGame[]>([])
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [board, setBoard] = useState<LandingBoard | null>(null)
  const [selectedSquare, setSelectedSquare] = useState<number | null>(null)
  const [assignForm, setAssignForm] = useState({
    participantId: '',
    playerId: '',
    paidFlg: false,
    reassign: false
  })
  const [participantOptions, setParticipantOptions] = useState<LandingUserOption[]>([])
  const [playerOptions, setPlayerOptions] = useState<LandingPlayerOption[]>([])

  const authHeaders = useMemo(() => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }
    return headers
  }, [token])

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

      const data = await response.json()
      const nextGames: LandingGame[] = data.games ?? []
      const nextGameId = pickInitialGameId(nextGames, preferredGameId)

      setGames(nextGames)
      setSelectedPoolId(poolId)
      setSelectedGameId(nextGameId)

      await loadBoard(poolId, nextGameId)
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Failed to load pool data')
      setGames([])
      setSelectedGameId(null)
      setBoard(null)
    } finally {
      setBusy(null)
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
      }
    } catch (error) {
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
    void loadPools(selectedPoolId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

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

  const formatUserName = (user: LandingUserOption): string => {
    const fullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
    if (fullName) return fullName
    return user.email ?? `User #${user.id}`
  }

  const formatPlayerName = (player: LandingPlayerOption): string => {
    const fullName = `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim()
    const jersey = player.jersey_num != null ? `#${player.jersey_num}` : '#-'
    return `${jersey} ${fullName || 'Unnamed player'}`
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
    const teamName = board?.primaryTeam ?? selectedPool?.primary_team ?? selectedPool?.team_name ?? 'Preferred Team'
    const fallbackLogo = selectedPool?.logo_file ? resolveImageUrl(selectedPool.logo_file) : null

    return resolveTeamBrand(
      teamName,
      board?.teamPrimaryColor ?? selectedPool?.primary_color ?? '#8a8f98',
      board?.teamSecondaryColor ?? selectedPool?.secondary_color ?? '#233042',
      fallbackLogo
    )
  }, [board, selectedPool])

  const opponentBrand = useMemo(() => {
    const opponentName = selectedGame?.opponent ?? board?.opponent ?? 'Opponent'
    return resolveTeamBrand(opponentName, '#5f6368', '#ffffff', null)
  }, [board, selectedGame])

  const logoSrc = selectedPool?.logo_file ? resolveImageUrl(selectedPool.logo_file) : DEFAULT_POOL_LOGO
  const topDigits = normalizeDigits(board?.colNumbers)
  const leftDigits = normalizeDigits(board?.rowNumbers)
  const hasActiveSelection = Boolean(selectedPool && selectedGame && board)

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

  const canManageSquares = Boolean(token && selectedPoolId && board)

  const heroTitle = selectedPool
    ? `${selectedPool.team_name ?? selectedPool.primary_team ?? 'Team'} • ${selectedPool.pool_name ?? 'Pool'}`
    : pools.length > 1
      ? 'Select Pool'
      : pools.length === 1
        ? `${pools[0].team_name ?? pools[0].primary_team ?? 'Team'} • ${pools[0].pool_name ?? 'Pool'}`
        : 'Football Pool'

  const heroDate = selectedPool ? formatDate(selectedGame?.game_dt ?? board?.gameDate) : new Date().toLocaleDateString()

  return (
    <div className={`landing-page-shell ${activePage === 'Squares' ? 'is-squares-page' : 'is-scroll-page'}`}>
      <nav className="landing-nav-bar">
        <div className="landing-nav-links">
          {(['Squares', 'Players', 'Teams', 'Pools', 'Schedules', 'Users'] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={`landing-nav-link ${activePage === item ? 'is-active' : ''}`}
              onClick={() => setActivePage(item)}
            >
              {item}
            </button>
          ))}
          <button type="button" className="landing-nav-link landing-nav-admin" onClick={onOpenAdmin}>
            Admin
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

      {pageError ? <div className="error-banner landing-error-banner">{pageError}</div> : null}

      {activePage === 'Squares' ? (
        <section className="landing-board-shell">
          <aside className="landing-logo-panel">
            <div className="landing-logo-card-frame">
              <img src={logoSrc} alt={selectedPool?.team_name ?? 'Football Pool'} />
            </div>
          </aside>

          <div className="landing-board-content">
            <div className={`landing-hero-bar ${selectedPool ? '' : 'is-empty'}`}>
              <div>
                <h1>{heroTitle}</h1>
                <p>{selectedPool ? `Game date: ${heroDate}` : `Today: ${heroDate}`}</p>
              </div>

              <div className="landing-hero-controls">
                {pools.length > 1 ? (
                  <select
                    value={selectedPoolId ?? ''}
                    onChange={(event) => {
                      const value = event.target.value ? Number(event.target.value) : null
                      void handlePoolChange(value)
                    }}
                  >
                    <option value="">Select Pool</option>
                    {pools.map((pool) => (
                      <option key={pool.id} value={pool.id}>
                        {pool.team_name ?? pool.primary_team ?? 'Team'} • {pool.pool_name}
                      </option>
                    ))}
                  </select>
                ) : null}

                {selectedPool && games.length > 0 ? (
                  <select
                    value={selectedGameId ?? ''}
                    onChange={(event) => {
                      const value = event.target.value ? Number(event.target.value) : null
                      void handleGameChange(value)
                    }}
                  >
                    {games.map((game) => (
                      <option key={game.id} value={game.id}>
                        {formatGameOption(game, board?.primaryTeam ?? selectedPool.primary_team ?? selectedPool.team_name ?? 'Team')}
                      </option>
                    ))}
                  </select>
                ) : null}
              </div>
            </div>

            {canManageSquares ? (
              <div className="landing-admin-hint">Admin mode: click any square to assign or clear a user.</div>
            ) : null}

            <div
              className={`landing-team-bar preferred ${selectedPool ? '' : 'is-empty'}`}
              style={selectedPool ? { backgroundColor: primaryBrand.color, color: primaryBrand.accent } : undefined}
            >
              {selectedPool ? (
                <>
                  {primaryBrand.logo ? <img src={primaryBrand.logo} alt={board?.primaryTeam ?? 'Preferred team'} /> : null}
                  <span>{board?.primaryTeam ?? selectedPool.primary_team ?? selectedPool.team_name ?? 'Preferred Team'}</span>
                </>
              ) : (
                <span>&nbsp;</span>
              )}
            </div>

            <div className="landing-score-bar top">
              <div className="landing-score-bar-spacer" aria-hidden="true" />
              {topDigits.map((digit, index) => (
                <div key={`top-digit-${index}`} className="landing-score-cell">
                  {digit}
                </div>
              ))}
            </div>

            <div className="landing-board-row-layout">
              <div
                className={`landing-team-bar opponent ${selectedGame ? '' : 'is-empty'}`}
                style={selectedGame ? { backgroundColor: opponentBrand.color, color: opponentBrand.accent } : undefined}
              >
                {selectedGame ? (
                  <>
                    {opponentBrand.logo ? <img src={opponentBrand.logo} alt={selectedGame.opponent} /> : null}
                    <span>{selectedGame.opponent}</span>
                  </>
                ) : (
                  <span>&nbsp;</span>
                )}
              </div>

              <div className="landing-squares-panel">
                {boardRows.map((row, rowIndex) => (
                  <div key={`landing-row-${rowIndex}`} className="landing-squares-row">
                    <div className="landing-row-score">{leftDigits[rowIndex]}</div>

                    {row.map((square) => {
                      const squareClass = !hasActiveSelection
                        ? 'is-neutral'
                        : square.current_game_won > 0
                          ? 'is-current-win'
                          : square.season_won_total > 0
                            ? 'is-season-win'
                            : !square.participant_id
                              ? 'is-open'
                              : square.paid_flg === false
                                ? 'is-unpaid'
                                : 'is-filled'

                      const isSelectedSquare = selectedSquare === square.square_num

                      return (
                        <div
                          key={square.square_num}
                          className={`landing-square-card ${squareClass} ${canManageSquares ? 'is-manageable' : ''} ${isSelectedSquare ? 'is-selected' : ''}`}
                          onClick={canManageSquares ? () => void handleOpenSquareAssignment(square) : undefined}
                          onKeyDown={canManageSquares
                            ? (event) => {
                                if (event.key === 'Enter' || event.key === ' ') {
                                  event.preventDefault()
                                  void handleOpenSquareAssignment(square)
                                }
                              }
                            : undefined}
                          role={canManageSquares ? 'button' : undefined}
                          tabIndex={canManageSquares ? 0 : undefined}
                          title={canManageSquares ? `Manage square ${square.square_num}` : undefined}
                        >
                          {hasActiveSelection && square.current_game_won > 0 ? (
                            <span className="landing-square-chip top-left">${square.current_game_won}</span>
                          ) : null}

                          {hasActiveSelection && square.season_won_total > 0 ? (
                            <span className="landing-square-chip bottom-left">Season ${square.season_won_total}</span>
                          ) : null}

                          {!hasActiveSelection || !square.participant_id ? (
                            <div className="landing-square-center">{square.square_num}</div>
                          ) : (
                            <div className="landing-square-owner">
                              <span>{square.participant_first_name ?? ''} {square.participant_last_name ?? ''}</span>
                              <span>{square.player_jersey_num != null ? `#${square.player_jersey_num}` : ''}</span>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>

          </div>

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

                  <select
                    value={assignForm.playerId}
                    onChange={(event) => setAssignForm((current) => ({ ...current, playerId: event.target.value }))}
                    disabled={busy !== null}
                  >
                    <option value="">No player</option>
                    {playerOptions.map((player) => (
                      <option key={player.id} value={player.id}>
                        {formatPlayerName(player)}
                      </option>
                    ))}
                  </select>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={assignForm.paidFlg}
                      onChange={(event) => setAssignForm((current) => ({ ...current, paidFlg: event.target.checked }))}
                      disabled={busy !== null}
                    />
                    Mark as paid
                  </label>

                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={assignForm.reassign}
                      onChange={(event) => setAssignForm((current) => ({ ...current, reassign: event.target.checked }))}
                      disabled={busy !== null}
                    />
                    Allow reassign if already sold
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
              <p>This section is not wired up yet. Use `Squares`, `Players`, `Users`, or `Admin` for now.</p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
