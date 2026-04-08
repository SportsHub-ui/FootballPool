import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { PayoutSummaryPanel, type BoardPayoutSummary } from './PayoutSummaryPanel'
import { getScoreSegmentDefinitions } from './utils/poolLeagues'

type UserPool = {
  id: number
  pool_name: string
  season: number
  primary_team_id: number | null // references nfl_team.id
  square_cost: number
  team_name: string
  total_squares: number
  user_squares: number
  primary_color?: string | null
  secondary_color?: string | null
  logo_file?: string | null
}

type UserSquare = {
  id: number
  square_num: number
  paid_flg: boolean
  participant_id: number | null
  player_id: number | null
  first_name: string | null
  last_name: string | null
  player_first_name: string | null
  player_last_name: string | null
}

type Winning = {
  id: number
  game_id: number
  pool_id: number
  quarter: number
  amount_won: number
  payout_status: string
  pool_name: string
  opponent: string
  game_dt: string
}

type WinningsResponse = {
  userId: number
  totalWon: number
  totalPending: number
  winnings: Winning[]
}

type Game = {
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

type BoardSquare = {
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

type PoolBoard = {
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
  squares: BoardSquare[]
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '')
  .toString()
  .trim()
  .replace(/\/+$/, '')
const DEFAULT_BOARD_LOGO = '/football-pool.png'
const boardMoneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
})

const formatBoardMoney = (value: number | null | undefined): string => boardMoneyFormatter.format(Number(value ?? 0))

const normalizeDigits = (value: Array<number | string> | null | undefined): Array<number | string> => {
  if (!Array.isArray(value) || value.length !== 10) {
    return Array.from({ length: 10 }, (_, index) => index)
  }

  return value.map((entry, index) => (typeof entry === 'number' || typeof entry === 'string' ? entry : index))
}

const formatBoardGameOption = (game: Game): string => {
  const weekLabel = game.week_num != null ? `Week ${game.week_num} • ` : ''
  return `${weekLabel}${new Date(game.game_dt).toLocaleDateString()} vs ${game.opponent}`
}

const resolveImageUrl = (value: string): string => {
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  if (value.startsWith('/')) return `${API_BASE}${value}`
  return `${API_BASE}/images/${value}`
}

