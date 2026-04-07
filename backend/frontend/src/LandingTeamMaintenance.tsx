import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { ColorPickerField } from './ColorPickerField'

import type { LandingPool } from './LandingMetrics'

type TeamRecord = {
  id: number
  team_name: string | null
  primary_color: string | null
  secondary_color: string | null
  logo_file: string | null
  primary_contact_id: number | null
  secondary_contact_id: number | null
}

type DirectoryUser = {
  id: number
  first_name: string | null
  last_name: string | null
  email: string | null
}

type StoredImage = {
  fileName: string
  filePath: string
}

type TeamPlayerRecord = {
  id: number
  user_id: number | null
  jersey_num: number | null
  first_name: string | null
  last_name: string | null
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
const TEAM_LIST_MIN_HEIGHT = 120
const TEAM_LIST_MAX_HEIGHT = 360
const TEAM_LIST_DEFAULT_HEIGHT = 170

const formatUserLabel = (user: DirectoryUser): string => {
  const fullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
  return fullName || user.email || `User ${user.id}`
}

const formatTeamName = (team: Pick<TeamRecord, 'id' | 'team_name'>): string => team.team_name ?? `Team ${team.id}`

const normalizeLogoFile = (value: string): string => {
  if (!value) return ''

  try {
    const parsed = new URL(value)
    if (parsed.pathname.startsWith('/images/')) {
      return parsed.pathname
    }

    return value
  } catch {
    if (value.startsWith('/images/')) return value
    if (value.startsWith('images/')) return `/${value}`
    return value
  }
}

const resolveImageUrl = (apiBase: string, value: string): string => {
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  if (value.startsWith('/')) return `${apiBase}${value}`
  return `${apiBase}/images/${value}`
}

export function LandingTeamMaintenance({ pools, token, authHeaders, apiBase, onRequireSignIn }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<TeamRecord[]>([])
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [teamImages, setTeamImages] = useState<StoredImage[]>([])
  const [teamPlayers, setTeamPlayers] = useState<TeamPlayerRecord[]>([])
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [isTeamListExpanded, setIsTeamListExpanded] = useState(true)
  const [teamListHeight, setTeamListHeight] = useState(TEAM_LIST_DEFAULT_HEIGHT)
  const [selectedTeamImage, setSelectedTeamImage] = useState('')
  const [teamLogoUpload, setTeamLogoUpload] = useState<File | null>(null)
  const [brokenImagePreviews, setBrokenImagePreviews] = useState<Record<string, boolean>>({})
  const [teamForm, setTeamForm] = useState({
    teamName: '',
    primaryColor: '',
    secondaryColor: '',
    logoFile: '',
    primaryContactId: '',
    secondaryContactId: ''
  })

  const canManageTeams = Boolean(token)

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, init)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const reason = data?.error || data?.detail || data?.message || `Request failed with status ${response.status}`
      throw new Error(reason)
    }

    return data as T
  }

  const loadTeamIntoForm = (team: TeamRecord | null) => {
    const storedLogo = team?.logo_file ? normalizeLogoFile(team.logo_file) : ''
    setSelectedTeamId(team?.id ?? null)
    setIsCreatingNew(team == null)
    setSelectedTeamImage(storedLogo ? resolveImageUrl(apiBase, storedLogo) : '')
    setTeamLogoUpload(null)
    setTeamForm({
      teamName: team?.team_name ?? '',
      primaryColor: team?.primary_color ?? '',
      secondaryColor: team?.secondary_color ?? '',
      logoFile: storedLogo,
      primaryContactId: team?.primary_contact_id != null ? String(team.primary_contact_id) : '',
      secondaryContactId: team?.secondary_contact_id != null ? String(team.secondary_contact_id) : ''
    })
  }

  const loadTeamData = async (preferredTeamId?: number | null): Promise<void> => {
    if (!token) {
      setTeams([])
      setUsers([])
      setTeamImages([])
      loadTeamIntoForm(null)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [teamResult, userResult, imageResult] = await Promise.all([
        request<{ teams: TeamRecord[] }>('/api/setup/teams', { headers: authHeaders }),
        request<{ users: DirectoryUser[] }>('/api/setup/users', { headers: authHeaders }),
        request<{ images: StoredImage[] }>('/api/setup/images', { headers: authHeaders })
      ])

      setTeams(teamResult.teams)
      setUsers(userResult.users)
      setTeamImages(imageResult.images)

      const nextSelectedTeamId =
        preferredTeamId && teamResult.teams.some((team) => team.id === preferredTeamId)
          ? preferredTeamId
          : teamResult.teams[0]?.id ?? null

      const nextTeam = teamResult.teams.find((team) => team.id === nextSelectedTeamId) ?? null
      loadTeamIntoForm(nextTeam)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load teams')
      setTeams([])
      setUsers([])
      setTeamImages([])
      loadTeamIntoForm(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadTeamData(selectedTeamId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    const loadAssignedPlayers = async () => {
      if (!token || !selectedTeamId) {
        setTeamPlayers([])
        return
      }

      try {
        const result = await request<{ players: TeamPlayerRecord[] }>(`/api/setup/teams/${selectedTeamId}/players`, {
          headers: authHeaders
        })
        setTeamPlayers(result.players)
      } catch {
        setTeamPlayers([])
      }
    }

    void loadAssignedPlayers()
  }, [authHeaders, selectedTeamId, token])

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
      return 'Sign in as an organizer to review and maintain teams.'
    }

    return `${teams.length} team record${teams.length === 1 ? '' : 's'} ready for maintenance.`
  }, [teams.length, token])

  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams]
  )

  const onSelectTeam = (teamId: number): void => {
    const team = teams.find((entry) => entry.id === teamId) ?? null
    loadTeamIntoForm(team)
  }

  const onAddTeam = (): void => {
    setError(null)
    loadTeamIntoForm(null)
  }

  const toggleTeamListExpanded = (): void => {
    setIsTeamListExpanded((current) => !current)
  }

  const startTeamListResize = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault()

    const startY = event.clientY
    const startHeight = teamListHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = Math.min(
        TEAM_LIST_MAX_HEIGHT,
        Math.max(TEAM_LIST_MIN_HEIGHT, startHeight + (moveEvent.clientY - startY))
      )
      setTeamListHeight(nextHeight)
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp, { once: true })
  }

  const onUploadTeamLogo = async (): Promise<void> => {
    if (!teamLogoUpload) {
      setError('Choose an image file first.')
      return
    }

    if (!canManageTeams) {
      setError('Sign in as an organizer to upload team images.')
      onRequireSignIn()
      return
    }

    setSaving(true)
    setError(null)

    try {
      const body = new FormData()
      body.append('image', teamLogoUpload)

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

      const storedPath = normalizeLogoFile(data.filePath ?? '')
      setTeamForm((current) => ({ ...current, logoFile: storedPath }))
      setSelectedTeamImage(resolveImageUrl(apiBase, storedPath))
      setTeamLogoUpload(null)

      const refreshedImages = await request<{ images: StoredImage[] }>('/api/setup/images', {
        headers: authHeaders
      })
      setTeamImages(refreshedImages.images)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Failed to upload image')
    } finally {
      setSaving(false)
    }
  }

  const onSaveTeam = async (): Promise<void> => {
    const trimmedName = teamForm.teamName.trim()

    if (!trimmedName) {
      setError('Team name is required.')
      return
    }

    if (!canManageTeams) {
      setError('Sign in as an organizer to save teams.')
      onRequireSignIn()
      return
    }

    setSaving(true)
    setError(null)

    try {
      const payload = {
        teamName: trimmedName,
        primaryColor: teamForm.primaryColor.trim() || undefined,
        secondaryColor: teamForm.secondaryColor.trim() || undefined,
        logoFile: teamForm.logoFile ? normalizeLogoFile(teamForm.logoFile.trim()) : undefined,
        primaryContactId: teamForm.primaryContactId ? Number(teamForm.primaryContactId) : undefined,
        secondaryContactId: teamForm.secondaryContactId ? Number(teamForm.secondaryContactId) : undefined
      }

      if (isCreatingNew) {
        const created = await request<{ id: number }>('/api/setup/teams', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(payload)
        })

        await loadTeamData(created.id)
        return
      }

      if (!selectedTeamId) {
        setError('Choose a team first.')
        return
      }

      await request(`/api/setup/teams/${selectedTeamId}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify(payload)
      })

      await loadTeamData(selectedTeamId)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save team')
    } finally {
      setSaving(false)
    }
  }

  const onDeleteTeam = async (): Promise<void> => {
    if (!selectedTeamId) {
      setError('Select a team to delete.')
      return
    }

    if (!canManageTeams) {
      setError('Sign in as an organizer to delete teams.')
      onRequireSignIn()
      return
    }

    const confirmed = window.confirm('Delete this team?')
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      await request(`/api/setup/teams/${selectedTeamId}`, {
        method: 'DELETE',
        headers: authHeaders
      })

      await loadTeamData()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete team')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="player-maintenance-shell">
      <div className="landing-hero-bar landing-player-hero" style={heroStyle}>
        <div>
          <h1>Team Maintenance</h1>
          <p>{heroSubtitle}</p>
        </div>
      </div>

      {error ? <div className="error-banner landing-error-banner">{error}</div> : null}

      <details className="landing-collapsible" open={isTeamListExpanded}>
        <summary
          onClick={(event) => {
            event.preventDefault()
            toggleTeamListExpanded()
          }}
        >
          <span className="landing-summary-main">
            <button
              type="button"
              className="landing-collapse-btn"
              aria-label={isTeamListExpanded ? 'Collapse teams list' : 'Expand teams list'}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                toggleTeamListExpanded()
              }}
            >
              {isTeamListExpanded ? '−' : '+'}
            </button>
            <span>Teams</span>
          </span>
          <span className="landing-collapsible-count">{teams.length}</span>
        </summary>

        <div className="landing-player-list-wrap is-scrollable" style={isTeamListExpanded ? { height: `${teamListHeight}px` } : undefined}>
          {loading ? (
            <p className="small">Loading teams...</p>
          ) : !token ? (
            <p className="small">Sign in to load team maintenance records.</p>
          ) : teams.length === 0 ? (
            <p className="small">No teams are available yet.</p>
          ) : (
            <table className="landing-player-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Primary</th>
                  <th>Secondary</th>
                  <th>Contact</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => (
                  <tr
                    key={team.id}
                    className={team.id === selectedTeamId ? 'is-selected' : ''}
                    onClick={() => onSelectTeam(team.id)}
                  >
                    <td>{formatTeamName(team)}</td>
                    <td>{team.primary_color ?? '—'}</td>
                    <td>{team.secondary_color ?? '—'}</td>
                    <td>{users.find((user) => user.id === team.primary_contact_id)?.email ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </details>

      {isTeamListExpanded ? (
        <div
          className="landing-resize-bar"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize teams list"
          onMouseDown={startTeamListResize}
          title="Drag to resize the teams list"
        >
          <span />
        </div>
      ) : null}

      <div className="landing-player-maintenance-grid">
        <article className="landing-maintenance-card">
          <div className="landing-maintenance-header">
            <div>
              <h2>{isCreatingNew ? 'Add Team' : 'Maintain Team'}</h2>
              <p className="small">Create a new team or update the selected one.</p>
            </div>
            <div className="landing-maintenance-actions">
              <button type="button" className="secondary compact" onClick={onAddTeam} disabled={saving}>
                Add
              </button>
              <button type="button" className="primary" onClick={onSaveTeam} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button type="button" className="secondary" onClick={onDeleteTeam} disabled={saving || !selectedTeamId}>
                Delete
              </button>
            </div>
          </div>

          <div className="landing-selected-summary">
            <div className="landing-selected-summary-header">
              <div>
                <strong>{selectedTeam ? formatTeamName(selectedTeam) : 'New team'}</strong>
              </div>
            </div>
          </div>

          <div className="landing-player-fields team-maintenance-fields">
            <label className="field-block landing-field-span">
              <span>Team name</span>
              <input
                value={teamForm.teamName}
                onChange={(event) => setTeamForm((current) => ({ ...current, teamName: event.target.value }))}
                disabled={saving}
              />
            </label>

            <div className="field-block landing-field-span team-image-inline-block">
              <span>Selected image</span>
              <div className="selected-image-preview">
                {selectedTeamImage ? (
                  <img src={selectedTeamImage} alt={`${teamForm.teamName || 'Selected'} logo`} />
                ) : (
                  <span>No team image selected</span>
                )}
              </div>
            </div>

            <ColorPickerField
              label="Primary color"
              value={teamForm.primaryColor}
              onChange={(nextValue) => setTeamForm((current) => ({ ...current, primaryColor: nextValue }))}
              placeholder="#0B162A"
              disabled={saving}
            />

            <ColorPickerField
              label="Secondary color"
              value={teamForm.secondaryColor}
              onChange={(nextValue) => setTeamForm((current) => ({ ...current, secondaryColor: nextValue }))}
              placeholder="#F7A33C"
              disabled={saving}
            />

            <label className="field-block landing-field-span">
              <span>Upload new image</span>
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={(event) => setTeamLogoUpload(event.target.files?.[0] ?? null)}
                disabled={saving}
              />
            </label>

            <div className="landing-maintenance-actions landing-field-span inline-actions inline-actions-tight">
              <button type="button" className="secondary compact" onClick={onUploadTeamLogo} disabled={saving || !teamLogoUpload}>
                {saving && teamLogoUpload ? 'Uploading...' : 'Upload new team image'}
              </button>
              <button
                type="button"
                className="secondary compact"
                onClick={() => {
                  setSelectedTeamImage('')
                  setTeamLogoUpload(null)
                  setTeamForm((current) => ({ ...current, logoFile: '' }))
                }}
                disabled={saving}
              >
                Remove image
              </button>
            </div>

            <div className="field-block landing-field-span">
              <span>Choose from existing images</span>
              {teamImages.length === 0 ? (
                <p className="small">No stored images are available yet.</p>
              ) : (
                <div className="image-selector-grid">
                  {teamImages.map((image) => {
                    const storedPath = normalizeLogoFile(image.filePath)
                    const fullPath = resolveImageUrl(apiBase, storedPath)
                    const showFallback = brokenImagePreviews[fullPath] === true

                    return (
                      <button
                        key={image.fileName}
                        type="button"
                        className={`image-option ${selectedTeamImage === fullPath ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedTeamImage(fullPath)
                          setTeamForm((current) => ({ ...current, logoFile: storedPath }))
                        }}
                        title={image.fileName}
                        disabled={saving}
                      >
                        {showFallback ? (
                          <span className="image-option-fallback">No preview</span>
                        ) : (
                          <img
                            src={fullPath}
                            alt={image.fileName}
                            onError={() => {
                              setBrokenImagePreviews((current) => ({ ...current, [fullPath]: true }))
                            }}
                          />
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <label className="field-block">
              <span>Primary contact</span>
              <select
                value={teamForm.primaryContactId}
                onChange={(event) => setTeamForm((current) => ({ ...current, primaryContactId: event.target.value }))}
                disabled={saving}
              >
                <option value="">None</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {formatUserLabel(user)}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-block">
              <span>Secondary contact</span>
              <select
                value={teamForm.secondaryContactId}
                onChange={(event) => setTeamForm((current) => ({ ...current, secondaryContactId: event.target.value }))}
                disabled={saving}
              >
                <option value="">None</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {formatUserLabel(user)}
                  </option>
                ))}
              </select>
            </label>
          </div>

        </article>

        <aside className="landing-maintenance-card">
          <div className="landing-maintenance-header">
            <div>
              <h2>Assigned Players</h2>
              <p className="small">Players currently linked to the selected team.</p>
            </div>
          </div>

          <div className="landing-readonly-panel">
            {!selectedTeamId ? (
              <p className="small">Select a team to view its players.</p>
            ) : teamPlayers.length === 0 ? (
              <p className="small">No players are assigned to this team yet.</p>
            ) : (
              <ul className="landing-readonly-list">
                {teamPlayers.map((player) => {
                  const fullName = `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim() || `User ${player.user_id ?? player.id}`
                  return (
                    <li key={player.id}>
                      <strong>{player.jersey_num != null ? `#${player.jersey_num}` : '#-'}</strong>
                      <span>{fullName}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}
