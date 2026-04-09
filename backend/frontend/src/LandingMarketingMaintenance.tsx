import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { LandingPool } from './LandingMetrics'

type DisplayAdPlacement = 'sidebar' | 'banner'

type DisplayAdSettings = {
  adsEnabled: boolean
  frequencySeconds: number
  durationSeconds: number
  shrinkPercent: number
  sidebarCount: number
  bannerCount: number
  defaultBannerMessage: string
  hideAdsForOrganization: boolean
  organizationId?: number | null
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
  placement: DisplayAdPlacement
  organizationId: number | null
  organizationName?: string | null
}

type MarketingResponse = {
  settings: Omit<DisplayAdSettings, 'defaultBannerMessage'> & { defaultBannerMessage: string | null }
  ads: DisplayAdRecord[]
}

type Props = {
  pools: LandingPool[]
  token: string | null
  authHeaders: Record<string, string>
  apiBase: string
  onRequireSignIn: () => void
}

type ScopeOption = {
  id: number | null
  label: string
}

const DEFAULT_HERO_COLOR = '#8a8f98'
const DEFAULT_HERO_ACCENT = '#ffffff'

const resolveImageUrl = (apiBase: string, value: string): string => {
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  if (value.startsWith('/')) return `${apiBase}${value}`
  return `${apiBase}/images/${value}`
}

const buildEmptyAdForm = (organizationId: number | null = null) => ({
  title: '',
  body: '',
  footer: '',
  imageUrl: '',
  accentColor: '#ffd54f',
  placement: 'sidebar' as DisplayAdPlacement,
  organizationId,
  activeFlg: true,
  sortOrder: 0
})

const buildScopeQuery = (organizationId: number | null): string =>
  organizationId != null ? `?organizationId=${organizationId}` : ''

