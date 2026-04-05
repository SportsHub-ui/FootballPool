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

      expect(response.status).toBe(200)
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

    it('should list users', async () => {
      const response = await request(app)
        .get('/api/setup/users')
        .set(organizerHeaders)

      expect(response.status).toBe(200)
      expect(Array.isArray(response.body)).toBe(true)
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

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('id')
      createdTeamId = response.body.id
    })
  })

  describe('Setup Endpoints - Pools', () => {
    let createdPoolId: number
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

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('id')
      createdPoolId = response.body.id
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
      expect(Array.isArray(response.body)).toBe(true)
      expect(response.body.length).toBe(100)
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

      expect(conflictResponse.status).toBe(409)
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
  const response = await request(require('../src/app').app)
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
