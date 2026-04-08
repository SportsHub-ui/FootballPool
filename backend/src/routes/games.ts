import { Router } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { db } from '../config/db';
import { resolveTemplateRoundSequence } from '../config/poolStructures';
import { requireRole } from '../middleware/auth';
import { ensurePoolGameStructureSupport } from '../services/poolGameStructureSupport';
import { syncPoolGameBoardNumbers } from '../services/poolBoardNumbers';
import { importPoolScheduleFromEspn } from '../services/scheduleImport';
import { ingestGameScores } from '../services/scoreIngestion';
import { buildMatchupDisplayLabel, parseMatchupLabel } from '../utils/matchupLabels';

export const gamesRouter = Router();

// All game endpoints require organizer role
gamesRouter.use(requireRole('organizer'));

const createGameSchema = z.object({
  poolId: z.number().int().positive(),
  weekNum: z.number().int().min(1).max(400).nullable().optional(),
  roundLabel: z.string().trim().max(80).optional().or(z.literal('')),
  roundSequence: z.number().int().min(1).max(50).nullable().optional(),
  bracketRegion: z.string().trim().max(64).optional().or(z.literal('')),
  matchupOrder: z.number().int().min(1).max(100).nullable().optional(),
  isChampionship: z.boolean().optional().default(false),
  homeTeamId: z.number().int().positive().optional(),
  awayTeamId: z.number().int().positive().optional(),
  opponent: z.string().trim().min(1).optional(),
  opponentSportTeamAbbr: z.string().trim().min(1).max(16).optional(),
  opponentNflTeamAbbr: z.string().trim().min(1).max(16).optional(),
  gameDate: z.string().refine((d) => !Number.isNaN(Date.parse(d)), 'Invalid date format'),
  isSimulation: z.boolean().optional().default(false),
  rowNumbers: z.any().optional(),
  columnNumbers: z.any().optional()
}).superRefine((value, ctx) => {
  const opponentAbbr = value.opponentSportTeamAbbr?.trim() || value.opponentNflTeamAbbr?.trim()

  if (value.awayTeamId == null && !value.opponent?.trim() && !opponentAbbr) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['opponent'],
      message: 'Opponent, opponent abbreviation, or awayTeamId is required'
    })
  }
})

const gameIdParamsSchema = z.object({
  gameId: z.coerce.number().int().positive()
});

const scoreUpdateSchema = z.object({
  q1PrimaryScore: z.number().int().nonnegative().nullable(),
  q1OpponentScore: z.number().int().nonnegative().nullable(),
  q2PrimaryScore: z.number().int().nonnegative().nullable(),
  q2OpponentScore: z.number().int().nonnegative().nullable(),
  q3PrimaryScore: z.number().int().nonnegative().nullable(),
  q3OpponentScore: z.number().int().nonnegative().nullable(),
  q4PrimaryScore: z.number().int().nonnegative().nullable(),
  q4OpponentScore: z.number().int().nonnegative().nullable()
});

type QuarterKey = '1' | '2' | '3' | '4'
type QuarterScoreMap = Partial<Record<QuarterKey, { home?: number | null; away?: number | null }>>

const toQuarterScoreMap = (value: unknown): QuarterScoreMap => {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as QuarterScoreMap
    } catch {
      return {}
    }
  }
  if (typeof value === 'object') {
    return value as QuarterScoreMap
  }
  return {}
}