export function LandingMarketingMaintenance({ pools, token, authHeaders, apiBase, onRequireSignIn }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [ads, setAds] = useState<DisplayAdRecord[]>([])
  const [selectedAdId, setSelectedAdId] = useState<number | null>(null)
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<number | null>(null)
  const [settings, setSettings] = useState<DisplayAdSettings>({
    adsEnabled: false,
    frequencySeconds: 180,
    durationSeconds: 30,
    shrinkPercent: 80,
    sidebarCount: 1,
    bannerCount: 1,
    defaultBannerMessage: '',
    hideAdsForOrganization: false,
    organizationId: null
  })
  const [adForm, setAdForm] = useState(buildEmptyAdForm())
  const [adImageUpload, setAdImageUpload] = useState<File | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)

  const scopeOptions = useMemo<ScopeOption[]>(() => {
    const seen = new Set<number>()
    const options: ScopeOption[] = [{ id: null, label: 'Global defaults' }]

    for (const pool of pools) {
      const organizationId = Number(pool.team_id ?? 0)
      if (!Number.isFinite(organizationId) || organizationId <= 0 || seen.has(organizationId)) {
        continue
      }

      seen.add(organizationId)
      options.push({
        id: organizationId,
        label: pool.team_name ?? `Organization ${organizationId}`
      })
    }

    return options
  }, [pools])

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, init)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const reason = data?.detail || data?.message || data?.error || `Request failed with status ${response.status}`
      throw new Error(reason)
    }

    return data as T
  }

  const loadMarketing = async (preferredAdId?: number | null, organizationId: number | null = selectedOrganizationId) => {
    if (!token) {
      setAds([])
      setError('Sign in as an organizer to manage display advertising.')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await request<MarketingResponse>(`/api/setup/marketing/display${buildScopeQuery(organizationId)}`, {
        headers: authHeaders
      })

      setAds(result.ads)
      setSettings({
        adsEnabled: Boolean(result.settings.adsEnabled),
        frequencySeconds: Number(result.settings.frequencySeconds ?? 180) || 180,
        durationSeconds: Number(result.settings.durationSeconds ?? 30) || 30,
        shrinkPercent: Number(result.settings.shrinkPercent ?? 80) || 80,
        sidebarCount: Number(result.settings.sidebarCount ?? 1) || 1,
        bannerCount: Number(result.settings.bannerCount ?? 1) || 1,
        defaultBannerMessage: result.settings.defaultBannerMessage ?? '',
        hideAdsForOrganization: Boolean(result.settings.hideAdsForOrganization),
        organizationId: organizationId ?? null
      })

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
              placement: selectedAd.placement ?? 'sidebar',
              organizationId: selectedAd.organizationId ?? organizationId ?? null,
              activeFlg: selectedAd.activeFlg,
              sortOrder: selectedAd.sortOrder ?? 0
            }
          : buildEmptyAdForm(organizationId)
      )
    } catch (fetchError) {
      setAds([])
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load marketing settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadMarketing(selectedAdId, selectedOrganizationId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, selectedOrganizationId])

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

  const selectedScopeLabel = scopeOptions.find((option) => option.id === selectedOrganizationId)?.label ?? 'Global defaults'

  const selectedAd = useMemo(
    () => ads.find((ad) => ad.id === selectedAdId) ?? null,
    [ads, selectedAdId]
  )

  const handleSelectAd = (ad: DisplayAdRecord | null) => {
    setSelectedAdId(ad?.id ?? null)
    setAdImageUpload(null)
    setAdForm(
      ad
        ? {
            title: ad.title ?? '',
            body: ad.body ?? '',
            footer: ad.footer ?? '',
            imageUrl: ad.imageUrl ?? '',
            accentColor: ad.accentColor ?? '#ffd54f',
            placement: ad.placement ?? 'sidebar',
            organizationId: ad.organizationId ?? selectedOrganizationId,
            activeFlg: ad.activeFlg,
            sortOrder: ad.sortOrder ?? 0
          }
        : buildEmptyAdForm(selectedOrganizationId)
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
      const result = await request<{ settings: MarketingResponse['settings'] }>(
        `/api/setup/marketing/display/settings${buildScopeQuery(selectedOrganizationId)}`,
        {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify(settings)
        }
      )

      setSettings((current) => ({
        ...current,
        ...result.settings,
        defaultBannerMessage: result.settings.defaultBannerMessage ?? ''
      }))
      setNotice(`${selectedScopeLabel} display settings saved.`)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save display advertising settings')
    } finally {
      setSaving(false)
    }
  }

  const handleUploadAdImage = async (): Promise<void> => {
    if (!adImageUpload) {
      setError('Choose an image file first.')
      return
    }

    if (!token) {
      setError('Sign in as an organizer to upload ad images.')
      onRequireSignIn()
      return
    }

    setUploadingImage(true)
    setError(null)
    setNotice(null)

    try {
      const body = new FormData()
      body.append('image', adImageUpload)

      const uploadHeaders: Record<string, string> = {}
      if (authHeaders.Authorization) {
        uploadHeaders.Authorization = authHeaders.Authorization
      }

      const response = await fetch(`${apiBase}/api/setup/images/upload`, {
        method: 'POST',
        headers: uploadHeaders,
        body
      })

      const text = await response.text()
      let data: { error?: string; filePath?: string } = {}

      try {
        data = text ? JSON.parse(text) : {}
      } catch {
        data = { error: `Upload failed with status ${response.status}` }
      }

      if (!response.ok) {
        throw new Error(data.error || `Failed to upload image (status ${response.status})`)
      }

      const storedPath = (data.filePath ?? '').toString().trim()
      setAdForm((current) => ({ ...current, imageUrl: storedPath }))
      setAdImageUpload(null)
      setNotice('Image uploaded and linked to this ad.')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Failed to upload image')
    } finally {
      setUploadingImage(false)
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
      const payload = {
        ...adForm,
        organizationId: selectedOrganizationId
      }

      if (selectedAdId != null) {
        await request(`/api/setup/marketing/display/ads/${selectedAdId}`, {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify(payload)
        })
        setNotice('Display ad updated.')
        await loadMarketing(selectedAdId, selectedOrganizationId)
      } else {
        const result = await request<{ ad: DisplayAdRecord }>('/api/setup/marketing/display/ads', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(payload)
        })
        setNotice('Display ad created.')
        await loadMarketing(result.ad.id, selectedOrganizationId)
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
      setAdForm(buildEmptyAdForm(selectedOrganizationId))
      await loadMarketing(null, selectedOrganizationId)
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
          <p>Configure cleaner kiosk ad rails, placement, stacking, and organization-specific overrides.</p>
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
          <div className="marketing-panel-header">
            <div>
              <h2>Display layout</h2>
              <p className="small">Pick a scope, then configure how the right and bottom ad bars behave on the kiosk.</p>
            </div>
          </div>

          <form className="form-grid" onSubmit={handleSaveSettings}>
            <label className="field-block field-block-full">
              <span>Advertising scope</span>
              <select
                value={selectedOrganizationId ?? ''}
                onChange={(event) => {
                  const nextOrganizationId = event.target.value ? Number(event.target.value) : null
                  setSelectedOrganizationId(nextOrganizationId)
                  setSelectedAdId(null)
                  setAdImageUpload(null)
                  setNotice(null)
                  setError(null)
                }}
                disabled={saving || loading || uploadingImage}
              >
                {scopeOptions.map((option) => (
                  <option key={option.id ?? 'global'} value={option.id ?? ''}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="checkbox-row marketing-checkbox-row">
              <input
                type="checkbox"
                checked={settings.adsEnabled}
                onChange={(event) => setSettings((current) => ({ ...current, adsEnabled: event.target.checked }))}
                disabled={saving}
              />
              Enable advertising on the display screen
            </label>

            {selectedOrganizationId != null ? (
              <label className="checkbox-row marketing-checkbox-row">
                <input
                  type="checkbox"
                  checked={settings.hideAdsForOrganization}
                  onChange={(event) => setSettings((current) => ({ ...current, hideAdsForOrganization: event.target.checked }))}
                  disabled={saving}
                />
                Hide all ads for this organization
              </label>
            ) : null}

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

            <label className="field-block">
              <span>Right bar stacked ads</span>
              <input
                type="number"
                min={0}
                max={4}
                value={settings.sidebarCount}
                onChange={(event) => setSettings((current) => ({ ...current, sidebarCount: Number(event.target.value) || 0 }))}
                disabled={saving}
              />
            </label>

            <label className="field-block">
              <span>Bottom bar tiles</span>
              <input
                type="number"
                min={0}
                max={6}
                value={settings.bannerCount}
                onChange={(event) => setSettings((current) => ({ ...current, bannerCount: Number(event.target.value) || 0 }))}
                disabled={saving}
              />
            </label>

            <label className="field-block field-block-full">
              <span>Default bottom-bar message</span>
              <textarea
                rows={3}
                value={settings.defaultBannerMessage}
                onChange={(event) => setSettings((current) => ({ ...current, defaultBannerMessage: event.target.value }))}
                placeholder="Welcome sponsors, event messaging, or a fallback announcement"
                disabled={saving}
              />
            </label>

            <div className="modal-actions">
              <button className="primary" type="submit" disabled={saving || loading}>
                {saving ? 'Saving...' : `Save ${selectedScopeLabel} settings`}
              </button>
            </div>
          </form>
        </article>

        <article className="panel">
          <div className="marketing-panel-header">
            <div>
              <h2>Creative library</h2>
              <p className="small">
                {selectedOrganizationId == null
                  ? 'These are the global fallback ads used when an organization has no custom creatives.'
                  : 'These creatives override the global set for this organization. If you leave this list empty, the global ads will still be used.'}
              </p>
            </div>
            <button type="button" className="secondary" onClick={() => handleSelectAd(null)} disabled={saving}>
              New creative
            </button>
          </div>

          <div className="marketing-ad-list">
            {ads.length === 0 ? (
              <p className="small">No ads are saved for {selectedScopeLabel.toLowerCase()} yet.</p>
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
                    <small>
                      {ad.placement === 'banner' ? 'Bottom bar' : 'Right bar'} • {ad.activeFlg ? 'Active' : 'Hidden'} • order {ad.sortOrder}
                    </small>
                  </span>
                  <span className="marketing-ad-color" style={{ backgroundColor: ad.accentColor ?? '#ffd54f' }} />
                </button>
              ))
            )}
          </div>
        </article>
      </div>

      <article className="panel">
        <h2>{selectedAd ? `Edit ad #${selectedAd.id}` : `New ad for ${selectedScopeLabel}`}</h2>
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
            <span>Placement</span>
            <select
              value={adForm.placement}
              onChange={(event) => setAdForm((current) => ({ ...current, placement: event.target.value as DisplayAdPlacement }))}
              disabled={saving}
            >
              <option value="sidebar">Right bar</option>
              <option value="banner">Bottom bar</option>
            </select>
          </label>

          <label className="field-block">
            <span>Image URL or uploaded image path</span>
            <input
              value={adForm.imageUrl}
              onChange={(event) => setAdForm((current) => ({ ...current, imageUrl: event.target.value }))}
              placeholder="https://example.com/ad.jpg or /api/setup/images/123/file"
              maxLength={500}
              disabled={saving || uploadingImage}
            />
          </label>

          <div className="field-block">
            <span>Selected image</span>
            <div className="selected-image-preview">
              {adForm.imageUrl ? (
                <img src={resolveImageUrl(apiBase, adForm.imageUrl)} alt={adForm.title || 'Selected ad image'} />
              ) : (
                <span>No image selected</span>
              )}
            </div>
          </div>

          <label className="field-block field-block-full">
            <span>Upload image from your computer</span>
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.gif,.svg,image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
              onChange={(event) => setAdImageUpload(event.target.files?.[0] ?? null)}
              disabled={saving || uploadingImage}
            />
          </label>

          <div className="modal-actions">
            <button type="button" className="secondary compact" onClick={() => void handleUploadAdImage()} disabled={saving || uploadingImage || !adImageUpload}>
              {uploadingImage ? 'Uploading...' : 'Upload selected image'}
            </button>
            {adForm.imageUrl ? (
              <button
                type="button"
                className="secondary compact"
                onClick={() => {
                  setAdImageUpload(null)
                  setAdForm((current) => ({ ...current, imageUrl: '' }))
                }}
                disabled={saving || uploadingImage}
              >
                Remove image
              </button>
            ) : null}
          </div>

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

          <label className="field-block field-block-full marketing-color-row">
            <span>Accent color</span>
            <div className="marketing-color-inputs">
              <input
                type="color"
                value={adForm.accentColor || '#ffd54f'}
                onChange={(event) => setAdForm((current) => ({ ...current, accentColor: event.target.value }))}
                disabled={saving}
              />
              <input
                value={adForm.accentColor}
                onChange={(event) => setAdForm((current) => ({ ...current, accentColor: event.target.value }))}
                placeholder="#ffd54f"
                maxLength={32}
                disabled={saving}
              />
            </div>
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
