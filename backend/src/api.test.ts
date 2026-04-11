import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { app } from '../src/app'
import { db } from '../src/config/db'
import { env } from '../src/config/env'
import { flushApiUsageMetricsNow } from '../src/services/apiUsage'

const canSafelyResetTestDatabase = async (): Promise<boolean> => {
  if (env.APP_ENV !== 'test' && process.env.NODE_ENV !== 'test') {
    return false
  }

  const result = await db.query<{ database_name: string }>('SELECT current_database() AS database_name')
  const databaseName = String(result.rows[0]?.database_name ?? '')

  if (/test/i.test(databaseName)) {
    return true
  }

  if (/dev/i.test(databaseName) && process.env.FOOTBALL_POOL_ALLOW_DEV_TEST_RESET === 'true') {
    return true
  }

  if (process.env.FOOTBALL_POOL_DISABLE_TEST_RESET === 'true') {
    return false
  }

  throw new Error(
    `Refusing to reset non-test database "${databaseName}". Set TEST_DATABASE_URL or create backend/.env.test so automated tests use a dedicated *_test database.`
  )
}

const resetTestDatabase = async (): Promise<void> => {
  const client = await db.connect()

  try {
    await client.query('BEGIN')
    await client.query(`
      TRUNCATE TABLE
        football_pool.api_usage_metric,
        football_pool.game_square_numbers,
        football_pool.ingestion_run_log,
        football_pool.notification_log,
        football_pool.notification_template,
        football_pool.organization_access_request,
        football_pool.user_session,
        football_pool.pool_game,
        football_pool.pool_payout_rule,
        football_pool.pool_simulation_state,
        football_pool.square,
        football_pool.uploaded_image,
        football_pool.user_pool,
        football_pool.winnings_ledger,
        football_pool.game,
        football_pool.pool,
        football_pool.member_organization,
        football_pool.organization,
        football_pool.users
      RESTART IDENTITY CASCADE
    `)

    await client.query(`
      DELETE FROM football_pool.sport_team
      WHERE id > 32
    `)

    await client.query(`
      SELECT setval(
        pg_get_serial_sequence('football_pool.sport_team', 'id'),
        COALESCE((SELECT MAX(id) FROM football_pool.sport_team), 1),
        true
      )
    `)

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

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
    const canResetTestDatabase = await canSafelyResetTestDatabase()

    const client = await db.connect()
    client.release()

    await flushApiUsageMetricsNow().catch(() => undefined)

    if (canResetTestDatabase) {
      await resetTestDatabase()
    }
  })

  afterAll(async () => {
    await flushApiUsageMetricsNow().catch(() => undefined)

    try {
      if (await canSafelyResetTestDatabase()) {
        await resetTestDatabase()
      }
    } catch {
      // Ignore cleanup safety failures on shutdown.
    }

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

    it('should return an API usage dashboard summary for organizers', async () => {
      await request(app).get('/api/health')
      await request(app).get('/api/db/smoke')
      await flushApiUsageMetricsNow()

      const response = await request(app)
        .get('/api/db/api-usage?hours=24&limit=10')
        .set(organizerHeaders)

      expect(response.status).toBe(200)
      expect(response.body.status).toBe('ok')
      expect(Number(response.body.summary?.totalRequests ?? 0)).toBeGreaterThan(0)
      expect(Array.isArray(response.body.topRoutes)).toBe(true)
    })
  })

  describe('Setup Endpoints - Users', () => {
    let createdUserId: number

    it('should allow creating the first user before anyone has signed in', async () => {
      const response = await request(app)
        .post('/api/setup/users')
        .send({
          firstName: 'Bootstrap',
          lastName: 'Organizer',
          email: `bootstrap-${Date.now()}@example.com`,
          phone: '5550001111'
        })

      expect(response.status).toBe(201)
      expect(response.body).toHaveProperty('id')
    })

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
          secondaryColor: 'Gold',
          nflTeamAbbr: 'GB' // Use NFL team abbreviation for normalized schema
        })

      expect(response.status).toBe(201)
      expect(response.body).toHaveProperty('id')
      expect(response.body).toHaveProperty('nfl_team_id')
      createdTeamId = response.body.id
    })
  })

  describe('Display advertising settings', () => {
    it('should save organization-scoped ad settings and placement-aware ads', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({
          teamName: `Marketing Org ${Date.now()}`,
          primaryColor: '#123456',
          secondaryColor: '#ffffff'
        })

      expect(teamResponse.status).toBe(201)
      const organizationId = Number(teamResponse.body.id)

      const settingsResponse = await request(app)
        .put(`/api/setup/marketing/display/settings?organizationId=${organizationId}`)
        .set(organizerHeaders)
        .send({
          adsEnabled: true,
          frequencySeconds: 120,
          durationSeconds: 25,
          shrinkPercent: 82,
          sidebarCount: 2,
          bannerCount: 3,
          defaultBannerMessage: 'Thanks to our sponsors',
          hideAdsForOrganization: false
        })

      expect(settingsResponse.status).toBe(200)
      expect(settingsResponse.body.settings.sidebarCount).toBe(2)
      expect(settingsResponse.body.settings.bannerCount).toBe(3)
      expect(settingsResponse.body.settings.defaultBannerMessage).toBe('Thanks to our sponsors')

      const adResponse = await request(app)
        .post('/api/setup/marketing/display/ads')
        .set(organizerHeaders)
        .send({
          title: 'Bottom Banner Sponsor',
          body: 'Now serving game-day specials',
          footer: 'Section 112',
          accentColor: '#ff9900',
          placement: 'banner',
          organizationId,
          activeFlg: true,
          sortOrder: 1
        })

      expect(adResponse.status).toBe(201)
      expect(adResponse.body.ad.placement).toBe('banner')
      expect(adResponse.body.ad.organizationId).toBe(organizationId)
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
          primaryColor: 'Red',
          nflTeamAbbr: 'GB'
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
          // primaryTeam is now derived from teamId/nfl_team_id
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

    it('should show sign-in-required pools to organizer landing sessions', async () => {
      const createResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Organizer Landing ${Date.now()}`,
          teamId,
          season: 2026,
          squareCost: 25,
          q1Payout: 250,
          q2Payout: 250,
          q3Payout: 250,
          q4Payout: 500
        })

      expect(createResponse.status).toBe(201)
      const poolId = Number(createResponse.body.id)

      await db.query(
        `UPDATE football_pool.pool
         SET sign_in_req_flg = TRUE
         WHERE id = $1`,
        [poolId]
      )

      const landingResponse = await request(app)
        .get('/api/landing/pools')
        .set(organizerHeaders)

      expect(landingResponse.status).toBe(200)
      expect(landingResponse.body.signedIn).toBe(true)
      expect(landingResponse.body.pools.some((pool: { id: number }) => pool.id === poolId)).toBe(true)
    })

    it('should persist pool contact notification settings', async () => {
      const createResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Pool Notify ${Date.now()}`,
          teamId,
          season: 2026,
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

    it('should persist pool league selection and filter primary sport teams by league', async () => {
      const sportTeamKey = `test-ncaab-${Date.now()}`
      const sportTeamName = `Test College Hoops ${sportTeamKey}`
      const sportTeamResult = await db.query<{ id: number }>(
        `INSERT INTO football_pool.sport_team (
           name,
           abbreviation,
           sport_code,
           league_code,
           espn_team_id,
           espn_team_uid
         )
         VALUES ($1, $2, 'BASKETBALL', 'NCAAB', $3, $4)
         ON CONFLICT (sport_code, league_code, name)
         DO UPDATE SET abbreviation = EXCLUDED.abbreviation
         RETURNING id`,
        [sportTeamName, 'TCH', `test-${sportTeamKey}`, `test:ncaab:${sportTeamKey}`]
      )
      const sportTeamId = Number(sportTeamResult.rows[0]?.id)

      const sportTeamsResponse = await request(app)
        .get('/api/setup/sport-teams?leagueCode=NCAAB')
        .set(organizerHeaders)

      expect(sportTeamsResponse.status).toBe(200)
      expect(
        sportTeamsResponse.body.sportTeams.some(
          (team: { id: number; league_code: string }) => team.id === sportTeamId && team.league_code === 'NCAAB'
        )
      ).toBe(true)
      expect(
        sportTeamsResponse.body.sportTeams.every((team: { league_code: string }) => team.league_code === 'NCAAB')
      ).toBe(true)

      const poolName = `College Hoops Pool ${Date.now()}`
      const createResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName,
          teamId,
          season: 2026,
          leagueCode: 'NCAAB',
          primarySportTeamId: sportTeamId,
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 200,
          q3Payout: 300,
          q4Payout: 400
        })

      expect(createResponse.status).toBe(201)

      const listResponse = await request(app)
        .get('/api/setup/pools')
        .set(organizerHeaders)

      const createdPool = listResponse.body.pools.find((pool: { pool_name: string }) => pool.pool_name === poolName)
      expect(createdPool?.league_code).toBe('NCAAB')
      expect(createdPool?.sport_code).toBe('BASKETBALL')
      expect(createdPool?.primary_sport_team_id).toBe(sportTeamId)
      expect(createdPool?.primary_team).toBe(sportTeamName)
      expect(createdPool?.q2_payout).toBe(0)
      expect(createdPool?.q3_payout).toBe(0)
    })

    it('should auto-sync missing MLB sport teams when a league list is requested', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input)

        if (url.includes('/sports/baseball/mlb/teams')) {
          return new Response(
            JSON.stringify({
              sports: [
                {
                  leagues: [
                    {
                      teams: [
                        {
                          team: {
                            id: '1',
                            uid: 's:10~l:442~t:1',
                            displayName: 'Chicago Cubs',
                            shortDisplayName: 'Cubs',
                            abbreviation: 'CHC',
                            slug: 'chicago-cubs',
                            color: '0E3386',
                            logos: [{ href: 'https://example.com/cubs.png' }]
                          }
                        },
                        {
                          team: {
                            id: '2',
                            uid: 's:10~l:442~t:2',
                            displayName: 'Los Angeles Dodgers',
                            shortDisplayName: 'Dodgers',
                            abbreviation: 'LAD',
                            slug: 'los-angeles-dodgers',
                            color: '005A9C',
                            logos: [{ href: 'https://example.com/dodgers.png' }]
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        }

        return new Response('Not found', { status: 404 })
      })

      try {
        await db.query(`DELETE FROM football_pool.sport_team WHERE league_code = 'MLB'`)

        const response = await request(app)
          .get('/api/setup/sport-teams?leagueCode=MLB')
          .set(organizerHeaders)

        expect(response.status).toBe(200)
        expect(response.body.sportTeams.length).toBeGreaterThanOrEqual(2)
        expect(
          response.body.sportTeams.some(
            (team: { name: string; league_code: string; sport_code: string }) =>
              team.name === 'Chicago Cubs' && team.league_code === 'MLB' && team.sport_code === 'BASEBALL'
          )
        ).toBe(true)
        expect(
          response.body.sportTeams.some((team: { name: string }) => team.name === 'Los Angeles Dodgers')
        ).toBe(true)
      } finally {
        fetchSpy.mockRestore()
      }
    })

    it('should allow tournament pools without a preferred team and persist winner/loser scoring', async () => {
      const poolName = `Tournament Pool ${Date.now()}`
      const createResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName,
          teamId,
          season: 2026,
          poolType: 'tournament',
          leagueCode: 'NCAAB',
          boardNumberMode: 'same_for_tournament',
          winnerLoserMode: true,
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 200
        })

      expect(createResponse.status).toBe(201)

      const listResponse = await request(app)
        .get('/api/setup/pools')
        .set(organizerHeaders)

      const createdPool = listResponse.body.pools.find((pool: { pool_name: string }) => pool.pool_name === poolName)
      expect(createdPool?.pool_type).toBe('tournament')
      expect(createdPool?.board_number_mode).toBe('same_for_tournament')
      expect(createdPool?.winner_loser_flg).toBe(true)
      expect(createdPool?.primary_sport_team_id ?? null).toBeNull()
      expect(createdPool?.primary_team ?? null).toBeNull()

      const gamesResponse = await request(app)
        .get(`/api/games?poolId=${createResponse.body.id}`)
        .set(organizerHeaders)

      expect(gamesResponse.status).toBe(200)
      expect(gamesResponse.body.some((game: { opponent: string }) => game.opponent === 'Championship Game')).toBe(true)
    })

    it('should persist date windows and template metadata for tournament pools', async () => {
      const poolName = `March Madness Pool ${Date.now()}`
      const createResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName,
          teamId,
          season: 2026,
          poolType: 'tournament',
          leagueCode: 'NCAAB',
          structureMode: 'template',
          templateCode: 'ncaab_march_madness',
          startDate: '2026-03-17',
          endDate: '2026-04-06',
          winnerLoserMode: true,
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 200
        })

      expect(createResponse.status).toBe(201)

      const listResponse = await request(app)
        .get('/api/setup/pools')
        .set(organizerHeaders)

      const createdPool = listResponse.body.pools.find((pool: { pool_name: string }) => pool.pool_name === poolName)
      expect(createdPool?.structure_mode).toBe('template')
      expect(createdPool?.template_code).toBe('ncaab_march_madness')
      expect(createdPool?.start_date).toContain('2026-03-17')
      expect(createdPool?.end_date).toContain('2026-04-06')
    })

    it('should persist round-based tournament payouts and use them for championship winnings', async () => {
      const poolName = `Escalating Tournament Pool ${Date.now()}`
      const createResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName,
          teamId,
          season: 2026,
          poolType: 'tournament',
          leagueCode: 'NCAAB',
          structureMode: 'template',
          templateCode: 'ncaab_march_madness',
          payoutScheduleMode: 'by_round',
          roundPayouts: [
            {
              roundLabel: 'Round of 64',
              roundSequence: 2,
              q1Payout: 0,
              q2Payout: 0,
              q3Payout: 0,
              q4Payout: 10
            },
            {
              roundLabel: 'Championship',
              roundSequence: 7,
              q1Payout: 0,
              q2Payout: 0,
              q3Payout: 0,
              q4Payout: 500
            }
          ],
          winnerLoserMode: true,
          squareCost: 20,
          q1Payout: 0,
          q2Payout: 0,
          q3Payout: 0,
          q4Payout: 25
        })

      expect(createResponse.status).toBe(201)
      const poolId = Number(createResponse.body.id)

      const listResponse = await request(app)
        .get('/api/setup/pools')
        .set(organizerHeaders)

      const createdPool = listResponse.body.pools.find((pool: { pool_name: string }) => pool.pool_name === poolName)
      expect(createdPool?.payout_schedule_mode).toBe('by_round')
      expect(Array.isArray(createdPool?.round_payouts)).toBe(true)
      const championshipRule = createdPool?.round_payouts?.find(
        (rule: { roundSequence?: number; roundLabel?: string; q4Payout?: number }) =>
          Number(rule.roundSequence ?? 0) === 7 || rule.roundLabel === 'Championship'
      )
      expect(championshipRule?.q4Payout).toBe(500)

      const participantResponse = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Bracket',
          lastName: 'Winner',
          email: `bracket-winner-${Date.now()}@example.com`,
          phone: '5552221111'
        })

      expect(participantResponse.status).toBe(201)
      const participantId = Number(participantResponse.body.id)

      const assignResponse = await request(app)
        .patch(`/api/setup/pools/${poolId}/squares/49`)
        .set(organizerHeaders)
        .send({ participantId, playerId: null, paidFlg: true })

      expect(assignResponse.status).toBe(200)

      const gameResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 7,
          roundLabel: 'Championship',
          roundSequence: 7,
          matchupOrder: 1,
          opponent: 'Title Game',
          gameDate: '2026-04-07'
        })

      expect(gameResponse.status).toBe(200)
      const gameId = Number(gameResponse.body.game.id)

      const scoreResponse = await request(app)
        .patch(`/api/games/${gameId}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: null,
          q1OpponentScore: null,
          q2PrimaryScore: null,
          q2OpponentScore: null,
          q3PrimaryScore: null,
          q3OpponentScore: null,
          q4PrimaryScore: 78,
          q4OpponentScore: 74
        })

      expect(scoreResponse.status).toBe(200)

      const winningsResponse = await request(app)
        .get(`/api/winnings/pool/${poolId}`)
        .set(organizerHeaders)

      expect(winningsResponse.status).toBe(200)
      const championshipWinning = winningsResponse.body.find(
        (entry: { game_id: number; amount_won: number }) => Number(entry.game_id) === gameId
      )
      expect(championshipWinning?.amount_won).toBe(500)

      const boardResponse = await request(app)
        .get(`/api/landing/pools/${poolId}/board?gameId=${gameId}`)
        .set(organizerHeaders)

      expect(boardResponse.status).toBe(200)
      expect(boardResponse.body.board?.payoutSummary?.payoutScheduleMode).toBe('by_round')
      expect(boardResponse.body.board?.payoutSummary?.activePayouts?.q4Payout).toBe(500)
      expect(boardResponse.body.board?.payoutSummary?.currentRoundLabel).toBe('Championship')
    })

    it('should preload the full bracket scaffold for NCAAB tournament templates', async () => {
      const poolName = `Bracket Scaffold Pool ${Date.now()}`
      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName,
          teamId,
          season: 2026,
          poolType: 'tournament',
          leagueCode: 'NCAAB',
          structureMode: 'template',
          templateCode: 'ncaab_march_madness',
          startDate: '2026-03-17',
          endDate: '2026-04-06',
          winnerLoserMode: true,
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 200
        })

      expect(poolResponse.status).toBe(201)

      const gamesResponse = await request(app)
        .get(`/api/games?poolId=${poolResponse.body.id}`)
        .set(organizerHeaders)

      expect(gamesResponse.status).toBe(200)
      expect(gamesResponse.body.length).toBeGreaterThanOrEqual(67)
      expect(gamesResponse.body.some((game: { round_label: string }) => game.round_label === 'Round of 64')).toBe(true)
      expect(gamesResponse.body.some((game: { round_label: string }) => game.round_label === 'Sweet 16')).toBe(true)
      expect(gamesResponse.body.some((game: { championship_flg: boolean }) => game.championship_flg)).toBe(true)
      expect(
        gamesResponse.body.some(
          (game: { round_label: string; opponent: string }) =>
            game.round_label === 'Sweet 16' && String(game.opponent).includes('Winner of')
        )
      ).toBe(true)
    })

    it('should seed the next bracket game once both feeder games are completed', async () => {
      const poolName = `Bracket Progression Pool ${Date.now()}`
      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName,
          teamId,
          season: 2026,
          poolType: 'tournament',
          leagueCode: 'NCAAB',
          structureMode: 'template',
          templateCode: 'ncaab_march_madness',
          startDate: '2026-03-17',
          endDate: '2026-04-06',
          winnerLoserMode: false,
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 200
        })

      expect(poolResponse.status).toBe(201)
      const poolId = Number(poolResponse.body.id)

      const initialGamesResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      expect(initialGamesResponse.status).toBe(200)

      const feederOne = initialGamesResponse.body.find(
        (game: { round_label: string; bracket_region: string; matchup_order: number }) =>
          game.round_label === 'Round of 64' && game.bracket_region === 'East' && Number(game.matchup_order) === 1
      )
      const feederTwo = initialGamesResponse.body.find(
        (game: { round_label: string; bracket_region: string; matchup_order: number }) =>
          game.round_label === 'Round of 64' && game.bracket_region === 'East' && Number(game.matchup_order) === 2
      )
      const nextRoundGame = initialGamesResponse.body.find(
        (game: { round_label: string; bracket_region: string; matchup_order: number }) =>
          game.round_label === 'Round of 32' && game.bracket_region === 'East' && Number(game.matchup_order) === 1
      )

      expect(feederOne).toBeTruthy()
      expect(feederTwo).toBeTruthy()
      expect(nextRoundGame).toBeTruthy()
      expect(nextRoundGame?.row_numbers).toBeNull()
      expect(nextRoundGame?.col_numbers).toBeNull()

      const firstGameDate = String(feederOne?.game_dt ?? '2026-03-19').slice(0, 10)
      const secondGameDate = String(feederTwo?.game_dt ?? '2026-03-19').slice(0, 10)

      const feederOneUpdateResponse = await request(app)
        .patch(`/api/games/${Number(feederOne?.id)}`)
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: Number(feederOne?.week_num ?? 2),
          roundLabel: feederOne?.round_label,
          roundSequence: Number(feederOne?.round_sequence ?? 2),
          bracketRegion: feederOne?.bracket_region,
          matchupOrder: Number(feederOne?.matchup_order ?? 1),
          opponent: 'Duke vs Houston',
          gameDate: firstGameDate,
          isSimulation: false
        })

      const feederTwoUpdateResponse = await request(app)
        .patch(`/api/games/${Number(feederTwo?.id)}`)
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: Number(feederTwo?.week_num ?? 2),
          roundLabel: feederTwo?.round_label,
          roundSequence: Number(feederTwo?.round_sequence ?? 2),
          bracketRegion: feederTwo?.bracket_region,
          matchupOrder: Number(feederTwo?.matchup_order ?? 2),
          opponent: 'Kansas vs Purdue',
          gameDate: secondGameDate,
          isSimulation: false
        })

      expect(feederOneUpdateResponse.status).toBe(200)
      expect(feederTwoUpdateResponse.status).toBe(200)
      expect(feederOneUpdateResponse.body.game.opponent).toBe('Duke vs Houston')
      expect(feederTwoUpdateResponse.body.game.opponent).toBe('Kansas vs Purdue')

      const firstScoreResponse = await request(app)
        .patch(`/api/games/${Number(feederOne?.id)}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: null,
          q1OpponentScore: null,
          q2PrimaryScore: null,
          q2OpponentScore: null,
          q3PrimaryScore: null,
          q3OpponentScore: null,
          q4PrimaryScore: 80,
          q4OpponentScore: 70
        })

      expect(firstScoreResponse.status).toBe(200)

      const afterFirstFeederResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      const pendingNextRoundGame = afterFirstFeederResponse.body.find(
        (game: { round_label: string; bracket_region: string; matchup_order: number }) =>
          game.round_label === 'Round of 32' && game.bracket_region === 'East' && Number(game.matchup_order) === 1
      )

      expect(pendingNextRoundGame?.row_numbers).toBeNull()
      expect(pendingNextRoundGame?.col_numbers).toBeNull()
      expect(String(pendingNextRoundGame?.opponent)).toContain('Winner of')

      const secondScoreResponse = await request(app)
        .patch(`/api/games/${Number(feederTwo?.id)}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: null,
          q1OpponentScore: null,
          q2PrimaryScore: null,
          q2OpponentScore: null,
          q3PrimaryScore: null,
          q3OpponentScore: null,
          q4PrimaryScore: 68,
          q4OpponentScore: 72
        })

      expect(secondScoreResponse.status).toBe(200)

      const completedBracketResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      const resolvedNextRoundGame = completedBracketResponse.body.find(
        (game: { round_label: string; bracket_region: string; matchup_order: number }) =>
          game.round_label === 'Round of 32' && game.bracket_region === 'East' && Number(game.matchup_order) === 1
      )

      expect(Array.isArray(resolvedNextRoundGame?.row_numbers)).toBe(true)
      expect(resolvedNextRoundGame?.row_numbers?.length).toBe(10)
      expect(Array.isArray(resolvedNextRoundGame?.col_numbers)).toBe(true)
      expect(resolvedNextRoundGame?.col_numbers?.length).toBe(10)
      expect(resolvedNextRoundGame?.opponent).toBe('Duke vs Purdue')

      const boardResponse = await request(app)
        .get(`/api/landing/pools/${poolId}/board?gameId=${Number(nextRoundGame?.id)}`)
        .set(organizerHeaders)

      expect(boardResponse.status).toBe(200)
      expect(Array.isArray(boardResponse.body.board?.rowNumbers)).toBe(true)
      expect(Array.isArray(boardResponse.body.board?.colNumbers)).toBe(true)
    })

    it('should keep the same board numbers across tournament games when configured', async () => {
      const poolName = `Fixed Tournament Board Pool ${Date.now()}`
      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName,
          teamId,
          season: 2026,
          poolType: 'tournament',
          leagueCode: 'NCAAB',
          structureMode: 'template',
          templateCode: 'ncaab_march_madness',
          boardNumberMode: 'same_for_tournament',
          startDate: '2026-03-17',
          endDate: '2026-04-06',
          winnerLoserMode: true,
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 200
        })

      expect(poolResponse.status).toBe(201)
      const poolId = Number(poolResponse.body.id)
      const matchupSeed = Date.now()
      const feederOneLabel = `Board Alpha ${matchupSeed} vs Board Beta ${matchupSeed}`
      const feederTwoLabel = `Board Gamma ${matchupSeed} vs Board Delta ${matchupSeed}`

      const initialGamesResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      expect(initialGamesResponse.status).toBe(200)

      const feederOne = initialGamesResponse.body.find(
        (game: { round_label: string; bracket_region: string; matchup_order: number }) =>
          game.round_label === 'Round of 64' && game.bracket_region === 'East' && Number(game.matchup_order) === 1
      )
      const feederTwo = initialGamesResponse.body.find(
        (game: { round_label: string; bracket_region: string; matchup_order: number }) =>
          game.round_label === 'Round of 64' && game.bracket_region === 'East' && Number(game.matchup_order) === 2
      )

      expect(feederOne).toBeTruthy()
      expect(feederTwo).toBeTruthy()

      const feederOneUpdateResponse = await request(app)
        .patch(`/api/games/${Number(feederOne?.id)}`)
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: Number(feederOne?.week_num ?? 2),
          roundLabel: feederOne?.round_label,
          roundSequence: Number(feederOne?.round_sequence ?? 2),
          bracketRegion: feederOne?.bracket_region,
          matchupOrder: Number(feederOne?.matchup_order ?? 1),
          opponent: feederOneLabel,
          gameDate: String(feederOne?.game_dt ?? '2026-03-19').slice(0, 10),
          isSimulation: false
        })

      const feederTwoUpdateResponse = await request(app)
        .patch(`/api/games/${Number(feederTwo?.id)}`)
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: Number(feederTwo?.week_num ?? 2),
          roundLabel: feederTwo?.round_label,
          roundSequence: Number(feederTwo?.round_sequence ?? 2),
          bracketRegion: feederTwo?.bracket_region,
          matchupOrder: Number(feederTwo?.matchup_order ?? 2),
          opponent: feederTwoLabel,
          gameDate: String(feederTwo?.game_dt ?? '2026-03-19').slice(0, 10),
          isSimulation: false
        })

      expect(feederOneUpdateResponse.status).toBe(200)
      expect(feederTwoUpdateResponse.status).toBe(200)
      expect(feederOneUpdateResponse.body.game.row_numbers).toEqual(feederTwoUpdateResponse.body.game.row_numbers)
      expect(feederOneUpdateResponse.body.game.col_numbers).toEqual(feederTwoUpdateResponse.body.game.col_numbers)

      const firstScoreResponse = await request(app)
        .patch(`/api/games/${Number(feederOne?.id)}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: null,
          q1OpponentScore: null,
          q2PrimaryScore: null,
          q2OpponentScore: null,
          q3PrimaryScore: null,
          q3OpponentScore: null,
          q4PrimaryScore: 81,
          q4OpponentScore: 70
        })

      const secondScoreResponse = await request(app)
        .patch(`/api/games/${Number(feederTwo?.id)}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: null,
          q1OpponentScore: null,
          q2PrimaryScore: null,
          q2OpponentScore: null,
          q3PrimaryScore: null,
          q3OpponentScore: null,
          q4PrimaryScore: 69,
          q4OpponentScore: 74
        })

      expect(firstScoreResponse.status).toBe(200)
      expect(secondScoreResponse.status).toBe(200)

      const completedGamesResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      const resolvedNextRoundGame = completedGamesResponse.body.find(
        (game: { round_label: string; bracket_region: string; matchup_order: number }) =>
          game.round_label === 'Round of 32' && game.bracket_region === 'East' && Number(game.matchup_order) === 1
      )

      expect(resolvedNextRoundGame?.row_numbers).toEqual(feederOneUpdateResponse.body.game.row_numbers)
      expect(resolvedNextRoundGame?.col_numbers).toEqual(feederOneUpdateResponse.body.game.col_numbers)
    })

    it('should persist round metadata for tournament schedules', async () => {
      const poolName = `Bracket Pool ${Date.now()}`
      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName,
          teamId,
          season: 2026,
          poolType: 'tournament',
          leagueCode: 'NCAAB',
          structureMode: 'template',
          templateCode: 'ncaab_march_madness',
          startDate: '2026-03-17',
          endDate: '2026-04-06',
          winnerLoserMode: true,
          squareCost: 20,
          q1Payout: 100,
          q2Payout: 100,
          q3Payout: 100,
          q4Payout: 200
        })

      expect(poolResponse.status).toBe(201)
      const poolId = Number(poolResponse.body.id)

      const gameResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 4,
          roundLabel: 'Sweet 16',
          roundSequence: 4,
          bracketRegion: 'Midwest',
          matchupOrder: 2,
          opponent: 'Duke vs Houston',
          gameDate: '2026-03-27'
        })

      expect(gameResponse.status).toBe(200)
      expect(gameResponse.body.game.round_label).toBe('Sweet 16')
      expect(gameResponse.body.game.round_sequence).toBe(4)
      expect(gameResponse.body.game.bracket_region).toBe('Midwest')
      expect(gameResponse.body.game.matchup_order).toBe(2)
      expect(gameResponse.body.game.championship_flg).toBe(false)

      const gamesResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      expect(gamesResponse.status).toBe(200)
      const seededRoundGame = gamesResponse.body.find(
        (game: { round_label: string; bracket_region: string; opponent: string }) =>
          game.round_label === 'Sweet 16' && game.opponent === 'Duke vs Houston'
      )
      expect(seededRoundGame?.bracket_region).toBe('Midwest')
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

    it('should delete a pool even when games and squares already exist', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({
          teamName: `Delete Pool Team ${Date.now()}`,
          nflTeamAbbr: 'ARI'
        })

      expect(teamResponse.status).toBe(201)
      const deleteTeamId = Number(teamResponse.body.id)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Delete Pool ${Date.now()}`,
          teamId: deleteTeamId,
          season: 2026,
          primaryTeam: 'Arizona Cardinals',
          squareCost: 25,
          q1Payout: 250,
          q2Payout: 250,
          q3Payout: 250,
          q4Payout: 500
        })

      expect(poolResponse.status).toBe(201)
      const deletePoolId = Number(poolResponse.body.id)

      const initSquaresResponse = await request(app)
        .post(`/api/setup/pools/${deletePoolId}/squares/init`)
        .set(organizerHeaders)
        .send({})

      expect(initSquaresResponse.status).toBe(200)

      const createGameResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId: deletePoolId,
          weekNum: 1,
          opponentNflTeamAbbr: 'SEA',
          gameDate: '2026-09-10T18:00:00.000Z'
        })

      expect(createGameResponse.status).toBe(200)

      const deleteResponse = await request(app)
        .delete(`/api/setup/pools/${deletePoolId}`)
        .set(organizerHeaders)

      expect(deleteResponse.status).toBe(200)

      const listResponse = await request(app)
        .get('/api/setup/pools')
        .set(organizerHeaders)

      expect(listResponse.status).toBe(200)
      expect(listResponse.body.pools.some((pool: { id: number }) => pool.id === deletePoolId)).toBe(false)
    })

    it('should open a display link on the current active game for the pool', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-17T18:05:00.000Z'))

      try {
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
            opponentNflTeamAbbr: 'CHI',
            gameDate: '2026-09-10T18:00:00.000Z'
          })

        const weekTwoResponse = await request(app)
          .post('/api/games')
          .set(organizerHeaders)
          .send({
            poolId: displayPoolId,
            weekNum: 2,
            opponentNflTeamAbbr: 'DET',
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

        // No direct update to any legacy game table; use pool_game / normalized game setup as needed.

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
      } finally {
        vi.useRealTimers()
      }
    })

    it('should rotate the display link between the last completed game and the next scheduled game until the next game starts', async () => {
      vi.useFakeTimers()

      try {
        const poolResponse = await request(app)
          .post('/api/setup/pools')
          .set(organizerHeaders)
          .send({
            poolName: `Rotating Display Pool ${Date.now()}`,
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
        const displayPoolToken = String(poolResponse.body.displayToken)
        const displayPoolId = Number(poolResponse.body.id)

        const weekOneResponse = await request(app)
          .post('/api/games')
          .set(organizerHeaders)
          .send({
            poolId: displayPoolId,
            weekNum: 1,
            opponentNflTeamAbbr: 'CHI',
            gameDate: '2026-09-10T18:00:00.000Z'
          })

        const weekTwoResponse = await request(app)
          .post('/api/games')
          .set(organizerHeaders)
          .send({
            poolId: displayPoolId,
            weekNum: 2,
            opponentNflTeamAbbr: 'DET',
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

        expect(completedScoreResponse.status).toBe(200)

        vi.setSystemTime(new Date('2026-09-11T12:00:00.000Z'))
        const firstDisplayResponse = await request(app).get(`/api/landing/display/${displayPoolToken}`)

        vi.setSystemTime(new Date('2026-09-11T12:00:16.000Z'))
        const secondDisplayResponse = await request(app).get(`/api/landing/display/${displayPoolToken}`)

        expect(firstDisplayResponse.status).toBe(200)
        expect(secondDisplayResponse.status).toBe(200)
        expect([weekOneGameId, weekTwoGameId]).toContain(firstDisplayResponse.body.selectedGameId)
        expect([weekOneGameId, weekTwoGameId]).toContain(secondDisplayResponse.body.selectedGameId)
        expect(new Set([firstDisplayResponse.body.selectedGameId, secondDisplayResponse.body.selectedGameId])).toEqual(
          new Set([weekOneGameId, weekTwoGameId])
        )

        vi.setSystemTime(new Date('2026-09-17T18:05:00.000Z'))
        const startedGameResponse = await request(app).get(`/api/landing/display/${displayPoolToken}`)

        expect(startedGameResponse.status).toBe(200)
        expect(startedGameResponse.body.selectedGameId).toBe(weekTwoGameId)
        expect(startedGameResponse.body.board?.gameId).toBe(weekTwoGameId)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should ignore an older past scheduled game and rotate from the latest completed game to the next upcoming game', async () => {
      vi.useFakeTimers()

      try {
        const poolResponse = await request(app)
          .post('/api/setup/pools')
          .set(organizerHeaders)
          .send({
            poolName: `Past Scheduled Rotation ${Date.now()}`,
            teamId,
            season: 2026,
            poolType: 'single_game',
            leagueCode: 'MLB',
            primaryTeam: 'Milwaukee Brewers',
            squareCost: 25,
            q1Payout: 10,
            q2Payout: 10,
            q3Payout: 10,
            q4Payout: 10,
            q5Payout: 10,
            q6Payout: 10,
            q7Payout: 10,
            q8Payout: 10,
            q9Payout: 20
          })

        expect(poolResponse.status).toBe(201)
        const displayPoolToken = String(poolResponse.body.displayToken)
        const poolId = Number(poolResponse.body.id)

        const stalePastResponse = await request(app)
          .post('/api/games')
          .set(organizerHeaders)
          .send({
            poolId,
            weekNum: 1,
            opponent: 'St. Louis Cardinals',
            gameDate: '2026-04-03T18:00:00.000Z'
          })

        const completedResponse = await request(app)
          .post('/api/games')
          .set(organizerHeaders)
          .send({
            poolId,
            weekNum: 2,
            opponent: 'Washington Nationals',
            gameDate: '2026-04-10T18:00:00.000Z'
          })

        const upcomingResponse = await request(app)
          .post('/api/games')
          .set(organizerHeaders)
          .send({
            poolId,
            weekNum: 3,
            opponent: 'Chicago Cubs',
            gameDate: '2026-04-11T18:00:00.000Z'
          })

        expect(stalePastResponse.status).toBe(200)
        expect(completedResponse.status).toBe(200)
        expect(upcomingResponse.status).toBe(200)

        const stalePastGameId = Number(stalePastResponse.body.game.id)
        const completedGameId = Number(completedResponse.body.game.id)
        const upcomingGameId = Number(upcomingResponse.body.game.id)

        const completedScoreResponse = await request(app)
          .patch(`/api/games/${completedGameId}/scores`)
          .set(organizerHeaders)
          .send({
            q1PrimaryScore: 1,
            q1OpponentScore: 0,
            q2PrimaryScore: 1,
            q2OpponentScore: 0,
            q3PrimaryScore: 2,
            q3OpponentScore: 1,
            q4PrimaryScore: 3,
            q4OpponentScore: 2,
            q5PrimaryScore: 3,
            q5OpponentScore: 2,
            q6PrimaryScore: 3,
            q6OpponentScore: 2,
            q7PrimaryScore: 3,
            q7OpponentScore: 2,
            q8PrimaryScore: 3,
            q8OpponentScore: 2,
            q9PrimaryScore: 3,
            q9OpponentScore: 2
          })

        expect(completedScoreResponse.status).toBe(200)

        await db.query(
          `UPDATE football_pool.game
           SET state = 'completed',
               current_quarter = 9
           WHERE id = $1`,
          [completedGameId]
        )

        vi.setSystemTime(new Date('2026-04-10T23:00:00.000Z'))
        const displayResponse = await request(app).get(`/api/landing/display/${displayPoolToken}`)

        expect(displayResponse.status).toBe(200)
        expect(displayResponse.body.selectedGameId).not.toBe(stalePastGameId)
        expect([completedGameId, upcomingGameId]).toContain(displayResponse.body.selectedGameId)
      } finally {
        vi.useRealTimers()
      }
    })

    it('should keep the display link on the live MLB game instead of jumping to tomorrow', async () => {
      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Live MLB Display ${Date.now()}`,
          teamId,
          season: 2026,
          poolType: 'single_game',
          leagueCode: 'MLB',
          primaryTeam: 'Milwaukee Brewers',
          squareCost: 25,
          q1Payout: 10,
          q2Payout: 10,
          q3Payout: 10,
          q4Payout: 10,
          q5Payout: 10,
          q6Payout: 10,
          q7Payout: 10,
          q8Payout: 10,
          q9Payout: 20
        })

      expect(poolResponse.status).toBe(201)
      const displayPoolId = Number(poolResponse.body.id)
      const displayPoolToken = String(poolResponse.body.displayToken)

      const todayResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId: displayPoolId,
          weekNum: 1,
          opponent: 'Washington Nationals',
          gameDate: '2026-04-10T18:00:00.000Z'
        })

      const tomorrowResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId: displayPoolId,
          weekNum: 2,
          opponent: 'Washington Nationals',
          gameDate: '2026-04-11T18:00:00.000Z'
        })

      expect(todayResponse.status).toBe(200)
      expect(tomorrowResponse.status).toBe(200)

      const todayGameId = Number(todayResponse.body.game.id)
      const tomorrowGameId = Number(tomorrowResponse.body.game.id)

      const inProgressScoreResponse = await request(app)
        .patch(`/api/games/${todayGameId}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: 1,
          q1OpponentScore: 0,
          q2PrimaryScore: 1,
          q2OpponentScore: 0,
          q3PrimaryScore: 2,
          q3OpponentScore: 0,
          q4PrimaryScore: 3,
          q4OpponentScore: 2,
          q5PrimaryScore: null,
          q5OpponentScore: null,
          q6PrimaryScore: null,
          q6OpponentScore: null,
          q7PrimaryScore: null,
          q7OpponentScore: null,
          q8PrimaryScore: null,
          q8OpponentScore: null,
          q9PrimaryScore: null,
          q9OpponentScore: null
        })

      expect(inProgressScoreResponse.status).toBe(200)

      await db.query(
        `UPDATE football_pool.game
         SET state = 'in_progress',
             current_quarter = 6
         WHERE id = $1`,
        [todayGameId]
      )

      const displayResponse = await request(app).get(`/api/landing/display/${displayPoolToken}`)

      expect(displayResponse.status).toBe(200)
      expect(displayResponse.body.pool?.id).toBe(displayPoolId)
      expect(displayResponse.body.selectedGameId).toBe(todayGameId)
      expect(displayResponse.body.selectedGameId).not.toBe(tomorrowGameId)
      expect(displayResponse.body.games.find((game: { id: number; current_quarter: number | null }) => game.id === todayGameId)?.current_quarter).toBe(6)
      expect(displayResponse.body.board?.poolId).toBe(displayPoolId)
      expect(displayResponse.body.board?.gameId).toBe(todayGameId)

      const previousLeaderSquare = displayResponse.body.board?.squares.find((square: { is_current_score_leader?: boolean }) => square.is_current_score_leader)?.square_num ?? null

      const topOfInningResponse = await request(app)
        .patch(`/api/games/${todayGameId}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: 1,
          q1OpponentScore: 0,
          q2PrimaryScore: 1,
          q2OpponentScore: 0,
          q3PrimaryScore: 2,
          q3OpponentScore: 0,
          q4PrimaryScore: 3,
          q4OpponentScore: 2,
          q5PrimaryScore: null,
          q5OpponentScore: null,
          q6PrimaryScore: null,
          q6OpponentScore: null,
          q7PrimaryScore: null,
          q7OpponentScore: 3,
          q8PrimaryScore: null,
          q8OpponentScore: null,
          q9PrimaryScore: null,
          q9OpponentScore: null
        })

      expect(topOfInningResponse.status).toBe(200)

      await db.query(
        `UPDATE football_pool.game
         SET state = 'in_progress',
             current_quarter = 7
         WHERE id = $1`,
        [todayGameId]
      )

      const topOfInningDisplayResponse = await request(app).get(`/api/landing/display/${displayPoolToken}`)
      const liveGame = topOfInningDisplayResponse.body.games.find((game: { id: number; current_quarter: number | null }) => game.id === todayGameId)
      const liveLeaderSquare = topOfInningDisplayResponse.body.board?.squares.find((square: { is_current_score_leader?: boolean }) => square.is_current_score_leader)?.square_num ?? null

      expect(topOfInningDisplayResponse.status).toBe(200)
      expect(liveGame?.current_quarter).toBe(7)
      expect(liveLeaderSquare).not.toBeNull()
      expect(liveLeaderSquare).not.toBe(previousLeaderSquare)
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
      expect(Array.isArray(response.body.game.row_numbers)).toBe(true)
      expect(response.body.game.row_numbers).toHaveLength(10)
      expect(Array.isArray(response.body.game.col_numbers)).toBe(true)
      expect(response.body.game.col_numbers).toHaveLength(10)
      gameId = response.body.game.id
    })

    it('should populate board numbers when Fill Schedule imports an MLB season pool', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input)

        if (url.includes('/teams/1/schedule?season=2026&seasontype=2')) {
          return new Response(
            JSON.stringify({
              events: [
                {
                  id: '401700001',
                  uid: 's:10~l:442~e:401700001',
                  date: '2026-04-01T18:20:00Z',
                  competitions: [
                    {
                      id: '401700001',
                      date: '2026-04-01T18:20:00Z',
                      competitors: [
                        {
                          team: {
                            id: '1',
                            uid: 's:10~l:442~t:1',
                            displayName: 'Chicago Cubs',
                            shortDisplayName: 'Cubs',
                            abbreviation: 'CHC',
                            slug: 'chicago-cubs'
                          }
                        },
                        {
                          team: {
                            id: '2',
                            uid: 's:10~l:442~t:2',
                            displayName: 'St. Louis Cardinals',
                            shortDisplayName: 'Cardinals',
                            abbreviation: 'STL',
                            slug: 'st-louis-cardinals'
                          }
                        }
                      ]
                    }
                  ]
                },
                {
                  id: '401700002',
                  uid: 's:10~l:442~e:401700002',
                  date: '2026-04-03T18:20:00Z',
                  competitions: [
                    {
                      id: '401700002',
                      date: '2026-04-03T18:20:00Z',
                      competitors: [
                        {
                          team: {
                            id: '1',
                            uid: 's:10~l:442~t:1',
                            displayName: 'Chicago Cubs',
                            shortDisplayName: 'Cubs',
                            abbreviation: 'CHC',
                            slug: 'chicago-cubs'
                          }
                        },
                        {
                          team: {
                            id: '3',
                            uid: 's:10~l:442~t:3',
                            displayName: 'Milwaukee Brewers',
                            shortDisplayName: 'Brewers',
                            abbreviation: 'MIL',
                            slug: 'milwaukee-brewers'
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        }

        if (url.includes('/sports/baseball/mlb/teams')) {
          return new Response(
            JSON.stringify({
              sports: [
                {
                  leagues: [
                    {
                      teams: [
                        {
                          team: {
                            id: '1',
                            uid: 's:10~l:442~t:1',
                            displayName: 'Chicago Cubs',
                            shortDisplayName: 'Cubs',
                            abbreviation: 'CHC',
                            slug: 'chicago-cubs',
                            color: '0E3386',
                            logos: [{ href: 'https://example.com/cubs.png' }]
                          }
                        },
                        {
                          team: {
                            id: '2',
                            uid: 's:10~l:442~t:2',
                            displayName: 'St. Louis Cardinals',
                            shortDisplayName: 'Cardinals',
                            abbreviation: 'STL',
                            slug: 'st-louis-cardinals',
                            color: 'C41E3A',
                            logos: [{ href: 'https://example.com/cardinals.png' }]
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        }

        return new Response('Not found', { status: 404 })
      })

      try {
        const teamResponse = await request(app)
          .post('/api/setup/teams')
          .set(organizerHeaders)
          .send({ teamName: `MLB Import Team ${Date.now()}` })

        expect(teamResponse.status).toBe(201)

        const poolResponse = await request(app)
          .post('/api/setup/pools')
          .set(organizerHeaders)
          .send({
            poolName: `MLB Import Pool ${Date.now()}`,
            teamId: teamResponse.body.id,
            season: 2026,
            leagueCode: 'MLB',
            primaryTeam: 'Chicago Cubs',
            squareCost: 20,
            q1Payout: 100,
            q2Payout: 100,
            q3Payout: 100,
            q4Payout: 100
          })

        expect(poolResponse.status).toBe(201)
        const importedPoolId = Number(poolResponse.body.id)

        const importResponse = await request(app)
          .post(`/api/games/import/pool/${importedPoolId}`)
          .set(organizerHeaders)

        expect(importResponse.status).toBe(200)

        const importedGamesResult = await db.query<{
          row_numbers: unknown;
          column_numbers: unknown;
          game_date: string;
          kickoff_at: string | null;
        }>(
          `SELECT pg.row_numbers,
                  pg.column_numbers,
                  g.game_date::text AS game_date,
                  g.kickoff_at::text AS kickoff_at
           FROM football_pool.pool_game pg
           JOIN football_pool.game g ON g.id = pg.game_id
           WHERE pg.pool_id = $1
           ORDER BY pg.game_id`,
          [importedPoolId]
        )

        expect(importedGamesResult.rows.length).toBe(2)
        expect(
          importedGamesResult.rows.every(
            (row) => Array.isArray(row.row_numbers) && row.row_numbers.length === 10 && Array.isArray(row.column_numbers) && row.column_numbers.length === 10
          )
        ).toBe(true)
        expect(importedGamesResult.rows.map((row) => row.game_date)).toEqual(['2026-04-01', '2026-04-03'])
        expect(importedGamesResult.rows.map((row) => row.kickoff_at?.slice(0, 16) ?? null)).toEqual([
          '2026-04-01 18:20',
          '2026-04-03 18:20'
        ])
      } finally {
        fetchSpy.mockRestore()
      }
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

    it('should repair legacy empty board numbers before calculating winners', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Legacy Board Team ${Date.now()}` })

      expect(teamResponse.status).toBe(201)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Legacy Board Pool ${Date.now()}`,
          teamId: teamResponse.body.id,
          season: 2026,
          poolType: 'single_game',
          leagueCode: 'MLB',
          primaryTeam: 'Chicago Cubs',
          boardNumberMode: 'same_for_tournament',
          squareCost: 20,
          q1Payout: 50,
          q2Payout: 0,
          q3Payout: 0,
          q4Payout: 0
        })

      expect(poolResponse.status).toBe(201)
      const legacyPoolId = Number(poolResponse.body.id)

      const participantResponse = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Legacy',
          lastName: 'Winner',
          email: `legacy-winner-${Date.now()}@example.com`,
          phone: '5554422222'
        })

      expect(participantResponse.status).toBe(201)
      const participantId = Number(participantResponse.body.id)

      await request(app)
        .post(`/api/setup/pools/${legacyPoolId}/squares/init`)
        .set(organizerHeaders)
        .send({})

      const assignResponse = await request(app)
        .patch(`/api/setup/pools/${legacyPoolId}/squares/12`)
        .set(organizerHeaders)
        .send({ participantId, playerId: null, paidFlg: true })

      expect(assignResponse.status).toBe(200)

      const gameResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId: legacyPoolId,
          weekNum: 1,
          opponent: 'Legacy Opponent',
          gameDate: '2026-07-05'
        })

      expect(gameResponse.status).toBe(200)
      const legacyGameId = Number(gameResponse.body.game.id)

      await db.query(
        `UPDATE football_pool.pool
         SET board_number_mode = 'same_for_tournament',
             tournament_row_numbers = $2::jsonb,
             tournament_column_numbers = $3::jsonb
         WHERE id = $1`,
        [
          legacyPoolId,
          JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
          JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
        ]
      )

      await db.query(
        `UPDATE football_pool.pool_game
         SET row_numbers = '[]'::jsonb,
             column_numbers = '[]'::jsonb
         WHERE pool_id = $1
           AND game_id = $2`,
        [legacyPoolId, legacyGameId]
      )

      const scoreResponse = await request(app)
        .patch(`/api/games/${legacyGameId}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: 1,
          q1OpponentScore: 1,
          q2PrimaryScore: null,
          q2OpponentScore: null,
          q3PrimaryScore: null,
          q3OpponentScore: null,
          q4PrimaryScore: null,
          q4OpponentScore: null
        })

      expect(scoreResponse.status).toBe(200)

      const repairedBoardResult = await db.query<{ row_numbers: number[] | null; column_numbers: number[] | null }>(
        `SELECT row_numbers, column_numbers
         FROM football_pool.pool_game
         WHERE pool_id = $1
           AND game_id = $2`,
        [legacyPoolId, legacyGameId]
      )

      expect(repairedBoardResult.rows[0]?.row_numbers).toHaveLength(10)
      expect(repairedBoardResult.rows[0]?.column_numbers).toHaveLength(10)

      const boardResponse = await request(app)
        .get(`/api/landing/pools/${legacyPoolId}/board?gameId=${legacyGameId}`)
        .set(organizerHeaders)

      expect(boardResponse.status).toBe(200)

      const winningSquare = boardResponse.body.board.squares.find((square: { square_num: number }) => square.square_num === 12)
      expect(winningSquare?.current_game_won).toBe(50)
    })

    it('should use winner and loser digits when a pool is configured for winner/loser scoring', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Winner Loser Team ${Date.now()}` })

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Winner Loser Pool ${Date.now()}`,
          teamId: teamResponse.body.id,
          season: 2026,
          poolType: 'single_game',
          primaryTeam: 'Packers',
          winnerLoserMode: true,
          squareCost: 20,
          q1Payout: 0,
          q2Payout: 0,
          q3Payout: 0,
          q4Payout: 400
        })

      expect(poolResponse.status).toBe(201)
      const winnerLoserPoolId = Number(poolResponse.body.id)

      const participantResponse = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Winner',
          lastName: 'Loser',
          email: `winner-loser-${Date.now()}@example.com`,
          phone: '5554400000'
        })

      expect(participantResponse.status).toBe(201)
      const participantId = Number(participantResponse.body.id)

      await request(app)
        .post(`/api/setup/pools/${winnerLoserPoolId}/squares/init`)
        .set(organizerHeaders)
        .send({})

      const assignResponse = await request(app)
        .patch(`/api/setup/pools/${winnerLoserPoolId}/squares/48`)
        .set(organizerHeaders)
        .send({ participantId, playerId: null, paidFlg: true })

      expect(assignResponse.status).toBe(200)

      const winnerLoserGameResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId: winnerLoserPoolId,
          weekNum: 1,
          opponent: 'Winner Loser Opponent',
          gameDate: '2026-02-01'
        })

      expect(winnerLoserGameResponse.status).toBe(200)
      const winnerLoserGameId = Number(winnerLoserGameResponse.body.game.id)

      await db.query(
        `UPDATE football_pool.pool_game
         SET row_numbers = $2::jsonb,
             column_numbers = $3::jsonb
         WHERE pool_id = $1
           AND game_id = $4`,
        [
          winnerLoserPoolId,
          JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
          JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
          winnerLoserGameId
        ]
      )

      const scoreResponse = await request(app)
        .patch(`/api/games/${winnerLoserGameId}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: null,
          q1OpponentScore: null,
          q2PrimaryScore: null,
          q2OpponentScore: null,
          q3PrimaryScore: null,
          q3OpponentScore: null,
          q4PrimaryScore: 14,
          q4OpponentScore: 27
        })

      expect(scoreResponse.status).toBe(200)

      const boardResponse = await request(app)
        .get(`/api/landing/pools/${winnerLoserPoolId}/board?gameId=${winnerLoserGameId}`)
        .set(organizerHeaders)

      expect(boardResponse.status).toBe(200)
      expect(boardResponse.body.board.primaryTeam).toBe('Winning Score')
      expect(boardResponse.body.board.opponent).toBe('Losing Score')

      const winningSquare = boardResponse.body.board.squares.find((square: { square_num: number }) => square.square_num === 48)
      expect(winningSquare?.current_game_won).toBe(400)
    })

    it('should support baseball inning payouts and treat the ninth slot as the final inning for extra-inning games', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Baseball Inning Team ${Date.now()}` })

      expect(teamResponse.status).toBe(201)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Baseball Inning Pool ${Date.now()}`,
          teamId: teamResponse.body.id,
          season: 2026,
          poolType: 'single_game',
          leagueCode: 'MLB',
          primaryTeam: 'Cubs',
          squareCost: 20,
          q1Payout: 10,
          q2Payout: 10,
          q3Payout: 10,
          q4Payout: 10,
          q5Payout: 10,
          q6Payout: 10,
          q7Payout: 10,
          q8Payout: 10,
          q9Payout: 20
        })

      expect(poolResponse.status).toBe(201)
      const baseballPoolId = Number(poolResponse.body.id)

      const participantResponse = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Baseball',
          lastName: 'Winner',
          email: `baseball-winner-${Date.now()}@example.com`,
          phone: '5554411111'
        })

      expect(participantResponse.status).toBe(201)
      const participantId = Number(participantResponse.body.id)

      await request(app)
        .post(`/api/setup/pools/${baseballPoolId}/squares/init`)
        .set(organizerHeaders)
        .send({})

      const assignResponse = await request(app)
        .patch(`/api/setup/pools/${baseballPoolId}/squares/12`)
        .set(organizerHeaders)
        .send({ participantId, playerId: null, paidFlg: true })

      expect(assignResponse.status).toBe(200)

      const gameResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId: baseballPoolId,
          weekNum: 1,
          opponent: 'Cardinals',
          gameDate: '2026-07-04'
        })

      expect(gameResponse.status).toBe(200)
      const baseballGameId = Number(gameResponse.body.game.id)

      await db.query(
        `UPDATE football_pool.pool_game
         SET row_numbers = $2::jsonb,
             column_numbers = $3::jsonb
         WHERE pool_id = $1
           AND game_id = $4`,
        [
          baseballPoolId,
          JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
          JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
          baseballGameId
        ]
      )

      const scoreResponse = await request(app)
        .patch(`/api/games/${baseballGameId}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: 1,
          q1OpponentScore: 1,
          q2PrimaryScore: 11,
          q2OpponentScore: 11,
          q3PrimaryScore: 21,
          q3OpponentScore: 21,
          q4PrimaryScore: 31,
          q4OpponentScore: 31,
          q5PrimaryScore: 41,
          q5OpponentScore: 41,
          q6PrimaryScore: 51,
          q6OpponentScore: 51,
          q7PrimaryScore: 61,
          q7OpponentScore: 61,
          q8PrimaryScore: 71,
          q8OpponentScore: 71,
          q9PrimaryScore: 101,
          q9OpponentScore: 101
        })

      expect(scoreResponse.status).toBe(200)

      const boardResponse = await request(app)
        .get(`/api/landing/pools/${baseballPoolId}/board?gameId=${baseballGameId}`)
        .set(organizerHeaders)

      expect(boardResponse.status).toBe(200)
      expect(boardResponse.body.board?.payoutSummary?.activeSlots).toEqual(['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9'])

      const winningSquare = boardResponse.body.board.squares.find((square: { square_num: number }) => square.square_num === 12)
      expect(winningSquare?.current_game_won).toBe(100)

      const winningsResponse = await request(app)
        .get(`/api/winnings/pool/${baseballPoolId}`)
        .set(organizerHeaders)

      expect(winningsResponse.status).toBe(200)
      expect(winningsResponse.body).toHaveLength(9)
      expect(Math.max(...winningsResponse.body.map((entry: { quarter: number }) => Number(entry.quarter)))).toBe(9)
      expect(winningsResponse.body.find((entry: { quarter: number; amount_won: number }) => Number(entry.quarter) === 9)?.amount_won).toBe(20)
    })

    it('should use live MLB ninth-inning totals for the Final card before the game is complete', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input)

        if (url.includes('/sports/baseball/mlb/scoreboard?dates=20260410')) {
          return new Response(
            JSON.stringify({
              events: [
                {
                  id: '401814999',
                  uid: 's:10~l:442~e:401814999',
                  competitions: [
                    {
                      status: {
                        period: 9,
                        displayClock: 'Top 9th',
                        type: {
                          completed: false,
                          description: 'In Progress',
                          shortDetail: 'Top 9th'
                        }
                      },
                      competitors: [
                        {
                          homeAway: 'home',
                          score: '3',
                          linescores: [
                            { value: 0 },
                            { value: 1 },
                            { value: 0 },
                            { value: 1 },
                            { value: 0 },
                            { value: 0 },
                            { value: 1 },
                            { value: 0 }
                          ],
                          team: {
                            id: '158',
                            uid: 's:10~l:442~t:158',
                            displayName: 'Milwaukee Brewers',
                            shortDisplayName: 'Brewers',
                            abbreviation: 'MIL'
                          }
                        },
                        {
                          homeAway: 'away',
                          score: '4',
                          linescores: [
                            { value: 1 },
                            { value: 0 },
                            { value: 1 },
                            { value: 0 },
                            { value: 0 },
                            { value: 1 },
                            { value: 0 },
                            { value: 1 }
                          ],
                          team: {
                            id: '120',
                            uid: 's:10~l:442~t:120',
                            displayName: 'Washington Nationals',
                            shortDisplayName: 'Nationals',
                            abbreviation: 'WSH'
                          }
                        }
                      ]
                    }
                  ]
                }
              ]
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        }

        return new Response(JSON.stringify({ events: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      })

      try {
        const teamResponse = await request(app)
          .post('/api/setup/teams')
          .set(organizerHeaders)
          .send({ teamName: `Live MLB Ninth Team ${Date.now()}` })

        expect(teamResponse.status).toBe(201)

        const poolResponse = await request(app)
          .post('/api/setup/pools')
          .set(organizerHeaders)
          .send({
            poolName: `Live MLB Ninth Pool ${Date.now()}`,
            teamId: teamResponse.body.id,
            season: 2026,
            poolType: 'single_game',
            leagueCode: 'MLB',
            primaryTeam: 'Milwaukee Brewers',
            squareCost: 20,
            q1Payout: 10,
            q2Payout: 10,
            q3Payout: 10,
            q4Payout: 10,
            q5Payout: 10,
            q6Payout: 10,
            q7Payout: 10,
            q8Payout: 10,
            q9Payout: 20
          })

        expect(poolResponse.status).toBe(201)
        const poolId = Number(poolResponse.body.id)

        const gameResponse = await request(app)
          .post('/api/games')
          .set(organizerHeaders)
          .send({
            poolId,
            weekNum: 1,
            opponent: 'Washington Nationals',
            gameDate: '2026-04-10T18:00:00.000Z'
          })

        expect(gameResponse.status).toBe(200)
        const gameId = Number(gameResponse.body.game.id)

        const ingestResponse = await request(app)
          .post(`/api/ingestion/games/${gameId}/scores`)
          .set(organizerHeaders)
          .send({ source: 'espn' })

        expect(ingestResponse.status).toBe(200)
        expect(ingestResponse.body.currentQuarter).toBe(9)
        expect(ingestResponse.body.state).toBe('in_progress')
        expect(ingestResponse.body.scores.q9PrimaryScore).toBe(3)
        expect(ingestResponse.body.scores.q9OpponentScore).toBe(4)

        const displayResponse = await request(app)
          .get(`/api/landing/pools/${poolId}/games`)
          .set(organizerHeaders)

        expect(displayResponse.status).toBe(200)
        const liveGame = displayResponse.body.games.find((game: { id: number }) => Number(game.id) === gameId)
        expect(liveGame?.current_quarter).toBe(9)
        expect(liveGame?.q9_primary_score).toBe(3)
        expect(liveGame?.q9_opponent_score).toBe(4)
      } finally {
        fetchSpy.mockRestore()
      }
    })

    it('should treat postponed ESPN MLB games as scheduled and clear prior payouts', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input)

        if (url.includes('/sports/baseball/mlb/scoreboard?dates=20260403')) {
          return new Response(
            JSON.stringify({
              events: [
                {
                  id: '401814790',
                  uid: 's:10~l:442~e:401814790',
                  competitions: [
                    {
                      competitors: [
                        {
                          homeAway: 'home',
                          score: '0',
                          linescores: [],
                          team: {
                            id: '118',
                            uid: 's:10~l:442~t:118',
                            displayName: 'Milwaukee Brewers',
                            shortDisplayName: 'Brewers',
                            abbreviation: 'MIL'
                          }
                        },
                        {
                          homeAway: 'away',
                          score: '0',
                          linescores: [],
                          team: {
                            id: '7',
                            uid: 's:10~l:442~t:7',
                            displayName: 'Kansas City Royals',
                            shortDisplayName: 'Royals',
                            abbreviation: 'KC'
                          }
                        }
                      ],
                      status: {
                        type: {
                          completed: false,
                          state: 'post',
                          description: 'Postponed',
                          detail: 'Postponed'
                        },
                        displayClock: '',
                        period: null
                      }
                    }
                  ]
                }
              ]
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        }

        return new Response(JSON.stringify({ events: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      })

      try {
        const teamResponse = await request(app)
          .post('/api/setup/teams')
          .set(organizerHeaders)
          .send({ teamName: `Postponed MLB Team ${Date.now()}` })

        expect(teamResponse.status).toBe(201)

        const poolResponse = await request(app)
          .post('/api/setup/pools')
          .set(organizerHeaders)
          .send({
            poolName: `Postponed MLB Pool ${Date.now()}`,
            teamId: teamResponse.body.id,
            season: 2026,
            poolType: 'single_game',
            leagueCode: 'MLB',
            primaryTeam: 'Milwaukee Brewers',
            squareCost: 20,
            q1Payout: 10,
            q2Payout: 10,
            q3Payout: 10,
            q4Payout: 10,
            q5Payout: 10,
            q6Payout: 10,
            q7Payout: 10,
            q8Payout: 10,
            q9Payout: 20
          })

        expect(poolResponse.status).toBe(201)
        const postponedPoolId = Number(poolResponse.body.id)

        const participantResponse = await request(app)
          .post('/api/setup/users')
          .set(organizerHeaders)
          .send({
            firstName: 'Postponed',
            lastName: 'Winner',
            email: `postponed-winner-${Date.now()}@example.com`,
            phone: '5554422222'
          })

        expect(participantResponse.status).toBe(201)
        const participantId = Number(participantResponse.body.id)

        await request(app)
          .post(`/api/setup/pools/${postponedPoolId}/squares/init`)
          .set(organizerHeaders)
          .send({})

        const assignResponse = await request(app)
          .patch(`/api/setup/pools/${postponedPoolId}/squares/12`)
          .set(organizerHeaders)
          .send({ participantId, playerId: null, paidFlg: true })

        expect(assignResponse.status).toBe(200)

        const gameResponse = await request(app)
          .post('/api/games')
          .set(organizerHeaders)
          .send({
            poolId: postponedPoolId,
            weekNum: 1,
            opponent: 'Kansas City Royals',
            gameDate: '2026-04-03'
          })

        expect(gameResponse.status).toBe(200)
        const postponedGameId = Number(gameResponse.body.game.id)

        await db.query(
          `UPDATE football_pool.game
           SET state = 'completed',
               final_score_home = 1,
               final_score_away = 1,
               scores_by_quarter = $2::jsonb
           WHERE id = $1`,
          [
            postponedGameId,
            JSON.stringify({
              '1': { home: null, away: null },
              '2': { home: null, away: null },
              '3': { home: null, away: null },
              '4': { home: null, away: null },
              '5': { home: null, away: null },
              '6': { home: null, away: null },
              '7': { home: null, away: null },
              '8': { home: null, away: null },
              '9': { home: 1, away: 1 }
            })
          ]
        )

        const winningsIdResult = await db.query<{ next_id: number }>(
          'SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM football_pool.winnings_ledger'
        )

        await db.query(
          `INSERT INTO football_pool.winnings_ledger
             (id, game_id, pool_id, quarter, winner_user_id, amount_won, payout_status)
           VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
          [Number(winningsIdResult.rows[0]?.next_id ?? 1), postponedGameId, postponedPoolId, 9, participantId, 20]
        )

        const beforeRepairResult = await db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM football_pool.winnings_ledger
           WHERE game_id = $1`,
          [postponedGameId]
        )

        expect(Number(beforeRepairResult.rows[0]?.count ?? '0')).toBeGreaterThan(0)

        const ingestResponse = await request(app)
          .post(`/api/ingestion/games/${postponedGameId}/scores`)
          .set(organizerHeaders)
          .send({ source: 'espn' })

        expect(ingestResponse.status).toBe(200)
        expect(ingestResponse.body.state).toBe('scheduled')

        const repairedGameResult = await db.query<{
          state: string
          final_score_home: number | null
          final_score_away: number | null
        }>(
          `SELECT state, final_score_home, final_score_away
           FROM football_pool.game
           WHERE id = $1`,
          [postponedGameId]
        )

        expect(repairedGameResult.rows[0]?.state).toBe('scheduled')
        expect(repairedGameResult.rows[0]?.final_score_home).toBeNull()
        expect(repairedGameResult.rows[0]?.final_score_away).toBeNull()

        const winningsResult = await db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count
           FROM football_pool.winnings_ledger
           WHERE game_id = $1`,
          [postponedGameId]
        )

        expect(Number(winningsResult.rows[0]?.count ?? '0')).toBe(0)
      } finally {
        fetchSpy.mockRestore()
      }
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

    it('should use actual ESPN results and persist ESPN event ids for historical simulations', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
        const url = String(input)

        if (url.includes('/scoreboard?dates=')) {
          return new Response(
            JSON.stringify({
              events: [
                {
                  id: '401777001',
                  uid: 's:20~l:28~e:401777001',
                  competitions: [
                    {
                      competitors: [
                        {
                          homeAway: 'home',
                          score: '27',
                          linescores: [{ value: 7 }, { value: 6 }, { value: 7 }, { value: 7 }],
                          team: {
                            id: '9',
                            uid: 's:20~l:28~t:9',
                            displayName: 'Green Bay Packers',
                            shortDisplayName: 'Packers',
                            abbreviation: 'GB'
                          }
                        },
                        {
                          homeAway: 'away',
                          score: '20',
                          linescores: [{ value: 3 }, { value: 7 }, { value: 7 }, { value: 3 }],
                          team: {
                            id: '3',
                            uid: 's:20~l:28~t:3',
                            displayName: 'Chicago Bears',
                            shortDisplayName: 'Bears',
                            abbreviation: 'CHI'
                          }
                        }
                      ],
                      status: {
                        type: {
                          completed: true,
                          state: 'post',
                          description: 'Final'
                        },
                        period: 4,
                        displayClock: '0:00'
                      }
                    }
                  ]
                }
              ]
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            }
          )
        }

        return new Response(JSON.stringify({ events: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      })

      try {
        const teamResponse = await request(app)
          .post('/api/setup/teams')
          .set(organizerHeaders)
          .send({ teamName: `Historical Sim Team ${Date.now()}` })

        const teamId = Number(teamResponse.body.id)

        const poolResponse = await request(app)
          .post('/api/setup/pools')
          .set(organizerHeaders)
          .send({
            poolName: `Historical Sim Pool ${Date.now()}`,
            teamId,
            season: 2024,
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
            firstName: 'Historical',
            lastName: `User${Date.now()}`,
            email: `historical-sim-${Date.now()}@example.com`,
            phone: '5551900000',
            isPlayer: true,
            playerTeams: [{ teamId, jerseyNum: 12 }]
          })

        const gameResponse = await request(app)
          .post('/api/games')
          .set(organizerHeaders)
          .send({
            poolId,
            weekNum: 1,
            opponent: 'Chicago Bears',
            gameDate: '2024-09-08',
            isSimulation: true
          })

        expect(gameResponse.status).toBe(200)
        const gameId = Number(gameResponse.body.game.id)

        const startResponse = await request(app)
          .post(`/api/setup/pools/${poolId}/simulation`)
          .set(organizerHeaders)
          .send({ mode: 'by_quarter' })

        expect(startResponse.status).toBe(201)
        expect(startResponse.body.result.mode).toBe('by_quarter')
        expect(startResponse.body.result.currentGameId).toBe(gameId)

        const advanceResponse = await request(app)
          .post(`/api/setup/pools/${poolId}/simulation/advance`)
          .set(organizerHeaders)
          .send({ source: 'espn' })

        expect(advanceResponse.status).toBe(200)
        expect(advanceResponse.body.completedGameId).toBe(gameId)
        expect(advanceResponse.body.completedQuarter).toBe(1)

        const gamesResponse = await request(app)
          .get(`/api/games?poolId=${poolId}`)
          .set(organizerHeaders)

        const completedGame = gamesResponse.body.find((game: { id: number }) => Number(game.id) === gameId)
        expect(completedGame.q1_primary_score).toBe(7)
        expect(completedGame.q1_opponent_score).toBe(3)
        expect(completedGame.q4_primary_score).toBeNull()

        const sourceIdResult = await db.query<{ espn_event_id: string | null; espn_event_uid: string | null }>(
          `SELECT espn_event_id, espn_event_uid
           FROM football_pool.game
           WHERE id = $1`,
          [gameId]
        )

        expect(sourceIdResult.rows[0]?.espn_event_id).toBe('401777001')
        expect(sourceIdResult.rows[0]?.espn_event_uid).toBe('s:20~l:28~e:401777001')
      } finally {
        fetchSpy.mockRestore()
      }
    }, 15000)

    it('should still allow ending a simulation when simulated games remain after state drift', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Cleanup Sim Team ${Date.now()}` })

      const teamId = Number(teamResponse.body.id)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Cleanup Sim Pool ${Date.now()}`,
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
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 1,
          opponent: 'Cleanup Opponent',
          gameDate: '2025-09-07',
          isSimulation: true
        })

      await db.query(
        `DELETE FROM football_pool.pool_simulation_state
         WHERE pool_id = $1`,
        [poolId]
      )

      await db.query(
        `UPDATE football_pool.square
         SET participant_id = NULL,
             player_id = NULL,
             paid_flg = FALSE
         WHERE pool_id = $1`,
        [poolId]
      )

      const statusResponse = await request(app)
        .get(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)

      expect(statusResponse.status).toBe(200)
      expect(statusResponse.body.status.hasSimulationData).toBe(true)
      expect(statusResponse.body.status.canCleanup).toBe(true)
    })

    it('should seed an NBA by-quarter simulation with quarter controls and live board data', async () => {
      await db.query(`
        SELECT setval(
          pg_get_serial_sequence('football_pool.sport_team', 'id'),
          GREATEST(COALESCE((SELECT MAX(id) FROM football_pool.sport_team), 1), 1),
          true
        )
      `)

      const sportTeamKey = `sim-nba-${Date.now()}`
      const sportTeamResult = await db.query<{ id: number }>(
        `INSERT INTO football_pool.sport_team (
           name,
           abbreviation,
           sport_code,
           league_code,
           espn_team_id,
           espn_team_uid
         )
         VALUES ($1, $2, 'BASKETBALL', 'NBA', $3, $4)
         ON CONFLICT (sport_code, league_code, name)
         DO UPDATE SET abbreviation = EXCLUDED.abbreviation
         RETURNING id`,
        [`Sim NBA Team ${sportTeamKey}`, 'SNB', sportTeamKey, `sim:nba:${sportTeamKey}`]
      )
      const sportTeamId = Number(sportTeamResult.rows[0]?.id)

      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `NBA Sim Org ${Date.now()}` })

      const teamId = Number(teamResponse.body.id)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `NBA Quarter Sim Pool ${Date.now()}`,
          teamId,
          season: 2025,
          leagueCode: 'NBA',
          primarySportTeamId: sportTeamId,
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
          firstName: 'NBA',
          lastName: `User${Date.now()}`,
          email: `nba-quarter-${Date.now()}@example.com`,
          phone: '5552600000',
          isPlayer: true,
          playerTeams: [{ teamId, jerseyNum: 30 }]
        })

      const firstGame = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 1,
          opponent: 'NBA Test Opponent',
          gameDate: '2025-10-20',
          isSimulation: true
        })

      expect(firstGame.status).toBe(200)
      expect(firstGame.body.game).toBeTruthy()
      const gameId = Number(firstGame.body.game.id)

      const startResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)
        .send({ mode: 'by_quarter' })

      expect(startResponse.status).toBe(201)
      expect(startResponse.body.result.mode).toBe('by_quarter')

      const statusResponse = await request(app)
        .get(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)

      expect(statusResponse.status).toBe(200)
      expect(statusResponse.body.status.currentGameId).toBe(gameId)
      expect(statusResponse.body.status.progressAction).toBe('complete_quarter')

      const gamesResponse = await request(app)
        .get(`/api/landing/pools/${poolId}/games`)
        .set(organizerHeaders)

      const seededGame = gamesResponse.body.games.find((game: { id: number }) => game.id === gameId)
      expect(seededGame.q1_primary_score).not.toBeNull()
      expect(seededGame.q1_opponent_score).not.toBeNull()
      expect(seededGame.q2_primary_score).toBeNull()

      const boardResponse = await request(app)
        .get(`/api/landing/pools/${poolId}/board?gameId=${gameId}`)
        .set(organizerHeaders)

      expect(boardResponse.status).toBe(200)
      expect(boardResponse.body.board.rowNumbers).toHaveLength(10)
      expect(boardResponse.body.board.colNumbers).toHaveLength(10)
    })

    it('should advance an MLB by-inning simulation into the 5th inning', async () => {
      await db.query(`
        SELECT setval(
          pg_get_serial_sequence('football_pool.sport_team', 'id'),
          GREATEST(COALESCE((SELECT MAX(id) FROM football_pool.sport_team), 1), 1),
          true
        )
      `)

      const sportTeamKey = `sim-mlb-${Date.now()}`
      const sportTeamResult = await db.query<{ id: number }>(
        `INSERT INTO football_pool.sport_team (
           name,
           abbreviation,
           sport_code,
           league_code,
           espn_team_id,
           espn_team_uid
         )
         VALUES ($1, $2, 'BASEBALL', 'MLB', $3, $4)
         ON CONFLICT (sport_code, league_code, name)
         DO UPDATE SET abbreviation = EXCLUDED.abbreviation
         RETURNING id`,
        [`Sim MLB Team ${sportTeamKey}`, 'SMB', sportTeamKey, `sim:mlb:${sportTeamKey}`]
      )
      const sportTeamId = Number(sportTeamResult.rows[0]?.id)

      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `MLB Sim Org ${Date.now()}` })

      const teamId = Number(teamResponse.body.id)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `MLB Inning Sim Pool ${Date.now()}`,
          teamId,
          season: 2026,
          leagueCode: 'MLB',
          primarySportTeamId: sportTeamId,
          squareCost: 20,
          q1Payout: 10,
          q2Payout: 10,
          q3Payout: 10,
          q4Payout: 10,
          q5Payout: 10,
          q6Payout: 10,
          q7Payout: 10,
          q8Payout: 10,
          q9Payout: 20
        })

      const poolId = Number(poolResponse.body.id)

      await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'MLB',
          lastName: `User${Date.now()}`,
          email: `mlb-inning-sim-${Date.now()}@example.com`,
          phone: '5552800000',
          isPlayer: true,
          playerTeams: [{ teamId, jerseyNum: 7 }]
        })

      const gameResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 1,
          opponent: 'St. Louis Cardinals',
          gameDate: '2026-07-01',
          isSimulation: true
        })

      expect(gameResponse.status).toBe(200)
      const gameId = Number(gameResponse.body.game.id)

      const startResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)
        .send({ mode: 'by_quarter' })

      expect(startResponse.status).toBe(201)
      expect(startResponse.body.result.currentGameId).toBe(gameId)
      expect(startResponse.body.result.nextQuarter).toBe(1)

      for (let inning = 1; inning <= 4; inning += 1) {
        const advanceResponse = await request(app)
          .post(`/api/setup/pools/${poolId}/simulation/advance`)
          .set(organizerHeaders)
          .send({ source: 'mock' })

        expect(advanceResponse.status).toBe(200)
      }

      const statusResponse = await request(app)
        .get(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)

      expect(statusResponse.status).toBe(200)
      expect(statusResponse.body.status.currentGameId).toBe(gameId)
      expect(statusResponse.body.status.nextQuarter).toBe(5)
    })

    it('should advance an NCAAB tournament simulation by half instead of quarter', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Half Sim Org ${Date.now()}` })

      const teamId = Number(teamResponse.body.id)

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Half Sim Pool ${Date.now()}`,
          teamId,
          season: 2026,
          poolType: 'tournament',
          leagueCode: 'NCAAB',
          winnerLoserMode: true,
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
          firstName: 'Half',
          lastName: `User${Date.now()}`,
          email: `half-sim-${Date.now()}@example.com`,
          phone: '5552700000',
          isPlayer: true,
          playerTeams: [{ teamId, jerseyNum: 14 }]
        })

      const gameResponse = await request(app)
        .post('/api/games')
        .set(organizerHeaders)
        .send({
          poolId,
          weekNum: 1,
          opponent: 'Half Test Opponent',
          gameDate: '2026-03-20',
          isSimulation: true
        })

      expect(gameResponse.status).toBe(200)
      const gameId = Number(gameResponse.body.game.id)

      const startResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation`)
        .set(organizerHeaders)
        .send({ mode: 'by_quarter' })

      expect(startResponse.status).toBe(201)
      expect(startResponse.body.result.mode).toBe('by_quarter')
      expect(startResponse.body.result.nextQuarter).toBe(1)

      const halfOneResponse = await request(app)
        .post(`/api/setup/pools/${poolId}/simulation/advance`)
        .set(organizerHeaders)
        .send({ source: 'mock' })

      expect(halfOneResponse.status).toBe(200)
      expect(String(halfOneResponse.body.message ?? '')).toMatch(/half/i)
      expect(halfOneResponse.body.status.currentGameId).toBe(gameId)
      expect(halfOneResponse.body.status.nextQuarter).toBe(4)

      const gamesResponse = await request(app)
        .get(`/api/games?poolId=${poolId}`)
        .set(organizerHeaders)

      const updatedGame = gamesResponse.body.find((game: { id: number }) => game.id === gameId)
      expect(updatedGame.q1_primary_score).not.toBeNull()
      expect(updatedGame.q1_opponent_score).not.toBeNull()
      expect(updatedGame.q2_primary_score).toBeNull()
      expect(updatedGame.q3_primary_score).toBeNull()
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
        `UPDATE football_pool.pool_game
         SET row_numbers = $2::jsonb,
             column_numbers = $3::jsonb
         WHERE game_id IN ($1, $4)`,
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
        `UPDATE football_pool.pool_game
         SET row_numbers = $2::jsonb,
             column_numbers = $3::jsonb
         WHERE game_id = $1`,
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
           AND recipient_email IN ($2, $3)
         ORDER BY recipient_email, quarter NULLS LAST`,
        [gameId, contactEmail, winnerEmail]
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
           AND recipient_email = $2
           AND quarter = 1
         LIMIT 1`,
        [gameId, winnerEmail]
      )

      expect(userMessageResult.rows[0]?.subject).toBe(`Quarter 1 winner in ${poolName}`)
      expect(String(userMessageResult.rows[0]?.message_text ?? '')).toContain('Quarter Winner won')
      expect(String(userMessageResult.rows[0]?.message_text ?? '')).toContain('Packers 0 · Email Opponent 0')
    })

    it('should use half-based wording for NCAAB score-segment notifications', async () => {
      const winnerEmail = `ncaab-winner-${Date.now()}@example.com`

      const winnerResponse = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Half',
          lastName: 'Winner',
          email: winnerEmail,
          phone: '5557771111',
          notificationLevel: 'quarter_win'
        })

      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({
          teamName: `NCAAB Notify Team ${Date.now()}`
        })

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `NCAAB Notify Pool ${Date.now()}`,
          teamId: Number(teamResponse.body.id),
          season: 2026,
          poolType: 'tournament',
          leagueCode: 'NCAAB',
          winnerLoserMode: true,
          squareCost: 25,
          q1Payout: 100,
          q2Payout: 0,
          q3Payout: 0,
          q4Payout: 200
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
          opponent: 'NCAAB Opponent',
          gameDate: '2026-03-19T18:00:00.000Z',
          isSimulation: true
        })

      const gameId = Number(gameResponse.body.game.id)

      await db.query(
        `UPDATE football_pool.pool_game
         SET row_numbers = $2::jsonb,
             column_numbers = $3::jsonb
         WHERE game_id = $1`,
        [gameId, JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])]
      )

      await request(app)
        .put('/api/setup/notifications/templates/participant/quarter_win')
        .set(organizerHeaders)
        .send({
          subjectTemplate: '{{segmentLabel}} winner in {{poolName}}',
          bodyTemplate: '{{winnerName}} won {{segmentLabel}} in {{poolName}}.',
          markupFormat: 'plain_text'
        })

      const scoreResponse = await request(app)
        .patch(`/api/games/${gameId}/scores`)
        .set(organizerHeaders)
        .send({
          q1PrimaryScore: 10,
          q1OpponentScore: 10,
          q2PrimaryScore: null,
          q2OpponentScore: null,
          q3PrimaryScore: null,
          q3OpponentScore: null,
          q4PrimaryScore: 60,
          q4OpponentScore: 60
        })

      expect(scoreResponse.status).toBe(200)

      const notificationResult = await db.query(
        `SELECT subject, message_text
         FROM football_pool.notification_log
         WHERE game_id = $1
           AND recipient_scope = 'user'
           AND recipient_email = $2
           AND quarter = 1
         LIMIT 1`,
        [gameId, winnerEmail]
      )

      expect(String(notificationResult.rows[0]?.subject ?? '')).toContain('1st half')
      expect(String(notificationResult.rows[0]?.message_text ?? '')).toContain('1st half')
    })

    it('should still log quarter-win emails when the pool payout is zero', async () => {
      const winnerEmail = `zero-payout-${Date.now()}@example.com`

      const winnerResponse = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Zero',
          lastName: 'Payout',
          email: winnerEmail,
          phone: '5558889999',
          notificationLevel: 'quarter_win'
        })

      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({
          teamName: `Zero Payout Team ${Date.now()}`
        })

      const poolResponse = await request(app)
        .post('/api/setup/pools')
        .set(organizerHeaders)
        .send({
          poolName: `Zero Payout Pool ${Date.now()}`,
          teamId: Number(teamResponse.body.id),
          season: 2026,
          primaryTeam: 'Packers',
          squareCost: 0,
          q1Payout: 0,
          q2Payout: 0,
          q3Payout: 0,
          q4Payout: 0
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
          opponent: 'Zero Opponent',
          gameDate: '2026-10-02T18:00:00.000Z',
          isSimulation: true
        })

      const gameId = Number(gameResponse.body.game.id)

      await db.query(
        `UPDATE football_pool.pool_game
         SET row_numbers = $2::jsonb,
             column_numbers = $3::jsonb
         WHERE game_id = $1`,
        [gameId, JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), JSON.stringify([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])]
      )

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
           AND recipient_scope = 'user'
           AND recipient_email = $2
         ORDER BY quarter NULLS LAST`,
        [gameId, winnerEmail]
      )

      expect(notificationResult.rows).toEqual([
        { recipient_email: winnerEmail, notification_kind: 'quarter_win', recipient_scope: 'user', quarter: 1 },
        { recipient_email: winnerEmail, notification_kind: 'quarter_win', recipient_scope: 'user', quarter: 2 },
        { recipient_email: winnerEmail, notification_kind: 'quarter_win', recipient_scope: 'user', quarter: 3 },
        { recipient_email: winnerEmail, notification_kind: 'quarter_win', recipient_scope: 'user', quarter: 4 }
      ])
    })
  })

  describe('Authentication', () => {
    it('should accept organizer auth for verify checks', async () => {
      const response = await request(app)
        .get('/api/auth/verify')
        .set(organizerHeaders)

      expect(response.status).toBe(200)
      expect(response.body).toHaveProperty('authenticated', true)
    })

    it('should refuse password login until a secure password has been set', async () => {
      const email = `auth-no-password-${Date.now()}@example.com`

      const createResponse = await request(app)
        .post('/api/setup/users')
        .set(organizerHeaders)
        .send({
          firstName: 'Password',
          lastName: 'Pending',
          email,
          phone: '5551002000'
        })

      expect(createResponse.status).toBe(201)

      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email,
          password: 'AnyPassword123!'
        })

      expect(loginResponse.status).toBe(403)
      expect(String(loginResponse.body.error ?? '')).toMatch(/password/i)
    })

    it('should allow an allowlisted email to create its initial password without a reset token', async () => {
      const email = 'jeff.pflanzer@gmail.com'
      const originalBypassEmails = [...env.PASSWORD_SETUP_BYPASS_EMAILS]
      env.PASSWORD_SETUP_BYPASS_EMAILS = [email]

      try {
        const createResponse = await request(app)
          .post('/api/setup/users')
          .set(organizerHeaders)
          .send({
            firstName: 'Jeff',
            lastName: 'Pflanzer',
            email,
            phone: '5551003000'
          })

        expect(createResponse.status).toBe(201)

        const resetResponse = await request(app)
          .post('/api/auth/reset-password')
          .send({
            email,
            password: 'SecurePass123!',
            confirmPassword: 'SecurePass123!'
          })

        expect(resetResponse.status).toBe(200)
        expect(resetResponse.headers['set-cookie']).toBeTruthy()

        const loginResponse = await request(app)
          .post('/api/auth/login')
          .send({
            email,
            password: 'SecurePass123!'
          })

        expect(loginResponse.status).toBe(200)
        expect(loginResponse.body.user?.email).toBe(email)
      } finally {
        env.PASSWORD_SETUP_BYPASS_EMAILS = originalBypassEmails
      }
    })

    it('should support request-access approval and secure password setup', async () => {
      const teamResponse = await request(app)
        .post('/api/setup/teams')
        .set(organizerHeaders)
        .send({ teamName: `Access Team ${Date.now()}` })

      expect(teamResponse.status).toBe(201)
      const organizationId = Number(teamResponse.body.id)
      const email = `access-request-${Date.now()}@example.com`

      const requestAccessResponse = await request(app)
        .post('/api/auth/request-access')
        .send({
          firstName: 'Access',
          lastName: 'Requester',
          email,
          phone: '5553334444',
          organizationId,
          requestNote: 'Please grant pool access.'
        })

      expect(requestAccessResponse.status).toBe(201)
      expect(typeof requestAccessResponse.body.resetToken).toBe('string')

      const accessListResponse = await request(app)
        .get('/api/auth/access-requests')
        .set(organizerHeaders)

      expect(accessListResponse.status).toBe(200)
      const createdRequest = accessListResponse.body.requests.find(
        (entry: { email?: string; organization_id?: number; status?: string }) =>
          entry.email === email && Number(entry.organization_id) === organizationId && entry.status === 'pending'
      )
      expect(createdRequest).toBeTruthy()

      const reviewResponse = await request(app)
        .patch(`/api/auth/access-requests/${createdRequest.id}`)
        .set(organizerHeaders)
        .send({ status: 'approved', reviewNote: 'Approved in test.' })

      expect(reviewResponse.status).toBe(200)

      const resetResponse = await request(app)
        .post('/api/auth/reset-password')
        .send({
          token: requestAccessResponse.body.resetToken,
          password: 'SecurePass123!',
          confirmPassword: 'SecurePass123!'
        })

      expect(resetResponse.status).toBe(200)
      expect(resetResponse.headers['set-cookie']).toBeTruthy()

      const sessionCookie = Array.isArray(resetResponse.headers['set-cookie'])
        ? resetResponse.headers['set-cookie'][0]
        : ''

      const verifyResponse = await request(app)
        .get('/api/auth/verify')
        .set('Cookie', sessionCookie)

      expect(verifyResponse.status).toBe(200)
      expect(Array.isArray(verifyResponse.body.user?.accessibleOrganizationIds)).toBe(true)
      expect(verifyResponse.body.user.accessibleOrganizationIds).toContain(organizationId)
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

