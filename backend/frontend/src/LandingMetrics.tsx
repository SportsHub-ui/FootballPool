import { useEffect, useMemo, useState } from 'react'

type LandingPool = {
  id: number
  pool_name: string | null
  season: number | null
  primary_team: string | null
  square_cost?: number | null
  default_flg: boolean
  sign_in_req_flg: boolean
  team_name: string | null
  primary_color: string | null
  secondary_color: string | null
  logo_file: string | null
}

type PoolMetricsResponse = {
  pool: {
    id: number
    pool_name: string | null
    season: number | null
    primary_team: string | null
    team_name: string | null
    square_cost: number | null
  }
  summary: {
    totalSquares: number
    soldSquares: number
    openSquares: number
    paidSquares: number
    unpaidSquares: number
    uniqueParticipants: number
    uniquePlayers: number
    totalGames: number
    completedGames: number
    totalAwarded: number
    totalPaidOut: number
    totalPending: number
  }
  playerMetrics: Array<{
    playerId: number
    playerName: string
    jerseyNum: number | null
    squaresSold: number
    winsCount: number
    totalWon: number
  }>
  participantMetrics: Array<{
    participantId: number
    participantName: string
    squaresOwned: number
    squaresPaid: number
    winsCount: number
    amountWon: number
  }>
}

type ChartSlice = {
  label: string
  value: number
  color: string
}

type Props = {
  pools: LandingPool[]
  token: string | null
  authHeaders: Record<string, string>
  apiBase: string
  selectedPoolId: number | null
  onSelectPool: (poolId: number | null) => void | Promise<void>
  onRequireSignIn: () => void
}

const DEFAULT_HERO_COLOR = '#8a8f98'
const DEFAULT_HERO_ACCENT = '#ffffff'
const CHART_COLORS = ['#1f9d55', '#c85b2a', '#4f46e5', '#f59e0b', '#d946ef', '#0f766e']

const formatCurrency = (value: number): string => `$${value.toLocaleString()}`
const formatPercent = (value: number): string => `${Math.round(value)}%`
const formatMetricPercent = (value: number | null): string => (value == null ? '—' : `${Math.round(value)}%`)

const calculateReturnPercent = (winnings: number, baseAmount: number): number | null => {
  if (baseAmount <= 0) return null
  return (winnings / baseAmount) * 100
}

const calculateNetRoiPercent = (winnings: number, baseAmount: number): number | null => {
  if (baseAmount <= 0) return null
  return ((winnings - baseAmount) / baseAmount) * 100
}

const getPercentClassName = (value: number | null): string => {
  if (value == null) return 'metrics-percent metrics-percent-neutral'
  if (value > 0) return 'metrics-percent metrics-percent-positive'
  if (value < 0) return 'metrics-percent metrics-percent-negative'
  return 'metrics-percent metrics-percent-neutral'
}

const buildEmptyMetrics = (pool: LandingPool | null, poolId: number): PoolMetricsResponse => ({
  pool: {
    id: pool?.id ?? poolId,
    pool_name: pool?.pool_name ?? null,
    season: pool?.season ?? null,
    primary_team: pool?.primary_team ?? null,
    team_name: pool?.team_name ?? null,
    square_cost: pool?.square_cost ?? null
  },
  summary: {
    totalSquares: 100,
    soldSquares: 0,
    openSquares: 100,
    paidSquares: 0,
    unpaidSquares: 0,
    uniqueParticipants: 0,
    uniquePlayers: 0,
    totalGames: 0,
    completedGames: 0,
    totalAwarded: 0,
    totalPaidOut: 0,
    totalPending: 0
  },
  playerMetrics: [],
  participantMetrics: []
})

