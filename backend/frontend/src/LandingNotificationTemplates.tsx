import { useEffect, useMemo, useState } from 'react'
import type { LandingPool } from './LandingMetrics'
import type { FormEvent } from 'react'

type TemplateScope = 'participant' | 'pool_contact'
type NotificationKind = 'quarter_win' | 'game_total' | 'lead_warning'
type MarkupFormat = 'plain_text' | 'markdown'

type NotificationTemplateRecord = {
  recipientScope: TemplateScope
  notificationKind: NotificationKind
  subjectTemplate: string
  bodyTemplate: string
  markupFormat: MarkupFormat
  poolId: number | null
  source: 'global' | 'pool'
}

type TemplatesResponse = {
  templates: NotificationTemplateRecord[]
  availableVariables: Record<NotificationKind, string[]>
  selectedPoolId: number | null
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

const scopeLabel: Record<TemplateScope, string> = {
  participant: 'Participant',
  pool_contact: 'Pool contact'
}

const kindLabel: Record<NotificationKind, string> = {
  quarter_win: 'End of score segment',
  game_total: 'End of game',
  lead_warning: 'Score change / live lead'
}

const formatPoolSelectionLabel = (pool: LandingPool): string => {
  const teamLabel = pool.team_name ?? `Pool ${pool.id}`
  const poolLabel = pool.pool_name ?? `Pool ${pool.id}`
  return pool.season ? `${teamLabel} — ${poolLabel} • ${pool.season}` : `${teamLabel} — ${poolLabel}`
}

const sampleValues: Record<NotificationKind, Record<string, string | number>> = {
  quarter_win: {
    recipientName: 'Jordan Smith',
    winnerName: 'Jordan Smith',
    poolName: 'Packers Weekly Pool',
    primaryTeamName: 'Packers',
    opponentName: 'Bears',
    scoreLine: 'Packers 14 · Bears 7',
    quarter: 2,
    segmentLabel: 'Halftime',
    squareNum: 42,
    payout: '$125'
  },
  game_total: {
    recipientName: 'Jordan Smith',
    winnerName: 'Jordan Smith',
    poolName: 'Packers Weekly Pool',
    totalWon: '$400',
    winningsBreakdown: 'Q1: $100 (square #42)\nQ2: $100 (square #42)\nQ4: $200 (square #42)'
  },
  lead_warning: {
    recipientName: 'Jordan Smith',
    leaderName: 'Jordan Smith',
    poolName: 'Packers Weekly Pool',
    primaryTeamName: 'Packers',
    opponentName: 'Bears',
    scoreLine: 'Packers 17 · Bears 14',
    quarter: 3,
    segmentLabel: 'Q3',
    squareNum: 42
  }
}

const renderTemplate = (template: string, values: Record<string, string | number>): string =>
  template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, variableName: string) => String(values[variableName] ?? ''))

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const renderInlineMarkdown = (value: string): string => {
  let output = escapeHtml(value)
  output = output.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  output = output.replace(/\*(.+?)\*/g, '<em>$1</em>')
  output = output.replace(/`(.+?)`/g, '<code>$1</code>')
  return output
}

const renderMarkupPreview = (text: string, format: MarkupFormat): string => {
  if (format !== 'markdown') {
    return `<pre style="white-space: pre-wrap; margin: 0; font-family: inherit;">${escapeHtml(text)}</pre>`
  }

  const lines = text.split(/\r?\n/)
  const htmlParts: string[] = []
  const listItems: string[] = []

  const flushList = () => {
    if (listItems.length === 0) return
    htmlParts.push(`<ul>${listItems.join('')}</ul>`)
    listItems.length = 0
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flushList()
      continue
    }

    if (/^[-*]\s+/.test(trimmed)) {
      listItems.push(`<li>${renderInlineMarkdown(trimmed.replace(/^[-*]\s+/, ''))}</li>`)
      continue
    }

    flushList()

    if (trimmed.startsWith('### ')) {
      htmlParts.push(`<h3>${renderInlineMarkdown(trimmed.slice(4))}</h3>`)
    } else if (trimmed.startsWith('## ')) {
      htmlParts.push(`<h2>${renderInlineMarkdown(trimmed.slice(3))}</h2>`)
    } else if (trimmed.startsWith('# ')) {
      htmlParts.push(`<h1>${renderInlineMarkdown(trimmed.slice(2))}</h1>`)
    } else {
      htmlParts.push(`<p>${renderInlineMarkdown(trimmed)}</p>`)
    }
  }

  flushList()
  return htmlParts.join('')
}

