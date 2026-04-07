import { useEffect, useMemo, useState } from 'react'
import { formatPhoneNumber } from './utils/phone'

import type { LandingPool } from './LandingMetrics'

type LandingUserPool = {
  pool_id: number
  pool_name: string | null
  season: number | null
  team_name: string | null
  primary_team: string | null
}

type LandingPlayerTeam = {
  team_id: number
  team_name: string | null
  jersey_num: number | null
}

type NotificationLevel = 'none' | 'quarter_win' | 'game_total'

type LandingUserRecord = {
  id: number
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  venmo_acct: string | null
  is_player_flg: boolean
  notification_level: NotificationLevel
  notify_on_square_lead_flg: boolean
  user_pools: LandingUserPool[]
  player_teams: LandingPlayerTeam[]
}

type LandingUsersResponse = {
  signedIn: boolean
  canManage: boolean
  pools: LandingPool[]
  users: LandingUserRecord[]
}

type PoolAssignmentDraft = {
  poolId: number
  poolLabel: string
  assigned: boolean
}

type Props = {
  pools: LandingPool[]
  token: string | null
  authHeaders: Record<string, string>
  apiBase: string
  onRequireSignIn: () => void
  onOpenPlayerMaintenance: () => void
}

const DEFAULT_HERO_COLOR = '#8a8f98'
const DEFAULT_HERO_ACCENT = '#ffffff'
const USER_LIST_MIN_HEIGHT = 120
const USER_LIST_MAX_HEIGHT = 360
const USER_LIST_DEFAULT_HEIGHT = 170

const formatUserName = (user: Pick<LandingUserRecord, 'first_name' | 'last_name' | 'email'>): string => {
  const fullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
  return fullName || user.email || 'Unnamed user'
}

const buildPoolLabel = (pool: LandingPool): string => {
  const teamLabel = pool.team_name ?? `Organization ${pool.id}`
  const parts = [`${teamLabel} — ${pool.pool_name ?? `Pool ${pool.id}`}`]
  if (pool.season) {
    parts.push(String(pool.season))
  }
  return parts.join(' • ')
}

const buildAssignedPoolLabel = (pool: LandingUserPool): string => {
  const teamLabel = pool.team_name ?? pool.primary_team
  const parts = [teamLabel ? `${teamLabel} — ${pool.pool_name ?? `Pool ${pool.pool_id}`}` : pool.pool_name ?? `Pool ${pool.pool_id}`]
  if (pool.season) {
    parts.push(String(pool.season))
  }
  return parts.join(' • ')
}

const formatPlayerTeamLabel = (assignment: LandingPlayerTeam): string =>
  `${assignment.team_name ?? `Organization ${assignment.team_id}`}${assignment.jersey_num != null ? ` #${assignment.jersey_num}` : ''}`

const formatNotificationLevel = (level: NotificationLevel): string => {
  if (level === 'quarter_win') return 'Quarter win'
  if (level === 'game_total') return 'Total after game ends'
  return 'None'
}

const formatNotificationSummary = (level: NotificationLevel, notifyOnSquareLead: boolean): string => {
  if (notifyOnSquareLead && level === 'none') {
    return 'Lead alerts only'
  }

  return notifyOnSquareLead ? `${formatNotificationLevel(level)} + lead alerts` : formatNotificationLevel(level)
}

const buildPoolAssignmentDrafts = (pools: LandingPool[], user: LandingUserRecord | null): PoolAssignmentDraft[] =>
  pools.map((pool) => ({
    poolId: pool.id,
    poolLabel: buildPoolLabel(pool),
    assigned: user?.user_pools.some((assignment) => assignment.pool_id === pool.id) ?? false
  }))