const buildPieBackground = (slices: ChartSlice[]): string => {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0)
  if (total <= 0) {
    return 'conic-gradient(#e7edf4 0deg 360deg)'
  }

  let startDeg = 0
  const stops = slices
    .filter((slice) => slice.value > 0)
    .map((slice) => {
      const sweep = (slice.value / total) * 360
      const stop = `${slice.color} ${startDeg}deg ${startDeg + sweep}deg`
      startDeg += sweep
      return stop
    })

  return `conic-gradient(${stops.join(', ')})`
}

function PieChartCard({ title, subtitle, slices }: { title: string; subtitle: string; slices: ChartSlice[] }) {
  const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0)

  return (
    <article className="panel">
      <h2>{title}</h2>
      <p className="small">{subtitle}</p>
      <div className="metrics-pie-layout">
        <div className="metrics-pie-chart" style={{ background: buildPieBackground(slices) }} aria-label={title} />
        <div className="metrics-legend">
          {slices.map((slice) => (
            <div key={slice.label} className="metrics-legend-item">
              <span className="metrics-legend-label">
                <span className="metrics-legend-swatch" style={{ backgroundColor: slice.color }} />
                {slice.label}
              </span>
              <strong>{slice.value.toLocaleString()}</strong>
            </div>
          ))}
          <p className="small metrics-chart-total">Total: {total.toLocaleString()}</p>
        </div>
      </div>
    </article>
  )
}