const toNullableNumber = (value: unknown): number | null => {
  if (value == null || value === '') return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const buildGameResponse = (row: Record<string, unknown>) => {
  const scores = toQuarterScoreMap(row.scores_by_quarter)

  const roundLabel = typeof row.round_label === 'string' ? row.round_label : null

  return {
    ...row,
    id: Number(row.game_id ?? row.id),
    game_id: Number(row.game_id ?? row.id),
    pool_game_id: toNullableNumber(row.pool_game_id),
    pool_id: toNullableNumber(row.pool_id),
    week_num: toNullableNumber(row.week_number ?? row.week_num),
    opponent: buildMatchupDisplayLabel(
      typeof row.home_team === 'string' ? row.home_team : null,
      typeof row.away_team === 'string' ? row.away_team : typeof row.opponent === 'string' ? row.opponent : null,
      { roundLabel, fallback: 'Opponent' }
    ),
    game_dt: row.kickoff_at ?? row.game_date ?? null,
    is_simulation: Boolean(row.is_simulation ?? false),
    row_numbers: Array.isArray(row.row_numbers) ? row.row_numbers : null,
    col_numbers: Array.isArray(row.column_numbers)
      ? row.column_numbers
      : Array.isArray(row.col_numbers)
        ? row.col_numbers
        : null,
    round_label: typeof row.round_label === 'string' ? row.round_label : null,
    round_sequence: toNullableNumber(row.round_sequence),
    bracket_region: typeof row.bracket_region === 'string' ? row.bracket_region : null,
    matchup_order: toNullableNumber(row.matchup_order),
    championship_flg: Boolean(row.championship_flg ?? false),
    q1_primary_score: toNullableNumber(scores['1']?.home),
    q1_opponent_score: toNullableNumber(scores['1']?.away),
    q2_primary_score: toNullableNumber(scores['2']?.home),
    q2_opponent_score: toNullableNumber(scores['2']?.away),
    q3_primary_score: toNullableNumber(scores['3']?.home),
    q3_opponent_score: toNullableNumber(scores['3']?.away),
    q4_primary_score: toNullableNumber(scores['4']?.home),
    q4_opponent_score: toNullableNumber(scores['4']?.away)
  }
}

const loadPoolGameRecord = async (client: PoolClient, gameId: number, poolId?: number) => {
  const result = await client.query(
    `SELECT pg.id AS pool_game_id,
            pg.pool_id,
            pg.row_numbers,
            pg.column_numbers,
            pg.round_label,
            pg.round_sequence,
            pg.bracket_region,
            pg.matchup_order,
            COALESCE(pg.championship_flg, FALSE) AS championship_flg,
            g.id AS game_id,
            g.season_year,
            g.week_number,
            g.game_date,
            g.kickoff_at,
            g.state,
            g.is_simulation,
            g.scores_by_quarter,
            g.current_quarter,
            g.time_remaining_in_quarter,
            g.final_score_home,
            g.final_score_away,
            home.name AS home_team,
            away.name AS away_team
     FROM football_pool.pool_game pg
     JOIN football_pool.game g ON g.id = pg.game_id
     JOIN football_pool.sport_team home ON g.home_team_id = home.id
     JOIN football_pool.sport_team away ON g.away_team_id = away.id
     WHERE g.id = $1
       AND ($2::int IS NULL OR pg.pool_id = $2)
     ORDER BY pg.pool_id ASC
     LIMIT 1`,
    [gameId, poolId ?? null]
  )

  return result.rows[0] ? buildGameResponse(result.rows[0] as Record<string, unknown>) : null
}

const resolveOrCreateNamedSportTeamId = async (
  client: PoolClient,
  teamName: string,
  sportCode: string,
  leagueCode: string
): Promise<number | null> => {
  const normalizedName = teamName.trim()
  if (!normalizedName) {
    return null
  }

  const existingResult = await client.query<{ id: number }>(
    `SELECT id
     FROM football_pool.sport_team
     WHERE league_code = $1
       AND sport_code = $2
       AND LOWER(name) = LOWER($3)
     LIMIT 1`,
    [leagueCode, sportCode, normalizedName]
  )

  if (existingResult.rows[0]?.id != null) {
    return Number(existingResult.rows[0].id)
  }

  const createdResult = await client.query<{ id: number }>(
    `INSERT INTO football_pool.sport_team (name, sport_code, league_code)
     VALUES ($1, $2, $3)
     ON CONFLICT (sport_code, league_code, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [normalizedName, sportCode, leagueCode]
  )

  return createdResult.rows[0]?.id != null ? Number(createdResult.rows[0].id) : null
}

const resolveGameTeams = async (
  client: PoolClient,
  input: z.infer<typeof createGameSchema>
): Promise<{ seasonYear: number; homeTeamId: number; awayTeamId: number; templateCode: string | null }> => {
  const poolResult = await client.query<{
    season: number | null
    pool_type: string | null
    primary_team: string | null
    primary_sport_team_id: number | null
    sport_code: string | null
    league_code: string | null
    template_code: string | null
    winner_loser_flg: boolean | null
  }>(
    `SELECT season,
            COALESCE(pool_type, 'season') AS pool_type,
            primary_team,
            primary_sport_team_id,
            COALESCE(sport_code, 'FOOTBALL') AS sport_code,
            COALESCE(league_code, 'NFL') AS league_code,
            template_code,
            COALESCE(winner_loser_flg, FALSE) AS winner_loser_flg
     FROM football_pool.pool
     WHERE id = $1
     LIMIT 1`,
    [input.poolId]
  )

  const pool = poolResult.rows[0]
  if (!pool) {
    throw new Error('Pool not found')
  }

  const sportCode = String(pool.sport_code ?? 'FOOTBALL')
  const leagueCode = String(pool.league_code ?? 'NFL')
  const poolType = String(pool.pool_type ?? 'season')
  const parsedMatchup = poolType === 'tournament' ? parseMatchupLabel(input.opponent?.trim() ?? '') : null

  let resolvedHomeTeamId = input.homeTeamId ?? null
  if (resolvedHomeTeamId == null && parsedMatchup) {
    resolvedHomeTeamId = await resolveOrCreateNamedSportTeamId(client, parsedMatchup.homeName, sportCode, leagueCode)
  }

  if (resolvedHomeTeamId == null) {
    resolvedHomeTeamId = pool.primary_sport_team_id ?? null
  }

  if (resolvedHomeTeamId == null && pool.primary_team) {
    const homeResult = await client.query<{ id: number }>(
      `SELECT id
       FROM football_pool.sport_team
       WHERE league_code = $1
         AND sport_code = $2
         AND (LOWER(name) = LOWER($3)
           OR LOWER(name) LIKE '%' || LOWER($3) || '%')
       LIMIT 1`,
      [leagueCode, sportCode, pool.primary_team]
    )
    resolvedHomeTeamId = homeResult.rows[0]?.id ?? null

    if (resolvedHomeTeamId == null) {
      const createdHomeResult = await client.query<{ id: number }>(
        `INSERT INTO football_pool.sport_team (name, sport_code, league_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (sport_code, league_code, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [pool.primary_team.trim(), sportCode, leagueCode]
      )
      resolvedHomeTeamId = createdHomeResult.rows[0]?.id ?? null
    }
  }

  let resolvedAwayTeamId = input.awayTeamId ?? null
  const opponentAbbreviation = input.opponentSportTeamAbbr?.trim() || input.opponentNflTeamAbbr?.trim() || ''

  if (resolvedAwayTeamId == null && parsedMatchup) {
    resolvedAwayTeamId = await resolveOrCreateNamedSportTeamId(client, parsedMatchup.awayName, sportCode, leagueCode)
  }

  if (resolvedAwayTeamId == null && opponentAbbreviation) {
    const awayByAbbrResult = await client.query<{ id: number }>(
      `SELECT id
       FROM football_pool.sport_team
       WHERE league_code = $1
         AND sport_code = $2
         AND UPPER(COALESCE(abbreviation, '')) = UPPER($3)
       LIMIT 1`,
      [leagueCode, sportCode, opponentAbbreviation]
    )
    resolvedAwayTeamId = awayByAbbrResult.rows[0]?.id ?? null
  }

  if (resolvedAwayTeamId == null && input.opponent) {
    const awayResult = await client.query<{ id: number }>(
      `SELECT id
       FROM football_pool.sport_team
       WHERE league_code = $1
         AND sport_code = $2
         AND (LOWER(name) = LOWER($3)
           OR LOWER(name) LIKE '%' || LOWER($3) || '%')
       LIMIT 1`,
      [leagueCode, sportCode, input.opponent.trim()]
    )
    resolvedAwayTeamId = awayResult.rows[0]?.id ?? null

    if (resolvedAwayTeamId == null) {
      const createdAwayResult = await client.query<{ id: number }>(
        `INSERT INTO football_pool.sport_team (name, sport_code, league_code)
         VALUES ($1, $2, $3)
         ON CONFLICT (sport_code, league_code, name) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [input.opponent.trim(), sportCode, leagueCode]
      )
      resolvedAwayTeamId = createdAwayResult.rows[0]?.id ?? null
    }
  }

  if (!pool.season) {
    throw new Error('Pool season is required before creating games')
  }

  if (resolvedHomeTeamId == null && poolType === 'tournament') {
    const genericHomeName = pool.primary_team?.trim() || (pool.winner_loser_flg ? 'Winning Score' : 'Home Team')
    const createdHomeResult = await client.query<{ id: number }>(
      `INSERT INTO football_pool.sport_team (name, sport_code, league_code)
       VALUES ($1, $2, $3)
       ON CONFLICT (sport_code, league_code, name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [genericHomeName, sportCode, leagueCode]
    )
    resolvedHomeTeamId = createdHomeResult.rows[0]?.id ?? null
  }

  if (resolvedHomeTeamId == null) {
    throw new Error('Pool primary team could not be resolved in sport_team')
  }

  if (resolvedAwayTeamId == null) {
    throw new Error('Opponent could not be resolved in sport_team')
  }

  return {
    seasonYear: Number(pool.season),
    homeTeamId: Number(resolvedHomeTeamId),
    awayTeamId: Number(resolvedAwayTeamId),
    templateCode: pool.template_code ?? null
  }
}

const resolvePoolGameRoundMetadata = (
  input: z.infer<typeof createGameSchema>,
  templateCode?: string | null
): {
  roundLabel: string | null
  roundSequence: number | null
  bracketRegion: string | null
  matchupOrder: number | null
  championshipFlg: boolean
} => {
  const roundLabel = input.roundLabel?.trim() || null
  const derivedSequence = resolveTemplateRoundSequence(templateCode ?? null, roundLabel)
  const championshipFlg = Boolean(input.isChampionship || (roundLabel && /championship/i.test(roundLabel)))

  return {
    roundLabel: championshipFlg && !roundLabel ? 'Championship' : roundLabel,
    roundSequence: input.roundSequence ?? derivedSequence ?? input.weekNum ?? null,
    bracketRegion: input.bracketRegion?.trim() || null,
    matchupOrder: input.matchupOrder ?? null,
    championshipFlg
  }
}

const resolveWeekNumber = async (
  client: PoolClient,
  poolId: number,
  weekNum: number | null | undefined,
  gameId?: number
): Promise<number> => {
  if (weekNum != null) {
    return Number(weekNum)
  }

  if (gameId != null) {
    const existingResult = await client.query<{ week_number: number | null }>(
      `SELECT week_number
       FROM football_pool.game
       WHERE id = $1
       LIMIT 1`,
      [gameId]
    )

    const existingWeekNum = existingResult.rows[0]?.week_number
    if (existingWeekNum != null) {
      return Number(existingWeekNum)
    }
  }

  const nextResult = await client.query<{ next_week_number: number }>(
    `SELECT COALESCE(MAX(g.week_number), 0) + 1 AS next_week_number
     FROM football_pool.pool_game pg
     JOIN football_pool.game g ON g.id = pg.game_id
     WHERE pg.pool_id = $1`,
    [poolId]
  )

  return Number(nextResult.rows[0]?.next_week_number ?? 1)
}

// POST /api/games - Create a new normalized shared game and link it to a pool
gamesRouter.post('/', async (req, res) => {
  try {
    const input = createGameSchema.parse(req.body)
    const client = await db.connect()

    try {
      await ensurePoolGameStructureSupport(client)
      await client.query('BEGIN')
      const resolved = await resolveGameTeams(client, input)
      const resolvedWeekNum = await resolveWeekNumber(client, input.poolId, input.weekNum)
      const roundMetadata = resolvePoolGameRoundMetadata(input, resolved.templateCode)

      const gameResult = await client.query<{ id: number }>(
        `INSERT INTO football_pool.game (
           season_year,
           week_number,
           home_team_id,
           away_team_id,
           game_date,
           kickoff_at,
           state,
           is_simulation,
           scores_by_quarter,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5::date, $5::timestamp, 'scheduled', $6, '{}'::jsonb, NOW(), NOW())
         ON CONFLICT (season_year, week_number, home_team_id, away_team_id, game_date)
         DO UPDATE SET
           kickoff_at = EXCLUDED.kickoff_at,
           is_simulation = EXCLUDED.is_simulation,
           updated_at = NOW()
         RETURNING id`,
        [resolved.seasonYear, resolvedWeekNum, resolved.homeTeamId, resolved.awayTeamId, input.gameDate, input.isSimulation]
      )

      const gameId = Number(gameResult.rows[0]?.id)

      const poolGameResult = await client.query(
        `INSERT INTO football_pool.pool_game (
           pool_id,
           game_id,
           row_numbers,
           column_numbers,
           round_label,
           round_sequence,
           bracket_region,
           matchup_order,
           championship_flg,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
         ON CONFLICT (pool_id, game_id)
         DO UPDATE SET
           row_numbers = EXCLUDED.row_numbers,
           column_numbers = EXCLUDED.column_numbers,
           round_label = EXCLUDED.round_label,
           round_sequence = EXCLUDED.round_sequence,
           bracket_region = EXCLUDED.bracket_region,
           matchup_order = EXCLUDED.matchup_order,
           championship_flg = EXCLUDED.championship_flg,
           updated_at = NOW()
         RETURNING *`,
        [
          input.poolId,
          gameId,
          input.rowNumbers ?? null,
          input.columnNumbers ?? null,
          roundMetadata.roundLabel,
          roundMetadata.roundSequence,
          roundMetadata.bracketRegion,
          roundMetadata.matchupOrder,
          roundMetadata.championshipFlg
        ]
      )

      await syncPoolGameBoardNumbers(client, input.poolId, { onlyGameId: gameId })
      const game = await loadPoolGameRecord(client, gameId, input.poolId)

      await client.query('COMMIT')
      res.json({ message: 'Game created', game, poolGame: poolGameResult.rows[0] })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors })
    } else {
      console.error('Game creation error:', error)
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to create game' })
    }
  }
})

// POST /api/games/import/pool/:poolId - Look up and auto-fill the season schedule for the pool's preferred team
gamesRouter.post('/import/pool/:poolId', async (req, res) => {
  try {
    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.params);

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await importPoolScheduleFromEspn(client, poolId);
      await client.query('COMMIT');

      return res.json({
        message: `Fill Schedule complete for ${result.teamName} (${result.season}). Added ${result.created} missing game(s) and skipped ${result.skipped} existing game(s).`,
        result
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.errors });
    }

    console.error('Game schedule import error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to import schedule'
    });
  }
});