type TeamBrand = {
  key: string
  color: string
  accent: string
  logo: string
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

const getGameScoreForQuarter = (game: Game, quarter: number): string => {
  const primaryScore =
    quarter === 1
      ? game.q1_primary_score
      : quarter === 2
        ? game.q2_primary_score
        : quarter === 3
          ? game.q3_primary_score
          : game.q4_primary_score
  const opponentScore =
    quarter === 1
      ? game.q1_opponent_score
      : quarter === 2
        ? game.q2_opponent_score
        : quarter === 3
          ? game.q3_opponent_score
          : game.q4_opponent_score

  return primaryScore !== null && opponentScore !== null ? `${primaryScore}-${opponentScore}` : 'TBD'
}

export function ParticipantView() {
  const [view, setView] = useState<'login' | 'dashboard'>('login')
  const [token, setToken] = useState<string | null>(localStorage.getItem('auth-token'))
  const [user, setUser] = useState<{ id: number; email: string; firstName: string; lastName: string } | null>(null)
  
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [loginError, setLoginError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  
  const [pools, setPools] = useState<UserPool[]>([])
  const [selectedPool, setSelectedPool] = useState<number | null>(null)
  const [poolSquares, setPoolSquares] = useState<UserSquare[]>([])
  const [poolGames, setPoolGames] = useState<Game[]>([])
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [poolBoard, setPoolBoard] = useState<PoolBoard | null>(null)
  const [winnings, setWinnings] = useState<WinningsResponse | null>(null)
  const liveRefreshTimerRef = useRef<number | null>(null)

  const headers = useMemo(() => {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) {
      h['Authorization'] = `Bearer ${token}`
    }
    return h
  }, [token])

  const scoreSegments = useMemo(
    () => getScoreSegmentDefinitions({ activeSlots: poolBoard?.payoutSummary?.activeSlots, payoutLabels: poolBoard?.payoutSummary?.payoutLabels }),
    [poolBoard?.payoutSummary]
  )

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setBusy(true)
    setLoginError(null)

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm)
      })

      if (!res.ok) throw new Error('Login failed')
      const data = await res.json()
      
      localStorage.setItem('auth-token', data.token)
      setToken(data.token)
      setUser(data.user)
      setView('dashboard')
      
      // Load data
      await loadParticipantData(data.token)
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  const loadParticipantData = async (authToken: string) => {
    try {
      const authHeaders = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      }

      const [poolsRes, winningsRes] = await Promise.all([
        fetch(`${API_BASE}/api/participant/pools`, { headers: authHeaders }),
        fetch(`${API_BASE}/api/participant/winnings`, { headers: authHeaders })
      ])

      if (poolsRes.ok) setPools(await poolsRes.json())
      if (winningsRes.ok) setWinnings(await winningsRes.json())
    } catch (err) {
      console.error('Failed to load participant data:', err)
    }
  }

  const refreshSelectedPoolBoard = async (poolId: number, preferredGameId?: number | null) => {
    try {
      const gamesRes = await fetch(`${API_BASE}/api/participant/pools/${poolId}/games`, { headers })

      if (!gamesRes.ok) {
        throw new Error('Failed to load pool games')
      }

      const games: Game[] = await gamesRes.json()
      setPoolGames(games)

      const nextGameId = preferredGameId != null && games.some((game) => Number(game.id) === Number(preferredGameId) || Number(game.game_id) === Number(preferredGameId))
        ? preferredGameId
        : null

      setSelectedGameId(nextGameId)

      const query = nextGameId != null ? `?gameId=${nextGameId}` : ''
      const boardRes = await fetch(`${API_BASE}/api/participant/pools/${poolId}/board${query}`, { headers })

      if (boardRes.ok) {
        const boardData = await boardRes.json()
        setPoolBoard(boardData.board)
      }
    } catch (err) {
      console.error('Failed to refresh live participant board:', err)
    }
  }

  const handleSelectPool = async (poolId: number) => {
    setSelectedPool(poolId)
    
    try {
      const [squaresRes, gamesRes] = await Promise.all([
        fetch(`${API_BASE}/api/participant/pools/${poolId}/squares`, { headers }),
        fetch(`${API_BASE}/api/participant/pools/${poolId}/games`, { headers })
      ])

      if (squaresRes.ok) setPoolSquares(await squaresRes.json())
      if (gamesRes.ok) {
        const games: Game[] = await gamesRes.json()
        setPoolGames(games)

        const initialGameId = null
        setSelectedGameId(initialGameId)

        const boardPath = `${API_BASE}/api/participant/pools/${poolId}/board`

        const boardRes = await fetch(boardPath, { headers })
        if (boardRes.ok) {
          const boardData = await boardRes.json()
          setPoolBoard(boardData.board)
        }
      }
    } catch (err) {
      console.error('Failed to load pool data:', err)
    }
  }

  const handleSelectBoardGame = async (gameId: number) => {
    if (!selectedPool) return

    setSelectedGameId(gameId)
    try {
      const boardRes = await fetch(
        `${API_BASE}/api/participant/pools/${selectedPool}/board?gameId=${gameId}`,
        { headers }
      )

      if (boardRes.ok) {
        const boardData = await boardRes.json()
        setPoolBoard(boardData.board)
      }
    } catch (err) {
      console.error('Failed to load board data:', err)
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined' || view !== 'dashboard' || !selectedPool) {
      return
    }

    const eventSource = new EventSource(`${API_BASE}/api/ingestion/events`)

    const scheduleRefresh = () => {
      if (liveRefreshTimerRef.current != null) {
        window.clearTimeout(liveRefreshTimerRef.current)
      }

      liveRefreshTimerRef.current = window.setTimeout(() => {
        liveRefreshTimerRef.current = null
        void refreshSelectedPoolBoard(selectedPool, selectedGameId)
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
          poolGames.some((game) => Number(game.id) === gameId || Number(game.game_id) === gameId) ||
          Number(selectedGameId ?? poolBoard?.gameId ?? 0) === gameId

        if (isRelevant) {
          scheduleRefresh()
        }
      } catch (error) {
        console.warn('Ignoring malformed live score event', error)
      }
    }

    eventSource.addEventListener('game-updated', handleGameUpdated as EventListener)

    return () => {
      if (liveRefreshTimerRef.current != null) {
        window.clearTimeout(liveRefreshTimerRef.current)
        liveRefreshTimerRef.current = null
      }

      eventSource.removeEventListener('game-updated', handleGameUpdated as EventListener)
      eventSource.close()
    }
  }, [poolBoard?.gameId, poolGames, selectedGameId, selectedPool, view])

  const handleLogout = () => {
    localStorage.removeItem('auth-token')
    setToken(null)
    setUser(null)
    setView('login')
    setPools([])
    setSelectedPool(null)
    setSelectedGameId(null)
    setPoolSquares([])
    setPoolBoard(null)
    setWinnings(null)
  }

  const boardRows = useMemo(() => {
    if (!poolBoard) return []

    const byNumber = new Map<number, BoardSquare>()
    for (const sq of poolBoard.squares) {
      byNumber.set(sq.square_num, sq)
    }

    return Array.from({ length: 10 }, (_, row) =>
      Array.from({ length: 10 }, (_, col) => {
        const squareNum = row * 10 + col + 1
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
  }, [poolBoard])

  const primaryBrand = useMemo(() => {
    if (!poolBoard) return null
    if (poolBoard.winnerLoserMode) {
      return {
        key: 'winner-score',
        color: poolBoard.teamPrimaryColor,
        accent: poolBoard.teamSecondaryColor,
        logo: ''
      }
    }

    return resolveTeamBrand(
      poolBoard.primaryTeam,
      poolBoard.teamPrimaryColor,
      poolBoard.teamSecondaryColor,
      poolBoard.teamLogo ? resolveImageUrl(poolBoard.teamLogo) : null
    )
  }, [poolBoard])

  const opponentBrand = useMemo(() => {
    if (!poolBoard) return null
    if (poolBoard.winnerLoserMode) {
      return {
        key: 'losing-score',
        color: '#5f6368',
        accent: '#ffffff',
        logo: ''
      }
    }
    return resolveTeamBrand(poolBoard.opponent, '#0076b6', '#b0b7bc', null)
  }, [poolBoard])

  const topDigits = useMemo(() => normalizeDigits(poolBoard?.colNumbers), [poolBoard?.colNumbers])
  const leftDigits = useMemo(() => normalizeDigits(poolBoard?.rowNumbers), [poolBoard?.rowNumbers])

  if (view === 'login') {
    return (
      <div className="participant-container">
        <div className="login-card">
          <h1>Football Pool</h1>
          <p>Participant Login</p>
          
          <form onSubmit={handleLogin}>
            <input
              type="email"
              placeholder="Email"
              value={loginForm.email}
              onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
              required
              disabled={busy}
            />
            <input
              type="password"
              placeholder="Password"
              value={loginForm.password}
              onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
              required
              disabled={busy}
            />
            <button type="submit" disabled={busy}>
              {busy ? 'Logging in...' : 'Login'}
            </button>
          </form>

          {loginError && <div className="error-message">{loginError}</div>}
          
          <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: '#666' }}>
            Demo: Use any email address with any password
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="participant-container">
      <header className="participant-header">
        <div>
          <h1>Football Pool</h1>
          <p>Welcome, {user?.firstName} {user?.lastName}</p>
        </div>
        <button onClick={handleLogout} className="logout-btn">Logout</button>
      </header>

      <div className="participant-content">
        {/* Winnings Summary */}
        <section className="winnings-summary">
          <h2>Your Winnings</h2>
          <div className="summary-cards">
            <div className="summary-card">
              <div className="summary-label">Total Won</div>
              <div className="summary-value">${winnings?.totalWon || 0}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Pending Payout</div>
              <div className="summary-value pending">${winnings?.totalPending || 0}</div>
            </div>
          </div>
        </section>

        {/* Pools List */}
        <section className="pools-section">
          <h2>Your Pools</h2>
          {pools.length === 0 ? (
            <p>No pools yet.</p>
          ) : (
            <div className="pools-grid">
              {pools.map((pool) => (
                <div
                  key={pool.id}
                  className={`pool-card ${selectedPool === pool.id ? 'selected' : ''}`}
                  onClick={() => handleSelectPool(pool.id)}
                >
                  <h3>{pool.pool_name}</h3>
                  <p>{pool.team_name} • {pool.season}</p>
                  <div className="pool-stats">
                    <span>{pool.user_squares} of {pool.total_squares} squares</span>
                    <span>${pool.square_cost}/sq</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Selected Pool Details */}
        {selectedPool && (
          <section className="pool-details">
            <h2>Pool Details</h2>
            
            {/* Squares Grid */}
            <div className="pool-subsection">
              <h3>Your Squares</h3>
              <div className="squares-list">
                {poolSquares.length === 0 ? (
                  <p>No squares assigned yet.</p>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Square #</th>
                        <th>Paid</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {poolSquares.map((sq) => (
                        <tr key={sq.id}>
                          <td>#{sq.square_num}</td>
                          <td>{sq.paid_flg ? '✓' : '○'}</td>
                          <td>
                            {sq.player_first_name && sq.player_last_name
                              ? `${sq.player_first_name} ${sq.player_last_name}`
                              : 'Assigned'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Games */}
            <div className="pool-subsection">
              <h3>Games & Scores</h3>
              <div className="games-list">
                {poolGames.length === 0 ? (
                  <p>No games yet.</p>
                ) : (
                  poolGames.map((game) => (
                    <div key={game.id} className="game-card">
                      <div className="game-header">
                        <strong>vs {game.opponent}</strong>
                        <span className="game-date">{new Date(game.game_dt).toLocaleDateString()}</span>
                      </div>
                      <div className="game-scores">
                        {scoreSegments.map((segment) => (
                          <div key={`${game.id}-${segment.slot}`} className="quarter">
                            <label>{segment.shortLabel}</label>
                            <span>{getGameScoreForQuarter(game, segment.quarter)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="pool-subsection">
              <h3>Pool Squares Board</h3>
              {poolBoard ? (
                <>
                  <div
                    className="pool-board"
                  style={{
                    ['--team-primary' as string]: poolBoard.teamPrimaryColor,
                    ['--team-secondary' as string]: poolBoard.teamSecondaryColor
                  }}
                >
                  <div className="pool-board-header">{poolBoard.poolName}</div>

                  <div className="pool-board-main">
                    <div className="pool-board-brand">
                      {poolBoard.teamLogo ? (
                        <img src={resolveImageUrl(poolBoard.teamLogo)} alt={`${poolBoard.teamName ?? 'Team'} logo`} />
                      ) : (
                        <img src={DEFAULT_BOARD_LOGO} alt="Knights Baseball logo" />
                      )}
                    </div>

                    <div className="pool-board-grid-wrap">
                      <div
                        className="board-axis-title board-axis-top"
                        style={{ backgroundColor: primaryBrand?.color, color: primaryBrand?.accent }}
                      >
                        {primaryBrand?.logo ? (
                          <img className="axis-team-logo" src={primaryBrand.logo} alt={poolBoard.primaryTeam} />
                        ) : null}
                        <span>{poolBoard.primaryTeam}</span>
                      </div>

                      <div className="board-top-digits">
                        {topDigits.map((digit, index) => (
                          <div key={`top-${index}`} className="digit-cell">{digit}</div>
                        ))}
                      </div>

                      <div className="board-middle">
                        <div
                          className="board-axis-title board-axis-left"
                          style={{ backgroundColor: opponentBrand?.color, color: opponentBrand?.accent }}
                        >
                          {opponentBrand?.logo ? (
                            <img className="axis-team-logo" src={opponentBrand.logo} alt={poolBoard.opponent} />
                          ) : null}
                          <span>{poolBoard.opponent}</span>
                        </div>

                        <div className="board-grid">
                          {boardRows.map((row, rowIndex) => (
                            <div key={`row-${rowIndex}`} className="board-row">
                              <div className="digit-cell digit-row">{leftDigits[rowIndex]}</div>
                              {row.map((sq) => {
                                const hasWeekWin = sq.current_game_won > 0
                                const hasSeasonWin = sq.season_won_total > 0
                                const isCurrentLeader = Boolean(sq.is_current_score_leader)
                                const winClass = hasWeekWin
                                  ? 'win-3'
                                  : hasSeasonWin
                                    ? 'win-1'
                                    : 'win-0'
                                const winStateClass = hasWeekWin ? 'is-week-win' : hasSeasonWin ? 'is-season-win' : ''
                                const hasTooltip = hasWeekWin || hasSeasonWin || isCurrentLeader
                                const squareTooltip = hasTooltip
                                  ? `${isCurrentLeader ? 'Currently leading • ' : ''}Week: ${formatBoardMoney(sq.current_game_won)} • YTD: ${formatBoardMoney(sq.season_won_total)}`
                                  : undefined

                                return (
                                  <button
                                    key={sq.id}
                                    type="button"
                                    className={`board-square ${sq.participant_id ? 'owned' : 'open'} ${winClass} ${winStateClass} ${isCurrentLeader ? 'current-win' : ''}`}
                                    aria-label={squareTooltip}
                                  >
                                    {sq.participant_id ? (
                                      <span className="square-owner">
                                        <span>{sq.participant_first_name ?? ''}</span>
                                        <span>{sq.participant_last_name ?? ''}</span>
                                        <span className="square-player-num">
                                          {sq.player_jersey_num != null ? `#${sq.player_jersey_num}` : ''}
                                        </span>
                                      </span>
                                    ) : (
                                      <span className="square-open-number">{sq.square_num}</span>
                                    )}

                                    {hasTooltip ? (
                                      <span className="square-hover-tooltip" aria-hidden="true">
                                        <span><strong>Week</strong>{formatBoardMoney(sq.current_game_won)}</span>
                                        <span><strong>YTD</strong>{formatBoardMoney(sq.season_won_total)}</span>
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
                  </div>

                  {poolGames.length > 0 ? (
                    <div className="board-game-selector">
                      <label htmlFor="board-game-id">Week/Game</label>
                      <select
                        id="board-game-id"
                        value={selectedGameId ?? ''}
                        onChange={(e) => handleSelectBoardGame(Number(e.target.value))}
                      >
                        {poolGames.map((game) => (
                          <option key={game.id} value={game.id}>
                            {formatBoardGameOption(game)}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>

                  {poolBoard?.payoutSummary ? <PayoutSummaryPanel summary={poolBoard.payoutSummary} title="Pool payout schedule" /> : null}
                </>
              ) : (
                <p>No board data yet.</p>
              )}
            </div>
          </section>
        )}

        {/* All Winnings History */}
        <section className="winnings-section">
          <h2>Winnings History</h2>
          {winnings?.winnings.length === 0 ? (
            <p>No winnings yet.</p>
          ) : (
            <table className="winnings-table">
              <thead>
                <tr>
                  <th>Pool</th>
                  <th>Game</th>
                  <th>Quarter</th>
                  <th>Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {winnings?.winnings.map((w) => (
                  <tr key={w.id} className={w.payout_status === 'paid' ? 'paid' : ''}>
                    <td>{w.pool_name}</td>
                    <td>{w.opponent} ({new Date(w.game_dt).toLocaleDateString()})</td>
                    <td>Q{w.quarter}</td>
                    <td>${w.amount_won}</td>
                    <td className={`status-${w.payout_status}`}>{w.payout_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