export function LandingMetrics({
  pools,
  token,
  authHeaders,
  apiBase,
  selectedPoolId,
  onSelectPool,
  onRequireSignIn
}: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<PoolMetricsResponse | null>(null)

  useEffect(() => {
    if (!selectedPoolId) {
      setMetrics(null)
      setError(null)
      setNotice(null)
      return
    }

    let isActive = true

    const loadMetrics = async (): Promise<void> => {
      setLoading(true)
      setError(null)
      setNotice(null)

      try {
        const response = await fetch(`${apiBase}/api/landing/pools/${selectedPoolId}/metrics`, {
          headers: authHeaders
        })

        const data = await response.json().catch(() => ({}))
        const fallbackMetrics = buildEmptyMetrics(
          pools.find((pool) => pool.id === selectedPoolId) ?? null,
          selectedPoolId
        )

        if (!response.ok) {
          const reason = data?.error || data?.detail || data?.message || 'Failed to load metrics'

          if (/sign in|forbidden|unauthorized|pool not found or unavailable/i.test(reason)) {
            throw new Error(reason)
          }

          if (isActive) {
            setMetrics(fallbackMetrics)
            setNotice('No metrics data is available for this pool yet. The charts will fill in as squares are sold and winnings are recorded.')
          }
          return
        }

        if (isActive) {
          const nextMetrics = data && typeof data === 'object' && 'summary' in data
            ? (data as PoolMetricsResponse)
            : fallbackMetrics

          setMetrics(nextMetrics)

          if (
            nextMetrics.summary.soldSquares === 0 &&
            nextMetrics.summary.totalAwarded === 0 &&
            nextMetrics.playerMetrics.length === 0 &&
            nextMetrics.participantMetrics.length === 0
          ) {
            setNotice('No metrics data is available for this pool yet. The charts will fill in as squares are sold and winnings are recorded.')
          }
        }
      } catch (loadError) {
        if (isActive) {
          const message = loadError instanceof Error ? loadError.message : 'Failed to load metrics'
          const isAuthIssue = /sign in|forbidden|unauthorized|pool not found or unavailable/i.test(message)

          if (isAuthIssue) {
            setError(message)
            setMetrics(null)
            if (!token && /sign in|forbidden|unauthorized/i.test(message)) {
              onRequireSignIn()
            }
          } else {
            setMetrics(buildEmptyMetrics(pools.find((pool) => pool.id === selectedPoolId) ?? null, selectedPoolId))
            setNotice('No metrics data is available for this pool yet. The charts will fill in as squares are sold and winnings are recorded.')
          }
        }
      } finally {
        if (isActive) {
          setLoading(false)
        }
      }
    }

    void loadMetrics()

    return () => {
      isActive = false
    }
  }, [apiBase, authHeaders, onRequireSignIn, pools, selectedPoolId, token])

  const selectedPool = useMemo(
    () => pools.find((pool) => pool.id === selectedPoolId) ?? null,
    [pools, selectedPoolId]
  )

  const heroStyle = useMemo(
    () => ({
      backgroundColor: selectedPool?.primary_color ?? DEFAULT_HERO_COLOR,
      color: selectedPool?.secondary_color ?? DEFAULT_HERO_ACCENT
    }),
    [selectedPool]
  )

  const playerBySales = useMemo(
    () => [...(metrics?.playerMetrics ?? [])].sort((a, b) => b.squaresSold - a.squaresSold || b.totalWon - a.totalWon),
    [metrics]
  )

  const playerByWinnings = useMemo(
    () => [...(metrics?.playerMetrics ?? [])].sort((a, b) => b.totalWon - a.totalWon || b.winsCount - a.winsCount),
    [metrics]
  )

  const participantLeaderboard = useMemo(
    () => [...(metrics?.participantMetrics ?? [])].sort((a, b) => b.amountWon - a.amountWon || b.winsCount - a.winsCount),
    [metrics]
  )

  const summary = metrics?.summary
  const squareCost = metrics?.pool.square_cost ?? 0

  const soldRate = summary && summary.totalSquares > 0 ? (summary.soldSquares / summary.totalSquares) * 100 : 0
  const payoutRate = summary && summary.totalAwarded > 0 ? (summary.totalPaidOut / summary.totalAwarded) * 100 : 0
  const averageSquaresPerParticipant = summary && summary.uniqueParticipants > 0 ? summary.soldSquares / summary.uniqueParticipants : 0

  const ownershipSlices = useMemo<ChartSlice[]>(() => [
    { label: 'Sold', value: summary?.soldSquares ?? 0, color: '#1f9d55' },
    { label: 'Open', value: summary?.openSquares ?? 0, color: '#d9e1ea' }
  ], [summary])

  const payoutSlices = useMemo<ChartSlice[]>(() => [
    { label: 'Paid out', value: summary?.totalPaidOut ?? 0, color: '#2563eb' },
    { label: 'Pending', value: summary?.totalPending ?? 0, color: '#f59e0b' }
  ], [summary])

  const topPlayerSlices = useMemo<ChartSlice[]>(
    () => playerBySales.slice(0, 5).map((item, index) => ({
      label: item.jerseyNum != null ? `#${item.jerseyNum} ${item.playerName}` : item.playerName,
      value: item.squaresSold,
      color: CHART_COLORS[index % CHART_COLORS.length]
    })),
    [playerBySales]
  )

  const topParticipantSlices = useMemo<ChartSlice[]>(
    () => participantLeaderboard.slice(0, 5).map((item, index) => ({
      label: item.participantName,
      value: item.amountWon,
      color: CHART_COLORS[index % CHART_COLORS.length]
    })),
    [participantLeaderboard]
  )

  const ideas = useMemo(() => {
    if (!summary) return []

    const notes = [
      `Sell-through rate is ${formatPercent(soldRate)} with ${summary.soldSquares} of ${summary.totalSquares} squares claimed.`,
      `Average ownership is ${averageSquaresPerParticipant.toFixed(1)} squares per participant across ${summary.uniqueParticipants} participant${summary.uniqueParticipants === 1 ? '' : 's'}.`,
      `Payout completion is ${formatPercent(payoutRate)} with ${formatCurrency(summary.totalPaidOut)} already marked paid.`
    ]

    if (participantLeaderboard[0]) {
      notes.push(`${participantLeaderboard[0].participantName} is currently leading the pool with ${participantLeaderboard[0].winsCount} wins worth ${formatCurrency(participantLeaderboard[0].amountWon)}.`)
    }

    if (playerByWinnings[0]) {
      notes.push(`${playerByWinnings[0].playerName} is the top player by winnings at ${formatCurrency(playerByWinnings[0].totalWon)}.`)
    }

    return notes
  }, [averageSquaresPerParticipant, participantLeaderboard, payoutRate, playerByWinnings, soldRate, summary])

  return (
    <section className="landing-placeholder-card">
      <div className="landing-hero-bar landing-player-hero" style={heroStyle}>
        <div>
          <h1>Metrics & Analytics</h1>
          <p>
            {selectedPool
              ? `Review sales, wins, and payout trends for ${selectedPool.pool_name ?? selectedPool.team_name ?? 'this pool'}.`
              : 'Choose a pool to start exploring performance trends.'}
          </p>
        </div>
      </div>

      <article className="panel landing-metrics-toolbar">
        <label className="field-block">
          <span>Pool</span>
          <select
            value={selectedPoolId ?? ''}
            onChange={(event) => {
              const value = event.target.value ? Number(event.target.value) : null
              void onSelectPool(value)
            }}
            disabled={loading || pools.length === 0}
          >
            <option value="">{pools.length > 0 ? 'Select Pool' : 'No Pools Available'}</option>
            {pools.map((pool) => (
              <option key={pool.id} value={pool.id}>
                {pool.team_name ?? pool.primary_team ?? 'Team'} • {pool.pool_name ?? `Pool ${pool.id}`}
              </option>
            ))}
          </select>
        </label>
      </article>

      {error ? <div className="error-banner landing-error-banner">{error}</div> : null}
      {notice ? (
        <article className="panel">
          <p className="small landing-readonly-note">{notice}</p>
        </article>
      ) : null}

      {!loading && summary ? (
        <article className="panel">
          <p className="small landing-readonly-note">
            <strong>Return %</strong> = winnings ÷ amount bought/sold. <strong>Net ROI %</strong> = (winnings − amount bought/sold) ÷ amount bought/sold.
          </p>
        </article>
      ) : null}

      {loading ? (
        <article className="panel">
          <h2>Loading metrics…</h2>
          <p className="small">Crunching the latest pool analytics.</p>
        </article>
      ) : !summary ? (
        <article className="panel">
          <h2>Select a pool</h2>
          <p className="small">Choose a pool above to load its metrics and charts.</p>
        </article>
      ) : (
        <>
          <div className="stat-grid metrics-summary-grid">
            <div className="summary-card">
              <div className="summary-label">Squares sold</div>
              <div className="summary-value">{summary.soldSquares}</div>
              <div className="summary-label">{formatPercent(soldRate)} sold</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Total awarded</div>
              <div className="summary-value">{formatCurrency(summary.totalAwarded)}</div>
              <div className="summary-label">{summary.completedGames}/{summary.totalGames} games complete</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Pending payout</div>
              <div className="summary-value pending">{formatCurrency(summary.totalPending)}</div>
              <div className="summary-label">{summary.paidSquares} squares marked paid</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Unique participants</div>
              <div className="summary-value">{summary.uniqueParticipants}</div>
              <div className="summary-label">{summary.uniquePlayers} players assigned</div>
            </div>
          </div>

          <div className="panel-grid metrics-panel-grid">
            <article className="panel">
              <h2>Total sold by player</h2>
              <p className="small">Sales totals plus return metrics based on sold-square revenue.</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Sold</th>
                      <th>Sold $</th>
                      <th>Return %</th>
                      <th>Net ROI %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playerBySales.length > 0 ? (
                      playerBySales.slice(0, 10).map((item) => {
                        const soldAmount = item.squaresSold * squareCost
                        const returnPercent = calculateReturnPercent(item.totalWon, soldAmount)
                        const netRoiPercent = calculateNetRoiPercent(item.totalWon, soldAmount)

                        return (
                          <tr key={`sales-${item.playerId}`}>
                            <td>{item.jerseyNum != null ? `#${item.jerseyNum} ` : ''}{item.playerName}</td>
                            <td>{item.squaresSold}</td>
                            <td>{formatCurrency(soldAmount)}</td>
                            <td className={getPercentClassName(returnPercent)}>{formatMetricPercent(returnPercent)}</td>
                            <td className={getPercentClassName(netRoiPercent)}>{formatMetricPercent(netRoiPercent)}</td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td colSpan={5}>No player sales recorded yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="panel">
              <h2>Total winnings by player</h2>
              <p className="small">Season winnings traced back through the player assigned to the winning square.</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Player</th>
                      <th>Won</th>
                      <th>Wins</th>
                      <th>Return %</th>
                      <th>Net ROI %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {playerByWinnings.length > 0 ? (
                      playerByWinnings.slice(0, 10).map((item) => {
                        const soldAmount = item.squaresSold * squareCost
                        const returnPercent = calculateReturnPercent(item.totalWon, soldAmount)
                        const netRoiPercent = calculateNetRoiPercent(item.totalWon, soldAmount)

                        return (
                          <tr key={`winnings-${item.playerId}`}>
                            <td>{item.jerseyNum != null ? `#${item.jerseyNum} ` : ''}{item.playerName}</td>
                            <td>{formatCurrency(item.totalWon)}</td>
                            <td>{item.winsCount}</td>
                            <td className={getPercentClassName(returnPercent)}>{formatMetricPercent(returnPercent)}</td>
                            <td className={getPercentClassName(netRoiPercent)}>{formatMetricPercent(netRoiPercent)}</td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td colSpan={5}>No winnings have been calculated yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="panel wide">
              <h2>Participant leaderboard</h2>
              <p className="small">Wins, ownership, amount won, and both return calculations for each participant.</p>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Participant</th>
                      <th>Squares</th>
                      <th>Bought $</th>
                      <th>Wins</th>
                      <th>Amount won</th>
                      <th>Return %</th>
                      <th>Net ROI %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {participantLeaderboard.length > 0 ? (
                      participantLeaderboard.slice(0, 12).map((item) => {
                        const boughtAmount = item.squaresOwned * squareCost
                        const returnPercent = calculateReturnPercent(item.amountWon, boughtAmount)
                        const netRoiPercent = calculateNetRoiPercent(item.amountWon, boughtAmount)

                        return (
                          <tr key={`participant-${item.participantId}`}>
                            <td>{item.participantName}</td>
                            <td>{item.squaresOwned}</td>
                            <td>{formatCurrency(boughtAmount)}</td>
                            <td>{item.winsCount}</td>
                            <td>{formatCurrency(item.amountWon)}</td>
                            <td className={getPercentClassName(returnPercent)}>{formatMetricPercent(returnPercent)}</td>
                            <td className={getPercentClassName(netRoiPercent)}>{formatMetricPercent(netRoiPercent)}</td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td colSpan={7}>No participant winnings are available yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <div className="panel-grid metrics-chart-grid">
            <PieChartCard title="Ownership mix" subtitle="Sold versus open squares" slices={ownershipSlices} />
            <PieChartCard title="Payout status" subtitle="Paid out versus still pending" slices={payoutSlices} />
            <PieChartCard title="Top players by sold squares" subtitle="Largest share of sold squares" slices={topPlayerSlices.length > 0 ? topPlayerSlices : [{ label: 'No data yet', value: 1, color: '#d9e1ea' }]} />
            <PieChartCard title="Top participants by winnings" subtitle="Biggest share of total amount won" slices={topParticipantSlices.length > 0 ? topParticipantSlices : [{ label: 'No data yet', value: 1, color: '#d9e1ea' }]} />
          </div>

          <article className="panel wide">
            <h2>More ideas & highlights</h2>
            <ul className="landing-readonly-list">
              {ideas.map((idea) => (
                <li key={idea}>{idea}</li>
              ))}
            </ul>
          </article>
        </>
      )}
    </section>
  )
}