export function LandingUserMaintenance({
  pools,
  token,
  authHeaders,
  apiBase,
  onRequireSignIn,
  onOpenPlayerMaintenance
}: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [users, setUsers] = useState<LandingUserRecord[]>([])
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [userForm, setUserForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    venmoAcct: '',
    notificationLevel: 'none' as NotificationLevel,
    notifyOnSquareLead: false
  })
  const [poolAssignments, setPoolAssignments] = useState<PoolAssignmentDraft[]>([])
  const [selectedPlayerTeams, setSelectedPlayerTeams] = useState<LandingPlayerTeam[]>([])
  const [selectedIsPlayer, setSelectedIsPlayer] = useState(false)
  const [showPlayersOnly, setShowPlayersOnly] = useState(false)
  const [isUserListExpanded, setIsUserListExpanded] = useState(true)
  const [userListHeight, setUserListHeight] = useState(USER_LIST_DEFAULT_HEIGHT)
  const [isCreatingNew, setIsCreatingNew] = useState(false)
  const [canManageUsers, setCanManageUsers] = useState(Boolean(token))

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, init)
    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const reason = data?.error || data?.detail || data?.message || `Request failed with status ${response.status}`
      throw new Error(reason)
    }

    return data as T
  }

  const loadUserIntoForm = (user: LandingUserRecord | null, nextPools = pools): void => {
    setSelectedUserId(user?.id ?? null)
    setSelectedPlayerTeams(user?.player_teams ?? [])
    setSelectedIsPlayer(Boolean(user?.is_player_flg))
    setIsCreatingNew(user == null)
    setUserForm({
      firstName: user?.first_name ?? '',
      lastName: user?.last_name ?? '',
      email: user?.email ?? '',
      phone: formatPhoneNumber(user?.phone ?? ''),
      venmoAcct: user?.venmo_acct ?? '',
      notificationLevel: user?.notification_level ?? 'none',
      notifyOnSquareLead: Boolean(user?.notify_on_square_lead_flg)
    })
    setPoolAssignments(buildPoolAssignmentDrafts(nextPools, user))
  }

  const loadUserData = async (preferredUserId?: number | null): Promise<void> => {
    setLoading(true)
    setError(null)

    try {
      const result = await request<LandingUsersResponse>('/api/landing/users', {
        headers: authHeaders
      })

      const nextPools = result.pools?.length ? result.pools : pools
      setCanManageUsers(Boolean(result.canManage))
      setUsers(result.users)

      const visibleResults = showPlayersOnly ? result.users.filter((user) => user.is_player_flg) : result.users

      const nextSelectedUserId =
        preferredUserId && visibleResults.some((user) => user.id === preferredUserId)
          ? preferredUserId
          : visibleResults[0]?.id ?? null

      const nextUser = result.users.find((user) => user.id === nextSelectedUserId) ?? null
      loadUserIntoForm(nextUser, nextPools)
    } catch (fetchError) {
      setCanManageUsers(false)
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load user maintenance data')
      setUsers([])
      loadUserIntoForm(null, pools)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadUserData(selectedUserId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const selectedUser = useMemo(
    () => users.find((entry) => entry.id === selectedUserId) ?? null,
    [selectedUserId, users]
  )

  const visibleUsers = useMemo(
    () => (showPlayersOnly ? users.filter((user) => user.is_player_flg) : users),
    [showPlayersOnly, users]
  )

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
      return 'No authorized pools are available for user maintenance yet.'
    }

    const visibilityText = canManageUsers
      ? 'You can review and maintain users, plus assign them to the pools you manage.'
      : 'You can review visible user records below. Sign in as an organizer to make updates.'

    return `${visibilityText} ${users.length} user record${users.length === 1 ? '' : 's'} across ${pools.length} pool${pools.length === 1 ? '' : 's'}.`
  }, [canManageUsers, pools.length, users.length])

  const onSelectUser = (userId: number): void => {
    const user = users.find((entry) => entry.id === userId) ?? null
    loadUserIntoForm(user)
  }

  const onAddUser = (): void => {
    setError(null)
    loadUserIntoForm(null)
  }

  const toggleUserListExpanded = (): void => {
    setIsUserListExpanded((current) => !current)
  }

  const startUserListResize = (event: React.MouseEvent<HTMLDivElement>): void => {
    event.preventDefault()

    const startY = event.clientY
    const startHeight = userListHeight

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = Math.min(
        USER_LIST_MAX_HEIGHT,
        Math.max(USER_LIST_MIN_HEIGHT, startHeight + (moveEvent.clientY - startY))
      )
      setUserListHeight(nextHeight)
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp, { once: true })
  }

  const onTogglePlayersOnly = (checked: boolean): void => {
    setShowPlayersOnly(checked)

    if (checked && selectedUserId != null && !users.some((user) => user.id === selectedUserId && user.is_player_flg)) {
      const nextPlayerUser = users.find((user) => user.is_player_flg) ?? null
      loadUserIntoForm(nextPlayerUser)
    }
  }

  const updatePoolAssignment = (poolId: number, assigned: boolean): void => {
    setPoolAssignments((current) =>
      current.map((assignment) => (assignment.poolId === poolId ? { ...assignment, assigned } : assignment))
    )
  }

  const onSaveUser = async (): Promise<void> => {
    const trimmedFirstName = userForm.firstName.trim()
    const trimmedLastName = userForm.lastName.trim()
    const trimmedEmail = userForm.email.trim()
    const trimmedPhone = userForm.phone.trim()
    const trimmedVenmoAcct = userForm.venmoAcct.trim()
    const poolIdsPayload = poolAssignments.filter((assignment) => assignment.assigned).map((assignment) => assignment.poolId)

    if (!trimmedFirstName || !trimmedLastName) {
      setError('First name and last name are required.')
      return
    }

    if (!canManageUsers) {
      setError(token ? 'Only organizers can add, update, or delete users.' : 'Sign in as an organizer to save users.')
      if (!token) {
        onRequireSignIn()
      }
      return
    }

    setSaving(true)
    setError(null)

    try {
      if (isCreatingNew) {
        const created = await request<{ id: number }>('/api/setup/users', {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            firstName: trimmedFirstName,
            lastName: trimmedLastName,
            email: trimmedEmail || undefined,
            phone: trimmedPhone || undefined,
            venmoAcct: trimmedVenmoAcct || undefined,
            notificationLevel: userForm.notificationLevel,
            notifyOnSquareLead: userForm.notifyOnSquareLead,
            isPlayer: selectedIsPlayer,
            poolIds: poolIdsPayload
          })
        })

        await loadUserData(created.id)
        return
      }

      if (!selectedUserId) {
        setError('Choose a user first.')
        return
      }

      await request(`/api/setup/users/${selectedUserId}`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({
          firstName: trimmedFirstName,
          lastName: trimmedLastName,
          email: trimmedEmail || undefined,
          phone: trimmedPhone || undefined,
          venmoAcct: trimmedVenmoAcct || undefined,
          notificationLevel: userForm.notificationLevel,
          notifyOnSquareLead: userForm.notifyOnSquareLead,
          isPlayer: selectedIsPlayer,
          poolIds: poolIdsPayload
        })
      })

      await loadUserData(selectedUserId)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save user')
    } finally {
      setSaving(false)
    }
  }

  const onDeleteUser = async (): Promise<void> => {
    if (!selectedUserId) {
      setError('Select a user to delete.')
      return
    }

    if (poolAssignments.some((assignment) => assignment.assigned) || (selectedUser?.player_teams.length ?? 0) > 0) {
      setError('A user can only be deleted after removing pool assignments and any player-team associations.')
      return
    }

    if (!canManageUsers) {
      setError(token ? 'Only organizers can delete users.' : 'Sign in as an organizer to delete users.')
      if (!token) {
        onRequireSignIn()
      }
      return
    }

    const confirmed = window.confirm('Delete this user record?')
    if (!confirmed) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      await request(`/api/setup/users/${selectedUserId}`, {
        method: 'DELETE',
        headers: authHeaders
      })

      await loadUserData()
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete user')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="player-maintenance-shell user-maintenance-shell">
      <div className="landing-hero-bar landing-player-hero" style={heroStyle}>
        <div>
          <h1>User Maintenance</h1>
          <p>{heroSubtitle}</p>
        </div>
      </div>

      {error ? <div className="error-banner landing-error-banner">{error}</div> : null}

      <details className="landing-collapsible" open={isUserListExpanded}>
        <summary
          onClick={(event) => {
            event.preventDefault()
            toggleUserListExpanded()
          }}
        >
          <span className="landing-summary-main">
            <button
              type="button"
              className="landing-collapse-btn"
              aria-label={isUserListExpanded ? 'Collapse users list' : 'Expand users list'}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                toggleUserListExpanded()
              }}
            >
              {isUserListExpanded ? '−' : '+'}
            </button>
            <span>Users</span>
          </span>
          <span className="landing-summary-side">
            <label className="checkbox-row landing-inline-checkbox compact" onClick={(event) => event.stopPropagation()}>
              <input
                type="checkbox"
                checked={showPlayersOnly}
                onChange={(event) => onTogglePlayersOnly(event.target.checked)}
              />
              <span>Members only</span>
            </label>
            <span className="landing-collapsible-count">{visibleUsers.length}</span>
          </span>
        </summary>

        <div className="landing-player-list-wrap is-scrollable" style={isUserListExpanded ? { height: `${userListHeight}px` } : undefined}>
          {loading ? (
            <p className="small">Loading users...</p>
          ) : visibleUsers.length === 0 ? (
            <p className="small">
              {showPlayersOnly ? 'No member users match the current filter.' : 'No user records are available for the pools you can see yet.'}
            </p>
          ) : (
            <table className="landing-player-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Venmo</th>
                  <th>Notifications</th>
                  <th>Pools</th>
                  <th>Organizations</th>
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((user) => (
                  <tr
                    key={user.id}
                    className={selectedUserId === user.id ? 'is-selected' : ''}
                    onClick={() => onSelectUser(user.id)}
                  >
                    <td>{formatUserName(user)}</td>
                    <td>{user.email ?? '—'}</td>
                    <td>{formatPhoneNumber(user.phone) || '—'}</td>
                    <td>{user.venmo_acct ?? '—'}</td>
                    <td>{formatNotificationSummary(user.notification_level, user.notify_on_square_lead_flg)}</td>
                    <td>{user.user_pools.length > 0 ? user.user_pools.map(buildAssignedPoolLabel).join(' | ') : 'Not assigned'}</td>
                    <td>
                      {user.player_teams.length > 0
                        ? user.player_teams.map(formatPlayerTeamLabel).join(' | ')
                        : user.is_player_flg
                          ? 'Member with no current organization assignment'
                          : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>

      {isUserListExpanded ? (
        <div
          className="landing-resize-bar"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize users list"
          onMouseDown={startUserListResize}
          title="Drag to resize the user list"
        >
          <span />
        </div>
      ) : null}

      <div className="landing-player-maintenance-grid">
        <article className="landing-maintenance-card">
          <div className="landing-maintenance-header">
            <div>
              <h2>User Maintenance</h2>
              <p className="small">Select a user row to edit, or add a new user record.</p>
            </div>
            <div className="landing-maintenance-actions">
              <button type="button" className="secondary compact" onClick={onAddUser}>
                Add
              </button>
              <button type="button" className="primary" onClick={() => void onSaveUser()} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void onDeleteUser()}
                disabled={
                  saving ||
                  selectedUserId == null ||
                  poolAssignments.some((assignment) => assignment.assigned) ||
                  (selectedUser?.player_teams.length ?? 0) > 0
                }
              >
                {saving ? 'Working...' : 'Delete'}
              </button>
            </div>
          </div>

          <div className="landing-selected-summary">
            <div className="landing-selected-summary-header">
              <strong>Current member organizations</strong>
              {selectedIsPlayer ? (
                <button type="button" className="secondary compact" onClick={onOpenPlayerMaintenance}>
                  Open Members
                </button>
              ) : null}
            </div>

            {selectedPlayerTeams.length > 0 ? (
              <p className="small landing-selected-team-inline">{selectedPlayerTeams.map(formatPlayerTeamLabel).join(', ')}</p>
            ) : (
              <p className="small landing-selected-team-empty">
                {selectedIsPlayer
                  ? 'This member currently has no organization assignments.'
                  : 'This user is not currently marked as a member.'}
              </p>
            )}
          </div>

          <div className="landing-player-fields">
            <label className="field-block">
              <span>First Name</span>
              <input
                value={userForm.firstName}
                onChange={(event) => setUserForm((current) => ({ ...current, firstName: event.target.value }))}
                placeholder="First name"
              />
            </label>

            <label className="field-block">
              <span>Last Name</span>
              <input
                value={userForm.lastName}
                onChange={(event) => setUserForm((current) => ({ ...current, lastName: event.target.value }))}
                placeholder="Last name"
              />
            </label>

            <label className="field-block">
              <span>Email</span>
              <input
                value={userForm.email}
                onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                placeholder="email@example.com"
              />
            </label>

            <label className="field-block">
              <span>Phone</span>
              <input
                value={userForm.phone}
                onChange={(event) => setUserForm((current) => ({ ...current, phone: formatPhoneNumber(event.target.value) }))}
                placeholder="(555) 555-1234"
                inputMode="tel"
              />
            </label>

            <label className="field-block">
              <span>Venmo</span>
              <input
                value={userForm.venmoAcct}
                onChange={(event) => setUserForm((current) => ({ ...current, venmoAcct: event.target.value }))}
                placeholder="@venmo-handle"
              />
            </label>

            <label className="field-block">
              <span>Notification level</span>
              <select
                value={userForm.notificationLevel}
                onChange={(event) =>
                  setUserForm((current) => ({ ...current, notificationLevel: event.target.value as NotificationLevel }))
                }
              >
                <option value="none">None</option>
                <option value="quarter_win">Quarter win</option>
                <option value="game_total">Total win after game ends</option>
              </select>
            </label>

            <label className="checkbox-row landing-inline-checkbox">
              <input
                type="checkbox"
                checked={userForm.notifyOnSquareLead}
                onChange={(event) => setUserForm((current) => ({ ...current, notifyOnSquareLead: event.target.checked }))}
              />
              <span>Email a live warning when this user's square becomes the current quarter leader</span>
            </label>

            <label className="checkbox-row landing-inline-checkbox landing-field-span">
              <input
                type="checkbox"
                checked={selectedIsPlayer}
                onChange={(event) => setSelectedIsPlayer(event.target.checked)}
              />
              <span>Mark this user as a member</span>
            </label>
          </div>

          {!canManageUsers ? (
            <p className="small">Sign in as an organizer to add, update, or delete user records.</p>
          ) : null}
        </article>

        <article className="landing-maintenance-card">
          <div className="landing-subhero" style={heroStyle}>
            <h2>Pool Assignments</h2>
          </div>

          <details className="landing-collapsible landing-team-collapsible" open>
            <summary>
              <span>Pools</span>
              <span className="landing-collapsible-count">{pools.length}</span>
            </summary>

            <div className="landing-team-assignment-list">
              {pools.length === 0 ? (
                <p className="small">No authorized pools are available.</p>
              ) : (
                poolAssignments.map((assignment) => (
                  <label key={`pool-assignment-${assignment.poolId}`} className="checkbox-row landing-checkbox-card">
                    <input
                      type="checkbox"
                      checked={assignment.assigned}
                      onChange={(event) => updatePoolAssignment(assignment.poolId, event.target.checked)}
                    />
                    <span>{assignment.poolLabel}</span>
                  </label>
                ))
              )}
            </div>
          </details>
        </article>
      </div>
    </section>
  )
}
