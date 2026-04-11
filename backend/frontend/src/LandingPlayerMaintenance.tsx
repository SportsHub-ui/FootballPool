import { useEffect, useMemo, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { formatPhoneNumber } from './utils/phone'

import type { LandingPool } from './LandingMetrics'

type LandingTeam = {
  id: number
  team_name: string | null
  primary_color: string | null
  secondary_color: string | null
  logo_file: string | null
  has_members_flg?: boolean | null
}

type LandingPlayerTeam = {
  team_id: number
  team_name: string | null
  jersey_num: number | null
}

type LandingPlayerRecord = {
  id: number
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  venmo_acct: string | null
  is_player_flg: boolean
  player_teams: LandingPlayerTeam[]
}

type LandingPlayersResponse = {
  signedIn: boolean
  teams: LandingTeam[]
  players: LandingPlayerRecord[]
}

type DirectoryUser = {
  id: number
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  venmo_acct: string | null
  is_player_flg?: boolean | null
  player_teams?: LandingPlayerTeam[]
}

type TeamAssignmentDraft = {
  teamId: number
  teamName: string
  assigned: boolean
  jerseyNum: string
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
const PLAYER_LIST_MIN_HEIGHT = 120
const PLAYER_LIST_MAX_HEIGHT = 360
const PLAYER_LIST_DEFAULT_HEIGHT = 170

const normalizeValue = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase()

const formatPersonName = (player: Pick<LandingPlayerRecord, 'first_name' | 'last_name' | 'email'>): string => {
  const fullName = `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim()
  return fullName || player.email || 'Unnamed player'
}

const buildAssignmentDrafts = (teams: LandingTeam[], player: LandingPlayerRecord | null): TeamAssignmentDraft[] =>
  teams
    .filter((team) => team.has_members_flg !== false)
    .map((team) => {
      const match = player?.player_teams.find((assignment) => assignment.team_id === team.id)

      return {
        teamId: team.id,
        teamName: team.team_name ?? `Organization ${team.id}`,
        assigned: Boolean(match),
        jerseyNum: match?.jersey_num != null ? String(match.jersey_num) : ''
      }
    })

export function LandingPlayerMaintenance({ pools, token, authHeaders, apiBase, onRequireSignIn }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teams, setTeams] = useState<LandingTeam[]>([])
  const [players, setPlayers] = useState<LandingPlayerRecord[]>([])
  const [directoryUsers, setDirectoryUsers] = useState<DirectoryUser[]>([])
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null)
  const [playerForm, setPlayerForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    venmoAcct: ''
  })
  const [playerAssignments, setPlayerAssignments] = useState<TeamAssignmentDraft[]>([])
  const [isPlayerListExpanded, setIsPlayerListExpanded] = useState(true)
  const [playerListHeight, setPlayerListHeight] = useState(PLAYER_LIST_DEFAULT_HEIGHT)
  const [isCreatingNew, setIsCreatingNew] = useState(false)

  const canManagePlayers = Boolean(token)

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, { credentials: 'include', ...init })
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const reason = data?.error || data?.detail || data?.message || `Request failed with status ${response.status}`
      throw new Error(reason)
    }

    return data as T
  }

  const loadPlayerIntoForm = (player: LandingPlayerRecord | null, nextTeams = teams): void => {
    setSelectedPlayerId(player?.id ?? null)
    setIsCreatingNew(player == null)
    setPlayerForm({
      firstName: player?.first_name ?? '',
      lastName: player?.last_name ?? '',
      email: player?.email ?? '',
      phone: formatPhoneNumber(player?.phone ?? ''),
      venmoAcct: player?.venmo_acct ?? ''
    })
    setPlayerAssignments(buildAssignmentDrafts(nextTeams, player))
  }

  const loadPlayerData = async (preferredPlayerId?: number | null): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      const result = await request<LandingPlayersResponse>('/api/landing/players', {
        headers: authHeaders
      })

      const assignableTeams = result.teams.filter((team) => team.has_members_flg !== false)

      setTeams(assignableTeams)
      setPlayers(result.players)

      if (token) {
        try {
          const directory = await request<{ users: DirectoryUser[] }>('/api/setup/users', {
            headers: authHeaders
          })
          setDirectoryUsers(directory.users)
        } catch {
          setDirectoryUsers(result.players)
        }
      } else {
        setDirectoryUsers(result.players)
      }

      const nextSelectedPlayer =
        preferredPlayerId && result.players.some((player) => player.id === preferredPlayerId)
          ? preferredPlayerId
          : result.players[0]?.id ?? null

      const nextPlayer = result.players.find((player) => player.id === nextSelectedPlayer) ?? null
      loadPlayerIntoForm(nextPlayer, assignableTeams)
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load player maintenance data')
      setTeams([])
      setPlayers([])
      setDirectoryUsers([])
      loadPlayerIntoForm(null, [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPlayerData(selectedPlayerId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const authorizedHeroPool = useMemo(() => {
    const defaultPool = pools.find((pool) => pool.default_flg)
    if (defaultPool) {
      return defaultPool
    }

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
    if (pools.length === 0) {
      return 'No authorized pools are available for member maintenance yet.'
    }

    const visibilityText = canManagePlayers
      ? 'You can review and maintain members for the organizations you are authorized to see.'
      : 'You can review public member records below. Sign in to make updates.'

    return `${visibilityText} ${players.length} member record${players.length === 1 ? '' : 's'} across ${teams.length} organization${teams.length === 1 ? '' : 's'}.`
  }, [canManagePlayers, players.length, pools.length, teams.length])

  const onSelectPlayer = (playerId: number): void => {
    const player = players.find((entry) => entry.id === playerId) ?? null
    loadPlayerIntoForm(player)
  }

  const onAddPlayer = (): void => {
    setError(null)
    loadPlayerIntoForm(null)
  }

  const togglePlayerListExpanded = (): void => {
    setIsPlayerListExpanded((current) => !current)
  }

  const startPlayerListResize = (event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault()

    const startY = event.clientY
    const startHeight = playerListHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = Math.min(
        PLAYER_LIST_MAX_HEIGHT,
        Math.max(PLAYER_LIST_MIN_HEIGHT, startHeight + (moveEvent.clientY - startY))
      )
      setPlayerListHeight(nextHeight)
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp, { once: true })
  }

  const updateAssignment = (teamId: number, changes: Partial<TeamAssignmentDraft>): void => {
    setPlayerAssignments((current) =>
      current.map((assignment) => (assignment.teamId === teamId ? { ...assignment, ...changes } : assignment))
    )
  }

  const onSavePlayer = async (): Promise<void> => {
    const trimmedFirstName = playerForm.firstName.trim()
    const trimmedLastName = playerForm.lastName.trim()
    const trimmedEmail = playerForm.email.trim()
    const trimmedPhone = playerForm.phone.trim()
    const trimmedVenmoAcct = playerForm.venmoAcct.trim()
    const selectedAssignments = playerAssignments.filter((assignment) => assignment.assigned)

    if (!trimmedFirstName || !trimmedLastName) {
      setError('First name and last name are required.')
      return
    }

    if (!canManagePlayers) {
      setError('Sign in to add or update members.')
      onRequireSignIn()
      return
    }

    setSaving(true)
    setError(null)

    try {
      const memberOrganizationsPayload = selectedAssignments.map((assignment) => ({
        teamId: assignment.teamId,
        memberNumber: assignment.jerseyNum.trim() === '' ? null : Number(assignment.jerseyNum)
      }))

      if (isCreatingNew) {
        const nameMatches = directoryUsers.filter(
          (user) =>
            normalizeValue(user.first_name) === normalizeValue(trimmedFirstName) &&
            normalizeValue(user.last_name) === normalizeValue(trimmedLastName)
        )

        const nonPlayerMatch = nameMatches.find((user) => !Boolean(user.is_player_flg))
        if (nonPlayerMatch) {
          const shouldConvertExisting = window.confirm(
            'A user with this name already exists but is not marked as a member. Click OK to make that user a member, or Cancel to create a new user record.'
          )

          if (shouldConvertExisting) {
            await request(`/api/setup/users/${nonPlayerMatch.id}`, {
              method: 'PATCH',
              headers: authHeaders,
              body: JSON.stringify({
                firstName: trimmedFirstName,
                lastName: trimmedLastName,
                email: trimmedEmail || nonPlayerMatch.email || undefined,
                phone: trimmedPhone || nonPlayerMatch.phone || undefined,
                venmoAcct: trimmedVenmoAcct || nonPlayerMatch.venmo_acct || undefined,
                isMember: true,
                memberOrganizations: memberOrganizationsPayload
              })
            })

            await loadPlayerData(nonPlayerMatch.id)
            return
          }
        }

        const playerMatch = nameMatches.find((user) => Boolean(user.is_player_flg))
        if (playerMatch) {
          const shouldCreateAnother = window.confirm(
            'A member with this name already exists. Click OK to add another user record with the same name, or Cancel to stop.'
          )

          if (!shouldCreateAnother) {
            return
          }
        }

        const created = await request<{ id: number }>('/api/setup/users', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            firstName: trimmedFirstName,
            lastName: trimmedLastName,
            email: trimmedEmail || undefined,
            phone: trimmedPhone || undefined,
            venmoAcct: trimmedVenmoAcct || undefined,
            isMember: true,
            memberOrganizations: memberOrganizationsPayload
          })
        })

        await loadPlayerData(created.id)
        return
      }

      if (!selectedPlayerId) {
        setError('Choose a player first.')
        return
      }

      await request(`/api/setup/users/${selectedPlayerId}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
          email: trimmedEmail || undefined,
          phone: trimmedPhone || undefined,
          venmoAcct: trimmedVenmoAcct || undefined,
          isMember: true,
          memberOrganizations: memberOrganizationsPayload
        })
      })

      await loadPlayerData(selectedPlayerId)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save member')
    } finally {
      setSaving(false)
    }
  }

  const onDeletePlayer = async (): Promise<void> => {
    if (!selectedPlayerId) {
      setError('Select a member to delete.')
      return
    }

    if (playerAssignments.some((assignment) => assignment.assigned)) {
      setError('A member can only be deleted if they are not assigned to an organization.')
      return
    }

    if (!canManagePlayers) {
      setError('Sign in to delete a member.')
      onRequireSignIn()
      return
    }

    const confirmed = window.confirm('Delete this member record?')
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      await request(`/api/setup/users/${selectedPlayerId}`, {
        method: 'DELETE',
        headers: authHeaders
      })

      await loadPlayerData()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete member')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="player-maintenance-shell">
      <div className="landing-hero-bar landing-player-hero" style={heroStyle}>
        <div>
          <h1>Member Maintenance</h1>
          <p>{heroSubtitle}</p>
        </div>
      </div>

      {error ? <div className="error-banner landing-error-banner">{error}</div> : null}

      <details className="landing-collapsible" open={isPlayerListExpanded}>
        <summary
          onClick={(event) => {
            event.preventDefault()
            togglePlayerListExpanded()
          }}
        >
          <span className="landing-summary-main">
            <button
              type="button"
              className="landing-collapse-btn"
              aria-label={isPlayerListExpanded ? 'Collapse players list' : 'Expand players list'}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                togglePlayerListExpanded()
              }}
            >
              {isPlayerListExpanded ? '−' : '+'}
            </button>
            <span>Members</span>
          </span>
          <span className="landing-collapsible-count">{players.length}</span>
        </summary>

        <div className="landing-player-list-wrap is-scrollable" style={isPlayerListExpanded ? { height: `${playerListHeight}px` } : undefined}>
          {loading ? (
            <p className="small">Loading members...</p>
          ) : players.length === 0 ? (
            <p className="small">No member records are available for the organizations you can see yet.</p>
          ) : (
            <table className="landing-player-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Venmo</th>
                  <th>Organizations</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => (
                  <tr
                    key={player.id}
                    className={selectedPlayerId === player.id ? 'is-selected' : ''}
                    onClick={() => onSelectPlayer(player.id)}
                  >
                    <td>{formatPersonName(player)}</td>
                    <td>{player.email ?? '—'}</td>
                    <td>{formatPhoneNumber(player.phone) || '—'}</td>
                    <td>{player.venmo_acct ?? '—'}</td>
                    <td>
                      {player.player_teams.length > 0
                        ? player.player_teams.map((assignment) => `${assignment.team_name ?? `Organization ${assignment.team_id}`} #${assignment.jersey_num ?? '—'}`).join(' | ')
                        : 'Not assigned'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>

      {isPlayerListExpanded ? (
        <div
          className="landing-resize-bar"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize players list"
          onMouseDown={startPlayerListResize}
          title="Drag to resize the players list"
        >
          <span />
        </div>
      ) : null}

      <div className="landing-player-maintenance-grid">
        <article className="landing-maintenance-card">
          <div className="landing-maintenance-header">
            <div>
              <h2>Member Maintenance</h2>
              <p className="small">Select a member row to edit, or add a new member record.</p>
            </div>
            <div className="landing-maintenance-actions">
              <button type="button" className="secondary compact" onClick={onAddPlayer}>
                Add
              </button>
              <button type="button" className="primary" onClick={() => void onSavePlayer()} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void onDeletePlayer()}
                disabled={saving || selectedPlayerId == null || playerAssignments.some((assignment) => assignment.assigned)}
              >
                {saving ? 'Working...' : 'Delete'}
              </button>
            </div>
          </div>

          <div className="landing-player-fields">
            <label className="field-block">
              <span>First Name</span>
              <input
                value={playerForm.firstName}
                onChange={(event) => setPlayerForm((current) => ({ ...current, firstName: event.target.value }))}
                placeholder="First name"
              />
            </label>

            <label className="field-block">
              <span>Last Name</span>
              <input
                value={playerForm.lastName}
                onChange={(event) => setPlayerForm((current) => ({ ...current, lastName: event.target.value }))}
                placeholder="Last name"
              />
            </label>

            <label className="field-block">
              <span>Email</span>
              <input
                value={playerForm.email}
                onChange={(event) => setPlayerForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="email@example.com"
              />
            </label>

            <label className="field-block">
              <span>Phone</span>
              <input
                value={playerForm.phone}
                onChange={(event) => setPlayerForm((current) => ({ ...current, phone: formatPhoneNumber(event.target.value) }))}
                placeholder="(555) 555-1234"
                inputMode="tel"
              />
            </label>

            <label className="field-block">
              <span>Venmo</span>
              <input
                value={playerForm.venmoAcct}
                onChange={(event) => setPlayerForm((current) => ({ ...current, venmoAcct: event.target.value }))}
                placeholder="@venmo-handle"
              />
            </label>
          </div>

          {!canManagePlayers ? <p className="small">Sign in to add, update, or delete member records.</p> : null}
        </article>

        <article className="landing-maintenance-card">
          <div className="landing-subhero" style={heroStyle}>
            <h2>Organization Assignments</h2>
          </div>

          <details className="landing-collapsible landing-team-collapsible" open>
            <summary>
              <span>Organizations</span>
              <span className="landing-collapsible-count">{teams.length}</span>
            </summary>

            <p className="small landing-readonly-note">Only organizations configured to track members appear in this list.</p>

            <div className="landing-team-assignment-list">
              {teams.length === 0 ? (
                <p className="small">No authorized organizations are available.</p>
              ) : (
                playerAssignments.map((assignment) => (
                  <div key={`team-assignment-${assignment.teamId}`} className="landing-team-assignment-row">
                    <label className="checkbox-row">
                      <input
                        type="checkbox"
                        checked={assignment.assigned}
                        onChange={(event) => {
                          updateAssignment(assignment.teamId, {
                            assigned: event.target.checked,
                            jerseyNum: event.target.checked ? assignment.jerseyNum : ''
                          })
                        }}
                      />
                      <span>{assignment.teamName}</span>
                    </label>

                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={assignment.jerseyNum}
                      disabled={!assignment.assigned}
                      onChange={(event) => {
                        updateAssignment(assignment.teamId, { jerseyNum: event.target.value })
                      }}
                      placeholder="Number"
                    />
                  </div>
                ))
              )}
            </div>
          </details>
        </article>
      </div>
    </section>
  )
}
