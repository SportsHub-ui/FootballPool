import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

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

type PoolRecord = {
  id: number
  pool_name: string | null
  team_id: number | null
  season: number | null
  primary_team: string | null
  square_cost: number | null
  q1_payout: number | null
  q2_payout: number | null
  q3_payout: number | null
  q4_payout: number | null
  team_name: string | null
}

type GameRecord = {
  id: number
  pool_id: number
  opponent: string
  game_dt: string
  is_simulation: boolean
  q1_primary_score: number | null
  q1_opponent_score: number | null
  q2_primary_score: number | null
  q2_opponent_score: number | null
  q3_primary_score: number | null
  q3_opponent_score: number | null
  q4_primary_score: number | null
  q4_opponent_score: number | null
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
const SCHEDULE_LIST_MIN_HEIGHT = 120
const SCHEDULE_LIST_MAX_HEIGHT = 360
const SCHEDULE_LIST_DEFAULT_HEIGHT = 170
const NFL_TEAMS = [
  'Arizona Cardinals',
  'Atlanta Falcons',
  'Baltimore Ravens',
  'Buffalo Bills',
  'Carolina Panthers',
  'Chicago Bears',
  'Cincinnati Bengals',
  'Cleveland Browns',
  'Dallas Cowboys',
  'Denver Broncos',
  'Detroit Lions',
  'Green Bay Packers',
  'Houston Texans',
  'Indianapolis Colts',
  'Jacksonville Jaguars',
  'Kansas City Chiefs',
  'Las Vegas Raiders',
  'Los Angeles Chargers',
  'Los Angeles Rams',
  'Miami Dolphins',
  'Minnesota Vikings',
  'New England Patriots',
  'New Orleans Saints',
  'New York Giants',
  'New York Jets',
  'Philadelphia Eagles',
  'Pittsburgh Steelers',
  'San Francisco 49ers',
  'Seattle Seahawks',
  'Tampa Bay Buccaneers',
  'Tennessee Titans',
  'Washington Commanders'
] as const

const formatScheduleName = (game: GameRecord): string => `${new Date(game.game_dt).toLocaleDateString()} • ${game.opponent}`
const toDateInputValue = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export function LandingScheduleMaintenance({ pools, token, authHeaders, apiBase, onRequireSignIn }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [poolRecords, setPoolRecords] = useState<PoolRecord[]>([])
  const [games, setGames] = useState<GameRecord[]>([])
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [isScheduleListExpanded, setIsScheduleListExpanded] = useState(true)
  const [scheduleListHeight, setScheduleListHeight] = useState(SCHEDULE_LIST_DEFAULT_HEIGHT)
  const [scheduleForm, setScheduleForm] = useState({
    poolId: '',
    opponent: '',
    gameDate: '',
    isSimulation: false
  })

  const canManageSchedules = Boolean(token)

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, init)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const reason = data?.error || data?.detail || data?.message || `Request failed with status ${response.status}`
      throw new Error(reason)
    }

    return data as T
  }

  const loadGameIntoForm = (game: GameRecord | null) => {
    setSelectedGameId(game?.id ?? null)
    setIsCreatingNew(game == null)
    setScheduleForm({
      poolId: game?.pool_id != null ? String(game.pool_id) : '',
      opponent: game?.opponent ?? '',
      gameDate: game?.game_dt ? toDateInputValue(game.game_dt) : '',
      isSimulation: Boolean(game?.is_simulation)
    })
  }

  const loadScheduleData = async (preferredGameId?: number | null): Promise<void> => {
    if (!token) {
      setPoolRecords([])
      setGames([])
      loadGameIntoForm(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const poolResult = await request<{ pools: PoolRecord[] }>('/api/setup/pools', { headers: authHeaders })
      const nextPools = poolResult.pools

      const gameGroups = await Promise.all(
        nextPools.map(async (pool) => {
          const result = await request<GameRecord[]>(`/api/games?poolId=${pool.id}`, {
            headers: authHeaders
          })
          return result
        })
      )

      const nextGames = gameGroups
        .flat()
        .sort((left, right) => new Date(right.game_dt).getTime() - new Date(left.game_dt).getTime())

      setPoolRecords(nextPools)
      setGames(nextGames)

      const nextSelectedGameId =
        preferredGameId && nextGames.some((game) => game.id === preferredGameId)
          ? preferredGameId
          : nextGames[0]?.id ?? null

      const nextGame = nextGames.find((game) => game.id === nextSelectedGameId) ?? null
      loadGameIntoForm(nextGame)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load schedules')
      setPoolRecords([])
      setGames([])
      loadGameIntoForm(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadScheduleData(selectedGameId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

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
    if (!token) {
      return 'Sign in as an organizer to review and maintain schedules.'
    }

    return `${games.length} scheduled game${games.length === 1 ? '' : 's'} ready for maintenance.`
  }, [games.length, token])

  const selectedGame = useMemo(
    () => games.find((game) => game.id === selectedGameId) ?? null,
    [games, selectedGameId]
  )

  const selectedPool = useMemo(
    () => poolRecords.find((pool) => String(pool.id) === scheduleForm.poolId) ?? null,
    [poolRecords, scheduleForm.poolId]
  )

  const onSelectGame = (gameId: number): void => {
    const game = games.find((entry) => entry.id === gameId) ?? null
    loadGameIntoForm(game)
  }

  const onAddSchedule = (): void => {
    setError(null)
    loadGameIntoForm(null)
  }

  const toggleScheduleListExpanded = (): void => {
    setIsScheduleListExpanded((current) => !current)
  }

  const startScheduleListResize = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault()

    const startY = event.clientY
    const startHeight = scheduleListHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = Math.min(
        SCHEDULE_LIST_MAX_HEIGHT,
        Math.max(SCHEDULE_LIST_MIN_HEIGHT, startHeight + (moveEvent.clientY - startY))
      )
      setScheduleListHeight(nextHeight)
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp, { once: true })
  }

  const onSaveSchedule = async (): Promise<void> => {
    if (!scheduleForm.poolId || !scheduleForm.opponent.trim() || !scheduleForm.gameDate) {
      setError('Pool, opponent, and game date are required.')
      return
    }

    if (!canManageSchedules) {
      setError('Sign in as an organizer to save schedules.')
      onRequireSignIn()
      return
    }

    setSaving(true)
    setError(null)

    try {
      const payload = {
        poolId: Number(scheduleForm.poolId),
        opponent: scheduleForm.opponent.trim(),
        gameDate: scheduleForm.gameDate,
        isSimulation: scheduleForm.isSimulation
      }

      if (isCreatingNew) {
        const created = await request<{ game: { id: number } }>('/api/games', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(payload)
        })

        await loadScheduleData(created.game.id)
        return
      }

      if (!selectedGameId) {
        setError('Choose a schedule first.')
        return
      }

      await request(`/api/games/${selectedGameId}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify(payload)
      })

      await loadScheduleData(selectedGameId)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save schedule')
    } finally {
      setSaving(false)
    }
  }

  const onDeleteSchedule = async (): Promise<void> => {
    if (!selectedGameId) {
      setError('Select a schedule to delete.')
      return
    }

    if (!canManageSchedules) {
      setError('Sign in as an organizer to delete schedules.')
      onRequireSignIn()
      return
    }

    const confirmed = window.confirm('Delete this schedule?')
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      await request(`/api/games/${selectedGameId}`, {
        method: 'DELETE',
        headers: authHeaders
      })

      await loadScheduleData()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete schedule')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="player-maintenance-shell">
      <div className="landing-hero-bar landing-player-hero" style={heroStyle}>
        <div>
          <h1>Schedule Maintenance</h1>
          <p>{heroSubtitle}</p>
        </div>
      </div>

      {error ? <div className="error-banner landing-error-banner">{error}</div> : null}

      <details className="landing-collapsible" open={isScheduleListExpanded}>
        <summary
          onClick={(event) => {
            event.preventDefault()
            toggleScheduleListExpanded()
          }}
        >
          <span className="landing-summary-main">
            <button
              type="button"
              className="landing-collapse-btn"
              aria-label={isScheduleListExpanded ? 'Collapse schedules list' : 'Expand schedules list'}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                toggleScheduleListExpanded()
              }}
            >
              {isScheduleListExpanded ? '−' : '+'}
            </button>
            <span>Schedules</span>
          </span>
          <span className="landing-collapsible-count">{games.length}</span>
        </summary>

        <div className="landing-player-list-wrap is-scrollable" style={isScheduleListExpanded ? { height: `${scheduleListHeight}px` } : undefined}>
          {loading ? (
            <p className="small">Loading schedules...</p>
          ) : !token ? (
            <p className="small">Sign in to load schedule maintenance records.</p>
          ) : games.length === 0 ? (
            <p className="small">No schedules are available yet.</p>
          ) : (
            <table className="landing-player-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Opponent</th>
                  <th>Pool</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {games.map((game) => {
                  const pool = poolRecords.find((entry) => entry.id === game.pool_id)

                  return (
                    <tr
                      key={game.id}
                      className={game.id === selectedGameId ? 'is-selected' : ''}
                      onClick={() => onSelectGame(game.id)}
                    >
                      <td>{new Date(game.game_dt).toLocaleDateString()}</td>
                      <td>{game.opponent}</td>
                      <td>{pool?.pool_name?.trim() || 'Unnamed pool'}</td>
                      <td>{game.is_simulation ? 'Simulation' : 'Live'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

      </details>

      {isScheduleListExpanded ? (
        <div
          className="landing-resize-bar"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize schedules list"
          onMouseDown={startScheduleListResize}
          title="Drag to resize the schedules list"
        >
          <span />
        </div>
      ) : null}

      <div className="landing-player-maintenance-grid">
        <article className="landing-maintenance-card">
          <div className="landing-maintenance-header">
            <div>
              <h2>{isCreatingNew ? 'Add Schedule' : 'Maintain Schedule'}</h2>
              <p className="small">Create a new game or update the selected one.</p>
            </div>
            <div className="landing-maintenance-actions">
              <button type="button" className="secondary compact" onClick={onAddSchedule} disabled={saving}>
                Add
              </button>
              <button type="button" className="primary" onClick={onSaveSchedule} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" className="secondary" onClick={onDeleteSchedule} disabled={saving || !selectedGameId}>
                Delete
              </button>
            </div>
          </div>

          <div className="landing-selected-summary">
            <div className="landing-selected-summary-header">
              <div>
                <strong>{selectedGame ? formatScheduleName(selectedGame) : 'New schedule'}</strong>
                <p className="small">{selectedGame ? 'Update the schedule details below.' : 'Enter the schedule details below.'}</p>
              </div>
            </div>
          </div>

          <div className="landing-player-fields">
            <label className="field-block">
              <span>Pool</span>
              <select
                value={scheduleForm.poolId}
                onChange={(event) => setScheduleForm((current) => ({ ...current, poolId: event.target.value }))}
                disabled={saving}
              >
                <option value="">Select pool</option>
                {poolRecords.map((pool) => (
                  <option key={pool.id} value={pool.id}>
                    {(pool.team_name?.trim() || pool.primary_team?.trim() || 'Unnamed team') + ' — ' + (pool.pool_name?.trim() || 'Unnamed pool')}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-block">
              <span>Opponent</span>
              <select
                value={scheduleForm.opponent}
                onChange={(event) => setScheduleForm((current) => ({ ...current, opponent: event.target.value }))}
                disabled={saving}
              >
                <option value="">Select opponent</option>
                {scheduleForm.opponent && !NFL_TEAMS.includes(scheduleForm.opponent as (typeof NFL_TEAMS)[number]) ? (
                  <option value={scheduleForm.opponent}>{scheduleForm.opponent}</option>
                ) : null}
                {NFL_TEAMS.map((teamName) => (
                  <option key={teamName} value={teamName}>
                    {teamName}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-block">
              <span>Game date</span>
              <input
                type="date"
                value={scheduleForm.gameDate}
                onChange={(event) => setScheduleForm((current) => ({ ...current, gameDate: event.target.value }))}
                disabled={saving}
              />
            </label>

            <label className="checkbox-row landing-inline-checkbox">
              <input
                type="checkbox"
                checked={scheduleForm.isSimulation}
                onChange={(event) => setScheduleForm((current) => ({ ...current, isSimulation: event.target.checked }))}
                disabled={saving}
              />
              <span>Simulation game</span>
            </label>
          </div>

        </article>

        <aside className="landing-maintenance-card">
          <div className="landing-maintenance-header">
            <div>
              <h2>Schedule Summary</h2>
              <p className="small">Quick reference for the selected game.</p>
            </div>
          </div>

          <div className="landing-readonly-panel">
            <div className="landing-selected-summary">
              <strong>Pool</strong>
              <p className="small">{selectedPool?.pool_name ?? 'No pool selected'}</p>
            </div>

            <div className="landing-selected-summary">
              <strong>Final score</strong>
              <p className="small">
                {selectedGame?.q4_primary_score != null && selectedGame?.q4_opponent_score != null
                  ? `${selectedGame.q4_primary_score} - ${selectedGame.q4_opponent_score}`
                  : 'No final score recorded yet.'}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