const buildTemplateKey = (template: Pick<NotificationTemplateRecord, 'recipientScope' | 'notificationKind'>): string =>
  `${template.recipientScope}:${template.notificationKind}`

export function LandingNotificationTemplates({ pools, token, authHeaders, apiBase, onRequireSignIn }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [templates, setTemplates] = useState<NotificationTemplateRecord[]>([])
  const [selectedPoolId, setSelectedPoolId] = useState<number | null>(null)
  const [availableVariables, setAvailableVariables] = useState<Record<NotificationKind, string[]>>({
    quarter_win: [],
    game_total: [],
    lead_warning: []
  })
  const [selectedKey, setSelectedKey] = useState<string>('participant:quarter_win')
  const [focusedField, setFocusedField] = useState<'subject' | 'body'>('body')
  const [form, setForm] = useState({
    subjectTemplate: '',
    bodyTemplate: '',
    markupFormat: 'plain_text' as MarkupFormat
  })

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, init)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const reason = data?.detail || data?.message || data?.error || `Request failed with status ${response.status}`
      throw new Error(reason)
    }

    return data as T
  }

  const loadTemplateIntoForm = (template: NotificationTemplateRecord | null) => {
    setForm({
      subjectTemplate: template?.subjectTemplate ?? '',
      bodyTemplate: template?.bodyTemplate ?? '',
      markupFormat: template?.markupFormat ?? 'plain_text'
    })
  }

  const loadTemplates = async (preferredKey?: string, poolId: number | null = selectedPoolId) => {
    if (!token) {
      setTemplates([])
      setError('Sign in as an organizer to manage outgoing email templates.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const query = poolId != null ? `?poolId=${encodeURIComponent(String(poolId))}` : ''
      const result = await request<TemplatesResponse>(`/api/setup/notifications/templates${query}`, {
        headers: authHeaders
      })

      setTemplates(result.templates)
      setAvailableVariables(result.availableVariables)

      const nextKey =
        preferredKey && result.templates.some((template) => buildTemplateKey(template) === preferredKey)
          ? preferredKey
          : buildTemplateKey(result.templates[0] ?? { recipientScope: 'participant', notificationKind: 'quarter_win' })

      setSelectedKey(nextKey)
      loadTemplateIntoForm(result.templates.find((template) => buildTemplateKey(template) === nextKey) ?? null)
    } catch (fetchError) {
      setTemplates([])
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load notification templates')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTemplates(selectedKey, selectedPoolId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedPoolId])

  const selectedTemplate = useMemo(
    () => templates.find((template) => buildTemplateKey(template) === selectedKey) ?? null,
    [selectedKey, templates]
  )

  const heroPool = useMemo(() => {
    const defaultPool = pools.find((pool) => pool.default_flg)
    if (defaultPool) return defaultPool
    return pools.length === 1 ? pools[0] : null
  }, [pools])

  const selectedPoolOption = useMemo(
    () => pools.find((pool) => pool.id === selectedPoolId) ?? null,
    [pools, selectedPoolId]
  )

  const heroStyle = useMemo(
    () => ({
      backgroundColor: heroPool?.primary_color ?? DEFAULT_HERO_COLOR,
      color: heroPool?.secondary_color ?? DEFAULT_HERO_ACCENT
    }),
    [heroPool]
  )

  const currentKind = selectedTemplate?.notificationKind ?? 'quarter_win'
  const previewValues = {
    ...sampleValues[currentKind],
    poolName: selectedPoolOption?.pool_name ?? sampleValues[currentKind].poolName
  }
  const previewSubject = renderTemplate(form.subjectTemplate, previewValues)
  const previewBody = renderTemplate(form.bodyTemplate, previewValues)
  const previewHtml = renderMarkupPreview(previewBody, form.markupFormat)
  const selectedContextLabel = selectedPoolOption ? formatPoolSelectionLabel(selectedPoolOption) : 'GLOBAL defaults'
  const sourceNotice =
    selectedPoolId == null
      ? 'You are editing the GLOBAL fallback used when a pool does not have its own template.'
      : selectedTemplate?.source === 'pool'
        ? `This message is currently overridden for ${selectedContextLabel}.`
        : `This pool is currently inheriting the GLOBAL fallback. Saving now will create a pool-specific override for ${selectedContextLabel}.`

  const insertVariable = (variableName: string) => {
    const tokenValue = `{{${variableName}}}`

    if (focusedField === 'subject') {
      setForm((current) => ({ ...current, subjectTemplate: `${current.subjectTemplate}${tokenValue}` }))
      return
    }

    setForm((current) => ({ ...current, bodyTemplate: `${current.bodyTemplate}${tokenValue}` }))
  }

  const handleSelectTemplate = (template: NotificationTemplateRecord) => {
    const key = buildTemplateKey(template)
    setSelectedKey(key)
    setNotice(null)
    loadTemplateIntoForm(template)
  }

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!selectedTemplate) {
      setError('Select a template to edit first.')
      return
    }

    if (!token) {
      onRequireSignIn()
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const response = await request<{ template: NotificationTemplateRecord }>(
        `/api/setup/notifications/templates/${selectedTemplate.recipientScope}/${selectedTemplate.notificationKind}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders
          },
          body: JSON.stringify({
            ...form,
            poolId: selectedPoolId ?? undefined
          })
        }
      )

      const nextTemplate = response.template
      setTemplates((current) => current.map((template) => (buildTemplateKey(template) === selectedKey ? nextTemplate : template)))
      setSelectedKey(buildTemplateKey(nextTemplate))
      loadTemplateIntoForm(nextTemplate)
      setNotice(selectedPoolId != null ? 'Pool-specific notification template saved.' : 'GLOBAL notification template saved.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save notification template')
    } finally {
      setSaving(false)
    }
  }

  const handleResetToGlobal = async () => {
    if (!selectedTemplate || selectedPoolId == null) {
      return
    }

    if (!window.confirm(`Reset this template for ${selectedContextLabel} back to the GLOBAL default?`)) {
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      await request<{ reset: boolean }>(
        `/api/setup/notifications/templates/${selectedTemplate.recipientScope}/${selectedTemplate.notificationKind}?poolId=${encodeURIComponent(String(selectedPoolId))}`,
        {
          method: 'DELETE',
          headers: authHeaders
        }
      )

      await loadTemplates(selectedKey, selectedPoolId)
      setNotice('Pool template reset to GLOBAL fallback.')
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Failed to reset template to GLOBAL fallback')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="landing-placeholder-card">
      <div className="landing-hero-bar" style={heroStyle}>
        <div>
          <p className="landing-eyebrow">Message configuration</p>
          <h1>Email Notifications</h1>
          <p>
            Configure separate participant and pool-contact messages for score-segment wins, game totals, and live score-change
            alerts. Use variables and optional Markdown formatting so future copy changes do not require code edits.
          </p>
        </div>
      </div>

      {!token ? (
        <article className="panel">
          <h2>Organizer sign-in required</h2>
          <p className="small">Sign in as an organizer to view and update notification templates.</p>
          <button type="button" className="primary" onClick={onRequireSignIn}>
            Sign In
          </button>
        </article>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}

      {token ? (
        <article className="panel">
          <label className="field-block" style={{ maxWidth: '28rem' }}>
            <span>Template scope</span>
            <select
              value={selectedPoolId ?? ''}
              onChange={(event) => {
                const nextValue = event.target.value ? Number(event.target.value) : null
                setSelectedPoolId(nextValue)
                setNotice(null)
              }}
              disabled={loading || saving}
            >
              <option value="">GLOBAL (default fallback)</option>
              {pools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {formatPoolSelectionLabel(pool)}
                </option>
              ))}
            </select>
          </label>
          <p className="small" style={{ marginTop: '0.5rem' }}>
            {sourceNotice}
          </p>
        </article>
      ) : null}

      <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'minmax(260px, 320px) minmax(0, 1fr)' }}>
        <article className="panel">
          <div className="panel-header-row">
            <div>
              <h2>Templates</h2>
              <p className="small">Choose which audience and event message to edit.</p>
            </div>
          </div>

          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {templates.map((template) => {
              const isActive = buildTemplateKey(template) === selectedKey
              return (
                <button
                  key={buildTemplateKey(template)}
                  type="button"
                  className={isActive ? 'primary' : 'secondary'}
                  style={{ textAlign: 'left' }}
                  onClick={() => handleSelectTemplate(template)}
                >
                  <strong>{scopeLabel[template.recipientScope]}</strong>
                  <div>{kindLabel[template.notificationKind]}</div>
                  <div className="small" style={{ marginTop: '0.25rem', opacity: 0.85 }}>
                    {template.source === 'pool' ? 'Pool-specific override' : selectedPoolId != null ? 'Using GLOBAL fallback' : 'GLOBAL default'}
                  </div>
                </button>
              )
            })}
          </div>
        </article>

        <div style={{ display: 'grid', gap: '1rem' }}>
          <article className="panel">
            <div className="panel-header-row">
              <div>
                <h2>
                  {selectedTemplate ? `${scopeLabel[selectedTemplate.recipientScope]} · ${kindLabel[selectedTemplate.notificationKind]}` : 'Edit template'}
                </h2>
                <p className="small">Click a variable to insert it into the last focused field.</p>
                <p className="small" style={{ marginTop: '0.35rem' }}>
                  <strong>Current target:</strong> {selectedContextLabel}
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
              {(availableVariables[currentKind] ?? []).map((variableName) => (
                <button key={variableName} type="button" className="secondary compact" onClick={() => insertVariable(variableName)}>
                  {`{{${variableName}}}`}
                </button>
              ))}
            </div>

            <form onSubmit={handleSave} style={{ display: 'grid', gap: '1rem' }}>
              <label className="field-block">
                <span>Subject</span>
                <input
                  value={form.subjectTemplate}
                  onFocus={() => setFocusedField('subject')}
                  onChange={(event) => setForm((current) => ({ ...current, subjectTemplate: event.target.value }))}
                  disabled={loading || saving || !selectedTemplate}
                />
              </label>

              <label className="field-block">
                <span>Body</span>
                <textarea
                  value={form.bodyTemplate}
                  onFocus={() => setFocusedField('body')}
                  onChange={(event) => setForm((current) => ({ ...current, bodyTemplate: event.target.value }))}
                  rows={12}
                  disabled={loading || saving || !selectedTemplate}
                />
              </label>

              <label className="field-block">
                <span>Formatting</span>
                <select
                  value={form.markupFormat}
                  onChange={(event) => setForm((current) => ({ ...current, markupFormat: event.target.value as MarkupFormat }))}
                  disabled={loading || saving || !selectedTemplate}
                >
                  <option value="plain_text">Plain text</option>
                  <option value="markdown">Markdown</option>
                </select>
              </label>

              <div className="modal-actions">
                <button type="submit" className="primary" disabled={loading || saving || !selectedTemplate}>
                  {saving ? 'Saving...' : 'Save template'}
                </button>
                {selectedPoolId != null ? (
                  <button
                    type="button"
                    className="secondary"
                    disabled={loading || saving || selectedTemplate?.source !== 'pool'}
                    onClick={() => void handleResetToGlobal()}
                    title={selectedTemplate?.source === 'pool' ? 'Remove this pool override and fall back to GLOBAL' : 'Already using GLOBAL fallback'}
                  >
                    Reset to GLOBAL
                  </button>
                ) : null}
                <button type="button" className="secondary" disabled={loading || saving} onClick={() => loadTemplateIntoForm(selectedTemplate)}>
                  Reset changes
                </button>
              </div>
            </form>
          </article>

          <article className="panel">
            <div className="panel-header-row">
              <div>
                <h2>Preview</h2>
                <p className="small">Sample values are used below so you can see the rendered output.</p>
              </div>
            </div>

            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <div>
                <strong>Rendered subject</strong>
                <div style={{ marginTop: '0.35rem' }}>{previewSubject || '—'}</div>
              </div>
              <div>
                <strong>Rendered body</strong>
                <div
                  style={{ marginTop: '0.35rem', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '0.75rem', padding: '0.85rem' }}
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            </div>
          </article>
        </div>
      </div>
    </section>
  )
}
