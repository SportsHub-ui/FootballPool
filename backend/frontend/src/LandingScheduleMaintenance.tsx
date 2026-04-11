import { Fragment, useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

import type { LandingPool } from './LandingMetrics'
import { getPoolTemplateDefinition } from './utils/poolStructures'

type PoolRecord = {
  id: number
  pool_name: string | null
  team_id: number | null
  season: number | null
  pool_type?: string | null
  structure_mode?: string | null
  template_code?: string | null
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
  week_num: number | null
  round_label?: string | null
  round_sequence?: number | null
  bracket_region?: string | null
  matchup_order?: number | null
  championship_flg?: boolean
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

const getRoundHeading = (game: Pick<GameRecord, 'round_label' | 'round_sequence' | 'bracket_region' | 'championship_flg'>): string => {
  if (game.round_label?.trim()) {
    return game.bracket_region?.trim() ? `${game.round_label} • ${game.bracket_region}` : game.round_label
  }

  if (game.championship_flg) {
    return 'Championship'
  }

  if (game.round_sequence != null) {
    return `Round ${game.round_sequence}`
  }

  return 'General Schedule'
}

const formatScheduleName = (game: GameRecord): string => {
  const heading = getRoundHeading(game)
  return `${heading} • ${new Date(game.game_dt).toLocaleDateString()} • ${game.opponent}`
}
const toDateInputValue = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

export function LandingScheduleMaintenance({ pools, token, authHeaders, apiBase, onRequireSignIn }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [refreshingActiveGames, setRefreshingActiveGames] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshFeedback, setRefreshFeedback] = useState<string | null>(null)
  const [poolRecords, setPoolRecords] = useState<PoolRecord[]>([])
  const [games, setGames] = useState<GameRecord[]>([])
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [isScheduleListExpanded, setIsScheduleListExpanded] = useState(true)
  const [scheduleListHeight, setScheduleListHeight] = useState(SCHEDULE_LIST_DEFAULT_HEIGHT)
  const [scheduleForm, setScheduleForm] = useState({
    poolId: '',
    weekNum: '',
    roundLabel: '',
    bracketRegion: '',
    matchupOrder: '',
    opponent: '',
    gameDate: '',
    isSimulation: false,
    isChampionship: false
  })

  const canManageSchedules = Boolean(token)

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, { credentials: 'include', ...init })
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
      weekNum: game?.round_sequence != null ? String(game.round_sequence) : game?.week_num != null ? String(game.week_num) : '',
      roundLabel: game?.round_label ?? '',
      bracketRegion: game?.bracket_region ?? '',
      matchupOrder: game?.matchup_order != null ? String(game.matchup_order) : '',
      opponent: game?.opponent ?? '',
      gameDate: game?.game_dt ? toDateInputValue(game.game_dt) : '',
      isSimulation: Boolean(game?.is_simulation),
      isChampionship: Boolean(game?.championship_flg)
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
        .sort(
          (left, right) =>
            (left.round_sequence ?? left.week_num ?? Number.MAX_SAFE_INTEGER) -
              (right.round_sequence ?? right.week_num ?? Number.MAX_SAFE_INTEGER) ||
            (left.matchup_order ?? Number.MAX_SAFE_INTEGER) - (right.matchup_order ?? Number.MAX_SAFE_INTEGER) ||
            new Date(left.game_dt).getTime() - new Date(right.game_dt).getTime()
        )

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

  const selectedTemplateDefinition = useMemo(
    () => getPoolTemplateDefinition(selectedPool?.template_code),
    [selectedPool?.template_code]
  )

  const selectedRoundDefinition = useMemo(
    () => selectedTemplateDefinition?.rounds.find((round) => round.label === scheduleForm.roundLabel) ?? null,
    [scheduleForm.roundLabel, selectedTemplateDefinition]
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
      setError('Pool, matchup label, and game date are required.')
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
        weekNum: scheduleForm.weekNum ? Number(scheduleForm.weekNum) : undefined,
        roundLabel: scheduleForm.roundLabel.trim() || undefined,
        roundSequence: scheduleForm.weekNum ? Number(scheduleForm.weekNum) : undefined,
        bracketRegion: scheduleForm.bracketRegion.trim() || undefined,
        matchupOrder: scheduleForm.matchupOrder ? Number(scheduleForm.matchupOrder) : undefined,
        isChampionship: scheduleForm.isChampionship,
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

  const onRefreshActiveGames = async (): Promise<void> => {
    if (!token) {
      setError('Sign in as an organizer to refresh active games.')
      onRequireSignIn()
      return
    }

    setRefreshingActiveGames(true)
    setError(null)
    setRefreshFeedback(null)

    try {
      const result = await request<{ total?: number; success?: number; failed?: number }>('/api/ingestion/run', {
        method: 'POST',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ source: 'espn' })
      })

      const total = Number(result.total ?? 0)
      const success = Number(result.success ?? 0)
      const failed = Number(result.failed ?? 0)

      setRefreshFeedback(
        total > 0
          ? `Refresh finished: ${success} of ${total} active game${total === 1 ? '' : 's'} checked${failed > 0 ? `, ${failed} failed` : ''}.`
          : 'No eligible active games need a refresh right now.'
      )

      await loadScheduleData(selectedGameId)
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Failed to refresh active games')
    } finally {
      setRefreshingActiveGames(false)
    }
  }

  return (
    <section className="player-maintenance-shell">
      <div className="landing-hero-bar landing-player-hero" style={heroStyle}>
        <div>
          <h1>Schedule Maintenance</h1>
          <p>{heroSubtitle}</p>
        </div>

        <div className="landing-hero-controls">
          <button
            type="button"
            className="secondary compact"
            onClick={() => {
              void onRefreshActiveGames()
            }}
            disabled={refreshingActiveGames || !token}
          >
            {refreshingActiveGames ? 'Refreshing active games...' : 'Refresh Active Games'}
          </button>
          {refreshFeedback ? <p className="small">{refreshFeedback}</p> : null}
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
                  <th>Round</th>
                  <th>Order</th>
                  <th>Date</th>
                  <th>Opponent</th>
                  <th>Pool</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                {games.map((game, index) => {
                  const pool = poolRecords.find((entry) => entry.id === game.pool_id)
                  const previousGame = index > 0 ? games[index - 1] : null
                  const currentGroupKey = `${game.pool_id}:${getRoundHeading(game)}`
                  const previousGroupKey = previousGame ? `${previousGame.pool_id}:${getRoundHeading(previousGame)}` : null
                  const showGroupHeader = currentGroupKey !== previousGroupKey

                  return (
                    <Fragment key={game.id}>
                      {showGroupHeader ? (
                        <tr key={`${game.id}-group`} className="landing-group-row">
                          <td colSpan={6}>
                            <strong>{getRoundHeading(game)}</strong>
                            <span className="small"> — {pool?.pool_name?.trim() || 'Unnamed pool'}</span>
                          </td>
                        </tr>
                      ) : null}
                      <tr
                        key={game.id}
                        className={game.id === selectedGameId ? 'is-selected' : ''}
                        onClick={() => onSelectGame(game.id)}
                      >
                        <td>{game.round_label ?? (game.championship_flg ? 'Championship' : game.bracket_region ?? 'General')}</td>
                        <td>{game.matchup_order ?? game.round_sequence ?? game.week_num ?? '—'}</td>
                        <td>{new Date(game.game_dt).toLocaleDateString()}</td>
                        <td>{game.opponent}</td>
                        <td>{pool?.pool_name?.trim() || 'Unnamed pool'}</td>
                        <td>{game.is_simulation ? 'Simulation' : 'Live'}</td>
                      </tr>
                    </Fragment>
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
                onChange={(event) => {
                  const nextPoolId = event.target.value
                  const nextPool = poolRecords.find((pool) => String(pool.id) === nextPoolId) ?? null
                  const nextTemplate = getPoolTemplateDefinition(nextPool?.template_code)

                  setScheduleForm((current) => ({
                    ...current,
                    poolId: nextPoolId,
                    roundLabel: current.roundLabel || nextTemplate?.rounds[0]?.label || '',
                    weekNum: current.weekNum || (nextTemplate?.rounds[0]?.sequence != null ? String(nextTemplate.rounds[0].sequence) : ''),
                    bracketRegion: current.bracketRegion
                  }))
                }}
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
              <span>Round / stage</span>
              <>
                <input
                  list="schedule-round-options"
                  value={scheduleForm.roundLabel}
                  onChange={(event) => {
                    const nextRoundLabel = event.target.value
                    const matchedRound = selectedTemplateDefinition?.rounds.find((round) => round.label === nextRoundLabel)
                    setScheduleForm((current) => ({
                      ...current,
                      roundLabel: nextRoundLabel,
                      weekNum: matchedRound?.sequence != null ? String(matchedRound.sequence) : current.weekNum,
                      isChampionship: matchedRound?.championship ?? current.isChampionship
                    }))
                  }}
                  placeholder="e.g. Sweet 16, Final Four, Championship"
                  disabled={saving}
                />
                <datalist id="schedule-round-options">
                  {(selectedTemplateDefinition?.rounds ?? []).map((round) => (
                    <option key={round.label} value={round.label} />
                  ))}
                </datalist>
              </>
            </label>

            <label className="field-block">
              <span>Region / pod (optional)</span>
              <>
                <input
                  list="schedule-region-options"
                  value={scheduleForm.bracketRegion}
                  onChange={(event) => setScheduleForm((current) => ({ ...current, bracketRegion: event.target.value }))}
                  placeholder="e.g. Midwest, East"
                  disabled={saving}
                />
                <datalist id="schedule-region-options">
                  {(selectedRoundDefinition?.regions ?? []).map((region) => (
                    <option key={region} value={region} />
                  ))}
                </datalist>
              </>
            </label>

            <label className="field-block">
              <span>Round order / week (optional)</span>
              <input
                type="number"
                min="1"
                max="400"
                value={scheduleForm.weekNum}
                onChange={(event) => setScheduleForm((current) => ({ ...current, weekNum: event.target.value }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Matchup slot (optional)</span>
              <input
                type="number"
                min="1"
                max="100"
                value={scheduleForm.matchupOrder}
                onChange={(event) => setScheduleForm((current) => ({ ...current, matchupOrder: event.target.value }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Opponent or matchup label</span>
              <input
                value={scheduleForm.opponent}
                onChange={(event) => setScheduleForm((current) => ({ ...current, opponent: event.target.value }))}
                placeholder="e.g. Lions, Duke vs Houston, AFC Championship"
                disabled={saving}
              />
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
                checked={scheduleForm.isChampionship}
                onChange={(event) =>
                  setScheduleForm((current) => ({
                    ...current,
                    isChampionship: event.target.checked,
                    roundLabel: event.target.checked ? 'Championship' : current.roundLabel
                  }))
                }
                disabled={saving}
              />
              <span>Championship game</span>
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

            {selectedTemplateDefinition ? (
              <p className="small landing-readonly-note landing-field-span">
                Template guide: {selectedTemplateDefinition.label} includes {selectedTemplateDefinition.rounds.map((round) => round.label).join(', ')}.
                Later rounds are preloaded with winner-path labels so the bracket can read like “Winner of Sweet 16 Game 1 vs Winner of Sweet 16 Game 2.”
              </p>
            ) : null}
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
              <strong>Round</strong>
              <p className="small">{selectedGame ? getRoundHeading(selectedGame) : scheduleForm.roundLabel || 'No round selected'}</p>
            </div>

            <div className="landing-selected-summary">
              <strong>Matchup order</strong>
              <p className="small">{(selectedGame?.matchup_order ?? scheduleForm.matchupOrder) || 'No order set'}</p>
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