// PATCH /api/games/:gameId - Update a normalized game schedule
gamesRouter.patch('/:gameId', async (req, res) => {
  try {
    const { gameId } = gameIdParamsSchema.parse(req.params)
    const input = createGameSchema.parse(req.body)
    const client = await db.connect()

    try {
      await ensurePoolGameStructureSupport(client)
      await client.query('BEGIN')
      const resolved = await resolveGameTeams(client, input)
      const resolvedWeekNum = await resolveWeekNumber(client, input.poolId, input.weekNum, gameId)
      const roundMetadata = resolvePoolGameRoundMetadata(input, resolved.templateCode)

      await client.query(
        `UPDATE football_pool.game
         SET week_number = $1,
             home_team_id = $2,
             away_team_id = $3,
             game_date = $4::date,
             kickoff_at = $4::timestamp,
             is_simulation = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [resolvedWeekNum, resolved.homeTeamId, resolved.awayTeamId, input.gameDate, input.isSimulation, gameId]
      )

      const poolGameResult = await client.query(
        `UPDATE football_pool.pool_game
         SET row_numbers = $1,
             column_numbers = $2,
             round_label = $3,
             round_sequence = $4,
             bracket_region = $5,
             matchup_order = $6,
             championship_flg = $7,
             updated_at = NOW()
         WHERE game_id = $8
           AND pool_id = $9
         RETURNING *`,
        [
          input.rowNumbers ?? null,
          input.columnNumbers ?? null,
          roundMetadata.roundLabel,
          roundMetadata.roundSequence,
          roundMetadata.bracketRegion,
          roundMetadata.matchupOrder,
          roundMetadata.championshipFlg,
          gameId,
          input.poolId
        ]
      )

      await syncPoolGameBoardNumbers(client, input.poolId, { onlyGameId: gameId })
      await client.query('COMMIT')

      if (poolGameResult.rows.length === 0) {
        return res.status(404).json({ error: 'Game not found for this pool' })
      }

      const game = await loadPoolGameRecord(client, gameId, input.poolId)
      res.json({ message: 'Game updated', game, poolGame: poolGameResult.rows[0] })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors })
    } else {
      console.error('Game update error:', error)
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to update game' })
    }
  }
})

// PATCH /api/games/:gameId/scores - Update game scores and calculate winners (normalized)
gamesRouter.patch('/:gameId/scores', async (req, res) => {
  try {
    const { gameId } = z.object({ gameId: z.coerce.number().int().positive() }).parse(req.params);
    const scores = scoreUpdateSchema.parse(req.body);
    const result = await ingestGameScores(gameId, 'payload', scores, { forceProcess: true })

    res.json({
      message: 'Scores updated and winners calculated',
      ...result,
      game: {
        id: result.gameId,
        q1_primary_score: result.scores.q1PrimaryScore,
        q1_opponent_score: result.scores.q1OpponentScore,
        q2_primary_score: result.scores.q2PrimaryScore,
        q2_opponent_score: result.scores.q2OpponentScore,
        q3_primary_score: result.scores.q3PrimaryScore,
        q3_opponent_score: result.scores.q3OpponentScore,
        q4_primary_score: result.scores.q4PrimaryScore,
        q4_opponent_score: result.scores.q4OpponentScore,
        state: result.state,
        current_quarter: result.currentQuarter,
        time_remaining_in_quarter: result.timeRemainingInQuarter
      }
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else if (error instanceof Error && error.message === 'Game not found') {
      res.status(404).json({ error: error.message });
    } else if (error instanceof Error && error.message === 'Pool not found') {
      res.status(404).json({ error: error.message });
    } else {
      console.error('Score update error:', error);
      res.status(500).json({ error: 'Failed to update scores' });
    }
  }
});

// DELETE /api/games/:gameId - Delete a game schedule (normalized)
gamesRouter.delete('/:gameId', async (req, res) => {
  try {
    const { gameId } = gameIdParamsSchema.parse(req.params);
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const winningsCheck = await client.query<{ ref_count: number }>(
        `SELECT COUNT(*)::int AS ref_count
         FROM football_pool.winnings_ledger
         WHERE game_id = $1`,
        [gameId]
      );
      if ((winningsCheck.rows[0]?.ref_count ?? 0) > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Cannot delete a game that already has winnings recorded.' });
      }
      // Delete from pool_game first
      await client.query(
        `DELETE FROM football_pool.pool_game WHERE game_id = $1`,
        [gameId]
      );
      const deleteResult = await client.query(
        `DELETE FROM football_pool.game WHERE id = $1 RETURNING id`,
        [gameId]
      );
      if (deleteResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Game not found' });
      }
      await client.query('COMMIT');
      res.json({ message: 'Game deleted', id: gameId });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Game delete error:', error);
      res.status(500).json({ error: 'Failed to delete game' });
    }
  }
});

// GET /api/games - List all games for a pool (normalized)
gamesRouter.get('/', async (req, res) => {
  try {
    const { poolId } = z.object({ poolId: z.coerce.number().int().positive() }).parse(req.query);
    const client = await db.connect();
    try {
      await ensurePoolGameStructureSupport(client)
      const result = await client.query(
        `SELECT pg.id AS pool_game_id,
                pg.pool_id,
                pg.row_numbers,
                pg.column_numbers,
                pg.round_label,
                pg.round_sequence,
                pg.bracket_region,
                pg.matchup_order,
                COALESCE(pg.championship_flg, FALSE) AS championship_flg,
                g.id AS game_id,
                g.season_year,
                g.week_number,
                g.game_date,
                g.kickoff_at,
                g.state,
                g.is_simulation,
                g.scores_by_quarter,
                g.current_quarter,
                g.time_remaining_in_quarter,
                g.final_score_home,
                g.final_score_away,
                home.name AS home_team,
                away.name AS away_team
         FROM football_pool.pool_game pg
         JOIN football_pool.game g ON g.id = pg.game_id
         JOIN football_pool.sport_team home ON g.home_team_id = home.id
         JOIN football_pool.sport_team away ON g.away_team_id = away.id
         WHERE pg.pool_id = $1
         ORDER BY COALESCE(pg.round_sequence, g.week_number, 9999),
                  COALESCE(pg.matchup_order, 9999),
                  COALESCE(g.kickoff_at, g.game_date::timestamp),
                  g.id`,
        [poolId]
      )
      res.json(result.rows.map((row) => buildGameResponse(row as Record<string, unknown>)))
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Games list error:', error);
      res.status(500).json({ error: 'Failed to fetch games' });
    }
  }
});

// GET /api/games/:gameId - Get a specific game (normalized)
gamesRouter.get('/:gameId', async (req, res) => {
  try {
    const { gameId } = z.object({ gameId: z.coerce.number().int().positive() }).parse(req.params);
    const client = await db.connect();
    try {
      await ensurePoolGameStructureSupport(client)
      const result = await client.query(
        `SELECT pg.id AS pool_game_id,
                pg.pool_id,
                pg.row_numbers,
                pg.column_numbers,
                pg.round_label,
                pg.round_sequence,
                pg.bracket_region,
                pg.matchup_order,
                COALESCE(pg.championship_flg, FALSE) AS championship_flg,
                g.id AS game_id,
                g.season_year,
                g.week_number,
                g.game_date,
                g.kickoff_at,
                g.state,
                g.is_simulation,
                g.scores_by_quarter,
                g.current_quarter,
                g.time_remaining_in_quarter,
                g.final_score_home,
                g.final_score_away,
                home.name AS home_team,
                away.name AS away_team
         FROM football_pool.pool_game pg
         JOIN football_pool.game g ON g.id = pg.game_id
         JOIN football_pool.sport_team home ON g.home_team_id = home.id
         JOIN football_pool.sport_team away ON g.away_team_id = away.id
         WHERE pg.game_id = $1
         LIMIT 1`,
        [gameId]
      )
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Game not found' })
      }
      res.json(buildGameResponse(result.rows[0] as Record<string, unknown>))
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: error.errors });
    } else {
      console.error('Game fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch game' });
    }
  }
});

