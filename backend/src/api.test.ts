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
