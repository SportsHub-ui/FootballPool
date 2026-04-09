import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { LandingPool } from './LandingMetrics'

type DisplayAdSettings = {
  adsEnabled: boolean
  frequencySeconds: number
  durationSeconds: number
  shrinkPercent: number
}

type DisplayAdRecord = {
  id: number
  title: string
  body: string | null
  footer: string | null
  imageUrl: string | null
  accentColor: string | null
  activeFlg: boolean
  sortOrder: number
}

type MarketingResponse = {
  settings: DisplayAdSettings
  ads: DisplayAdRecord[]
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

const buildEmptyAdForm = () => ({
  title: '',
  body: '',
  footer: '',
  imageUrl: '',
  accentColor: '#ffd54f',
  activeFlg: true,
  sortOrder: 0
})

export function LandingMarketingMaintenance({ pools, token, authHeaders, apiBase, onRequireSignIn }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [ads, setAds] = useState<DisplayAdRecord[]>([])
  const [selectedAdId, setSelectedAdId] = useState<number | null>(null)
  const [settings, setSettings] = useState<DisplayAdSettings>({
    adsEnabled: false,
    frequencySeconds: 180,
    durationSeconds: 30,
    shrinkPercent: 80
  })
  const [adForm, setAdForm] = useState(buildEmptyAdForm())

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, init)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const reason = data?.detail || data?.message || data?.error || `Request failed with status ${response.status}`
      throw new Error(reason)
    }

    return data as T
  }

  const loadMarketing = async (preferredAdId?: number | null) => {
    if (!token) {
      setAds([])
      setError('Sign in as an organizer to manage display advertising.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await request<MarketingResponse>('/api/setup/marketing/display', {
        headers: authHeaders
      })

      setAds(result.ads)
      setSettings(result.settings)

      const nextSelectedId =
        preferredAdId != null && result.ads.some((ad) => ad.id === preferredAdId)
          ? preferredAdId
          : result.ads[0]?.id ?? null

      setSelectedAdId(nextSelectedId)

      const selectedAd = result.ads.find((ad) => ad.id === nextSelectedId) ?? null
      setAdForm(
        selectedAd
          ? {
              title: selectedAd.title ?? '',
              body: selectedAd.body ?? '',
              footer: selectedAd.footer ?? '',
              imageUrl: selectedAd.imageUrl ?? '',
              accentColor: selectedAd.accentColor ?? '#ffd54f',
              activeFlg: selectedAd.activeFlg,
              sortOrder: selectedAd.sortOrder ?? 0
            }
          : buildEmptyAdForm()
      )
    } catch (fetchError) {
      setAds([])
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load marketing settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMarketing(selectedAdId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const heroPool = useMemo(() => {
    const defaultPool = pools.find((pool) => pool.default_flg)
    if (defaultPool) return defaultPool
    return pools.length > 0 ? pools[0] : null
  }, [pools])

  const heroStyle = useMemo(
    () => ({
      backgroundColor: heroPool?.primary_color ?? DEFAULT_HERO_COLOR,
      color: heroPool?.secondary_color ?? DEFAULT_HERO_ACCENT
    }),
    [heroPool]
  )

  const selectedAd = useMemo(
    () => ads.find((ad) => ad.id === selectedAdId) ?? null,
    [ads, selectedAdId]
  )

  const handleSelectAd = (ad: DisplayAdRecord | null) => {
    setSelectedAdId(ad?.id ?? null)
    setAdForm(
      ad
        ? {
            title: ad.title ?? '',
            body: ad.body ?? '',
            footer: ad.footer ?? '',
            imageUrl: ad.imageUrl ?? '',
            accentColor: ad.accentColor ?? '#ffd54f',
            activeFlg: ad.activeFlg,
            sortOrder: ad.sortOrder ?? 0
          }
        : buildEmptyAdForm()
    )
    setNotice(null)
    setError(null)
  }

  const handleSaveSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!token) {
      onRequireSignIn()
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      const result = await request<{ settings: DisplayAdSettings }>('/api/setup/marketing/display/settings', {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(settings)
      })

      setSettings(result.settings)
      setNotice('Display advertising settings saved.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save display advertising settings')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAd = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!token) {
      onRequireSignIn()
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      if (selectedAdId != null) {
        await request(`/api/setup/marketing/display/ads/${selectedAdId}`, {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify(adForm)
        })
        setNotice('Display ad updated.')
        await loadMarketing(selectedAdId)
      } else {
        const result = await request<{ ad: DisplayAdRecord }>('/api/setup/marketing/display/ads', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(adForm)
        })
        setNotice('Display ad created.')
        await loadMarketing(result.ad.id)
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save display ad')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteSelectedAd = async () => {
    if (!token) {
      onRequireSignIn()
      return
    }

    if (selectedAdId == null) {
      setError('Select an ad first.')
      return
    }

    setSaving(true)
    setError(null)
    setNotice(null)

    try {
      await request(`/api/setup/marketing/display/ads/${selectedAdId}`, {
        method: 'DELETE',
        headers: authHeaders
      })

      setNotice('Display ad deleted.')
      setSelectedAdId(null)
      setAdForm(buildEmptyAdForm())
      await loadMarketing(null)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete display ad')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="landing-placeholder-card">
      <div className="landing-hero-bar" style={heroStyle}>
        <div>
          <p className="landing-eyebrow">Marketing</p>
          <h1>Display Advertising</h1>
          <p>Manage the sponsor content and display cadence shown on the read-only TV screen.</p>
        </div>
      </div>

      {!token ? (
        <article className="panel">
          <h2>Organizer sign-in required</h2>
          <p className="small">Sign in to manage display advertising, sponsor content, and rotation timing.</p>
          <button className="primary" type="button" onClick={onRequireSignIn}>Sign in</button>
        </article>
      ) : null}

      {error ? <div className="error-banner">{error}</div> : null}
      {notice ? <div className="success-banner">{notice}</div> : null}

      <div className="marketing-grid">
        <article className="panel">
          <h2>Display timing</h2>
          <p className="small">These settings control when the display board shrinks and how long sponsor content stays visible.</p>
          <form className="form-grid" onSubmit={handleSaveSettings}>
            <label className="checkbox-row marketing-checkbox-row">
              <input
                type="checkbox"
                checked={settings.adsEnabled}
                onChange={(event) => setSettings((current) => ({ ...current, adsEnabled: event.target.checked }))}
                disabled={saving}
              />
              Enable advertising on the display screen
            </label>

            <label className="field-block">
              <span>Frequency (seconds)</span>
              <input
                type="number"
                min={15}
                max={3600}
                value={settings.frequencySeconds}
                onChange={(event) => setSettings((current) => ({ ...current, frequencySeconds: Number(event.target.value) || 180 }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Duration (seconds)</span>
              <input
                type="number"
                min={5}
                max={600}
                value={settings.durationSeconds}
                onChange={(event) => setSettings((current) => ({ ...current, durationSeconds: Number(event.target.value) || 30 }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Board size during ad mode (%)</span>
              <input
                type="number"
                min={50}
                max={95}
                value={settings.shrinkPercent}
                onChange={(event) => setSettings((current) => ({ ...current, shrinkPercent: Number(event.target.value) || 80 }))}
                disabled={saving}
              />
            </label>

            <div className="modal-actions">
              <button className="primary" type="submit" disabled={saving || loading}>
                {saving ? 'Saving...' : 'Save display settings'}
              </button>
            </div>
          </form>
        </article>

        <article className="panel">
          <div className="marketing-panel-header">
            <div>
              <h2>Creative library</h2>
              <p className="small">Choose an ad to edit or start a new sponsor placement.</p>
            </div>
            <button type="button" className="secondary" onClick={() => handleSelectAd(null)} disabled={saving}>
              New creative
            </button>
          </div>

          <div className="marketing-ad-list">
            {ads.length === 0 ? (
              <p className="small">No display ads saved yet. Add one to start rotating sponsor content.</p>
            ) : (
              ads.map((ad) => (
                <button
                  key={ad.id}
                  type="button"
                  className={`marketing-ad-list-item ${selectedAdId === ad.id ? 'is-selected' : ''}`}
                  onClick={() => handleSelectAd(ad)}
                >
                  <span>
                    <strong>{ad.title}</strong>
                    <small>{ad.activeFlg ? 'Active' : 'Hidden'} • order {ad.sortOrder}</small>
                  </span>
                  <span className="marketing-ad-color" style={{ backgroundColor: ad.accentColor ?? '#ffd54f' }} />
                </button>
              ))
            )}
          </div>
        </article>
      </div>

      <article className="panel">
        <h2>{selectedAd ? `Edit ad #${selectedAd.id}` : 'New display ad'}</h2>
        <form className="form-grid" onSubmit={handleSaveAd}>
          <label className="field-block">
            <span>Title</span>
            <input
              value={adForm.title}
              onChange={(event) => setAdForm((current) => ({ ...current, title: event.target.value }))}
              maxLength={160}
              required
              disabled={saving}
            />
          </label>

          <label className="field-block">
            <span>Accent color</span>
            <input
              value={adForm.accentColor}
              onChange={(event) => setAdForm((current) => ({ ...current, accentColor: event.target.value }))}
              placeholder="#ffd54f"
              maxLength={32}
              disabled={saving}
            />
          </label>

          <label className="field-block">
            <span>Image URL or uploaded image path</span>
            <input
              value={adForm.imageUrl}
              onChange={(event) => setAdForm((current) => ({ ...current, imageUrl: event.target.value }))}
              placeholder="https://example.com/ad.jpg or /images/your-file.png"
              maxLength={500}
              disabled={saving}
            />
          </label>

          <label className="field-block">
            <span>Sort order</span>
            <input
              type="number"
              min={0}
              max={999}
              value={adForm.sortOrder}
              onChange={(event) => setAdForm((current) => ({ ...current, sortOrder: Number(event.target.value) || 0 }))}
              disabled={saving}
            />
          </label>

          <label className="field-block field-block-full">
            <span>Body text</span>
            <textarea
              rows={4}
              value={adForm.body}
              onChange={(event) => setAdForm((current) => ({ ...current, body: event.target.value }))}
              placeholder="Formatted sponsor message or promo copy"
              disabled={saving}
            />
          </label>

          <label className="field-block field-block-full">
            <span>Footer / call to action</span>
            <input
              value={adForm.footer}
              onChange={(event) => setAdForm((current) => ({ ...current, footer: event.target.value }))}
              placeholder="Visit our sponsor booth • Promo ends Sunday"
              maxLength={255}
              disabled={saving}
            />
          </label>

          <label className="checkbox-row marketing-checkbox-row">
            <input
              type="checkbox"
              checked={adForm.activeFlg}
              onChange={(event) => setAdForm((current) => ({ ...current, activeFlg: event.target.checked }))}
              disabled={saving}
            />
            Show this ad in rotation
          </label>

          <div className="modal-actions">
            {selectedAd ? (
              <button className="secondary" type="button" onClick={handleDeleteSelectedAd} disabled={saving}>
                Delete ad
              </button>
            ) : null}
            <button className="primary" type="submit" disabled={saving || loading}>
              {saving ? 'Saving...' : selectedAd ? 'Update ad' : 'Create ad'}
            </button>
          </div>
        </form>
      </article>
    </section>
  )
}
