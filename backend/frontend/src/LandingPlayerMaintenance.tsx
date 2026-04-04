import { useEffect, useMemo, useState } from 'react'

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

type LandingTeam = {
  id: number
  team_name: string | null
  primary_color: string | null
  secondary_color: string | null
  logo_file: string | null
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

const normalizeValue = (value: string | null | undefined): string => (value ?? '').trim().toLowerCase()

const formatPersonName = (player: Pick<LandingPlayerRecord, 'first_name' | 'last_name' | 'email'>): string => {
  const fullName = `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim()
  return fullName || player.email || 'Unnamed player'
}

const buildAssignmentDrafts = (teams: LandingTeam[], player: LandingPlayerRecord | null): TeamAssignmentDraft[] =>
  teams.map((team) => {
    const match = player?.player_teams.find((assignment) => assignment.team_id === team.id)

    return {
      teamId: team.id,
      teamName: team.team_name ?? `Team ${team.id}`,
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
    phone: ''
  })
  const [playerAssignments, setPlayerAssignments] = useState<TeamAssignmentDraft[]>([])
  const [isCreatingNew, setIsCreatingNew] = useState(false)

  const canManagePlayers = Boolean(token)

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${apiBase}${path}`, init)
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
      phone: player?.phone ?? ''
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

      setTeams(result.teams)
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
      loadPlayerIntoForm(nextPlayer, result.teams)
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
      return 'No authorized pools are available for player maintenance yet.'
    }

    const visibilityText = canManagePlayers
      ? 'You can review and maintain players for the teams you are authorized to see.'
      : 'You can review public player records below. Sign in to make updates.'

    return `${visibilityText} ${players.length} player record${players.length === 1 ? '' : 's'} across ${teams.length} team${teams.length === 1 ? '' : 's'}.`
  }, [canManagePlayers, players.length, pools.length, teams.length])

  const onSelectPlayer = (playerId: number): void => {
    const player = players.find((entry) => entry.id === playerId) ?? null
    loadPlayerIntoForm(player)
  }

  const onAddPlayer = (): void => {
    setError(null)
    loadPlayerIntoForm(null)
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
    const selectedAssignments = playerAssignments.filter((assignment) => assignment.assigned)

    if (!trimmedFirstName || !trimmedLastName) {
      setError('First name and last name are required.')
      return
    }

    if (selectedAssignments.some((assignment) => assignment.jerseyNum.trim() === '')) {
      setError('Enter a jersey number for every assigned team.')
      return
    }

    if (!canManagePlayers) {
      setError('Sign in to add or update players.')
      onRequireSignIn()
      return
    }

    setSaving(true)
    setError(null)

    try {
      const playerTeamsPayload = selectedAssignments.map((assignment) => ({
        teamId: assignment.teamId,
        jerseyNum: Number(assignment.jerseyNum)
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
            'A user with this name already exists but is not marked as a player. Click OK to make that user a player, or Cancel to create a new user record.'
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
                isPlayer: true,
                playerTeams: playerTeamsPayload
              })
            })

            await loadPlayerData(nonPlayerMatch.id)
            return
          }
        }

        const playerMatch = nameMatches.find((user) => Boolean(user.is_player_flg))
        if (playerMatch) {
          const shouldCreateAnother = window.confirm(
            'A player with this name already exists. Click OK to add another user record with the same name, or Cancel to stop.'
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
            isPlayer: true,
            playerTeams: playerTeamsPayload
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
          isPlayer: true,
          playerTeams: playerTeamsPayload
        })
      })

      await loadPlayerData(selectedPlayerId)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save player')
    } finally {
      setSaving(false)
    }
  }

  const onDeletePlayer = async (): Promise<void> => {
    if (!selectedPlayerId) {
      setError('Select a player to delete.')
      return
    }

    if (playerAssignments.some((assignment) => assignment.assigned)) {
      setError('A player can only be deleted if they are not assigned to a team.')
      return
    }

    if (!canManagePlayers) {
      setError('Sign in to delete a player.')
      onRequireSignIn()
      return
    }

    const confirmed = window.confirm('Delete this player record?')
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
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete player')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="player-maintenance-shell">
      <div className="landing-hero-bar landing-player-hero" style={heroStyle}>
        <div>
          <h1>Player Maintenance</h1>
          <p>{heroSubtitle}</p>
        </div>
      </div>

      {error ? <div className="error-banner landing-error-banner">{error}</div> : null}

      <details className="landing-collapsible" open>
        <summary>
          <span>Players</span>
          <span className="landing-collapsible-count">{players.length}</span>
        </summary>

        <div className="landing-player-list-wrap">
          {loading ? (
            <p className="small">Loading players...</p>
          ) : players.length === 0 ? (
            <p className="small">No player records are available for the teams you can see yet.</p>
          ) : (
            <table className="landing-player-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Teams</th>
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
                    <td>{player.phone ?? '—'}</td>
                    <td>
                      {player.player_teams.length > 0
                        ? player.player_teams.map((assignment) => `${assignment.team_name ?? `Team ${assignment.team_id}`} #${assignment.jersey_num ?? '—'}`).join(' | ')
                        : 'Not assigned'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>

      <div className="landing-player-maintenance-grid">
        <article className="landing-maintenance-card">
          <div className="landing-maintenance-header">
            <div>
              <h2>Player Maintenance</h2>
              <p className="small">Select a player row to edit, or add a new player record.</p>
            </div>
            <button type="button" className="secondary compact" onClick={onAddPlayer}>
              Add
            </button>
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
                onChange={(event) => setPlayerForm((current) => ({ ...current, phone: event.target.value }))}
                placeholder="(555) 555-1234"
              />
            </label>
          </div>

          <div className="landing-maintenance-actions">
            <button type="button" className="primary" onClick={() => void onSavePlayer()} disabled={saving}>
              {saving ? 'Saving...' : isCreatingNew ? 'Save new player' : 'Save player'}
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

          {!canManagePlayers ? <p className="small">Sign in to add, update, or delete player records.</p> : null}
        </article>

        <article className="landing-maintenance-card">
          <div className="landing-subhero" style={heroStyle}>
            <h2>Team Assignments</h2>
          </div>

          <details className="landing-collapsible landing-team-collapsible" open>
            <summary>
              <span>Teams</span>
              <span className="landing-collapsible-count">{teams.length}</span>
            </summary>

            <div className="landing-team-assignment-list">
              {teams.length === 0 ? (
                <p className="small">No authorized teams are available.</p>
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
                      placeholder="Jersey #"
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
