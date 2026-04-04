import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import { formatPhoneNumber } from './utils/phone'

type HealthResponse = {
  status: string
  databaseTime?: string
  message?: string
  detail?: string
}

type SmokeRow = {
  table_name: string
  row_count: number
}

type PreviewRow = {
  pool_id: number
  pool_name: string
  season: number
  team_name: string
  total_squares: number
  sold_squares: number
  latest_game_dt: string | null
}

type UserOption = {
  id: number
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  is_player_flg?: boolean | null
  player_teams?: Array<{
    team_id: number
    team_name: string | null
    jersey_num: number
  }>
}

type TeamOption = {
  id: number
  team_name: string | null
  primary_color: string | null
  secondary_color: string | null
  logo_file: string | null
  primary_contact_id: number | null
  secondary_contact_id: number | null
}

type PoolOption = {
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

type StoredImage = {
  fileName: string
  filePath: string
}

type PlayerOption = {
  id: number
  user_id: number | null
  jersey_num: number | null
  first_name: string | null
  last_name: string | null
}

type IngestionRun = {
  id: number
  run_mode: string
  source: string
  total_games: number
  success_games: number
  failed_games: number
  requested_by: string | null
  created_at: string
}

type IngestionSummary = {
  message: string
  source: string
  total: number
  success: number
  failed: number
}

type BoardSquare = {
  id: number
  square_num: number
  participant_id: number | null
  player_id: number | null
  paid_flg: boolean | null
  participant_first_name: string | null
  participant_last_name: string | null
  player_jersey_num: number | null
  wins_count: number
  won_total: number
}

type PoolBoard = {
  poolId: number
  poolName: string
  primaryTeam: string
  opponent: string
  gameId: number | null
  gameDate: string | null
  teamName: string | null
  teamPrimaryColor: string
  teamSecondaryColor: string
  teamLogo: string | null
  squares: BoardSquare[]
}

type BoardGame = {
  id: number
  opponent: string
  game_dt: string
}

type TeamBrand = {
  key: string
  color: string
  accent: string
  logo: string
}

const NFL_TEAM_BRANDS: TeamBrand[] = [
  { key: 'lions', color: '#0076b6', accent: '#b0b7bc', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/det.png' },
  { key: 'packers', color: '#203731', accent: '#ffb612', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/gb.png' },
  { key: 'bears', color: '#0b162a', accent: '#c83803', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/chi.png' },
  { key: 'vikings', color: '#4f2683', accent: '#ffc62f', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/min.png' },
  { key: 'cowboys', color: '#002244', accent: '#869397', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/dal.png' },
  { key: 'chiefs', color: '#e31837', accent: '#ffb81c', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/kc.png' },
  { key: 'eagles', color: '#004c54', accent: '#a5acaf', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/phi.png' },
  { key: '49ers', color: '#aa0000', accent: '#b3995d', logo: 'https://a.espncdn.com/i/teamlogos/nfl/500/sf.png' }
]

const resolveTeamBrand = (
  teamName: string,
  fallbackColor: string,
  fallbackAccent: string,
  fallbackLogo: string | null
): TeamBrand => {
  const lowered = teamName.toLowerCase()
  const match = NFL_TEAM_BRANDS.find((team) => lowered.includes(team.key))
  if (match) {
    return match
  }

  return {
    key: teamName,
    color: fallbackColor,
    accent: fallbackAccent,
    logo: fallbackLogo ?? ''
  }
}

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000'
const DEFAULT_BOARD_LOGO = '/football-pool.png'

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

const resolveImageUrl = (value: string): string => {
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  if (value.startsWith('/')) return `${API_BASE}${value}`
  return `${API_BASE}/images/${value}`
}

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [smoke, setSmoke] = useState<SmokeRow[]>([])
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const createUserFirstFieldRef = useRef<HTMLInputElement>(null)
  const createTeamFirstFieldRef = useRef<HTMLInputElement>(null)
  const createPoolFirstFieldRef = useRef<HTMLInputElement>(null)

  const [userForm, setUserForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: ''
  })
  const [createUserIsPlayer, setCreateUserIsPlayer] = useState(false)
  const [createUserPlayerTeams, setCreateUserPlayerTeams] = useState<Array<{ teamId: string; jerseyNum: string }>>([])
  const [teamForm, setTeamForm] = useState({
    teamName: '',
    primaryColor: '',
    secondaryColor: '',
    logoFile: '',
    primaryContactId: ''
  })
  const [teamLogoUpload, setTeamLogoUpload] = useState<File | null>(null)
  const [editTeamLogoUpload, setEditTeamLogoUpload] = useState<File | null>(null)
  const [teamImages, setTeamImages] = useState<StoredImage[]>([])
  const [selectedTeamImage, setSelectedTeamImage] = useState<string>('')
  const [brokenImagePreviews, setBrokenImagePreviews] = useState<Record<string, boolean>>({})
  const [existingUsers, setExistingUsers] = useState<UserOption[]>([])
  const [existingTeams, setExistingTeams] = useState<TeamOption[]>([])
  const [existingPools, setExistingPools] = useState<PoolOption[]>([])
  const [editingUserId, setEditingUserId] = useState('')
  const [editingTeamId, setEditingTeamId] = useState('')
  const [editingPoolId, setEditingPoolId] = useState('')
  const [editUserForm, setEditUserForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: ''
  })
  const [editUserIsPlayer, setEditUserIsPlayer] = useState(false)
  const [editUserPlayerTeams, setEditUserPlayerTeams] = useState<Array<{ teamId: string; jerseyNum: string }>>([])
  const [editTeamForm, setEditTeamForm] = useState({
    teamName: '',
    primaryColor: '',
    secondaryColor: '',
    logoFile: '',
    primaryContactId: ''
  })
  const [editPoolForm, setEditPoolForm] = useState({
    poolName: '',
    teamId: '',
    season: 2026,
    primaryTeam: '',
    squareCost: 0,
    q1Payout: 0,
    q2Payout: 0,
    q3Payout: 0,
    q4Payout: 0
  })
  const [editSelectedTeamImage, setEditSelectedTeamImage] = useState('')
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
  const [gameForm, setGameForm] = useState({ poolId: '', opponent: '', gameDate: '' })
  const createGameFirstFieldRef = useRef<HTMLSelectElement>(null)
  const [created, setCreated] = useState<{ userId?: number; teamId?: number; poolId?: number }>({})
  const [squaresPoolId, setSquaresPoolId] = useState('')
  const [selectedSquare, setSelectedSquare] = useState<number | null>(null)
  const [assignForm, setAssignForm] = useState({
    participantId: '',
    playerId: '',
    paidFlg: false,
    reassign: false
  })
  const [participantOptions, setParticipantOptions] = useState<UserOption[]>([])
  const [playerOptions, setPlayerOptions] = useState<PlayerOption[]>([])
  const [playerTeamId, setPlayerTeamId] = useState('')
  const [teamPlayers, setTeamPlayers] = useState<PlayerOption[]>([])
  const [editingPlayerId, setEditingPlayerId] = useState('')
  const [playerForm, setPlayerForm] = useState({
    userId: '',
    jerseyNum: ''
  })
  const [ingestSource, setIngestSource] = useState<'mock' | 'payload' | 'espn'>('mock')
  const [ingestGameId, setIngestGameId] = useState('')
  const [ingestSummary, setIngestSummary] = useState<IngestionSummary | null>(null)
  const [ingestionHistory, setIngestionHistory] = useState<IngestionRun[]>([])
  const [managedPoolId, setManagedPoolId] = useState<number | null>(null)
  const [managedGames, setManagedGames] = useState<BoardGame[]>([])
  const [managedGameId, setManagedGameId] = useState<number | null>(null)
  const [organizerBoard, setOrganizerBoard] = useState<PoolBoard | null>(null)

  const organizerHeaders = useMemo(
    () => ({
      'Content-Type': 'application/json',
      'x-user-id': 'dev-user',
      'x-user-role': 'organizer'
    }),
    []
  )

  const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`${API_BASE}${path}`, init)
    const data = await response.json()

    if (!response.ok) {
      const validationIssues = Array.isArray(data?.error)
        ? data.error
            .map((issue: { path?: Array<string | number>; message?: string }) => {
              const field = Array.isArray(issue.path) && issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
              return `${field}${issue.message ?? 'Invalid value'}`
            })
            .join('; ')
        : ''

      const reason = validationIssues || data.error || data.detail || data.message || `Request failed with status ${response.status}`
      throw new Error(reason)
    }

    return data as T
  }

  const refreshDiagnostics = async (): Promise<void> => {
    setBusy('refresh')
    setError(null)

    try {
      const [healthData, smokeData, previewData] = await Promise.all([
        request<HealthResponse>('/api/health'),
        request<{ counts: SmokeRow[] }>('/api/db/smoke'),
        request<{ pools: PreviewRow[] }>('/api/db/preview')
      ])

      setHealth(healthData)
      setSmoke(smokeData.counts)
      setPreview(previewData.pools)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load diagnostics')
    } finally {
      setBusy(null)
    }
  }

  const onCreateUser = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy('user')
    setError(null)

    try {
      const playerTeamsPayload = createUserIsPlayer
        ? createUserPlayerTeams
            .filter((assignment) => assignment.teamId && assignment.jerseyNum !== '')
            .map((assignment) => ({
              teamId: Number(assignment.teamId),
              jerseyNum: Number(assignment.jerseyNum)
            }))
        : []

      if (createUserIsPlayer) {
        const uniqueTeamIds = new Set(playerTeamsPayload.map((assignment) => assignment.teamId))
        if (uniqueTeamIds.size !== playerTeamsPayload.length) {
          setError('A player cannot be assigned to the same team more than once.')
          setBusy(null)
          return
        }
      }

      const emailNorm = userForm.email.trim().toLowerCase()
      const isDuplicate = existingUsers.some(
        (u) =>
          (u.first_name ?? '').trim().toLowerCase() === userForm.firstName.trim().toLowerCase() &&
          (u.last_name ?? '').trim().toLowerCase() === userForm.lastName.trim().toLowerCase() &&
          (u.email ?? '').trim().toLowerCase() === emailNorm
      )
      if (isDuplicate) {
        setError('A user with the same first name, last name, and email already exists.')
        setBusy(null)
        return
      }

      const result = await request<{ id: number }>('/api/setup/users', {
        method: 'POST',
        headers: organizerHeaders,
        body: JSON.stringify({
          ...userForm,
          email: userForm.email.trim() || undefined,
          phone: userForm.phone.trim() || undefined,
          isPlayer: createUserIsPlayer,
          playerTeams: playerTeamsPayload
        })
      })

      setCreated((current) => ({ ...current, userId: result.id }))
      setTeamForm((current) => ({ ...current, primaryContactId: String(result.id) }))
      setUserForm({ firstName: '', lastName: '', email: '', phone: '' })
      setCreateUserIsPlayer(false)
      setCreateUserPlayerTeams([])
      await refreshSetupLookups()
      createUserFirstFieldRef.current?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user')
    } finally {
      setBusy(null)
    }
  }

  const onCreateTeam = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy('team')
    setError(null)

    try {
      const result = await request<{ id: number }>('/api/setup/teams', {
        method: 'POST',
        headers: organizerHeaders,
        body: JSON.stringify({
          teamName: teamForm.teamName,
          primaryColor: teamForm.primaryColor,
          secondaryColor: teamForm.secondaryColor,
          logoFile: teamForm.logoFile ? normalizeLogoFile(teamForm.logoFile) : undefined,
          primaryContactId: teamForm.primaryContactId ? Number(teamForm.primaryContactId) : undefined
        })
      })

      setCreated((current) => ({ ...current, teamId: result.id }))
      setPoolForm((current) => ({ ...current, teamId: String(result.id) }))
      setTeamForm({ teamName: '', primaryColor: '', secondaryColor: '', logoFile: '', primaryContactId: '' })
      setSelectedTeamImage('')
      setTeamLogoUpload(null)
      await refreshSetupLookups()
      createTeamFirstFieldRef.current?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create team')
    } finally {
      setBusy(null)
    }
  }

  const onUploadTeamLogo = async (): Promise<void> => {
    if (!teamLogoUpload) {
      setError('Choose an image file first')
      return
    }

    setBusy('upload-logo')
    setError(null)

    try {
      const body = new FormData()
      body.append('image', teamLogoUpload)

      const response = await fetch(`${API_BASE}/api/setup/images/upload`, {
        method: 'POST',
        headers: {
          'x-user-id': 'dev-user',
          'x-user-role': 'organizer'
        },
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
      const fullPath = resolveImageUrl(storedPath)
      setTeamForm((current) => ({ ...current, logoFile: storedPath }))
      setSelectedTeamImage(fullPath)
      await refreshSetupLookups()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload logo')
    } finally {
      setBusy(null)
    }
  }

  const onUploadEditTeamLogo = async (): Promise<void> => {
    if (!editTeamLogoUpload) {
      setError('Choose an image file first')
      return
    }

    setBusy('upload-edit-logo')
    setError(null)

    try {
      const body = new FormData()
      body.append('image', editTeamLogoUpload)

      const response = await fetch(`${API_BASE}/api/setup/images/upload`, {
        method: 'POST',
        headers: {
          'x-user-id': 'dev-user',
          'x-user-role': 'organizer'
        },
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
      const fullPath = resolveImageUrl(storedPath)
      setEditSelectedTeamImage(fullPath)
      setEditTeamForm((current) => ({ ...current, logoFile: storedPath }))
      setEditTeamLogoUpload(null)
      await refreshSetupLookups()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload team logo')
    } finally {
      setBusy(null)
    }
  }

  const onCreatePool = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy('pool')
    setError(null)

    try {
      const result = await request<{ id: number }>('/api/setup/pools', {
        method: 'POST',
        headers: organizerHeaders,
        body: JSON.stringify({
          ...poolForm,
          teamId: Number(poolForm.teamId)
        })
      })

      setCreated((current) => ({ ...current, poolId: result.id }))
      setPoolForm({ poolName: '', teamId: '', season: new Date().getFullYear(), primaryTeam: '', squareCost: 0, q1Payout: 0, q2Payout: 0, q3Payout: 0, q4Payout: 0 })
      await refreshSetupLookups()
      createPoolFirstFieldRef.current?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pool')
    } finally {
      setBusy(null)
    }
  }

  const onInitSquares = async (): Promise<void> => {
    if (!created.poolId) {
      setError('Create a pool first')
      return
    }

    setBusy('squares')
    setError(null)

    try {
      await request(`/api/setup/pools/${created.poolId}/squares/init`, {
        method: 'POST',
        headers: organizerHeaders
      })

      setSquaresPoolId(String(created.poolId))
      await loadSquares(String(created.poolId))
      await refreshDiagnostics()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize squares')
    } finally {
      setBusy(null)
    }
  }

  const loadSquares = async (poolIdText = squaresPoolId): Promise<void> => {
    if (!poolIdText) {
      setError('Enter a pool ID to load squares')
      return
    }

    setBusy('load-squares')
    setError(null)

    try {
      const [userResult, playerResult] = await Promise.all([
        request<{ users: UserOption[] }>('/api/setup/users', {
          headers: organizerHeaders
        }),
        request<{ players: PlayerOption[] }>(`/api/setup/pools/${poolIdText}/players`, {
          headers: organizerHeaders
        })
      ])

      setParticipantOptions(userResult.users)
      setPlayerOptions(playerResult.players)
      setSelectedSquare(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load squares')
    } finally {
      setBusy(null)
    }
  }

  const onAssignSquare = async (event: FormEvent): Promise<void> => {
    event.preventDefault()

    if (!squaresPoolId) {
      setError('Enter a pool ID first')
      return
    }

    if (!selectedSquare) {
      setError('Select a square from the grid first')
      return
    }

    setBusy('assign-square')
    setError(null)

    try {
      await request(`/api/setup/pools/${squaresPoolId}/squares/${selectedSquare}`, {
        method: 'PATCH',
        headers: organizerHeaders,
        body: JSON.stringify({
          participantId: assignForm.participantId ? Number(assignForm.participantId) : null,
          playerId: assignForm.playerId ? Number(assignForm.playerId) : null,
          paidFlg: assignForm.paidFlg,
          reassign: assignForm.reassign
        })
      })

      await loadSquares(squaresPoolId)
      if (managedPoolId) {
        await loadOrganizerBoard(managedPoolId, managedGameId ?? undefined)
      }
      setSelectedSquare(null)
      await refreshDiagnostics()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign square')
    } finally {
      setBusy(null)
    }
  }

  const onClearSquareAssignment = async (): Promise<void> => {
    if (!squaresPoolId || selectedSquare == null) {
      setError('Select a square from the grid first')
      return
    }

    setBusy('clear-square')
    setError(null)

    try {
      await request(`/api/setup/pools/${squaresPoolId}/squares/${selectedSquare}`, {
        method: 'PATCH',
        headers: organizerHeaders,
        body: JSON.stringify({
          participantId: null,
          playerId: null,
          paidFlg: false,
          reassign: true
        })
      })

      setAssignForm({
        participantId: '',
        playerId: '',
        paidFlg: false,
        reassign: false
      })
      await loadSquares(squaresPoolId)
      if (managedPoolId) {
        await loadOrganizerBoard(managedPoolId, managedGameId ?? undefined)
      }
      setSelectedSquare(null)
      await refreshDiagnostics()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear square assignment')
    } finally {
      setBusy(null)
    }
  }

  const loadIngestionHistory = async (): Promise<void> => {
    setBusy('ingestion-history')
    setError(null)

    try {
      const result = await request<{ runs: IngestionRun[] }>('/api/ingestion/history', {
        headers: organizerHeaders
      })

      setIngestionHistory(result.runs)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ingestion history')
    } finally {
      setBusy(null)
    }
  }

  const onCreateGame = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!gameForm.poolId) {
      setError('Select a pool')
      return
    }
    if (!gameForm.opponent.trim()) {
      setError('Enter an opponent name')
      return
    }
    if (!gameForm.gameDate) {
      setError('Enter a game date')
      return
    }
    setBusy('create-game')
    setError(null)
    try {
      await request<{ game: { id: number } }>('/api/games', {
        method: 'POST',
        headers: organizerHeaders,
        body: JSON.stringify({
          poolId: Number(gameForm.poolId),
          opponent: gameForm.opponent.trim(),
          gameDate: gameForm.gameDate
        })
      })
      setGameForm({ poolId: '', opponent: '', gameDate: '' })
      createGameFirstFieldRef.current?.focus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game')
    } finally {
      setBusy(null)
    }
  }

  const onRunBatchIngestion = async (): Promise<void> => {
    setBusy('ingestion-run')
    setError(null)

    try {
      const result = await request<IngestionSummary>('/api/ingestion/run', {
        method: 'POST',
        headers: organizerHeaders,
        body: JSON.stringify({ source: ingestSource })
      })

      setIngestSummary(result)
      await loadIngestionHistory()
      await refreshDiagnostics()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run ingestion')
    } finally {
      setBusy(null)
    }
  }

  const onRunSingleIngestion = async (): Promise<void> => {
    if (!ingestGameId) {
      setError('Enter a game ID for single-game ingestion')
      return
    }

    setBusy('ingestion-one')
    setError(null)

    try {
      await request(`/api/ingestion/games/${ingestGameId}/scores`, {
        method: 'POST',
        headers: organizerHeaders,
        body: JSON.stringify({ source: ingestSource })
      })

      setIngestSummary({
        message: 'Single game ingestion completed',
        source: ingestSource,
        total: 1,
        success: 1,
        failed: 0
      })
      await loadIngestionHistory()
      await refreshDiagnostics()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run single-game ingestion')
    } finally {
      setBusy(null)
    }
  }

  const refreshSetupLookups = async (): Promise<void> => {
    try {
      const [usersResult, teamsResult, poolsResult, imagesResult] = await Promise.all([
        request<{ users: UserOption[] }>('/api/setup/users', { headers: organizerHeaders }),
        request<{ teams: TeamOption[] }>('/api/setup/teams', { headers: organizerHeaders }),
        request<{ pools: PoolOption[] }>('/api/setup/pools', { headers: organizerHeaders }),
        request<{ images: StoredImage[] }>('/api/setup/images', { headers: organizerHeaders })
      ])

      setExistingUsers(usersResult.users)
      setExistingTeams(teamsResult.teams)
      setExistingPools(poolsResult.pools)
      setTeamImages(imagesResult.images)
    } catch {
      // Keep existing state on lookup refresh failures.
    }
  }

  const loadUserForEdit = (userIdText: string): void => {
    setEditingUserId(userIdText)

    if (!userIdText) {
      setEditUserForm({ firstName: '', lastName: '', email: '', phone: '' })
      setEditUserIsPlayer(false)
      setEditUserPlayerTeams([])
      return
    }

    const user = existingUsers.find((item) => item.id === Number(userIdText))
    if (!user) return

    setEditUserForm({
      firstName: user.first_name ?? '',
      lastName: user.last_name ?? '',
      email: user.email ?? '',
      phone: formatPhoneNumber(user.phone ?? '')
    })

    const assignments = user.player_teams ?? []
    setEditUserIsPlayer(Boolean(user.is_player_flg) || assignments.length > 0)
    setEditUserPlayerTeams(
      assignments.map((assignment) => ({
        teamId: String(assignment.team_id),
        jerseyNum: String(assignment.jersey_num)
      }))
    )
  }

  const loadTeamForEdit = (teamIdText: string): void => {
    setEditingTeamId(teamIdText)

    if (!teamIdText) {
      setEditTeamForm({ teamName: '', primaryColor: '', secondaryColor: '', logoFile: '', primaryContactId: '' })
      setEditSelectedTeamImage('')
      setEditTeamLogoUpload(null)
      return
    }

    const team = existingTeams.find((item) => item.id === Number(teamIdText))
    if (!team) return

    const storedLogo = team.logo_file ? normalizeLogoFile(team.logo_file) : ''
    const resolvedLogo = storedLogo ? resolveImageUrl(storedLogo) : ''
    setEditSelectedTeamImage(resolvedLogo)
    setEditTeamForm({
      teamName: team.team_name ?? '',
      primaryColor: team.primary_color ?? '',
      secondaryColor: team.secondary_color ?? '',
      logoFile: storedLogo,
      primaryContactId: team.primary_contact_id != null ? String(team.primary_contact_id) : ''
    })
  }

  const loadPoolForEdit = (poolIdText: string): void => {
    setEditingPoolId(poolIdText)

    if (!poolIdText) {
      setEditPoolForm({
        poolName: '',
        teamId: '',
        season: 2026,
        primaryTeam: '',
        squareCost: 0,
        q1Payout: 0,
        q2Payout: 0,
        q3Payout: 0,
        q4Payout: 0
      })
      return
    }

    const pool = existingPools.find((item) => item.id === Number(poolIdText))
    if (!pool) return

    setEditPoolForm({
      poolName: pool.pool_name ?? '',
      teamId: pool.team_id != null ? String(pool.team_id) : '',
      season: pool.season ?? 2026,
      primaryTeam: pool.primary_team ?? '',
      squareCost: pool.square_cost ?? 0,
      q1Payout: pool.q1_payout ?? 0,
      q2Payout: pool.q2_payout ?? 0,
      q3Payout: pool.q3_payout ?? 0,
      q4Payout: pool.q4_payout ?? 0
    })
  }

  const onUpdateUser = async (event: FormEvent): Promise<void> => {
    event.preventDefault()

    if (!editingUserId) {
      setError('Choose a user to maintain')
      return
    }

    setBusy('update-user')
    setError(null)

    try {
      const playerTeamsPayload = editUserIsPlayer
        ? editUserPlayerTeams
            .filter((assignment) => assignment.teamId && assignment.jerseyNum !== '')
            .map((assignment) => ({
              teamId: Number(assignment.teamId),
              jerseyNum: Number(assignment.jerseyNum)
            }))
        : []

      if (editUserIsPlayer) {
        const uniqueTeamIds = new Set(playerTeamsPayload.map((assignment) => assignment.teamId))
        if (uniqueTeamIds.size !== playerTeamsPayload.length) {
          setError('A player cannot be assigned to the same team more than once.')
          setBusy(null)
          return
        }
      }

      await request(`/api/setup/users/${editingUserId}`, {
        method: 'PATCH',
        headers: organizerHeaders,
        body: JSON.stringify({
          ...editUserForm,
          email: editUserForm.email.trim() || undefined,
          phone: editUserForm.phone.trim() || undefined,
          isPlayer: editUserIsPlayer,
          playerTeams: playerTeamsPayload
        })
      })

      await refreshSetupLookups()
      await refreshDiagnostics()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update user')
    } finally {
      setBusy(null)
    }
  }

  const onDeleteUser = async (): Promise<void> => {
    if (!editingUserId) {
      setError('Choose a user to delete')
      return
    }

    setBusy('delete-user')
    setError(null)

    try {
      await request(`/api/setup/users/${editingUserId}`, {
        method: 'DELETE',
        headers: organizerHeaders
      })

      setEditingUserId('')
      setEditUserForm({ firstName: '', lastName: '', email: '', phone: '' })
      setEditUserIsPlayer(false)
      setEditUserPlayerTeams([])
      await refreshSetupLookups()
      await refreshDiagnostics()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete user')
    } finally {
      setBusy(null)
    }
  }

  const onUpdateTeam = async (event: FormEvent): Promise<void> => {
    event.preventDefault()

    if (!editingTeamId) {
      setError('Choose a team to maintain')
      return
    }

    setBusy('update-team')
    setError(null)

    try {
      await request(`/api/setup/teams/${editingTeamId}`, {
        method: 'PATCH',
        headers: organizerHeaders,
        body: JSON.stringify({
          teamName: editTeamForm.teamName,
          primaryColor: editTeamForm.primaryColor,
          secondaryColor: editTeamForm.secondaryColor,
          logoFile: editTeamForm.logoFile ? normalizeLogoFile(editTeamForm.logoFile) : undefined,
          primaryContactId: editTeamForm.primaryContactId ? Number(editTeamForm.primaryContactId) : undefined
        })
      })

      await refreshSetupLookups()
      await refreshDiagnostics()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update team')
    } finally {
      setBusy(null)
    }
  }

  const onUpdatePool = async (event: FormEvent): Promise<void> => {
    event.preventDefault()

    if (!editingPoolId) {
      setError('Choose a pool to maintain')
      return
    }

    setBusy('update-pool')
    setError(null)

    try {
      await request(`/api/setup/pools/${editingPoolId}`, {
        method: 'PATCH',
        headers: organizerHeaders,
        body: JSON.stringify({
          ...editPoolForm,
          teamId: Number(editPoolForm.teamId)
        })
      })

      await refreshSetupLookups()
      await refreshDiagnostics()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update pool')
    } finally {
      setBusy(null)
    }
  }

  const onRefreshExistingRecords = async (): Promise<void> => {
    setBusy('lookup-records')
    setError(null)

    try {
      await refreshSetupLookups()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh existing records')
    } finally {
      setBusy(null)
    }
  }

  const loadTeamPlayers = async (teamIdText = playerTeamId): Promise<void> => {
    if (!teamIdText) {
      setTeamPlayers([])
      setEditingPlayerId('')
      setPlayerForm({ userId: '', jerseyNum: '' })
      return
    }

    setBusy('load-team-players')
    setError(null)

    try {
      const result = await request<{ players: PlayerOption[] }>(`/api/setup/teams/${teamIdText}/players`, {
        headers: organizerHeaders
      })

      setTeamPlayers(result.players)
      setEditingPlayerId('')
      setPlayerForm({ userId: '', jerseyNum: '' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load team players')
    } finally {
      setBusy(null)
    }
  }

  const onSelectPlayerTeam = async (teamIdText: string): Promise<void> => {
    setPlayerTeamId(teamIdText)
    await loadTeamPlayers(teamIdText)
  }

  const onSelectTeamPlayer = (playerIdText: string): void => {
    setEditingPlayerId(playerIdText)

    if (!playerIdText) {
      setPlayerForm({ userId: '', jerseyNum: '' })
      return
    }

    const player = teamPlayers.find((item) => item.id === Number(playerIdText))
    if (!player) return

    setPlayerForm({
      userId: player.user_id != null ? String(player.user_id) : '',
      jerseyNum: player.jersey_num != null ? String(player.jersey_num) : ''
    })
  }

  const onSavePlayer = async (event: FormEvent): Promise<void> => {
    event.preventDefault()

    if (!playerTeamId) {
      setError('Select a team first')
      return
    }

    if (!playerForm.userId || playerForm.jerseyNum === '') {
      setError('Choose a player name and jersey number')
      return
    }

    setBusy('save-player')
    setError(null)

    try {
      const body = {
        userId: Number(playerForm.userId),
        jerseyNum: Number(playerForm.jerseyNum)
      }

      if (editingPlayerId) {
        await request(`/api/setup/players/${editingPlayerId}`, {
          method: 'PATCH',
          headers: organizerHeaders,
          body: JSON.stringify(body)
        })
      } else {
        await request('/api/setup/players', {
          method: 'POST',
          headers: organizerHeaders,
          body: JSON.stringify({
            teamId: Number(playerTeamId),
            ...body
          })
        })
        setPlayerForm({ userId: '', jerseyNum: '' })
        setEditingPlayerId('')
      }

      await loadTeamPlayers(playerTeamId)
      if (managedPoolId) {
        await loadSquares(String(managedPoolId))
      }
      await refreshDiagnostics()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save player')
    } finally {
      setBusy(null)
    }
  }

  const onDeletePlayer = async (): Promise<void> => {
    if (!editingPlayerId) {
      setError('Choose a player to delete')
      return
    }

    setBusy('delete-player')
    setError(null)

    try {
      await request(`/api/setup/players/${editingPlayerId}`, {
        method: 'DELETE',
        headers: organizerHeaders
      })

      await loadTeamPlayers(playerTeamId)
      if (managedPoolId) {
        await loadSquares(String(managedPoolId))
      }
      await refreshDiagnostics()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete player')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    void refreshDiagnostics()
    void refreshSetupLookups()
  }, [])

  const loadOrganizerBoard = async (poolId: number, gameId?: number): Promise<void> => {
    const path = gameId
      ? `/api/participant/pools/${poolId}/board?gameId=${gameId}`
      : `/api/participant/pools/${poolId}/board`

    const result = await request<{ board: PoolBoard }>(path, {
      headers: organizerHeaders
    })

    setOrganizerBoard(result.board)
  }

  const onSelectManagedPool = async (poolId: number): Promise<void> => {
    setBusy('manage-pool')
    setError(null)

    try {
      setManagedPoolId(poolId)
      setSquaresPoolId(String(poolId))
      await loadSquares(String(poolId))

      const games = await request<BoardGame[]>(`/api/participant/pools/${poolId}/games`, {
        headers: organizerHeaders
      })
      setManagedGames(games)

      setManagedGameId(null)

      await loadOrganizerBoard(poolId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load selected pool')
    } finally {
      setBusy(null)
    }
  }

  const onSelectManagedGame = async (gameId: number): Promise<void> => {
    if (!managedPoolId) return
    setManagedGameId(gameId)

    try {
      await loadOrganizerBoard(managedPoolId, gameId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load selected game board')
    }
  }

  const organizerBoardRows = useMemo(() => {
    if (!organizerBoard) return []

    const byNumber = new Map<number, BoardSquare>()
    for (const sq of organizerBoard.squares) {
      byNumber.set(sq.square_num, sq)
    }

    return Array.from({ length: 10 }, (_, row) =>
      Array.from({ length: 10 }, (_, col) => {
        const squareNum = row * 10 + col + 1
        return byNumber.get(squareNum) ?? {
          id: squareNum,
          square_num: squareNum,
          participant_id: null,
          player_id: null,
          paid_flg: null,
          participant_first_name: null,
          participant_last_name: null,
          player_jersey_num: null,
          wins_count: 0,
          won_total: 0
        }
      })
    )
  }, [organizerBoard])

  const selectedBoardSquare = useMemo(() => {
    if (!organizerBoard || selectedSquare == null) return null
    return organizerBoard.squares.find((sq) => sq.square_num === selectedSquare) ?? null
  }, [organizerBoard, selectedSquare])

  const onOpenSquareAssignment = (square: BoardSquare): void => {
    setSelectedSquare(square.square_num)
    setAssignForm({
      participantId: square.participant_id != null ? String(square.participant_id) : '',
      playerId: square.player_id != null ? String(square.player_id) : '',
      paidFlg: Boolean(square.paid_flg),
      reassign: false
    })
  }

  const onCloseSquareAssignment = (): void => {
    setSelectedSquare(null)
  }

  const formatUserName = (user: UserOption): string => {
    const fullName = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim()
    if (fullName) return fullName
    return user.email ?? 'Unnamed user'
  }

  const formatUserPlayerTeams = (user: UserOption): string => {
    const assignments = user.player_teams ?? []
    if (assignments.length === 0) return 'Not a player'
    return assignments
      .map((assignment) => `${assignment.team_name ?? 'Unnamed team'} #${assignment.jersey_num}`)
      .join(' | ')
  }

  const formatPlayerName = (player: PlayerOption): string => {
    const fullName = `${player.first_name ?? ''} ${player.last_name ?? ''}`.trim()
    const jersey = player.jersey_num != null ? `#${player.jersey_num}` : '#-'
    return `${jersey} ${fullName || 'Unnamed player'}`
  }

  const usdCurrency = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0
  })

  const formatUsd = (value: number | null | undefined): string => usdCurrency.format(Number(value ?? 0))

  const primaryBrand = useMemo(() => {
    if (!organizerBoard) return null
    return resolveTeamBrand(
      organizerBoard.primaryTeam,
      organizerBoard.teamPrimaryColor,
      organizerBoard.teamSecondaryColor,
      organizerBoard.teamLogo ? resolveImageUrl(organizerBoard.teamLogo) : null
    )
  }, [organizerBoard])

  const opponentBrand = useMemo(() => {
    if (!organizerBoard) return null
    return resolveTeamBrand(organizerBoard.opponent, '#0076b6', '#b0b7bc', null)
  }, [organizerBoard])

  const selectedUserForEdit = useMemo(() => {
    if (!editingUserId) return null
    return existingUsers.find((user) => user.id === Number(editingUserId)) ?? null
  }, [editingUserId, existingUsers])

  return (
    <div className="app-shell">
      <header className="hero">
        <p className="kicker">Football Pool Ops Console</p>
        <h1>Launch Day Dashboard</h1>
        <p className="subhead">
          Connected to your live API at <strong>{API_BASE}</strong>. Use this page to validate health,
          inspect database state, and run organizer setup workflows.
        </p>
        <button className="primary" onClick={refreshDiagnostics} disabled={busy !== null}>
          {busy === 'refresh' ? 'Refreshing...' : 'Refresh diagnostics'}
        </button>
      </header>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="panel-grid">
        <article className="panel">
          <h2>System Health</h2>
          <p className="small">Checks API reachability and PostgreSQL access.</p>
          <div className="stat">
            <span>Status</span>
            <strong>{health?.status ?? 'unknown'}</strong>
          </div>
          <div className="stat">
            <span>Database Time</span>
            <strong>{health?.databaseTime ?? 'n/a'}</strong>
          </div>
        </article>

        <article className="panel wide">
          <h2>Table Counts</h2>
          <p className="small">From /api/db/smoke</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Rows</th>
                </tr>
              </thead>
              <tbody>
                {smoke.map((row) => (
                  <tr key={row.table_name}>
                    <td>{row.table_name}</td>
                    <td>{row.row_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="panel-grid">
        <article className="panel form-panel">
          <h2>Create User</h2>
          <form onSubmit={onCreateUser}>
            <input ref={createUserFirstFieldRef} value={userForm.firstName} onChange={(e) => setUserForm({ ...userForm, firstName: e.target.value })} placeholder="First name" />
            <input value={userForm.lastName} onChange={(e) => setUserForm({ ...userForm, lastName: e.target.value })} placeholder="Last name" />
            <input value={userForm.email} onChange={(e) => setUserForm({ ...userForm, email: e.target.value })} placeholder="Email" />
            <input value={userForm.phone} onChange={(e) => setUserForm({ ...userForm, phone: formatPhoneNumber(e.target.value) })} placeholder="Phone" inputMode="tel" />
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={createUserIsPlayer}
                onChange={(e) => {
                  const checked = e.target.checked
                  setCreateUserIsPlayer(checked)
                  if (!checked) {
                    setCreateUserPlayerTeams([])
                  } else if (createUserPlayerTeams.length === 0) {
                    setCreateUserPlayerTeams([{ teamId: '', jerseyNum: '' }])
                  }
                }}
              />
              Is player
            </label>
            {createUserIsPlayer ? (
              <div className="player-assignments">
                {createUserPlayerTeams.map((assignment, index) => (
                  <div key={`create-player-team-${index}`} className="player-assignment-row">
                    <select
                      value={assignment.teamId}
                      onChange={(e) => {
                        const next = [...createUserPlayerTeams]
                        next[index] = { ...next[index], teamId: e.target.value }
                        setCreateUserPlayerTeams(next)
                      }}
                    >
                      <option value="">Team</option>
                      {existingTeams.map((team) => (
                        <option key={`create-user-player-team-${team.id}`} value={team.id}>
                          {team.team_name ?? 'Unnamed team'}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={assignment.jerseyNum}
                      onChange={(e) => {
                        const next = [...createUserPlayerTeams]
                        next[index] = { ...next[index], jerseyNum: e.target.value }
                        setCreateUserPlayerTeams(next)
                      }}
                      placeholder="Jersey #"
                    />
                    <button
                      className="secondary compact"
                      type="button"
                      onClick={() => {
                        setCreateUserPlayerTeams((current) => current.filter((_, rowIndex) => rowIndex !== index))
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  className="secondary compact"
                  type="button"
                  onClick={() => {
                    setCreateUserPlayerTeams((current) => [...current, { teamId: '', jerseyNum: '' }])
                  }}
                >
                  Add team assignment
                </button>
              </div>
            ) : null}
            <button className="secondary" type="submit" disabled={busy !== null}>{busy === 'user' ? 'Saving...' : 'Create user'}</button>
          </form>
          <p className="small">User ID: {created.userId ?? 'not created'}</p>
        </article>

        <article className="panel form-panel">
          <h2>Create Team</h2>
          <form onSubmit={onCreateTeam}>
            <input ref={createTeamFirstFieldRef} value={teamForm.teamName} onChange={(e) => setTeamForm({ ...teamForm, teamName: e.target.value })} placeholder="Team name" />
            <input value={teamForm.primaryColor} onChange={(e) => setTeamForm({ ...teamForm, primaryColor: e.target.value })} placeholder="Primary color" />
            <input value={teamForm.secondaryColor} onChange={(e) => setTeamForm({ ...teamForm, secondaryColor: e.target.value })} placeholder="Secondary color" />
            <input type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => setTeamLogoUpload(e.target.files?.[0] ?? null)} />
            <button className="secondary" type="button" onClick={onUploadTeamLogo} disabled={busy !== null || !teamLogoUpload}>
              {busy === 'upload-logo' ? 'Uploading...' : 'Upload logo to images folder'}
            </button>
            <div className="image-selector-grid">
              {teamImages.map((image) => {
                const storedPath = normalizeLogoFile(image.filePath)
                const fullPath = resolveImageUrl(storedPath)
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
                  >
                    {showFallback ? (
                      <span className="image-option-fallback">No preview</span>
                    ) : (
                      <img
                        src={fullPath}
                        alt=""
                        onError={() => {
                          setBrokenImagePreviews((current) => ({ ...current, [fullPath]: true }))
                        }}
                      />
                    )}
                  </button>
                )
              })}
            </div>
            <select value={teamForm.primaryContactId} onChange={(e) => setTeamForm({ ...teamForm, primaryContactId: e.target.value })}>
              <option value="">Primary contact</option>
              {existingUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {formatUserName(user)}
                </option>
              ))}
            </select>
            <button className="secondary" type="submit" disabled={busy !== null}>{busy === 'team' ? 'Saving...' : 'Create team'}</button>
          </form>
          <p className="small">Team ID: {created.teamId ?? 'not created'}</p>
        </article>

        <article className="panel form-panel">
          <h2>Create Pool</h2>
          <form onSubmit={onCreatePool}>
            <label className="field-block">
              <span>Pool Name</span>
              <input ref={createPoolFirstFieldRef} value={poolForm.poolName} onChange={(e) => setPoolForm({ ...poolForm, poolName: e.target.value })} placeholder="Pool name" />
            </label>
            <label className="field-block">
              <span>Team</span>
              <select value={poolForm.teamId} onChange={(e) => setPoolForm({ ...poolForm, teamId: e.target.value })}>
                <option value="">Team</option>
                {existingTeams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.team_name ?? 'Unnamed team'}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-block">
              <span>Season</span>
              <input type="number" value={poolForm.season} onChange={(e) => setPoolForm({ ...poolForm, season: Number(e.target.value) })} placeholder="Season" />
            </label>
            <label className="field-block">
              <span>Primary Team</span>
              <input value={poolForm.primaryTeam} onChange={(e) => setPoolForm({ ...poolForm, primaryTeam: e.target.value })} placeholder="Primary team" />
            </label>
            <label className="field-block">
              <span>Square Cost (USD $)</span>
              <input type="number" value={poolForm.squareCost} onChange={(e) => setPoolForm({ ...poolForm, squareCost: Number(e.target.value) })} placeholder="$ Square cost" />
            </label>
            <label className="field-block">
              <span>Q1 Payout (USD $)</span>
              <input type="number" value={poolForm.q1Payout} onChange={(e) => setPoolForm({ ...poolForm, q1Payout: Number(e.target.value) })} placeholder="$ Q1 payout" />
            </label>
            <label className="field-block">
              <span>Q2 Payout (USD $)</span>
              <input type="number" value={poolForm.q2Payout} onChange={(e) => setPoolForm({ ...poolForm, q2Payout: Number(e.target.value) })} placeholder="$ Q2 payout" />
            </label>
            <label className="field-block">
              <span>Q3 Payout (USD $)</span>
              <input type="number" value={poolForm.q3Payout} onChange={(e) => setPoolForm({ ...poolForm, q3Payout: Number(e.target.value) })} placeholder="$ Q3 payout" />
            </label>
            <label className="field-block">
              <span>Q4 Payout (USD $)</span>
              <input type="number" value={poolForm.q4Payout} onChange={(e) => setPoolForm({ ...poolForm, q4Payout: Number(e.target.value) })} placeholder="$ Q4 payout" />
            </label>
            <button className="secondary" type="submit" disabled={busy !== null}>{busy === 'pool' ? 'Saving...' : 'Create pool'}</button>
          </form>
          <div className="inline-actions">
            <p className="small">Pool ID: {created.poolId ?? 'not created'}</p>
            <button className="primary" onClick={onInitSquares} disabled={busy !== null || !created.poolId}>
              {busy === 'squares' ? 'Initializing...' : 'Init 100 squares'}
            </button>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="inline-actions">
          <h2>Existing Records</h2>
          <button className="secondary compact" type="button" onClick={onRefreshExistingRecords} disabled={busy !== null}>
            {busy === 'lookup-records' ? 'Refreshing...' : 'Refresh existing records'}
          </button>
        </div>
        <p className="small">Use this if users, teams, pools, or uploaded logos were added outside this page.</p>
      </section>

      <section className="panel-grid">
        <article className="panel form-panel">
          <h2>Maintain User</h2>
          <p className="small">Choose an existing user, edit the fields, then save.</p>
          <form onSubmit={onUpdateUser}>
            <select value={editingUserId} onChange={(e) => loadUserForEdit(e.target.value)}>
              <option value="">Select user</option>
              {existingUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {formatUserName(user)} {user.player_teams && user.player_teams.length > 0 ? `- ${formatUserPlayerTeams(user)}` : ''}
                </option>
              ))}
            </select>
            {selectedUserForEdit?.player_teams && selectedUserForEdit.player_teams.length > 0 ? (
              <p className="small">Assigned teams: {formatUserPlayerTeams(selectedUserForEdit)}</p>
            ) : null}
            <input value={editUserForm.firstName} onChange={(e) => setEditUserForm({ ...editUserForm, firstName: e.target.value })} placeholder="First name" />
            <input value={editUserForm.lastName} onChange={(e) => setEditUserForm({ ...editUserForm, lastName: e.target.value })} placeholder="Last name" />
            <input value={editUserForm.email} onChange={(e) => setEditUserForm({ ...editUserForm, email: e.target.value })} placeholder="Email" />
            <input value={editUserForm.phone} onChange={(e) => setEditUserForm({ ...editUserForm, phone: formatPhoneNumber(e.target.value) })} placeholder="Phone" inputMode="tel" />
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={editUserIsPlayer}
                onChange={(e) => {
                  const checked = e.target.checked
                  setEditUserIsPlayer(checked)
                  if (!checked) {
                    setEditUserPlayerTeams([])
                  } else if (editUserPlayerTeams.length === 0) {
                    setEditUserPlayerTeams([{ teamId: '', jerseyNum: '' }])
                  }
                }}
              />
              Is player
            </label>
            {editUserIsPlayer ? (
              <div className="player-assignments">
                {editUserPlayerTeams.map((assignment, index) => (
                  <div key={`player-team-${index}`} className="player-assignment-row">
                    <select
                      value={assignment.teamId}
                      onChange={(e) => {
                        const next = [...editUserPlayerTeams]
                        next[index] = { ...next[index], teamId: e.target.value }
                        setEditUserPlayerTeams(next)
                      }}
                    >
                      <option value="">Team</option>
                      {existingTeams.map((team) => (
                        <option key={`user-player-team-${team.id}`} value={team.id}>
                          {team.team_name ?? 'Unnamed team'}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={assignment.jerseyNum}
                      onChange={(e) => {
                        const next = [...editUserPlayerTeams]
                        next[index] = { ...next[index], jerseyNum: e.target.value }
                        setEditUserPlayerTeams(next)
                      }}
                      placeholder="Jersey #"
                    />
                    <button
                      className="secondary compact"
                      type="button"
                      onClick={() => {
                        setEditUserPlayerTeams((current) => current.filter((_, rowIndex) => rowIndex !== index))
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  className="secondary compact"
                  type="button"
                  onClick={() => {
                    setEditUserPlayerTeams((current) => [...current, { teamId: '', jerseyNum: '' }])
                  }}
                >
                  Add team assignment
                </button>
              </div>
            ) : null}
            <button className="secondary" type="submit" disabled={busy !== null || !editingUserId}>
              {busy === 'update-user' ? 'Saving...' : 'Save user changes'}
            </button>
            <button className="secondary" type="button" disabled={busy !== null || !editingUserId} onClick={onDeleteUser}>
              {busy === 'delete-user' ? 'Deleting...' : 'Delete user'}
            </button>
          </form>
        </article>

        <article className="panel form-panel">
          <h2>Maintain Team</h2>
          <p className="small">Choose a team, upload or select a logo, then save.</p>
          <form onSubmit={onUpdateTeam}>
            <select value={editingTeamId} onChange={(e) => loadTeamForEdit(e.target.value)}>
              <option value="">Select team</option>
              {existingTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.team_name ?? 'Unnamed team'}
                </option>
              ))}
            </select>
            <input value={editTeamForm.teamName} onChange={(e) => setEditTeamForm({ ...editTeamForm, teamName: e.target.value })} placeholder="Team name" />
            <input value={editTeamForm.primaryColor} onChange={(e) => setEditTeamForm({ ...editTeamForm, primaryColor: e.target.value })} placeholder="Primary color" />
            <input value={editTeamForm.secondaryColor} onChange={(e) => setEditTeamForm({ ...editTeamForm, secondaryColor: e.target.value })} placeholder="Secondary color" />
            <div className="selected-image-preview">
              {editSelectedTeamImage ? (
                <img src={editSelectedTeamImage} alt="" />
              ) : (
                <span>No team image selected</span>
              )}
            </div>
            <input type="file" accept=".png,.jpg,.jpeg,.webp,.svg,image/png,image/jpeg,image/webp,image/svg+xml" onChange={(e) => setEditTeamLogoUpload(e.target.files?.[0] ?? null)} />
            <div className="inline-actions inline-actions-tight">
              <button className="secondary compact" type="button" onClick={onUploadEditTeamLogo} disabled={busy !== null || !editTeamLogoUpload || !editingTeamId}>
                {busy === 'upload-edit-logo' ? 'Uploading...' : 'Upload new team image'}
              </button>
              <button
                className="secondary compact"
                type="button"
                onClick={() => {
                  setEditSelectedTeamImage('')
                  setEditTeamForm((current) => ({ ...current, logoFile: '' }))
                }}
                disabled={busy !== null || !editingTeamId}
              >
                Remove image
              </button>
            </div>
            <div className="image-selector-grid">
              {teamImages.map((image) => {
                const storedPath = normalizeLogoFile(image.filePath)
                const fullPath = resolveImageUrl(storedPath)
                const showFallback = brokenImagePreviews[fullPath] === true
                return (
                  <button
                    key={`edit-${image.fileName}`}
                    type="button"
                    className={`image-option ${editSelectedTeamImage === fullPath ? 'selected' : ''}`}
                    onClick={() => {
                      setEditSelectedTeamImage(fullPath)
                      setEditTeamForm((current) => ({ ...current, logoFile: storedPath }))
                    }}
                    title={image.fileName}
                  >
                    {showFallback ? (
                      <span className="image-option-fallback">No preview</span>
                    ) : (
                      <img
                        src={fullPath}
                        alt=""
                        onError={() => {
                          setBrokenImagePreviews((current) => ({ ...current, [fullPath]: true }))
                        }}
                      />
                    )}
                  </button>
                )
              })}
            </div>
            <select value={editTeamForm.primaryContactId} onChange={(e) => setEditTeamForm({ ...editTeamForm, primaryContactId: e.target.value })}>
              <option value="">Primary contact</option>
              {existingUsers.map((user) => (
                <option key={`edit-contact-${user.id}`} value={user.id}>
                  {formatUserName(user)}
                </option>
              ))}
            </select>
            <button className="secondary" type="submit" disabled={busy !== null || !editingTeamId}>
              {busy === 'update-team' ? 'Saving...' : 'Save team changes'}
            </button>
          </form>
        </article>

        <article className="panel form-panel">
          <h2>Maintain Pool</h2>
          <p className="small">Choose a pool to edit its team, season, or payouts.</p>
          <form onSubmit={onUpdatePool}>
            <select value={editingPoolId} onChange={(e) => loadPoolForEdit(e.target.value)}>
              <option value="">Select pool</option>
              {existingPools.map((pool) => (
                <option key={pool.id} value={pool.id}>
                  {pool.pool_name ?? 'Unnamed pool'}
                </option>
              ))}
            </select>
            <input value={editPoolForm.poolName} onChange={(e) => setEditPoolForm({ ...editPoolForm, poolName: e.target.value })} placeholder="Pool name" />
            <select value={editPoolForm.teamId} onChange={(e) => setEditPoolForm({ ...editPoolForm, teamId: e.target.value })}>
              <option value="">Team</option>
              {existingTeams.map((team) => (
                <option key={`edit-team-${team.id}`} value={team.id}>
                  {team.team_name ?? 'Unnamed team'}
                </option>
              ))}
            </select>
            <input type="number" value={editPoolForm.season} onChange={(e) => setEditPoolForm({ ...editPoolForm, season: Number(e.target.value) })} placeholder="Season" />
            <input value={editPoolForm.primaryTeam} onChange={(e) => setEditPoolForm({ ...editPoolForm, primaryTeam: e.target.value })} placeholder="Primary team" />
            <input type="number" value={editPoolForm.squareCost} onChange={(e) => setEditPoolForm({ ...editPoolForm, squareCost: Number(e.target.value) })} placeholder="$ Square cost" />
            <input type="number" value={editPoolForm.q1Payout} onChange={(e) => setEditPoolForm({ ...editPoolForm, q1Payout: Number(e.target.value) })} placeholder="$ Q1 payout" />
            <input type="number" value={editPoolForm.q2Payout} onChange={(e) => setEditPoolForm({ ...editPoolForm, q2Payout: Number(e.target.value) })} placeholder="$ Q2 payout" />
            <input type="number" value={editPoolForm.q3Payout} onChange={(e) => setEditPoolForm({ ...editPoolForm, q3Payout: Number(e.target.value) })} placeholder="$ Q3 payout" />
            <input type="number" value={editPoolForm.q4Payout} onChange={(e) => setEditPoolForm({ ...editPoolForm, q4Payout: Number(e.target.value) })} placeholder="$ Q4 payout" />
            <button className="secondary" type="submit" disabled={busy !== null || !editingPoolId}>
              {busy === 'update-pool' ? 'Saving...' : 'Save pool changes'}
            </button>
          </form>
        </article>

        <article className="panel form-panel">
          <h2>Maintain Players</h2>
          <p className="small">Select a team, then add, update, or delete player entries.</p>
          <form onSubmit={onSavePlayer}>
            <select value={playerTeamId} onChange={(e) => void onSelectPlayerTeam(e.target.value)}>
              <option value="">Select team</option>
              {existingTeams.map((team) => (
                <option key={`players-team-${team.id}`} value={team.id}>
                  {team.team_name ?? 'Unnamed team'}
                </option>
              ))}
            </select>
            <select value={editingPlayerId} onChange={(e) => onSelectTeamPlayer(e.target.value)} disabled={!playerTeamId}>
              <option value="">New player</option>
              {teamPlayers.map((player) => (
                <option key={`team-player-${player.id}`} value={player.id}>
                  {formatPlayerName(player)}
                </option>
              ))}
            </select>
            <select
              value={playerForm.userId}
              onChange={(e) => setPlayerForm((current) => ({ ...current, userId: e.target.value }))}
              disabled={!playerTeamId}
            >
              <option value="">Player name</option>
              {existingUsers.map((user) => (
                <option key={`player-user-${user.id}`} value={user.id}>
                  {formatUserName(user)}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={99}
              value={playerForm.jerseyNum}
              onChange={(e) => setPlayerForm((current) => ({ ...current, jerseyNum: e.target.value }))}
              placeholder="Jersey number"
              disabled={!playerTeamId}
            />
            <div className="inline-actions inline-actions-tight">
              <button className="secondary" type="submit" disabled={busy !== null || !playerTeamId}>
                {busy === 'save-player' ? 'Saving...' : editingPlayerId ? 'Save player changes' : 'Add player'}
              </button>
              <button
                className="secondary"
                type="button"
                onClick={onDeletePlayer}
                disabled={busy !== null || !editingPlayerId}
              >
                {busy === 'delete-player' ? 'Deleting...' : 'Delete player'}
              </button>
            </div>
          </form>
        </article>
      </section>

      <section className="panel-grid">
        <article className="panel">
          <h2>Existing Users</h2>
          <p className="small">Loaded from /api/setup/users</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Player Teams</th>
                </tr>
              </thead>
              <tbody>
                {existingUsers.slice(0, 8).map((u) => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>{(u.first_name ?? '').trim()} {(u.last_name ?? '').trim()}</td>
                    <td>{formatUserPlayerTeams(u)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <h2>Existing Teams</h2>
          <p className="small">Loaded from /api/setup/teams</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Team</th>
                </tr>
              </thead>
              <tbody>
                {existingTeams.slice(0, 8).map((t) => (
                  <tr key={t.id}>
                    <td>{t.id}</td>
                    <td>{t.team_name ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="panel">
          <h2>Existing Pools</h2>
          <p className="small">Loaded from /api/setup/pools</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Pool</th>
                </tr>
              </thead>
              <tbody>
                {existingPools.slice(0, 8).map((p) => (
                  <tr key={p.id}>
                    <td>{p.id}</td>
                    <td>{p.pool_name ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="pools-section">
        <h2>Choose Pool To Manage</h2>
        {preview.length === 0 ? (
          <p>No pools available yet.</p>
        ) : (
          <div className="pools-grid">
            {preview.map((pool) => (
              <div
                key={pool.pool_id}
                className={`pool-card ${managedPoolId === pool.pool_id ? 'selected' : ''}`}
                onClick={() => onSelectManagedPool(pool.pool_id)}
              >
                <h3>{pool.pool_name}</h3>
                <p>{pool.team_name} • {pool.season}</p>
                <div className="pool-stats">
                  <span>{pool.sold_squares}/{pool.total_squares} sold</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Square Assignment</h2>
        <p className="small">Select a square on the board, then assign participant and player.</p>

        {organizerBoard ? (
          <div
            className="pool-board"
            style={{
              ['--team-primary' as string]: organizerBoard.teamPrimaryColor,
              ['--team-secondary' as string]: organizerBoard.teamSecondaryColor
            }}
          >
            <div className="pool-board-header">{organizerBoard.teamName ? `${organizerBoard.teamName} - ${organizerBoard.poolName}` : organizerBoard.poolName}</div>
            <div className="pool-board-main">
              <div className="pool-board-brand">
                {organizerBoard.teamLogo ? (
                  <img src={resolveImageUrl(organizerBoard.teamLogo)} alt={`${organizerBoard.teamName ?? 'Team'} logo`} />
                ) : (
                  <img src={DEFAULT_BOARD_LOGO} alt="Knights Baseball logo" />
                )}
              </div>

              <div className="pool-board-grid-wrap">
                <div className="board-axis-title board-axis-top" style={{ backgroundColor: primaryBrand?.color, color: primaryBrand?.accent }}>
                  {primaryBrand?.logo ? <img className="axis-team-logo" src={primaryBrand.logo} alt={organizerBoard.primaryTeam} /> : null}
                  <span>{organizerBoard.primaryTeam}</span>
                </div>

                <div className="board-top-digits">
                  {Array.from({ length: 10 }, (_, d) => (
                    <div key={`top-${d}`} className="digit-cell">{d}</div>
                  ))}
                </div>

                <div className="board-middle">
                  <div className="board-axis-title board-axis-left" style={{ backgroundColor: opponentBrand?.color, color: opponentBrand?.accent }}>
                    {opponentBrand?.logo ? <img className="axis-team-logo" src={opponentBrand.logo} alt={organizerBoard.opponent} /> : null}
                    <span>{organizerBoard.opponent}</span>
                  </div>

                  <div className="board-grid">
                    {organizerBoardRows.map((row, rowIndex) => (
                      <div key={`row-${rowIndex}`} className="board-row">
                        <div className="digit-cell digit-row">{rowIndex}</div>
                        {row.map((sq) => {
                          const winClass = sq.wins_count >= 3
                            ? 'win-3'
                            : sq.wins_count === 2
                              ? 'win-2'
                              : sq.wins_count === 1
                                ? 'win-1'
                                : 'win-0'

                          return (
                            <button
                              key={sq.id}
                              type="button"
                              className={`board-square ${sq.participant_id ? 'owned' : 'open'} ${sq.paid_flg ? 'paid' : ''} ${winClass} ${selectedSquare === sq.square_num ? 'selected' : ''}`}
                              onClick={() => onOpenSquareAssignment(sq)}
                            >
                              {sq.participant_id ? (
                                <span className="square-owner">
                                  <span>{sq.participant_first_name ?? ''}</span>
                                  <span>{sq.participant_last_name ?? ''}</span>
                                  <span className="square-player-num">{sq.player_jersey_num != null ? `#${sq.player_jersey_num}` : ''}</span>
                                </span>
                              ) : (
                                <span className="square-open-number">{sq.square_num}</span>
                              )}
                              {sq.wins_count > 0 ? <span className="square-win">{formatUsd(sq.won_total)}</span> : null}
                            </button>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {managedGames.length > 0 ? (
              <div className="board-game-selector">
                <label htmlFor="organizer-board-game-id">Week/Game</label>
                <select
                  id="organizer-board-game-id"
                  value={managedGameId ?? ''}
                  onChange={(e) => onSelectManagedGame(Number(e.target.value))}
                >
                  {managedGames.map((game) => (
                    <option key={game.id} value={game.id}>
                      {new Date(game.game_dt).toLocaleDateString()} vs {game.opponent}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </div>
        ) : (
          <p>Select a pool above to load the board.</p>
        )}
        <p className="small" style={{ marginTop: '1rem' }}>Click any square to edit assignment details.</p>

        {selectedSquare != null ? (
          <div className="modal-backdrop" onClick={onCloseSquareAssignment}>
            <div
              className="modal-card"
              role="dialog"
              aria-modal="true"
              aria-labelledby="square-modal-title"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="modal-header">
                <h3 id="square-modal-title">Square {selectedSquare}</h3>
                <button type="button" className="secondary compact" onClick={onCloseSquareAssignment}>Close</button>
              </div>

              <p className="small">
                Current owner:{' '}
                {selectedBoardSquare?.participant_id
                  ? `${selectedBoardSquare.participant_first_name ?? ''} ${selectedBoardSquare.participant_last_name ?? ''}`.trim() || `User #${selectedBoardSquare.participant_id}`
                  : 'Unassigned'}
              </p>

              <form onSubmit={onAssignSquare} className="assign-form modal-assign-form">
                <select
                  value={assignForm.participantId}
                  onChange={(e) => setAssignForm({ ...assignForm, participantId: e.target.value })}
                >
                  <option value="">Unassigned participant</option>
                  {participantOptions.map((user) => (
                    <option key={user.id} value={user.id}>
                      {formatUserName(user)}
                    </option>
                  ))}
                </select>
                <select
                  value={assignForm.playerId}
                  onChange={(e) => setAssignForm({ ...assignForm, playerId: e.target.value })}
                >
                  <option value="">No player</option>
                  {playerOptions.map((player) => (
                    <option key={player.id} value={player.id}>
                      {formatPlayerName(player)}
                    </option>
                  ))}
                </select>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={assignForm.paidFlg}
                    onChange={(e) => setAssignForm({ ...assignForm, paidFlg: e.target.checked })}
                  />
                  Mark as paid
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={assignForm.reassign}
                    onChange={(e) => setAssignForm({ ...assignForm, reassign: e.target.checked })}
                  />
                  Allow reassign if already sold
                </label>
                <div className="modal-actions">
                  <button
                    className="secondary"
                    type="button"
                    onClick={onClearSquareAssignment}
                    disabled={busy !== null || !managedPoolId}
                  >
                    {busy === 'clear-square' ? 'Clearing...' : 'Clear cell'}
                  </button>
                  <button className="primary" type="submit" disabled={busy !== null || !managedPoolId}>
                    {busy === 'assign-square' ? 'Saving...' : 'Save assignment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>Pool Preview</h2>
        <p className="small">From /api/db/preview</p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pool</th>
                <th>Team</th>
                <th>Season</th>
                <th>Total Squares</th>
                <th>Sold</th>
                <th>Latest Game</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.pool_id}>
                  <td>{row.pool_name}</td>
                  <td>{row.team_name}</td>
                  <td>{row.season}</td>
                  <td>{row.total_squares}</td>
                  <td>{row.sold_squares}</td>
                  <td>{row.latest_game_dt ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <h2>Create Game</h2>
        <p className="small">Add a game to a pool before running score ingestion.</p>
        <form onSubmit={onCreateGame}>
          <select ref={createGameFirstFieldRef} value={gameForm.poolId} onChange={(e) => setGameForm({ ...gameForm, poolId: e.target.value })}>
            <option value="">Select pool</option>
            {existingPools.map((pool) => (
              <option key={pool.id} value={pool.id}>{pool.pool_name ?? 'Unnamed pool'}</option>
            ))}
          </select>
          <input value={gameForm.opponent} onChange={(e) => setGameForm({ ...gameForm, opponent: e.target.value })} placeholder="Opponent name" />
          <input type="date" value={gameForm.gameDate} onChange={(e) => setGameForm({ ...gameForm, gameDate: e.target.value })} />
          <button className="primary" type="submit" disabled={busy !== null}>Create game</button>
        </form>
      </section>

      <section className="panel">
        <h2>Score Ingestion</h2>
        <p className="small">Run automated score updates and review ingestion history.</p>

        <div className="square-toolbar">
          <select value={ingestSource} onChange={(e) => setIngestSource(e.target.value as 'mock' | 'payload' | 'espn')}>
            <option value="mock">Mock</option>
            <option value="espn">ESPN</option>
            <option value="payload">Payload</option>
          </select>
          <button className="secondary" onClick={onRunBatchIngestion} disabled={busy !== null}>
            {busy === 'ingestion-run' ? 'Running...' : 'Run ingestion batch'}
          </button>
          <button className="secondary" onClick={loadIngestionHistory} disabled={busy !== null}>
            {busy === 'ingestion-history' ? 'Loading...' : 'Refresh history'}
          </button>
        </div>

        <div className="square-toolbar">
          <input
            value={ingestGameId}
            onChange={(e) => setIngestGameId(e.target.value)}
            placeholder="Game ID for single ingestion"
          />
          <button className="primary" onClick={onRunSingleIngestion} disabled={busy !== null}>
            {busy === 'ingestion-one' ? 'Running...' : 'Run one game'}
          </button>
        </div>

        {ingestSummary ? (
          <div className="stat-grid">
            <div className="stat"><span>Source</span><strong>{ingestSummary.source}</strong></div>
            <div className="stat"><span>Total</span><strong>{ingestSummary.total}</strong></div>
            <div className="stat"><span>Success</span><strong>{ingestSummary.success}</strong></div>
            <div className="stat"><span>Failed</span><strong>{ingestSummary.failed}</strong></div>
          </div>
        ) : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Mode</th>
                <th>Source</th>
                <th>Total</th>
                <th>Success</th>
                <th>Failed</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {ingestionHistory.map((run) => (
                <tr key={run.id}>
                  <td>{run.id}</td>
                  <td>{run.run_mode}</td>
                  <td>{run.source}</td>
                  <td>{run.total_games}</td>
                  <td>{run.success_games}</td>
                  <td>{run.failed_games}</td>
                  <td>{new Date(run.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default App
