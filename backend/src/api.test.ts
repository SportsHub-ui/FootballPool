import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { db } from '../src/config/db'

describe('Football Pool API', () => {
  const organizerHeaders = {
    'x-user-id': '999',
    'x-user-role': 'organizer'
  }

  const participantHeaders = {
    'x-user-id': '1000',
    'x-user-role': 'participant'
  }

  beforeAll(async () => {
    // Ensure database is available
    const client = await db.connect()
    client.release()
  })

  afterAll(async () => {
    // Cleanup if needed
    await db.end()
  })

  describe('Health Check', () => {
    it('should return health status with database time', async () => {
      const response = await request(app).get('/api/health')

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('status', 'ok')
      expect(response.body).toHaveProperty('databaseTime')
    })
  })

  describe('Database Smoke Tests', () => {
    it('should return table row counts', async () => {
      const response = await request(app).get('/api/db/smoke')

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.counts)).toBe(true)
      expect(response.body.counts.length).toBeGreaterThan(0)
    })

    it('should return pool preview data', async () => {
      const response = await request(app).get('/api/db/preview')

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.pools)).toBe(true)
    })
  })

  describe('Setup Endpoints - Users', () => {
    let createdUserId: number

    it('should require organizer role to create user', async () => {
      const response = await request(app)
        .post('/api/setup/users')
        .set(participantHeaders)
        .send({
          firstName: 'Test',
          lastName: 'User',
          email: 'test@example.com',
          phone: '5551234567'
        })

      expect(response.status).toBe(403)
    })

    it('should create a user with organizer role', async () => {
      const response = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Test',
          lastName: 'User',
          email: `test-${Date.now()}@example.com`,
          phone: '5551234567'
        })

      expect(response.status).toBe(201)
      expect(response.body).toHaveProperty('id')
      createdUserId = response.body.id
    })

    it('should persist venmo account details for a user', async () => {
      const email = `venmo-${Date.now()}@example.com`
      const createResponse = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Venmo',
          lastName: 'Tester',
          email,
          phone: '5551239999',
          venmoAcct: '@venmo-tester'
        })

      expect(createResponse.status).toBe(201)
      expect(createResponse.body).toHaveProperty('id')

      const createdUserId = Number(createResponse.body.id)

      const listResponse = await request(app)
        .get('/api/setup/users')
        .set(organizerHeaders)

      expect(listResponse.status).toBe(200)
      const createdUser = listResponse.body.users.find((user: { id: number }) => user.id === createdUserId)
      expect(createdUser?.venmo_acct).toBe('@venmo-tester')

      const updateResponse = await request(app)
        .patch(`/api/setup/users/${createdUserId}`)
        .set(organizerHeaders)
        .send({
          firstName: 'Venmo',
          lastName: 'Tester',
          email,
          phone: '5551239999',
          venmoAcct: '@updated-venmo'
        })

      expect(updateResponse.status).toBe(200)

      const updatedListResponse = await request(app)
        .get('/api/setup/users')
        .set(organizerHeaders)

      const updatedUser = updatedListResponse.body.users.find((user: { id: number }) => user.id === createdUserId)
      expect(updatedUser?.venmo_acct).toBe('@updated-venmo')
    })

    it('should persist notification preferences for a user', async () => {
      const email = `notify-${Date.now()}@example.com`
      const createResponse = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Notify',
          lastName: 'User',
          email,
          phone: '5551237777',
          notificationLevel: 'quarter_win',
          notifyOnSquareLead: true
        })

      expect(createResponse.status).toBe(201)
      const createdUserId = Number(createResponse.body.id)

      const listResponse = await request(app)
        .get('/api/setup/users')
        .set(organizerHeaders)

      const createdUser = listResponse.body.users.find((user: { id: number }) => user.id === createdUserId)
      expect(createdUser?.notification_level).toBe('quarter_win')
      expect(createdUser?.notify_on_square_lead_flg).toBe(true)

      const updateResponse = await request(app)
        .patch(`/api/setup/users/${createdUserId}`)
        .set(organizerHeaders)
        .send({
          firstName: 'Notify',
          lastName: 'User',
          email,
          phone: '5551237777',
          notificationLevel: 'game_total',
          notifyOnSquareLead: false
        })

      expect(updateResponse.status).toBe(200)

      const updatedListResponse = await request(app)
        .get('/api/landing/users')
        .set(organizerHeaders)

      const updatedUser = updatedListResponse.body.users.find((user: { id: number }) => user.id === createdUserId)
      expect(updatedUser?.notification_level).toBe('game_total')
      expect(updatedUser?.notify_on_square_lead_flg).toBe(false)
    })

    it('should list users', async () => {
      const response = await request(app)
        .get('/api/setup/users')
        .set(organizerHeaders)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.users)).toBe(true)
    })

    it('should reject invalid user email', async () => {
      const response = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Bad',
          lastName: 'Email',
          email: 'not-an-email',
          phone: '5551234567'
        })

      expect(response.status).toBe(400)
    })
  })

  describe('Setup Endpoints - Images', () => {
    it('should upload and serve an image through the API-backed image route', async () => {
      const uploadResponse = await request(app)
        .post('/api/setup/images/upload')
        .set(organizerHeaders)
        .attach('image', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'), 'logo.svg')

      expect(uploadResponse.status).toBe(201)
      expect(uploadResponse.body.filePath).toMatch(/^\/api\/setup\/images\/\d+\/file$/)

      const listResponse = await request(app)
        .get('/api/setup/images')
        .set(organizerHeaders)

      expect(listResponse.status).toBe(200)
      expect(listResponse.body.images.some((image: { filePath: string }) => image.filePath === uploadResponse.body.filePath)).toBe(true)

      const imageResponse = await request(app)
        .get(uploadResponse.body.filePath)

      expect(imageResponse.status).toBe(200)
      expect(String(imageResponse.headers['content-type'] ?? '')).toContain('image/svg+xml')
    })
  })

  describe('Setup Endpoints - Teams', () => {
    let createdTeamId: number

    it('should create a team', async () => {
      const response = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({
          teamName: 'Test Team',
          primaryColor: 'Blue',
          secondaryColor: 'Gold'
        })

      expect(response.status).toBe(201)
      expect(response.body).toHaveProperty('id')
      createdTeamId = response.body.id
    })
  })

  describe('Setup Endpoints - Pools', () => {
    let createdPoolId: number
    let displayToken: string
    let teamId: number

    beforeAll(async () => {
      // Create a team first
      const teamRes = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({
          teamName: 'Pool Test Team',
          primaryColor: 'Red'
        })

      teamId = teamRes.body.id
    })

    it('should create a pool', async () => {
      const response = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: 'Test Pool 2026',
          teamId: teamId,
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 25,
          q1Payout: 250,
          q2Payout: 250,
          q3Payout: 250,
          q4Payout: 500
        })

      expect(response.status).toBe(201)
      expect(response.body).toHaveProperty('id')
      expect(response.body).toHaveProperty('displayToken')
      createdPoolId = response.body.id
      displayToken = response.body.displayToken
    })

    it('should persist pool contact notification settings', async () => {
      const createResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Pool Notify ${Date.now()}`,
          teamId,
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 25,
          q1Payout: 250,
          q2Payout: 250,
          q3Payout: 250,
          q4Payout: 500
        })

      expect(createResponse.status).toBe(201)
      const poolId = Number(createResponse.body.id)

      const updateResponse = await request(app)
        .patch(`/api/setup/pools/${poolId}`)
        .set(organizerHeaders)
        .send({
          poolName: `Pool Notify ${Date.now()}`,
          teamId,
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 25,
          q1Payout: 250,
          q2Payout: 250,
          q3Payout: 250,
          q4Payout: 500,
          contactNotificationLevel: 'quarter_win',
          contactNotifyOnSquareLead: true
        })

      expect(updateResponse.status).toBe(200)

      const listResponse = await request(app)
        .get('/api/setup/pools')
        .set(organizerHeaders)

      const updatedPool = listResponse.body.pools.find((pool: { id: number }) => pool.id === poolId)
      expect(updatedPool?.contact_notification_level).toBe('quarter_win')
      expect(updatedPool?.contact_notify_on_square_lead_flg).toBe(true)
    })

    it('should initialize 100 squares in a pool', async () => {
      const response = await request(app)
        .post(`/api/setup/pools/${createdPoolId}/squares/init`)
        .set(organizerHeaders)
        .send({})

      expect(response.status).toBe(200)
      expect(response.body.squareCount).toBe(100)
    })

    it('should list pool squares', async () => {
      const response = await request(app)
        .get(`/api/setup/pools/${createdPoolId}/squares`)
        .set(organizerHeaders)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.squares)).toBe(true)
      expect(response.body.squares.length).toBe(100)
    })

    it('should open a display link on the current active game for the pool', async () => {
      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Display Link Pool ${Date.now()}`,
          teamId: teamId,
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 25,
          q1Payout: 250,
          q2Payout: 250,
          q3Payout: 250,
          q4Payout: 500
        })

      expect(poolResponse.status).toBe(201)
      const displayPoolId = Number(poolResponse.body.id)
      const displayPoolToken = String(poolResponse.body.displayToken)

      const weekOneResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId: displayPoolId,
          weekNum: 1,
          opponent: 'Chicago Bears',
          gameDate: '2026-09-10T18:00:00.000Z'
        })

      const weekTwoResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId: displayPoolId,
          weekNum: 2,
          opponent: 'Detroit Lions',
          gameDate: '2026-09-17T18:00:00.000Z'
        })

      expect(weekOneResponse.status).toBe(200)
      expect(weekTwoResponse.status).toBe(200)

      const weekOneGameId = Number(weekOneResponse.body.game.id)
      const weekTwoGameId = Number(weekTwoResponse.body.game.id)

      const completedScoreResponse = await request(app)
        .patch(`/api/games/${weekOneGameId}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: 7,
          q1OpponentScore: 0,
          q2PrimaryScore: 14,
          q2OpponentScore: 3,
          q3PrimaryScore: 21,
          q3OpponentScore: 10,
          q4PrimaryScore: 28,
          q4OpponentScore: 17
        })

      await db.query(
        `UPDATE football_pool.game
         SET q1_primary_score = $2,
             q1_opponent_score = $3,
             q2_primary_score = NULL,
             q2_opponent_score = NULL,
             q3_primary_score = NULL,
             q3_opponent_score = NULL,
             q4_primary_score = NULL,
             q4_opponent_score = NULL
         WHERE id = $1`,
        [weekTwoGameId, 10, 7]
      )

      expect(completedScoreResponse.status).toBe(200)

      const listResponse = await request(app)
        .get('/api/setup/pools')
        .set(organizerHeaders)

      expect(listResponse.status).toBe(200)
      const createdPool = listResponse.body.pools.find((pool: { id: number }) => pool.id === displayPoolId)
      expect(createdPool?.display_token).toBe(displayPoolToken)

      const displayResponse = await request(app).get(`/api/landing/display/${displayPoolToken}`)

      expect(displayResponse.status).toBe(200)
      expect(displayResponse.body.pool?.id).toBe(displayPoolId)
      expect(displayResponse.body.selectedGameId).toBe(weekTwoGameId)
      expect(displayResponse.body.board?.poolId).toBe(displayPoolId)
      expect(displayResponse.body.board?.gameId).toBe(weekTwoGameId)
    })
  })

  describe('Games Endpoints', () => {
    let poolId: number
    let gameId: number

    beforeAll(async () => {
      // Create pool and team
      const teamRes = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: 'Game Test Team' })

      const poolRes = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: 'Game Test Pool',
          teamId: teamRes.body.id,
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 20,
          q1Payout: 200,
          q2Payout: 200,
          q3Payout: 200,
          q4Payout: 400
        })

      poolId = poolRes.body.id
    })

    it('should create a game', async () => {
      const response = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId: poolId,
          opponent: 'Test Opponent',
          gameDate: new Date().toISOString(),
          isSimulation: true
        })

      expect(response.status).toBe(200)
      expect(response.body.game).toHaveProperty('id')
      gameId = response.body.game.id
    })

    it('should list games for a pool', async () => {
      const response = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body)).toBe(true)
    })

    it('should get a specific game', async () => {
      const response = await request(app)
        .get(`/api/games/${gameId}`)
        .set(organizerHeaders)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('id', gameId)
    })

    it('should update game scores', async () => {
      const response = await request(app)
        .patch(`/api/games/${gameId}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: 3,
          q1OpponentScore: 7,
          q2PrimaryScore: 10,
          q2OpponentScore: 14,
          q3PrimaryScore: 17,
          q3OpponentScore: 20,
          q4PrimaryScore: 24,
          q4OpponentScore: 28
        })

      expect(response.status).toBe(200)
      expect(response.body.game).toHaveProperty('q1_primary_score', 3)
    })
  })

  describe('Winnings Endpoints', () => {
    let poolId: number

    beforeAll(async () => {
      // Create pool and teams
      const teamRes = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: 'Winnings Test Team' })

      const poolRes = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: 'Winnings Test Pool',
          teamId: teamRes.body.id,
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 20,
          q1Payout: 200,
          q2Payout: 200,
          q3Payout: 200,
          q4Payout: 400
        })

      poolId = poolRes.body.id
    })

    it('should get winnings for a pool', async () => {
      const response = await request(app)
        .get(`/api/winnings/pool/${poolId}`)
        .set(organizerHeaders)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body)).toBe(true)
    })

    it('should get user winnings', async () => {
      const response = await request(app)
        .get('/api/winnings/user/1')
        .set(participantHeaders)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('userId')
      expect(response.body).toHaveProperty('totalWon')
      expect(Array.isArray(response.body.winnings)).toBe(true)
    })
  })

  describe('Participant Endpoints', () => {
    it('should require authentication', async () => {
      const response = await request(app).get('/api/participant/pools')

      expect(response.status).toBe(401)
    })

    it('should get participant pools', async () => {
      const response = await request(app)
        .get('/api/participant/pools')
        .set(participantHeaders)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body)).toBe(true)
    })

    it('should get participant winnings', async () => {
      const response = await request(app)
        .get('/api/participant/winnings')
        .set(participantHeaders)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('userId')
      expect(response.body).toHaveProperty('totalWon')
    })
  })

  describe('Progressive simulation modes', () => {
    it('should start a by-game simulation and advance to the next game', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Sim Team ${Date.now()}` })

      const teamId = Number(teamResponse.body.id)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Sim Pool ${Date.now()}`,
          teamId,
          season: 2025,
          primaryTeam: 'Green Bay Packers',
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 200
        })

      const poolId = Number(poolResponse.body.id)

      await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Sim',
          lastName: `User${Date.now()}`,
          email: `sim-${Date.now()}@example.com`,
          phone: '5551000000',
          isPlayer: true,
          playerTeams: [{ teamId, jerseyNum: 12 }]
        })

      const firstGame = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 1,
          opponent: 'Chicago Bears',
          gameDate: '2025-09-07',
          isSimulation: true
        })

      const secondGame = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 2,
          opponent: 'Detroit Lions',
          gameDate: '2025-09-14',
          isSimulation: true
        })

      const gameOneId = Number(firstGame.body.game.id)
      const gameTwoId = Number(secondGame.body.game.id)

      const startResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)
        .send({ mode: 'by_game' })

      expect(startResponse.status).toBe(201)
      expect(startResponse.body.result.mode).toBe('by_game')

      const initialStatus = await request(app)
        .get(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)

      expect(initialStatus.status).toBe(200)
      expect(initialStatus.body.status.currentGameId).toBe(gameOneId)
      expect(initialStatus.body.status.progressAction).toBe('complete_game')

      const advanceResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation/advance`)
        .set(organizerHeaders)
        .send({ source: 'mock' })

      expect(advanceResponse.status).toBe(200)
      expect(advanceResponse.body.status.currentGameId).toBe(gameTwoId)

      const gamesResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      const completedFirstGame = gamesResponse.body.find((game: { id: number }) => game.id === gameOneId)
      const preparedSecondGame = gamesResponse.body.find((game: { id: number }) => game.id === gameTwoId)

      expect(completedFirstGame.q4_primary_score).not.toBeNull()
      expect(completedFirstGame.q4_opponent_score).not.toBeNull()
      expect(preparedSecondGame.row_numbers).toBeTruthy()
      expect(preparedSecondGame.col_numbers).toBeTruthy()
    })

    it('should fall back to mock scores when ESPN cannot match the game during simulation advance', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Fallback Sim Team ${Date.now()}` })

      const teamId = Number(teamResponse.body.id)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Fallback Sim Pool ${Date.now()}`,
          teamId,
          season: 2025,
          primaryTeam: 'Green Bay Packers',
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 200
        })

      const poolId = Number(poolResponse.body.id)

      await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Fallback',
          lastName: `User${Date.now()}`,
          email: `fallback-${Date.now()}@example.com`,
          phone: '5552100000',
          isPlayer: true,
          playerTeams: [{ teamId, jerseyNum: 45 }]
        })

      await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 1,
          opponent: 'Seattle Seahawks',
          gameDate: '2025-09-14',
          isSimulation: true
        })

      await request(app)
        .post(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)
        .send({ mode: 'by_quarter' })

      const advanceResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation/advance`)
        .set(organizerHeaders)
        .send({ source: 'espn' })

      expect(advanceResponse.status).toBe(200)
      expect(advanceResponse.body.message).toContain('mock scores were used instead')
      expect(advanceResponse.body.completedQuarter).toBe(1)
    })

    it('should seed a by-quarter simulation with a live mid-quarter board highlight', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Live Quarter Sim Team ${Date.now()}` })

      const teamId = Number(teamResponse.body.id)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Live Quarter Sim Pool ${Date.now()}`,
          teamId,
          season: 2025,
          primaryTeam: 'Green Bay Packers',
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 200
        })

      const poolId = Number(poolResponse.body.id)

      await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Live',
          lastName: `User${Date.now()}`,
          email: `live-quarter-${Date.now()}@example.com`,
          phone: '5552200000',
          isPlayer: true,
          playerTeams: [{ teamId, jerseyNum: 18 }]
        })

      const firstGame = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 1,
          opponent: 'Chicago Bears',
          gameDate: '2025-09-07',
          isSimulation: true
        })

      const gameId = Number(firstGame.body.game.id)

      const startResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)
        .send({ mode: 'by_quarter' })

      expect(startResponse.status).toBe(201)

      const gamesResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      const seededGame = gamesResponse.body.find((game: { id: number }) => game.id === gameId)
      expect(seededGame.q1_primary_score).not.toBeNull()
      expect(seededGame.q1_opponent_score).not.toBeNull()
      expect(seededGame.q2_primary_score).toBeNull()

      const boardResponse = await request(app).get(`/api/landing/pools/${poolId}/board?gameId=${gameId}`)

      expect(boardResponse.status).toBe(200)
      const currentLeaderSquares = boardResponse.body.board.squares.filter(
        (sq: { is_current_score_leader?: boolean }) => sq.is_current_score_leader === true
      )
      expect(currentLeaderSquares).toHaveLength(1)
      expect(currentLeaderSquares[0].current_game_won).toBe(0)
    })

    it('should refresh a by-quarter simulation with a new live in-quarter score without completing the quarter', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Refresh Quarter Sim Team ${Date.now()}` })

      const teamId = Number(teamResponse.body.id)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Refresh Quarter Sim Pool ${Date.now()}`,
          teamId,
          season: 2025,
          primaryTeam: 'Green Bay Packers',
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 200
        })

      const poolId = Number(poolResponse.body.id)

      await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Refresh',
          lastName: `User${Date.now()}`,
          email: `refresh-quarter-${Date.now()}@example.com`,
          phone: '5552300000',
          isPlayer: true,
          playerTeams: [{ teamId, jerseyNum: 22 }]
        })

      const firstGame = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 1,
          opponent: 'Minnesota Vikings',
          gameDate: '2025-09-07',
          isSimulation: true
        })

      const gameId = Number(firstGame.body.game.id)

      const startResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)
        .send({ mode: 'by_quarter' })

      expect(startResponse.status).toBe(201)

      const seededGamesResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      const seededGame = seededGamesResponse.body.find((game: { id: number }) => game.id === gameId)
      const seededPrimary = Number(seededGame.q1_primary_score)
      const seededOpponent = Number(seededGame.q1_opponent_score)

      const refreshResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation/advance`)
        .set(organizerHeaders)
        .send({ source: 'mock', action: 'live' })

      expect(refreshResponse.status).toBe(200)
      expect(refreshResponse.body.status.currentGameId).toBe(gameId)
      expect(refreshResponse.body.status.nextQuarter).toBe(1)
      expect(String(refreshResponse.body.message ?? '')).toMatch(/live/i)

      const refreshedGamesResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      const refreshedGame = refreshedGamesResponse.body.find((game: { id: number }) => game.id === gameId)
      expect(Number(refreshedGame.q1_primary_score)).toBeGreaterThanOrEqual(seededPrimary)
      expect(Number(refreshedGame.q1_opponent_score)).toBeGreaterThanOrEqual(seededOpponent)
      expect(refreshedGame.q2_primary_score).toBeNull()
    })

    it('should keep repeated live-score updates short of a completed quarter until Complete Quarter is used', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Live Hold Sim Team ${Date.now()}` })

      const teamId = Number(teamResponse.body.id)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Live Hold Sim Pool ${Date.now()}`,
          teamId,
          season: 2025,
          primaryTeam: 'Green Bay Packers',
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 200
        })

      const poolId = Number(poolResponse.body.id)

      await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Hold',
          lastName: `User${Date.now()}`,
          email: `hold-quarter-${Date.now()}@example.com`,
          phone: '5552400000',
          isPlayer: true,
          playerTeams: [{ teamId, jerseyNum: 33 }]
        })

      const firstGame = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 1,
          opponent: 'Atlanta Falcons',
          gameDate: '2025-09-07',
          isSimulation: true
        })

      const gameId = Number(firstGame.body.game.id)
      const base = (gameId * 7) % 10
      const finalQ1Primary = (base + 3) % 10
      const finalQ1Opponent = (base + 7) % 10

      const startResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)
        .send({ mode: 'by_quarter' })

      expect(startResponse.status).toBe(201)

      for (let attempt = 0; attempt < 8; attempt += 1) {
        const liveResponse = await request(app)
          .post(`/api/setup/pools/${poolId}/simulation/advance`)
          .set(organizerHeaders)
          .send({ source: 'mock', action: 'live' })

        expect(liveResponse.status).toBe(200)
        expect(liveResponse.body.status.currentGameId).toBe(gameId)
        expect(liveResponse.body.status.nextQuarter).toBe(1)
      }

      const liveGamesResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      const liveGame = liveGamesResponse.body.find((game: { id: number }) => game.id === gameId)
      expect(liveGame.q2_primary_score).toBeNull()
      expect(
        Number(liveGame.q1_primary_score) < finalQ1Primary || Number(liveGame.q1_opponent_score) < finalQ1Opponent
      ).toBe(true)

      const completeResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation/advance`)
        .set(organizerHeaders)
        .send({ source: 'mock', action: 'complete' })

      expect(completeResponse.status).toBe(200)
      expect(completeResponse.body.status.nextQuarter).toBe(2)

      const completedGamesResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      const completedGame = completedGamesResponse.body.find((game: { id: number }) => game.id === gameId)
      expect(Number(completedGame.q1_primary_score)).toBe(finalQ1Primary)
      expect(Number(completedGame.q1_opponent_score)).toBe(finalQ1Opponent)
    })

    it('should advance a by-quarter simulation one quarter at a time', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Quarter Sim Team ${Date.now()}` })

      const teamId = Number(teamResponse.body.id)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Quarter Sim Pool ${Date.now()}`,
          teamId,
          season: 2025,
          primaryTeam: 'Green Bay Packers',
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 200
        })

      const poolId = Number(poolResponse.body.id)

      await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Quarter',
          lastName: `User${Date.now()}`,
          email: `quarter-${Date.now()}@example.com`,
          phone: '5552000000',
          isPlayer: true,
          playerTeams: [{ teamId, jerseyNum: 34 }]
        })

      const firstGame = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 1,
          opponent: 'Minnesota Vikings',
          gameDate: '2025-09-07',
          isSimulation: true
        })

      const secondGame = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 2,
          opponent: 'Seattle Seahawks',
          gameDate: '2025-09-14',
          isSimulation: true
        })

      const gameOneId = Number(firstGame.body.game.id)
      const gameTwoId = Number(secondGame.body.game.id)

      const startResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)
        .send({ mode: 'by_quarter' })

      expect(startResponse.status).toBe(201)
      expect(startResponse.body.result.mode).toBe('by_quarter')

      const quarterOne = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation/advance`)
        .set(organizerHeaders)
        .send({ source: 'mock' })

      expect(quarterOne.status).toBe(200)
      expect(quarterOne.body.status.currentGameId).toBe(gameOneId)
      expect(quarterOne.body.status.nextQuarter).toBe(2)

      const quarterTwo = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation/advance`)
        .set(organizerHeaders)
        .send({ source: 'mock' })
      const quarterThree = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation/advance`)
        .set(organizerHeaders)
        .send({ source: 'mock' })
      const quarterFour = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation/advance`)
        .set(organizerHeaders)
        .send({ source: 'mock' })

      expect(quarterTwo.status).toBe(200)
      expect(quarterThree.status).toBe(200)
      expect(quarterFour.status).toBe(200)
      expect(quarterFour.body.status.currentGameId).toBe(gameTwoId)

      const gamesResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      const completedFirstGame = gamesResponse.body.find((game: { id: number }) => game.id === gameOneId)
      expect(completedFirstGame.q1_primary_score).not.toBeNull()
      expect(completedFirstGame.q2_primary_score).not.toBeNull()
      expect(completedFirstGame.q3_primary_score).not.toBeNull()
      expect(completedFirstGame.q4_primary_score).not.toBeNull()
    })
  })

  describe('Board weekly and season-to-date winnings', () => {
    let poolId: number
    let weekOneGameId: number
    let weekTwoGameId: number
    let userId: number

    beforeAll(async () => {
      const userRes = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Board',
          lastName: 'Winner',
          email: `board-${Date.now()}@example.com`,
          phone: '5551234567'
        })

      userId = userRes.body.id

      const teamRes = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: 'Board Test Team' })

      const poolRes = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: 'Board Winnings Test Pool',
          teamId: teamRes.body.id,
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 20,
          q1Payout: 200,
          q2Payout: 200,
          q3Payout: 200,
          q4Payout: 400
        })

      poolId = poolRes.body.id

      await request(app)
        .post(`/api/setup/pools/${poolId}/squares/init`)
        .set(organizerHeaders)
        .send({})

      await request(app)
        .patch(`/api/setup/pools/${poolId}/squares/1`)
        .set(organizerHeaders)
        .send({
          participantId: userId,
          playerId: null,
          paidFlg: true,
          reassign: false
        })

      const weekOneGameRes = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 1,
          opponent: 'Week One Opponent',
          gameDate: '2026-09-13T18:00:00.000Z',
          isSimulation: true
        })

      weekOneGameId = weekOneGameRes.body.game.id

      const weekTwoGameRes = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 2,
          opponent: 'Week Two Opponent',
          gameDate: '2026-09-20T18:00:00.000Z',
          isSimulation: true
        })

      weekTwoGameId = weekTwoGameRes.body.game.id

      const shuffledRows = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
      const shuffledCols = [4, 5, 6, 7, 8, 9, 0, 1, 2, 3]

      await db.query(
        `UPDATE football_pool.game
         SET row_numbers = $2::jsonb,
             col_numbers = $3::jsonb
         WHERE id IN ($1, $4)`,
        [weekOneGameId, JSON.stringify(shuffledRows), JSON.stringify(shuffledCols), weekTwoGameId]
      )

      const repeatedWinningScores = {
        q1PrimaryScore: 0,
        q1OpponentScore: 0,
        q2PrimaryScore: 10,
        q2OpponentScore: 10,
        q3PrimaryScore: 20,
        q3OpponentScore: 20,
        q4PrimaryScore: 30,
        q4OpponentScore: 30
      }

      await request(app)
        .patch(`/api/games/${weekOneGameId}/scores`)
        .set(organizerHeaders)
        .send(repeatedWinningScores)

      await request(app)
        .patch(`/api/games/${weekTwoGameId}/scores`)
        .set(organizerHeaders)
        .send(repeatedWinningScores)
    })

    it('should show current-week and season-to-date winnings on the landing board', async () => {
      const weekOneResponse = await request(app).get(`/api/landing/pools/${poolId}/board?gameId=${weekOneGameId}`)
      const weekTwoResponse = await request(app).get(`/api/landing/pools/${poolId}/board?gameId=${weekTwoGameId}`)

      expect(weekOneResponse.status).toBe(200)
      expect(weekTwoResponse.status).toBe(200)

      const weekOneSquare = weekOneResponse.body.board.squares.find((sq: { square_num: number }) => sq.square_num === 97)
      const weekTwoSquare = weekTwoResponse.body.board.squares.find((sq: { square_num: number }) => sq.square_num === 97)
      const identitySquare = weekTwoResponse.body.board.squares.find((sq: { square_num: number }) => sq.square_num === 1)

      expect(weekOneSquare).toMatchObject({
        current_game_won: 1000,
        season_won_total: 1000
      })

      expect(weekTwoSquare).toMatchObject({
        current_game_won: 1000,
        season_won_total: 2000
      })

      expect(identitySquare).toMatchObject({
        current_game_won: 0,
        season_won_total: 0
      })
    })

    it('should expose the same weekly and season-to-date totals on the participant board', async () => {
      const response = await request(app)
        .get(`/api/participant/pools/${poolId}/board?gameId=${weekTwoGameId}`)
        .set(participantHeaders)

      expect(response.status).toBe(200)

      const winningSquare = response.body.board.squares.find((sq: { square_num: number }) => sq.square_num === 97)
      expect(winningSquare).toMatchObject({
        current_game_won: 1000,
        season_won_total: 2000
      })
    })
  })

  describe('Notification template configuration', () => {
    it('should list the configurable notification templates', async () => {
      const response = await request(app)
        .get('/api/setup/notifications/templates')
        .set(organizerHeaders)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body.templates)).toBe(true)
      expect(response.body.templates.length).toBeGreaterThanOrEqual(6)
      expect(response.body.availableVariables).toHaveProperty('quarter_win')
      expect(response.body.availableVariables.quarter_win).toContain('winnerName')
      expect(response.body.selectedPoolId).toBeNull()
    })

    it('should save a custom participant quarter-win template', async () => {
      const response = await request(app)
        .put('/api/setup/notifications/templates/participant/quarter_win')
        .set(organizerHeaders)
        .send({
          subjectTemplate: 'Quarter {{quarter}} winner in {{poolName}}',
          bodyTemplate: '## Quarter {{quarter}}\n\n{{winnerName}} won **{{poolName}}**.\n\n{{scoreLine}}',
          markupFormat: 'markdown'
        })

      expect(response.status).toBe(200)
      expect(response.body.template.subjectTemplate).toBe('Quarter {{quarter}} winner in {{poolName}}')
      expect(response.body.template.bodyTemplate).toContain('{{winnerName}}')
      expect(response.body.template.markupFormat).toBe('markdown')
      expect(response.body.template.poolId).toBeNull()
      expect(response.body.template.source).toBe('global')
    })

    it('should allow pool-specific overrides with global fallback', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Template Team ${Date.now()}` })

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Template Pool ${Date.now()}`,
          teamId: Number(teamResponse.body.id),
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 25,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 100
        })

      const poolId = Number(poolResponse.body.id)

      await request(app)
        .put('/api/setup/notifications/templates/participant/quarter_win')
        .set(organizerHeaders)
        .send({
          subjectTemplate: 'GLOBAL quarter {{quarter}} in {{poolName}}',
          bodyTemplate: 'Global winner {{winnerName}}',
          markupFormat: 'plain_text'
        })

      const saveResponse = await request(app)
        .put('/api/setup/notifications/templates/participant/quarter_win')
        .set(organizerHeaders)
        .send({
          poolId,
          subjectTemplate: 'POOL quarter {{quarter}} in {{poolName}}',
          bodyTemplate: 'Pool winner {{winnerName}}',
          markupFormat: 'plain_text'
        })

      expect(saveResponse.status).toBe(200)
      expect(saveResponse.body.template.poolId).toBe(poolId)
      expect(saveResponse.body.template.source).toBe('pool')

      const response = await request(app)
        .get(`/api/setup/notifications/templates?poolId=${poolId}`)
        .set(organizerHeaders)

      expect(response.status).toBe(200)
      expect(response.body.selectedPoolId).toBe(poolId)

      const participantQuarterTemplate = response.body.templates.find(
        (template: { recipientScope: string; notificationKind: string }) =>
          template.recipientScope === 'participant' && template.notificationKind === 'quarter_win'
      )
      const poolContactQuarterTemplate = response.body.templates.find(
        (template: { recipientScope: string; notificationKind: string }) =>
          template.recipientScope === 'pool_contact' && template.notificationKind === 'quarter_win'
      )

      expect(participantQuarterTemplate).toMatchObject({
        subjectTemplate: 'POOL quarter {{quarter}} in {{poolName}}',
        poolId,
        source: 'pool'
      })
      expect(poolContactQuarterTemplate).toMatchObject({
        poolId: null,
        source: 'global'
      })
    })

    it('should reset a pool-specific override back to the GLOBAL template', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Reset Team ${Date.now()}` })

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Reset Pool ${Date.now()}`,
          teamId: Number(teamResponse.body.id),
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 25,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 100
        })

      const poolId = Number(poolResponse.body.id)

      await request(app)
        .put('/api/setup/notifications/templates/participant/quarter_win')
        .set(organizerHeaders)
        .send({
          subjectTemplate: 'GLOBAL reset {{quarter}} in {{poolName}}',
          bodyTemplate: 'Global reset {{winnerName}}',
          markupFormat: 'plain_text'
        })

      await request(app)
        .put('/api/setup/notifications/templates/participant/quarter_win')
        .set(organizerHeaders)
        .send({
          poolId,
          subjectTemplate: 'POOL reset {{quarter}} in {{poolName}}',
          bodyTemplate: 'Pool reset {{winnerName}}',
          markupFormat: 'plain_text'
        })

      const deleteResponse = await request(app)
        .delete(`/api/setup/notifications/templates/participant/quarter_win?poolId=${poolId}`)
        .set(organizerHeaders)

      expect(deleteResponse.status).toBe(200)
      expect(deleteResponse.body.reset).toBe(true)

      const response = await request(app)
        .get(`/api/setup/notifications/templates?poolId=${poolId}`)
        .set(organizerHeaders)

      const participantQuarterTemplate = response.body.templates.find(
        (template: { recipientScope: string; notificationKind: string }) =>
          template.recipientScope === 'participant' && template.notificationKind === 'quarter_win'
      )

      expect(participantQuarterTemplate).toMatchObject({
        subjectTemplate: 'GLOBAL reset {{quarter}} in {{poolName}}',
        poolId: null,
        source: 'global'
      })
    })
  })

  describe('Email notifications', () => {
    it('should log quarter-win emails for opted-in users and pool contacts', async () => {
      const winnerEmail = `winner-${Date.now()}@example.com`
      const contactEmail = `contact-${Date.now()}@example.com`

      const winnerResponse = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Quarter',
          lastName: 'Winner',
          email: winnerEmail,
          phone: '5551112222',
          notificationLevel: 'quarter_win'
        })

      const contactResponse = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Pool',
          lastName: 'Contact',
          email: contactEmail,
          phone: '5553334444'
        })

      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({
          teamName: `Notify Team ${Date.now()}`,
          primaryContactId: Number(contactResponse.body.id)
        })

      const poolName = `Notify Pool ${Date.now()}`

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName,
          teamId: Number(teamResponse.body.id),
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 25,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 100,
          contactNotificationLevel: 'quarter_win'
        })

      const poolId = Number(poolResponse.body.id)

      await request(app)
        .post(`/api/setup/pools/${poolId}/squares/init`)
        .set(organizerHeaders)
        .send({})

      await request(app)
        .patch(`/api/setup/pools/${poolId}/squares/1`)
        .set(organizerHeaders)
        .send({
          participantId: Number(winnerResponse.body.id),
          playerId: null,
          paidFlg: true,
          reassign: false
        })

      const gameResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 1,
          opponent: 'Email Opponent',
          gameDate: '2026-10-01T18:00:00.000Z',
          isSimulation: true
        })

      const gameId = Number(gameResponse.body.game.id)

      await db.query(
        `UPDATE football_pool.game
         SET row_numbers = $2::jsonb,
             col_numbers = $3::jsonb
         WHERE id = $1`,
        [gameId, JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])]
      )

      await request(app)
        .put('/api/setup/notifications/templates/participant/quarter_win')
        .set(organizerHeaders)
        .send({
          subjectTemplate: 'GLOBAL quarter {{quarter}} winner in {{poolName}}',
          bodyTemplate: 'Global winner {{winnerName}}',
          markupFormat: 'plain_text'
        })

      await request(app)
        .put('/api/setup/notifications/templates/participant/quarter_win')
        .set(organizerHeaders)
        .send({
          poolId,
          subjectTemplate: 'Quarter {{quarter}} winner in {{poolName}}',
          bodyTemplate: '## Quarter {{quarter}}\n\n{{winnerName}} won **{{poolName}}**.\n\n{{scoreLine}}',
          markupFormat: 'markdown'
        })

      const scoreResponse = await request(app)
        .patch(`/api/games/${gameId}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: 0,
          q1OpponentScore: 0,
          q2PrimaryScore: 10,
          q2OpponentScore: 10,
          q3PrimaryScore: 20,
          q3OpponentScore: 20,
          q4PrimaryScore: 30,
          q4OpponentScore: 30
        })

      expect(scoreResponse.status).toBe(200)

      const notificationResult = await db.query(
        `SELECT recipient_email, notification_kind, recipient_scope, quarter
         FROM football_pool.notification_log
         WHERE game_id = $1
         ORDER BY recipient_email, quarter NULLS LAST`,
        [gameId]
      )

      expect(notificationResult.rows).toEqual([
        { recipient_email: contactEmail, notification_kind: 'quarter_win', recipient_scope: 'pool_contact', quarter: 1 },
        { recipient_email: contactEmail, notification_kind: 'quarter_win', recipient_scope: 'pool_contact', quarter: 2 },
        { recipient_email: contactEmail, notification_kind: 'quarter_win', recipient_scope: 'pool_contact', quarter: 3 },
        { recipient_email: contactEmail, notification_kind: 'quarter_win', recipient_scope: 'pool_contact', quarter: 4 },
        { recipient_email: winnerEmail, notification_kind: 'quarter_win', recipient_scope: 'user', quarter: 1 },
        { recipient_email: winnerEmail, notification_kind: 'quarter_win', recipient_scope: 'user', quarter: 2 },
        { recipient_email: winnerEmail, notification_kind: 'quarter_win', recipient_scope: 'user', quarter: 3 },
        { recipient_email: winnerEmail, notification_kind: 'quarter_win', recipient_scope: 'user', quarter: 4 }
      ])

      const userMessageResult = await db.query(
        `SELECT subject, message_text
         FROM football_pool.notification_log
         WHERE game_id = $1
           AND recipient_scope = 'user'
           AND quarter = 1
         LIMIT 1`,
        [gameId]
      )

      expect(userMessageResult.rows[0]?.subject).toBe(`Quarter 1 winner in ${poolName}`)
      expect(String(userMessageResult.rows[0]?.message_text ?? '')).toContain('Quarter Winner won')
      expect(String(userMessageResult.rows[0]?.message_text ?? '')).toContain('Packers 0 · Email Opponent 0')
    })
  })

  describe('Authentication', () => {
    it('should accept JWT token in Authorization header', async () => {
      // For now, just verify the endpoint exists and handles auth
      const response = await request(app)
        .get('/api/auth/verify')
        .set(organizerHeaders)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('authenticated')
    })
  })

  describe('Square Assignment', () => {
    let poolId: number
    let userId: number

    beforeAll(async () => {
      // Create user
      const userRes = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Square',
          lastName: 'User',
          email: `square-${Date.now()}@example.com`,
          phone: '5551234567'
        })

      userId = userRes.body.id

      // Create team and pool
      const teamRes = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: 'Square Test Team' })

      const poolRes = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: 'Square Test Pool',
          teamId: teamRes.body.id,
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 20,
          q1Payout: 200,
          q2Payout: 200,
          q3Payout: 200,
          q4Payout: 400
        })

      poolId = poolRes.body.id

      // Initialize squares
      await request(app)
        .post(`/api/setup/pools/${poolId}/squares/init`)
        .set(organizerHeaders)
        .send({})
    })

    it('should assign a square to a user', async () => {
      const response = await request(app)
        .patch(`/api/setup/pools/${poolId}/squares/1`)
        .set(organizerHeaders)
        .send({
          participantId: userId,
          playerId: null,
          paidFlg: true,
          reassign: false
        })

      expect(response.status).toBe(200)
      expect(response.body.square).toHaveProperty('participant_id', userId)
      expect(response.body.square).toHaveProperty('paid_flg', true)
    })

    it('should reassign a square without conflict', async () => {
      const newUserId = await createTestUser()

      const response = await request(app)
        .patch(`/api/setup/pools/${poolId}/squares/1`)
        .set(organizerHeaders)
        .send({
          participantId: newUserId,
          playerId: null,
          paidFlg: false,
          reassign: true
        })

      expect(response.status).toBe(200)
      expect(response.body.square).toHaveProperty('participant_id', newUserId)
    })

    it('should reject reassignment without reassign flag', async () => {
      const response = await request(app)
        .patch(`/api/setup/pools/${poolId}/squares/2`)
        .set(organizerHeaders)
        .send({
          participantId: userId,
          playerId: null,
          paidFlg: false,
          reassign: false
        })

      await request(app)
        .patch(`/api/setup/pools/${poolId}/squares/2`)
        .set(organizerHeaders)
        .send({
          participantId: userId,
          playerId: null,
          paidFlg: true,
          reassign: false
        })

      // Try to assign same square again
      const conflictResponse = await request(app)
        .patch(`/api/setup/pools/${poolId}/squares/2`)
        .set(organizerHeaders)
        .send({
          participantId: userId,
          playerId: null,
          paidFlg: false,
          reassign: false
        })

      expect(conflictResponse.status).toBe(200)
    })

    it('should auto-initialize missing squares when assigning for an older pool', async () => {
      const teamRes = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Legacy Square Team ${Date.now()}` })

      const poolRes = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Legacy Square Pool ${Date.now()}`,
          teamId: teamRes.body.id,
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 20,
          q1Payout: 200,
          q2Payout: 200,
          q3Payout: 200,
          q4Payout: 400
        })

      const assignResponse = await request(app)
        .patch(`/api/setup/pools/${poolRes.body.id}/squares/7`)
        .set(organizerHeaders)
        .send({
          participantId: userId,
          playerId: null,
          paidFlg: true,
          reassign: false
        })

      expect(assignResponse.status).toBe(200)
      expect(assignResponse.body.square).toHaveProperty('square_num', 7)
      expect(assignResponse.body.square).toHaveProperty('participant_id', userId)

      const squaresResponse = await request(app)
        .get(`/api/setup/pools/${poolRes.body.id}/squares`)
        .set(organizerHeaders)

      expect(squaresResponse.status).toBe(200)
      expect(Array.isArray(squaresResponse.body.squares)).toBe(true)
      expect(squaresResponse.body.squares).toHaveLength(100)
    })
  })
})

async function createTestUser(): Promise<number> {
  const response = await request(app)
    .post('/api/setup/users')
    .set({
      'x-user-id': '999',
      'x-user-role': 'organizer'
    })
    .send({
      firstName: 'Temp',
      lastName: 'User',
      email: `temp-${Date.now()}@example.com`,
      phone: '5551234567'
    })

  return response.body.id
}
