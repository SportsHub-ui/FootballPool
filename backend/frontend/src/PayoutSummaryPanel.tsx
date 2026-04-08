type PayoutSlotKey = 'q1' | 'q2' | 'q3' | 'q4'

type PayoutBreakdown = {
  q1Payout: number
  q2Payout: number
  q3Payout: number
  q4Payout: number
}

export type BoardRoundPayout = {
  roundLabel: string
  roundSequence?: number | null
  q1Payout: number
  q2Payout: number
  q3Payout: number
  q4Payout: number
}

export type BoardPayoutSummary = {
  payoutScheduleMode: 'uniform' | 'by_round'
  currentRoundLabel?: string | null
  currentRoundSequence?: number | null
  activeSlots?: PayoutSlotKey[]
  payoutLabels?: Partial<Record<PayoutSlotKey, string>>
  defaultPayouts?: PayoutBreakdown
  activePayouts?: PayoutBreakdown
  roundPayouts?: BoardRoundPayout[]
}

const payoutMoneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
})

const defaultPayoutLabels: Record<PayoutSlotKey, string> = {
  q1: 'Q1 payout',
  q2: 'Q2 payout',
  q3: 'Q3 payout',
  q4: 'Final payout'
}

const getPayoutValue = (entry: PayoutBreakdown | BoardRoundPayout | undefined | null, slot: PayoutSlotKey): number => {
  if (!entry) return 0
  if (slot === 'q1') return Number(entry.q1Payout ?? 0)
  if (slot === 'q2') return Number(entry.q2Payout ?? 0)
  if (slot === 'q3') return Number(entry.q3Payout ?? 0)
  return Number(entry.q4Payout ?? 0)
}

const formatPayoutMoney = (value: number): string => payoutMoneyFormatter.format(Number(value ?? 0))

export function PayoutSummaryPanel({
  summary,
  title = 'Payout plan'
}: {
  summary?: BoardPayoutSummary | null
  title?: string
}) {
  if (!summary) {
    return null
  }

  const activeSlots = summary.activeSlots?.length ? summary.activeSlots : (['q1', 'q2', 'q3', 'q4'] as PayoutSlotKey[])
  const payoutLabels = { ...defaultPayoutLabels, ...(summary.payoutLabels ?? {}) }
  const activePayouts = summary.activePayouts ?? summary.defaultPayouts ?? { q1Payout: 0, q2Payout: 0, q3Payout: 0, q4Payout: 0 }
  const visibleRoundPayouts = (summary.roundPayouts ?? []).filter((roundPayout) =>
    activeSlots.some((slot) => getPayoutValue(roundPayout, slot) > 0)
  )

  return (
    <article className="board-payout-summary-card">
      <div className="board-payout-summary-header">
        <div>
          <h3>{title}</h3>
          <p className="small">
            {summary.payoutScheduleMode === 'by_round'
              ? summary.currentRoundLabel
                ? `Selected game uses the ${summary.currentRoundLabel} payout rule.`
                : 'Tournament payouts can change by round.'
              : 'The same payout schedule applies to every game in this pool.'}
          </p>
        </div>
        <span className={`board-payout-mode-badge is-${summary.payoutScheduleMode}`}>
          {summary.payoutScheduleMode === 'by_round' ? 'By round' : 'Uniform'}
        </span>
      </div>

      <div className="board-payout-chip-list">
        {activeSlots.map((slot) => (
          <div key={slot} className="board-payout-chip">
            <span>{payoutLabels[slot]}</span>
            <strong>{formatPayoutMoney(getPayoutValue(activePayouts, slot))}</strong>
          </div>
        ))}
      </div>

      {summary.payoutScheduleMode === 'by_round' && visibleRoundPayouts.length > 0 ? (
        <div className="board-payout-round-list">
          {visibleRoundPayouts.map((roundPayout) => {
            const isCurrentRound =
              (summary.currentRoundSequence != null && roundPayout.roundSequence != null && Number(roundPayout.roundSequence) === Number(summary.currentRoundSequence)) ||
              String(roundPayout.roundLabel).trim().toLowerCase() === String(summary.currentRoundLabel ?? '').trim().toLowerCase()

            return (
              <div key={`${roundPayout.roundLabel}-${roundPayout.roundSequence ?? 'na'}`} className={`board-payout-round-row ${isCurrentRound ? 'is-current' : ''}`}>
                <div className="board-payout-round-title-row">
                  <strong>{roundPayout.roundLabel}</strong>
                  {isCurrentRound ? <span className="board-payout-current-tag">Current</span> : null}
                </div>
                <div className="board-payout-round-values">
                  {activeSlots.map((slot) => (
                    <span key={`${roundPayout.roundLabel}-${slot}`}>
                      {payoutLabels[slot]}: <strong>{formatPayoutMoney(getPayoutValue(roundPayout, slot))}</strong>
                    </span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}
    </article>
  )
}
