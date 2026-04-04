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

type TeamRecord = {
  id: number
  team_name: string | null
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

const formatCurrency = (value: number | null | undefined): string =>
  value == null ? '—' : `$${value.toLocaleString()}`

const formatPoolName = (pool: Pick<PoolRecord, 'id' | 'pool_name'>): string => pool.pool_name ?? `Pool ${pool.id}`

export function LandingPoolMaintenance({ pools, token, authHeaders, apiBase, onRequireSignIn }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teamOptions, setTeamOptions] = useState<TeamRecord[]>([])
  const [poolRecords, setPoolRecords] = useState<PoolRecord[]>([])
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [isPoolListExpanded, setIsPoolListExpanded] = useState(true)
  const [poolListHeight, setPoolListHeight] = useState(POOL_LIST_DEFAULT_HEIGHT)
  const [poolForm, setPoolForm] = useState({
    poolName: '',
    teamId: '',
    season: new Date().getFullYear(),
    primaryTeam: '',
    squareCost: 0,
    q1Payout: 0,
    q2Payout: 0,
    q3Payout: 0,
    q4Payout: 0
  })

  const canManagePools = Boolean(token)

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, init)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const reason = data?.error || data?.detail || data?.message || `Request failed with status ${response.status}`
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
      primaryTeam: pool?.primary_team ?? '',
      squareCost: pool?.square_cost ?? 0,
      q1Payout: pool?.q1_payout ?? 0,
      q2Payout: pool?.q2_payout ?? 0,
      q3Payout: pool?.q3_payout ?? 0,
      q4Payout: pool?.q4_payout ?? 0
    })
  }

  const loadPoolData = async (preferredPoolId?: number | null): Promise<void> => {
    if (!token) {
      setPoolRecords([])
      setTeamOptions([])
      loadPoolIntoForm(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [teamResult, poolResult] = await Promise.all([
        request<{ teams: TeamRecord[] }>('/api/setup/teams', { headers: authHeaders }),
        request<{ pools: PoolRecord[] }>('/api/setup/pools', { headers: authHeaders })
      ])

      setTeamOptions(teamResult.teams)
      setPoolRecords(poolResult.pools)

      const nextSelectedPoolId =
        preferredPoolId && poolResult.pools.some((pool) => pool.id === preferredPoolId)
          ? preferredPoolId
          : poolResult.pools[0]?.id ?? null

      const nextPool = poolResult.pools.find((pool) => pool.id === nextSelectedPoolId) ?? null
      loadPoolIntoForm(nextPool)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load pools')
      setPoolRecords([])
      setTeamOptions([])
      loadPoolIntoForm(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPoolData(selectedPoolId)
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
      return 'Sign in as an organizer to review and maintain pools.'
    }

    return `${poolRecords.length} pool record${poolRecords.length === 1 ? '' : 's'} ready for maintenance.`
  }, [poolRecords.length, token])

  const selectedPool = useMemo(
    () => poolRecords.find((pool) => pool.id === selectedPoolId) ?? null,
    [poolRecords, selectedPoolId]
  )

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
          ) : !token ? (
            <p className="small">Sign in to load pool maintenance records.</p>
          ) : poolRecords.length === 0 ? (
            <p className="small">No pools are available yet.</p>
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
              <button type="button" className="secondary compact" onClick={onAddPool} disabled={saving}>
                Add
              </button>
              <button type="button" className="primary" onClick={onSavePool} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" className="secondary" onClick={onDeletePool} disabled={saving || !selectedPoolId}>
                Delete
              </button>
            </div>
          </div>

          <div className="landing-selected-summary">
            <div className="landing-selected-summary-header">
              <div>
                <strong>{selectedPool ? formatPoolName(selectedPool) : 'New pool'}</strong>
                <p className="small">{selectedPool ? `Pool ID ${selectedPool.id}` : 'Enter the pool details below.'}</p>
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
              <span>Primary team label</span>
              <input
                value={poolForm.primaryTeam}
                onChange={(event) => setPoolForm((current) => ({ ...current, primaryTeam: event.target.value }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Square cost</span>
              <input
                type="number"
                value={poolForm.squareCost}
                onChange={(event) => setPoolForm((current) => ({ ...current, squareCost: Number(event.target.value) }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Q1 payout</span>
              <input
                type="number"
                value={poolForm.q1Payout}
                onChange={(event) => setPoolForm((current) => ({ ...current, q1Payout: Number(event.target.value) }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Q2 payout</span>
              <input
                type="number"
                value={poolForm.q2Payout}
                onChange={(event) => setPoolForm((current) => ({ ...current, q2Payout: Number(event.target.value) }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Q3 payout</span>
              <input
                type="number"
                value={poolForm.q3Payout}
                onChange={(event) => setPoolForm((current) => ({ ...current, q3Payout: Number(event.target.value) }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Q4 payout</span>
              <input
                type="number"
                value={poolForm.q4Payout}
                onChange={(event) => setPoolForm((current) => ({ ...current, q4Payout: Number(event.target.value) }))}
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
            <div className="landing-selected-summary">
              <strong>Square cost</strong>
              <p className="small">{formatCurrency(poolForm.squareCost)}</p>
            </div>

            <div className="landing-selected-summary">
              <strong>Quarter payouts</strong>
              <p className="small">Q1: {formatCurrency(poolForm.q1Payout)}</p>
              <p className="small">Q2: {formatCurrency(poolForm.q2Payout)}</p>
              <p className="small">Q3: {formatCurrency(poolForm.q3Payout)}</p>
              <p className="small">Q4: {formatCurrency(poolForm.q4Payout)}</p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  )
}
