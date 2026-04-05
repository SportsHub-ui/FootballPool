import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'

type LandingPool = {
  id: number
  pool_name: string | null
  season: number | null
  primary_team: string | null
  default_flg: boolean
  sign_in_req_flg: boolean
  display_token: string | null
  team_name: string | null
  primary_color: string | null
  secondary_color: string | null
  logo_file: string | null
}

type TeamRecord = {
  id: number
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
  display_token: string | null
  team_name: string | null
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
const NFL_SEASON_GAMES = 17
const SHOW_SIMULATION_CONTROLS =
  (import.meta.env.VITE_ENABLE_SIMULATION_CONTROLS ?? 'true').toString().toLowerCase() === 'true'
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

const formatSimulationMode = (mode: SimulationMode | null | undefined): string => {
  if (mode === 'by_game') return 'By Game'
  if (mode === 'by_quarter') return 'By Quarter'
  return 'Full Year'
}

const buildReadonlyPoolRecords = (pools: LandingPool[]): PoolRecord[] =>
  pools.map((pool) => ({
    id: pool.id,
    pool_name: pool.pool_name,
    team_id: null,
    season: pool.season,
    primary_team: pool.primary_team,
    square_cost: null,
    q1_payout: null,
    q2_payout: null,
    q3_payout: null,
    q4_payout: null,
    display_token: pool.display_token,
    team_name: pool.team_name
  }))

export function LandingPoolMaintenance({ pools, token, authHeaders, apiBase, onRequireSignIn }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [teamOptions, setTeamOptions] = useState<TeamRecord[]>([])
  const [poolRecords, setPoolRecords] = useState<PoolRecord[]>([])
  const [poolGames, setPoolGames] = useState<GameRecord[]>([])
  const [hasOrganizerAccess, setHasOrganizerAccess] = useState(false)
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null)
  const [simulationStatus, setSimulationStatus] = useState<SimulationControlStatus | null>(null)
  const [simulationMode, setSimulationMode] = useState<SimulationMode>('full_year')
  const simulationAdvanceSource: 'espn' = 'espn'
  const [simulationBusy, setSimulationBusy] = useState<'create-simulation' | 'cleanup-simulation' | 'advance-simulation' | null>(null)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [isPoolListExpanded, setIsPoolListExpanded] = useState(true)
  const [poolListHeight, setPoolListHeight] = useState(POOL_LIST_DEFAULT_HEIGHT)
  const [poolForm, setPoolForm] = useState({
    poolName: '',
    teamId: '',
    season: new Date().getFullYear(),
    primaryTeam: 'Green Bay Packers',
    squareCost: 0,
    q1Payout: 0,
    q2Payout: 0,
    q3Payout: 0,
    q4Payout: 0
  })

  const canManagePools = hasOrganizerAccess

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
    setSelectedPoolId(pool?.id ?? null)
    setIsCreatingNew(pool == null)
    setPoolForm({
      poolName: pool?.pool_name ?? '',
      teamId: pool?.team_id != null ? String(pool.team_id) : '',
      season: pool?.season ?? new Date().getFullYear(),
      primaryTeam: pool?.primary_team ?? 'Green Bay Packers',
      squareCost: pool?.square_cost ?? 0,
      q1Payout: pool?.q1_payout ?? 0,
      q2Payout: pool?.q2_payout ?? 0,
      q3Payout: pool?.q3_payout ?? 0,
      q4Payout: pool?.q4_payout ?? 0
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
    const q1Payout = Math.max(0, Number(poolForm.q1Payout) || 0)
    const q2Payout = Math.max(0, Number(poolForm.q2Payout) || 0)
    const q3Payout = Math.max(0, Number(poolForm.q3Payout) || 0)
    const q4Payout = Math.max(0, Number(poolForm.q4Payout) || 0)

    const totalRevenue = squareCost * TOTAL_SQUARES
    const totalPayout = (q1Payout + q2Payout + q3Payout + q4Payout) * NFL_SEASON_GAMES

    const rawPaidOutToDate = poolGames.reduce((sum, game) => {
      return (
        sum +
        (hasRecordedQuarter(game.q1_primary_score, game.q1_opponent_score) ? q1Payout : 0) +
        (hasRecordedQuarter(game.q2_primary_score, game.q2_opponent_score) ? q2Payout : 0) +
        (hasRecordedQuarter(game.q3_primary_score, game.q3_opponent_score) ? q3Payout : 0) +
        (hasRecordedQuarter(game.q4_primary_score, game.q4_opponent_score) ? q4Payout : 0)
      )
    }, 0)

    const paidOutToDate = Math.min(rawPaidOutToDate, totalPayout)

    return {
      totalRevenue,
      totalPayout,
      totalRaisedForTeam: totalRevenue - totalPayout,
      paidOutToDate,
      remainingToBePaid: Math.max(0, totalPayout - paidOutToDate)
    }
  }, [poolForm.q1Payout, poolForm.q2Payout, poolForm.q3Payout, poolForm.q4Payout, poolForm.squareCost, poolGames])

  const onSelectPool = (poolId: number): void => {
    const pool = poolRecords.find((entry) => entry.id === poolId) ?? null
    loadPoolIntoForm(pool)
  }

  const onAddPool = (): void => {
    setError(null)
    loadPoolIntoForm(null)
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
    if (!poolForm.poolName.trim() || !poolForm.teamId || !poolForm.primaryTeam.trim()) {
      setError('Pool name, team, and primary team are required.')
      return
    }

    if (!canManagePools) {
      setError('Sign in as an organizer to save pools.')
      onRequireSignIn()
      return
    }

    setSaving(true)
    setError(null)

    try {
      const payload = {
        poolName: poolForm.poolName.trim(),
        teamId: Number(poolForm.teamId),
        season: Number(poolForm.season),
        primaryTeam: poolForm.primaryTeam.trim(),
        squareCost: Number(poolForm.squareCost),
        q1Payout: Number(poolForm.q1Payout),
        q2Payout: Number(poolForm.q2Payout),
        q3Payout: Number(poolForm.q3Payout),
        q4Payout: Number(poolForm.q4Payout)
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

  const hasSimulationData = simulationStatus?.hasSimulationData ?? poolGames.some((game) => game.is_simulation)
  const simulationButtonLabel = hasSimulationData ? 'Cleanup' : `Start ${formatSimulationMode(simulationMode)}`
  const simulationButtonDisabled = hasSimulationData
    ? !selectedPoolId || saving || simulationBusy !== null || !(simulationStatus?.canCleanup ?? hasSimulationData)
    : !selectedPoolId || saving || simulationBusy !== null || !(simulationStatus?.canSimulate ?? false)
  const simulationButtonTitle = !selectedPoolId
    ? 'Select a pool to enable simulation.'
    : hasSimulationData
      ? 'Remove the simulated season data for this pool.'
      : simulationStatus?.canSimulate
        ? simulationMode === 'full_year'
          ? 'Create the full season simulation for this pool.'
          : simulationMode === 'by_game'
            ? 'Start a simulation that advances one game at a time.'
            : 'Start a simulation that advances one quarter at a time.'
        : simulationStatus?.blockers.join(' ') || 'Simulation unavailable for this pool.'
  const showSimulationTooltip = simulationButtonDisabled && Boolean(simulationButtonTitle)
  const simulationProgressNote = simulationStatus?.hasSimulationData
    ? simulationStatus.mode
      ? `Active simulation: ${formatSimulationMode(simulationStatus.mode)}.`
      : null
    : null
  const showSimulationAdvance = Boolean(simulationStatus?.progressAction)
  const simulationAdvanceLabel = simulationStatus?.progressAction === 'complete_game' ? 'Complete Game' : 'Complete Quarter'

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
            : 'Start a By Quarter simulation for this pool? The first game will get row/col numbers now, then Complete Quarter on the Scores page will progress one quarter at a time.'
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

  const handleSimulationAdvance = async (): Promise<void> => {
    if (!selectedPoolId || !simulationStatus?.canAdvance) {
      return
    }

    setSimulationBusy('advance-simulation')
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
          body: JSON.stringify({ source: simulationAdvanceSource })
        }
      )

      await loadPoolData(selectedPoolId)
      await loadPoolGames(selectedPoolId)
      setSimulationStatus(result.status ?? null)
      setNotice(result.message ?? `${simulationAdvanceLabel} complete.`)
    } catch (simulationError) {
      setError(simulationError instanceof Error ? simulationError.message : `Failed to ${simulationAdvanceLabel.toLowerCase()}`)
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
                  <th>Team</th>
                  <th>Season</th>
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
              <button type="button" className="secondary" onClick={onFillSchedule} disabled={saving || simulationBusy !== null || !selectedPoolId}>
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
                      <option value="by_quarter">By Quarter</option>
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
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void handleSimulationAdvance()}
                      disabled={saving || simulationBusy !== null || !selectedPoolId || !(simulationStatus?.canAdvance ?? false)}
                    >
                      {simulationBusy === 'advance-simulation' ? 'Completing...' : simulationAdvanceLabel}
                    </button>
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
              <span>Team</span>
              <select
                value={poolForm.teamId}
                onChange={(event) => setPoolForm((current) => ({ ...current, teamId: event.target.value }))}
                disabled={saving}
              >
                <option value="">Select team</option>
                {teamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.team_name ?? `Team ${team.id}`}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-block">
              <span>Season</span>
              <input
                type="number"
                value={poolForm.season}
                onChange={(event) => setPoolForm((current) => ({ ...current, season: Number(event.target.value) }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Primary Team</span>
              <select
                value={poolForm.primaryTeam}
                onChange={(event) => setPoolForm((current) => ({ ...current, primaryTeam: event.target.value }))}
                disabled={saving}
              >
                {NFL_TEAMS.map((teamName) => (
                  <option key={teamName} value={teamName}>
                    {teamName}
                  </option>
                ))}
              </select>
            </label>

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

            <label className="field-block">
              <span>Q1 payout</span>
              <input
                type="text"
                inputMode="numeric"
                value={formatCurrencyInput(poolForm.q1Payout)}
                onChange={(event) => setPoolForm((current) => ({ ...current, q1Payout: parseCurrencyInput(event.target.value) }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Q2 payout</span>
              <input
                type="text"
                inputMode="numeric"
                value={formatCurrencyInput(poolForm.q2Payout)}
                onChange={(event) => setPoolForm((current) => ({ ...current, q2Payout: parseCurrencyInput(event.target.value) }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Q3 payout</span>
              <input
                type="text"
                inputMode="numeric"
                value={formatCurrencyInput(poolForm.q3Payout)}
                onChange={(event) => setPoolForm((current) => ({ ...current, q3Payout: parseCurrencyInput(event.target.value) }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Q4 payout</span>
              <input
                type="text"
                inputMode="numeric"
                value={formatCurrencyInput(poolForm.q4Payout)}
                onChange={(event) => setPoolForm((current) => ({ ...current, q4Payout: parseCurrencyInput(event.target.value) }))}
                disabled={saving}
              />
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
