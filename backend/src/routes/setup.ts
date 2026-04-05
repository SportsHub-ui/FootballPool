import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { db } from '../config/db';
import { env } from '../config/env';
import { requireRole } from '../middleware/auth';
import {
  advancePoolSeasonSimulation,
  cleanupPoolSeasonSimulation,
  createPoolSeasonSimulation,
  getPoolSimulationStatus
} from '../services/poolSimulation';
import { ensurePoolSquaresInitialized } from '../services/poolSquares';

export const setupRouter = Router();

const imageDir = path.resolve(__dirname, '../../images');
fs.mkdirSync(imageDir, { recursive: true });

const buildSafeUploadFileName = (originalName: string): string => {
  const safeBase = path
    .basename(originalName, path.extname(originalName))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'team-logo';

  return `${Date.now()}-${safeBase}${path.extname(originalName).toLowerCase()}`;
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    cb(null, allowed.includes(file.mimetype));
  }
});

const optionalEmailSchema = z
  .string()
  .trim()
  .email()
  .optional()
  .or(z.literal(''));

const optionalPhoneSchema = z
  .string()
  .trim()
  .min(7)
  .optional()
  .or(z.literal(''));

const optionalVenmoAcctSchema = z
  .string()
  .trim()
  .max(255)
  .optional()
  .or(z.literal(''));

const createUserSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: optionalEmailSchema,
  phone: optionalPhoneSchema,
  venmoAcct: optionalVenmoAcctSchema,
  isPlayer: z.boolean().optional(),
  playerTeams: z
    .array(
      z.object({
        teamId: z.number().int().positive(),
        jerseyNum: z.number().int().min(0).max(99)
      })
    )
    .optional(),
  poolIds: z.array(z.number().int().positive()).optional()
});

const updateUserSchema = createUserSchema.extend({
  isPlayer: z.boolean().optional(),
  playerTeams: z
    .array(
      z.object({
        teamId: z.number().int().positive(),
        jerseyNum: z.number().int().min(0).max(99)
      })
    )
    .optional()
});

const createTeamSchema = z.object({
  teamName: z.string().min(1),
  primaryColor: z.string().min(1).optional(),
  secondaryColor: z.string().min(1).optional(),
  logoFile: z.string().min(1).optional(),
  primaryContactId: z.number().int().positive().optional(),
  secondaryContactId: z.number().int().positive().optional()
});

const updateTeamSchema = createTeamSchema;

const createPoolSchema = z.object({
  poolName: z.string().min(1),
  teamId: z.number().int().positive(),
  season: z.number().int().min(2000).max(2100),
  primaryTeam: z.string().min(1),
  squareCost: z.number().int().nonnegative(),
  q1Payout: z.number().int().nonnegative(),
  q2Payout: z.number().int().nonnegative(),
  q3Payout: z.number().int().nonnegative(),
  q4Payout: z.number().int().nonnegative()
});

const updatePoolSchema = createPoolSchema;

const createPlayerSchema = z.object({
  teamId: z.number().int().positive(),
  userId: z.number().int().positive(),
  jerseyNum: z.number().int().min(0).max(99)
});

const updatePlayerSchema = z.object({
  userId: z.number().int().positive(),
  jerseyNum: z.number().int().min(0).max(99)
});

const poolIdParams = z.object({
  poolId: z.coerce.number().int().positive()
});

const createSimulationSchema = z.object({
  mode: z.enum(['full_year', 'by_game', 'by_quarter']).default('full_year')
});

const advanceSimulationSchema = z.object({
  source: z.enum(['espn', 'mock']).optional()
});

const userIdParams = z.object({
  userId: z.coerce.number().int().positive()
});

const teamIdParams = z.object({
  teamId: z.coerce.number().int().positive()
});

const imageIdParams = z.object({
  imageId: z.coerce.number().int().positive()
});

const playerIdParams = z.object({
  playerId: z.coerce.number().int().positive()
});

const squareParams = z.object({
  poolId: z.coerce.number().int().positive(),
  squareNum: z.coerce.number().int().min(1).max(100)
});

const assignSquareSchema = z.object({
  participantId: z.number().int().positive().nullable(),
  playerId: z.number().int().positive().nullable(),
  paidFlg: z.boolean().optional(),
  reassign: z.boolean().optional()
});

setupRouter.get('/images/:imageId/file', async (req, res) => {
  const parsedParams = imageIdParams.safeParse(req.params);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  try {
    const result = await db.query<{
      file_name: string | null;
      content_type: string | null;
      image_data: Buffer;
    }>(
      `
        SELECT file_name, content_type, image_data
        FROM football_pool.uploaded_image
        WHERE id = $1
        LIMIT 1
      `,
      [parsedParams.data.imageId]
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Image not found' });
      return;
    }

    const image = result.rows[0];
    const safeFileName = (image.file_name ?? `image-${parsedParams.data.imageId}`).replace(/[^a-zA-Z0-9._-]/g, '_');

    res.setHeader('Content-Type', image.content_type ?? 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${safeFileName}"`);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(image.image_data);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load image',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

setupRouter.use(requireRole('organizer'));

setupRouter.post('/images/upload', (req, res) => {
  upload.single('image')(req, res, async (error: unknown) => {
    if (error) {
      if (error instanceof multer.MulterError) {
        const message =
          error.code === 'LIMIT_FILE_SIZE'
            ? 'Image is too large. Max allowed size is 2MB.'
            : `Upload error: ${error.message}`;
        res.status(400).json({ error: message });
        return;
      }

      res.status(400).json({
        error: error instanceof Error ? error.message : 'Image upload failed'
      });
      return;
    }

    if (!req.file?.buffer) {
      res.status(400).json({ error: 'Image upload failed or file type is unsupported' });
      return;
    }

    const client = await db.connect();

    try {
      await client.query('BEGIN');
      const id = await nextId(client, 'uploaded_image');
      const fileName = buildSafeUploadFileName(req.file.originalname);

      await client.query(
        `
          INSERT INTO football_pool.uploaded_image (
            id,
            file_name,
            original_name,
            content_type,
            image_data,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, NOW())
        `,
        [
          id,
          fileName,
          req.file.originalname,
          req.file.mimetype || 'application/octet-stream',
          req.file.buffer
        ]
      );

      await client.query('COMMIT');
      res.status(201).json({
        fileName,
        filePath: `/api/setup/images/${id}/file`
      });
    } catch (uploadError) {
      await client.query('ROLLBACK');
      res.status(500).json({
        error: 'Failed to save image',
        detail: uploadError instanceof Error ? uploadError.message : 'Unknown error'
      });
    } finally {
      client.release();
    }
  });
});

const nextId = async (client: PoolClient, tableName: string): Promise<number> => {
  const lockSql = `LOCK TABLE football_pool.${tableName} IN EXCLUSIVE MODE`;
  await client.query(lockSql);

  const idResult = await client.query<{ next_id: number }>(
    `
      SELECT COALESCE(MAX(id), 0) + 1 AS next_id
      FROM football_pool.${tableName}
    `
  );

  return idResult.rows[0].next_id;
};

const hasDuplicateTeamAssignments = (assignments: Array<{ teamId: number; jerseyNum: number }>): boolean => {
  const uniqueTeamIds = new Set<number>();
  for (const assignment of assignments) {
    if (uniqueTeamIds.has(assignment.teamId)) {
      return true;
    }
    uniqueTeamIds.add(assignment.teamId);
  }

  return false;
};

const hasDuplicateIds = (ids: number[]): boolean => new Set(ids).size !== ids.length;

const syncUserPlayerFlag = async (client: PoolClient, userId: number): Promise<void> => {
  const assignmentCount = await client.query<{ assignment_count: number }>(
    `
      SELECT COUNT(*)::int AS assignment_count
      FROM football_pool.player_team
      WHERE user_id = $1
    `,
    [userId]
  );

  await client.query(
    `
      UPDATE football_pool.users
      SET is_player_flg = $2
      WHERE id = $1
    `,
    [userId, (assignmentCount.rows[0]?.assignment_count ?? 0) > 0]
  );
};

const syncUserPoolAssignments = async (client: PoolClient, userId: number, poolIds: number[]): Promise<void> => {
  const uniquePoolIds = Array.from(new Set(poolIds));

  await client.query(
    `
      DELETE FROM football_pool.user_pool
      WHERE user_id = $1
    `,
    [userId]
  );

  for (const poolId of uniquePoolIds) {
    const userPoolId = await nextId(client, 'user_pool');

    await client.query(
      `
        INSERT INTO football_pool.user_pool (id, user_id, pool_id, created_at)
        VALUES ($1, $2, $3, NOW())
      `,
      [userPoolId, userId, poolId]
    );
  }
};

const createPlayerTeamAssignment = async (
  client: PoolClient,
  userId: number,
  teamId: number,
  jerseyNum: number
): Promise<number> => {
  const duplicateCheck = await client.query<{ id: number }>(
    `
      SELECT id
      FROM football_pool.player_team
      WHERE user_id = $1
        AND team_id = $2
      LIMIT 1
    `,
    [userId, teamId]
  );

  if ((duplicateCheck.rowCount ?? 0) > 0) {
    throw new Error('Player is already assigned to this team.');
  }

  const playerTeamId = await nextId(client, 'player_team');

  await client.query(
    `
      INSERT INTO football_pool.player_team (id, user_id, team_id, jersey_num, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `,
    [playerTeamId, userId, teamId, jerseyNum]
  );

  await client.query(
    `
      UPDATE football_pool.users
      SET is_player_flg = TRUE
      WHERE id = $1
    `,
    [userId]
  );

  return playerTeamId;
};

setupRouter.post('/users', async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  if (parsed.data.isPlayer && hasDuplicateTeamAssignments(parsed.data.playerTeams ?? [])) {
    res.status(400).json({ error: 'A player cannot be assigned to the same team more than once.' });
    return;
  }

  if (hasDuplicateIds(parsed.data.poolIds ?? [])) {
    res.status(400).json({ error: 'A user cannot be assigned to the same pool more than once.' });
    return;
  }

  const client = await db.connect();

  try {
    const dupCheck = await client.query<{ id: number }>(
      `SELECT id FROM football_pool.users
       WHERE lower(first_name) = lower($1)
         AND lower(last_name)  = lower($2)
         AND lower(coalesce(email, '')) = lower(coalesce($3, ''))`,
      [parsed.data.firstName, parsed.data.lastName, parsed.data.email ?? null]
    );
    if (dupCheck.rows.length > 0) {
      client.release();
      res.status(409).json({ error: 'A user with the same first name, last name, and email already exists.' });
      return;
    }

    await client.query('BEGIN');
    const id = await nextId(client, 'users');

    await client.query(
      `
        INSERT INTO football_pool.users (id, first_name, last_name, email, phone, venmo_acct, created_at, is_player_flg)
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
      `,
      [
        id,
        parsed.data.firstName,
        parsed.data.lastName,
        parsed.data.email ? parsed.data.email : null,
        parsed.data.phone ? parsed.data.phone : null,
        parsed.data.venmoAcct ? parsed.data.venmoAcct : null,
        parsed.data.isPlayer ?? false
      ]
    );

    if (parsed.data.isPlayer) {
      const assignments = parsed.data.playerTeams ?? [];
      for (const assignment of assignments) {
        await createPlayerTeamAssignment(client, id, assignment.teamId, assignment.jerseyNum);
      }
    }

    if (parsed.data.poolIds) {
      await syncUserPoolAssignments(client, id, parsed.data.poolIds);
    }

    await client.query('COMMIT');
    res.status(201).json({ id });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to create user',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.post('/teams', async (req, res) => {
  const parsed = createTeamSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const id = await nextId(client, 'team');

    await client.query(
      `
        INSERT INTO football_pool.team (
          id,
          team_name,
          primary_color,
          secondary_color,
          logo_file,
          primary_contact_id,
          secondary_contact_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `,
      [
        id,
        parsed.data.teamName,
        parsed.data.primaryColor ?? null,
        parsed.data.secondaryColor ?? null,
        parsed.data.logoFile ?? null,
        parsed.data.primaryContactId ?? null,
        parsed.data.secondaryContactId ?? null
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ id });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to create team',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.post('/players', async (req, res) => {
  const parsed = createPlayerSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const duplicateCheck = await client.query<{ id: number }>(
      `
        SELECT id
        FROM football_pool.player_team
        WHERE team_id = $1
          AND user_id = $2
        LIMIT 1
      `,
      [parsed.data.teamId, parsed.data.userId]
    );

    if ((duplicateCheck.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Player is already assigned to this team.' });
      return;
    }

    const id = await createPlayerTeamAssignment(client, parsed.data.userId, parsed.data.teamId, parsed.data.jerseyNum);

    await client.query('COMMIT');
    res.status(201).json({ id });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to create player',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.patch('/players/:playerId', async (req, res) => {
  const parsedParams = playerIdParams.safeParse(req.params);
  const parsedBody = updatePlayerSchema.safeParse(req.body);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const targetPlayer = await client.query<{ team_id: number; user_id: number }>(
      `
        SELECT team_id, user_id
        FROM football_pool.player_team
        WHERE id = $1
        FOR UPDATE
      `,
      [parsedParams.data.playerId]
    );

    if (targetPlayer.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    const duplicateCheck = await client.query<{ id: number }>(
      `
        SELECT id
        FROM football_pool.player_team
        WHERE team_id = $1
          AND user_id = $2
          AND id <> $3
        LIMIT 1
      `,
      [targetPlayer.rows[0].team_id, parsedBody.data.userId, parsedParams.data.playerId]
    );

    if ((duplicateCheck.rowCount ?? 0) > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Player is already assigned to this team.' });
      return;
    }

    const result = await client.query(
      `
        UPDATE football_pool.player_team
        SET
          user_id = $2,
          jersey_num = $3
        WHERE id = $1
        RETURNING id
      `,
      [parsedParams.data.playerId, parsedBody.data.userId, parsedBody.data.jerseyNum]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    await syncUserPlayerFlag(client, targetPlayer.rows[0].user_id);
    await syncUserPlayerFlag(client, parsedBody.data.userId);
    await client.query('COMMIT');

    res.json({ id: parsedParams.data.playerId, message: 'Player updated' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to update player',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.delete('/players/:playerId', async (req, res) => {
  const parsedParams = playerIdParams.safeParse(req.params);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const assignmentResult = await client.query<{ user_id: number }>(
      `
        SELECT user_id
        FROM football_pool.player_team
        WHERE id = $1
        FOR UPDATE
      `,
      [parsedParams.data.playerId]
    );

    if (assignmentResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    const squareRefResult = await client.query<{ ref_count: number }>(
      `
        SELECT COUNT(*)::int AS ref_count
        FROM football_pool.square
        WHERE player_id = $1
      `,
      [parsedParams.data.playerId]
    );

    if ((squareRefResult.rows[0]?.ref_count ?? 0) > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Cannot delete player while squares are still linked to this player.' });
      return;
    }

    await client.query(
      `
        DELETE FROM football_pool.player_team
        WHERE id = $1
      `,
      [parsedParams.data.playerId]
    );

    await syncUserPlayerFlag(client, assignmentResult.rows[0].user_id);
    await client.query('COMMIT');

    res.json({ id: parsedParams.data.playerId, message: 'Player deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to delete player',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.post('/pools', async (req, res) => {
  const parsed = createPoolSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const id = await nextId(client, 'pool');

    await client.query(
      `
        INSERT INTO football_pool.pool (
          id,
          pool_name,
          team_id,
          season,
          primary_team,
          square_cost,
          q1_payout,
          q2_payout,
          q3_payout,
          q4_payout,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      `,
      [
        id,
        parsed.data.poolName,
        parsed.data.teamId,
        parsed.data.season,
        parsed.data.primaryTeam,
        parsed.data.squareCost,
        parsed.data.q1Payout,
        parsed.data.q2Payout,
        parsed.data.q3Payout,
        parsed.data.q4Payout
      ]
    );

    await ensurePoolSquaresInitialized(client, id);

    await client.query('COMMIT');
    res.status(201).json({ id });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to create pool',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.post('/pools/:poolId/squares/init', async (req, res) => {
  const parsedParams = poolIdParams.safeParse(req.params);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const initResult = await ensurePoolSquaresInitialized(client, parsedParams.data.poolId);

    await client.query('COMMIT');
    res.status(initResult.insertedCount > 0 ? 201 : 200).json({
      message: initResult.insertedCount > 0 ? 'Initialized pool squares' : 'Pool squares already initialized',
      poolId: parsedParams.data.poolId,
      squareCount: initResult.totalCount,
      insertedCount: initResult.insertedCount
    });
  } catch (error) {
    await client.query('ROLLBACK');

    if (error instanceof Error && error.message === 'Pool not found') {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    res.status(500).json({
      error: 'Failed to initialize squares',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.get('/pools/:poolId/simulation', async (req, res) => {
  const parsedParams = poolIdParams.safeParse(req.params);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    const status = await getPoolSimulationStatus(client, parsedParams.data.poolId);
    res.json({
      environment: env.APP_ENV,
      status
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Pool not found.') {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    res.status(500).json({
      error: 'Failed to load simulation status',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.post('/pools/:poolId/simulation', async (req, res) => {
  const parsedParams = poolIdParams.safeParse(req.params);
  const parsedBody = createSimulationSchema.safeParse(req.body ?? {});

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const result = await createPoolSeasonSimulation(
      client,
      parsedParams.data.poolId,
      parsedBody.data.mode
    );
    await client.query('COMMIT');

    const modeLabel =
      result.mode === 'full_year'
        ? 'Full Year'
        : result.mode === 'by_game'
          ? 'By Game'
          : 'By Quarter';

    res.status(201).json({
      message:
        result.mode === 'full_year'
          ? `Simulation complete for ${result.teamName} (${result.season}). ${result.simulatedGames} games simulated and ${result.assignedSquares} squares assigned.`
          : `Simulation started for ${result.teamName} (${result.season}) in ${modeLabel} mode. ${result.assignedSquares} squares assigned.`,
      result
    });
  } catch (error) {
    await client.query('ROLLBACK');

    if (error instanceof Error && error.message === 'Pool not found.') {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    if (error instanceof Error && /disabled by configuration/i.test(error.message)) {
      res.status(403).json({ error: error.message });
      return;
    }

    if (error instanceof Error && /not ready for simulation/i.test(error.message)) {
      res.status(409).json({ error: error.message });
      return;
    }

    res.status(500).json({
      error: 'Failed to create simulation',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.post('/pools/:poolId/simulation/advance', async (req, res) => {
  const parsedParams = poolIdParams.safeParse(req.params);
  const parsedBody = advanceSimulationSchema.safeParse(req.body ?? {});

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.issues });
    return;
  }

  const client = await db.connect();
  const requestedSource = parsedBody.data.source ?? 'espn';

  try {
    await client.query('BEGIN');
    const result = await advancePoolSeasonSimulation(client, parsedParams.data.poolId, requestedSource);
    await client.query('COMMIT');

    res.status(200).json(result);
  } catch (error) {
    await client.query('ROLLBACK');

    const shouldFallbackToMock =
      requestedSource === 'espn' &&
      error instanceof Error &&
      /(No matching ESPN game found|Failed to fetch ESPN|has not posted)/i.test(error.message);

    if (shouldFallbackToMock) {
      try {
        await client.query('BEGIN');
        const fallbackResult = await advancePoolSeasonSimulation(client, parsedParams.data.poolId, 'mock');
        await client.query('COMMIT');

        res.status(200).json({
          ...fallbackResult,
          message: `${fallbackResult.message} ESPN scores were unavailable, so mock scores were used instead.`
        });
        return;
      } catch (fallbackError) {
        await client.query('ROLLBACK');
        error = fallbackError;
      }
    }

    if (error instanceof Error && /no step-by-step simulation is active/i.test(error.message)) {
      res.status(409).json({ error: error.message });
      return;
    }

    if (error instanceof Error && /has not posted/i.test(error.message)) {
      res.status(409).json({ error: error.message });
      return;
    }

    if (error instanceof Error && /disabled by configuration/i.test(error.message)) {
      res.status(403).json({ error: error.message });
      return;
    }

    res.status(500).json({
      error: 'Failed to advance simulation',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.delete('/pools/:poolId/simulation', async (req, res) => {
  const parsedParams = poolIdParams.safeParse(req.params);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const result = await cleanupPoolSeasonSimulation(client, parsedParams.data.poolId);
    await client.query('COMMIT');

    res.json({
      message: `Simulation cleanup complete. Removed ${result.deletedGames} simulated games and cleared ${result.clearedSquares} square assignments.`,
      result
    });
  } catch (error) {
    await client.query('ROLLBACK');

    if (error instanceof Error && /disabled in production/i.test(error.message)) {
      res.status(403).json({ error: error.message });
      return;
    }

    res.status(500).json({
      error: 'Failed to clean up simulation',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.get('/users', async (_req, res) => {
  try {
    const result = await db.query(
      `
        SELECT
          u.id,
          u.first_name,
          u.last_name,
          u.email,
          u.phone,
          u.venmo_acct,
          u.is_player_flg,
          pt.team_id,
          pt.jersey_num,
          t.team_name
        FROM football_pool.users u
        LEFT JOIN football_pool.player_team pt ON pt.user_id = u.id
        LEFT JOIN football_pool.team t ON t.id = pt.team_id
        ORDER BY u.last_name, u.first_name, u.id, pt.team_id
        LIMIT 500
      `
    );

    type UserWithTeams = {
      id: number;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      phone: string | null;
      venmo_acct: string | null;
      is_player_flg: boolean;
      player_teams: Array<{ team_id: number; team_name: string | null; jersey_num: number }>;
    };

    const usersMap = new Map<number, UserWithTeams>();

    for (const row of result.rows) {
      const id = Number(row.id);
      const existing: UserWithTeams = usersMap.get(id) ?? {
        id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
        phone: row.phone,
        venmo_acct: row.venmo_acct,
        is_player_flg: Boolean(row.is_player_flg),
        player_teams: []
      };

      if (row.team_id != null) {
        existing.player_teams.push({
          team_id: Number(row.team_id),
          team_name: row.team_name,
          jersey_num: Number(row.jersey_num)
        });
      }

      usersMap.set(id, existing);
    }

    const users = Array.from(usersMap.values());
    res.json({ users });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load users',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

setupRouter.patch('/users/:userId', async (req, res) => {
  const parsedParams = userIdParams.safeParse(req.params);
  const parsedBody = updateUserSchema.safeParse(req.body);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.issues });
    return;
  }

  if (parsedBody.data.isPlayer && hasDuplicateTeamAssignments(parsedBody.data.playerTeams ?? [])) {
    res.status(400).json({ error: 'A player cannot be assigned to the same team more than once.' });
    return;
  }

  if (hasDuplicateIds(parsedBody.data.poolIds ?? [])) {
    res.status(400).json({ error: 'A user cannot be assigned to the same pool more than once.' });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
        UPDATE football_pool.users
        SET
          first_name = $2,
          last_name = $3,
          email = $4,
          phone = $5,
          venmo_acct = $6,
          is_player_flg = COALESCE($7, is_player_flg)
        WHERE id = $1
        RETURNING id
      `,
      [
        parsedParams.data.userId,
        parsedBody.data.firstName,
        parsedBody.data.lastName,
        parsedBody.data.email ? parsedBody.data.email : null,
        parsedBody.data.phone ? parsedBody.data.phone : null,
        parsedBody.data.venmoAcct ? parsedBody.data.venmoAcct : null,
        parsedBody.data.isPlayer ?? null
      ]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (parsedBody.data.isPlayer !== undefined) {
      const assignments = parsedBody.data.isPlayer ? parsedBody.data.playerTeams ?? [] : [];

      await client.query(
        `
          UPDATE football_pool.square AS sq
          SET player_id = NULL
          FROM football_pool.player_team AS pt
          WHERE sq.player_id = pt.id
            AND pt.user_id = $1
        `,
        [parsedParams.data.userId]
      );

      const remainingSquareRefs = await client.query<{ ref_count: number }>(
        `
          SELECT COUNT(*)::int AS ref_count
          FROM football_pool.square AS sq
          JOIN football_pool.player_team AS pt
            ON pt.id = sq.player_id
          WHERE pt.user_id = $1
        `,
        [parsedParams.data.userId]
      );

      if ((remainingSquareRefs.rows[0]?.ref_count ?? 0) > 0) {
        await client.query('ROLLBACK');
        res.status(409).json({ error: 'Cannot reassign player teams while squares are still linked to this player.' });
        return;
      }

      await client.query(
        `
          DELETE FROM football_pool.player_team
          WHERE user_id = $1
        `,
        [parsedParams.data.userId]
      );

      if (assignments.length > 0) {
        for (const assignment of assignments) {
          await createPlayerTeamAssignment(client, parsedParams.data.userId, assignment.teamId, assignment.jerseyNum);
        }
      }
    }

    if (parsedBody.data.poolIds !== undefined) {
      await syncUserPoolAssignments(client, parsedParams.data.userId, parsedBody.data.poolIds);
    }

    await client.query('COMMIT');

    res.json({ id: parsedParams.data.userId, message: 'User updated' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to update user',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.delete('/users/:userId', async (req, res) => {
  const parsedParams = userIdParams.safeParse(req.params);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  try {
    const [teamAssignmentResult, playerAssignmentResult, userPoolAssignmentResult, squareAssignmentResult] = await Promise.all([
      db.query<{ assignment_count: number }>(
        `
          SELECT COUNT(*)::int AS assignment_count
          FROM football_pool.team
          WHERE primary_contact_id = $1
             OR secondary_contact_id = $1
        `,
        [parsedParams.data.userId]
      ),
      db.query<{ assignment_count: number }>(
        `
          SELECT COUNT(*)::int AS assignment_count
          FROM football_pool.player_team
          WHERE user_id = $1
        `,
        [parsedParams.data.userId]
      ),
      db.query<{ assignment_count: number }>(
        `
          SELECT COUNT(*)::int AS assignment_count
          FROM football_pool.user_pool
          WHERE user_id = $1
        `,
        [parsedParams.data.userId]
      ),
      db.query<{ assignment_count: number }>(
        `
          SELECT COUNT(*)::int AS assignment_count
          FROM football_pool.square
          WHERE participant_id = $1
        `,
        [parsedParams.data.userId]
      )
    ]);

    const teamAssignments = teamAssignmentResult.rows[0]?.assignment_count ?? 0;
    const playerAssignments = playerAssignmentResult.rows[0]?.assignment_count ?? 0;
    const userPoolAssignments = userPoolAssignmentResult.rows[0]?.assignment_count ?? 0;
    const squareAssignments = squareAssignmentResult.rows[0]?.assignment_count ?? 0;

    if (teamAssignments > 0 || playerAssignments > 0 || userPoolAssignments > 0 || squareAssignments > 0) {
      res.status(409).json({
        error: 'User cannot be deleted while assigned to teams, pools, or squares.',
        assignments: {
          teamContacts: teamAssignments,
          playerTeams: playerAssignments,
          userPools: userPoolAssignments,
          poolSquares: squareAssignments
        }
      });
      return;
    }

    const deleteResult = await db.query(
      `
        DELETE FROM football_pool.users
        WHERE id = $1
        RETURNING id
      `,
      [parsedParams.data.userId]
    );

    if ((deleteResult.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ id: parsedParams.data.userId, message: 'User deleted' });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to delete user',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

setupRouter.get('/teams', async (_req, res) => {
  try {
    const result = await db.query(
      `
        SELECT
          id,
          team_name,
          primary_color,
          secondary_color,
          logo_file,
          primary_contact_id,
          secondary_contact_id
        FROM football_pool.team
        ORDER BY team_name, id
        LIMIT 500
      `
    );

    res.json({ teams: result.rows });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load teams',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

setupRouter.patch('/teams/:teamId', async (req, res) => {
  const parsedParams = teamIdParams.safeParse(req.params);
  const parsedBody = updateTeamSchema.safeParse(req.body);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.issues });
    return;
  }

  try {
    const result = await db.query(
      `
        UPDATE football_pool.team
        SET
          team_name = $2,
          primary_color = $3,
          secondary_color = $4,
          logo_file = $5,
          primary_contact_id = $6,
          secondary_contact_id = $7
        WHERE id = $1
        RETURNING id
      `,
      [
        parsedParams.data.teamId,
        parsedBody.data.teamName,
        parsedBody.data.primaryColor ?? null,
        parsedBody.data.secondaryColor ?? null,
        parsedBody.data.logoFile ?? null,
        parsedBody.data.primaryContactId ?? null,
        parsedBody.data.secondaryContactId ?? null
      ]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    res.json({ id: parsedParams.data.teamId, message: 'Team updated' });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update team',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

setupRouter.delete('/teams/:teamId', async (req, res) => {
  const parsedParams = teamIdParams.safeParse(req.params);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const refResult = await client.query<{
      pool_refs: number;
      player_refs: number;
    }>(
      `
        SELECT
          (SELECT COUNT(*)::int FROM football_pool.pool WHERE team_id = $1) AS pool_refs,
          (SELECT COUNT(*)::int FROM football_pool.player_team WHERE team_id = $1) AS player_refs
      `,
      [parsedParams.data.teamId]
    );

    const refs = refResult.rows[0];

    if ((refs?.pool_refs ?? 0) > 0 || (refs?.player_refs ?? 0) > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: 'Cannot delete team while pools or player assignments still reference it.'
      });
      return;
    }

    const deleteResult = await client.query(
      `
        DELETE FROM football_pool.team
        WHERE id = $1
        RETURNING id
      `,
      [parsedParams.data.teamId]
    );

    if ((deleteResult.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Team not found' });
      return;
    }

    await client.query('COMMIT');
    res.json({ id: parsedParams.data.teamId, message: 'Team deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to delete team',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.get('/pools', async (_req, res) => {
  try {
    const result = await db.query(
      `
        SELECT
          p.id,
          p.pool_name,
          p.team_id,
          p.season,
          p.primary_team,
          p.square_cost,
          p.q1_payout,
          p.q2_payout,
          p.q3_payout,
          p.q4_payout,
          t.team_name
        FROM football_pool.pool p
        LEFT JOIN football_pool.team t ON t.id = p.team_id
        ORDER BY p.id DESC
        LIMIT 500
      `
    );

    res.json({ pools: result.rows });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load pools',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

setupRouter.patch('/pools/:poolId', async (req, res) => {
  const parsedParams = poolIdParams.safeParse(req.params);
  const parsedBody = updatePoolSchema.safeParse(req.body);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.issues });
    return;
  }

  try {
    const result = await db.query(
      `
        UPDATE football_pool.pool
        SET
          pool_name = $2,
          team_id = $3,
          season = $4,
          primary_team = $5,
          square_cost = $6,
          q1_payout = $7,
          q2_payout = $8,
          q3_payout = $9,
          q4_payout = $10
        WHERE id = $1
        RETURNING id
      `,
      [
        parsedParams.data.poolId,
        parsedBody.data.poolName,
        parsedBody.data.teamId,
        parsedBody.data.season,
        parsedBody.data.primaryTeam,
        parsedBody.data.squareCost,
        parsedBody.data.q1Payout,
        parsedBody.data.q2Payout,
        parsedBody.data.q3Payout,
        parsedBody.data.q4Payout
      ]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    res.json({ id: parsedParams.data.poolId, message: 'Pool updated' });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update pool',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

setupRouter.delete('/pools/:poolId', async (req, res) => {
  const parsedParams = poolIdParams.safeParse(req.params);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    const refResult = await client.query<{
      game_refs: number;
      square_refs: number;
      user_refs: number;
      winnings_refs: number;
    }>(
      `
        SELECT
          (SELECT COUNT(*)::int FROM football_pool.game WHERE pool_id = $1) AS game_refs,
          (SELECT COUNT(*)::int FROM football_pool.square WHERE pool_id = $1) AS square_refs,
          (SELECT COUNT(*)::int FROM football_pool.user_pool WHERE pool_id = $1) AS user_refs,
          (SELECT COUNT(*)::int FROM football_pool.winnings_ledger WHERE pool_id = $1) AS winnings_refs
      `,
      [parsedParams.data.poolId]
    );

    const refs = refResult.rows[0];

    if (
      (refs?.game_refs ?? 0) > 0 ||
      (refs?.square_refs ?? 0) > 0 ||
      (refs?.user_refs ?? 0) > 0 ||
      (refs?.winnings_refs ?? 0) > 0
    ) {
      await client.query('ROLLBACK');
      res.status(409).json({
        error: 'Cannot delete pool while games, squares, users, or winnings still reference it.'
      });
      return;
    }

    const deleteResult = await client.query(
      `
        DELETE FROM football_pool.pool
        WHERE id = $1
        RETURNING id
      `,
      [parsedParams.data.poolId]
    );

    if ((deleteResult.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    await client.query('COMMIT');
    res.json({ id: parsedParams.data.poolId, message: 'Pool deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to delete pool',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.get('/images', async (_req, res) => {
  try {
    const storedImagesResult = await db.query<{ id: number; file_name: string | null }>(
      `
        SELECT id, file_name
        FROM football_pool.uploaded_image
        ORDER BY created_at DESC, id DESC
        LIMIT 200
      `
    );

    const storedImages = storedImagesResult.rows.map((row) => ({
      fileName: row.file_name ?? `image-${row.id}`,
      filePath: `/api/setup/images/${row.id}/file`
    }));

    const packagedFiles = fs
      .readdirSync(imageDir)
      .filter((file) => /\.(png|jpg|jpeg|webp|svg)$/i.test(file))
      .sort((a, b) => a.localeCompare(b))
      .map((fileName) => ({
        fileName,
        filePath: `/images/${fileName}`
      }));

    res.json({ images: [...storedImages, ...packagedFiles] });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load images',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

setupRouter.get('/teams/:teamId/players', async (req, res) => {
  const parsedParams = teamIdParams.safeParse(req.params);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  try {
    const result = await db.query(
      `
        SELECT
          pt.id,
          pt.user_id,
          pt.jersey_num,
          u.first_name,
          u.last_name
        FROM football_pool.player_team pt
        LEFT JOIN football_pool.users u ON u.id = pt.user_id
        WHERE pt.team_id = $1
        ORDER BY pt.jersey_num, pt.id
      `,
      [parsedParams.data.teamId]
    );

    res.json({ players: result.rows });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load team players',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

setupRouter.get('/pools/:poolId/players', async (req, res) => {
  const parsedParams = poolIdParams.safeParse(req.params);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  try {
    const result = await db.query(
      `
        SELECT
          pt.id,
          pt.user_id,
          pt.jersey_num,
          u.first_name,
          u.last_name
        FROM football_pool.player_team pt
        JOIN football_pool.pool p ON p.team_id = pt.team_id
        LEFT JOIN football_pool.users u ON u.id = pt.user_id
        WHERE p.id = $1
        ORDER BY pt.jersey_num, pt.id
      `,
      [parsedParams.data.poolId]
    );

    res.json({ players: result.rows });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load players',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

setupRouter.get('/pools/:poolId/squares', async (req, res) => {
  const parsedParams = poolIdParams.safeParse(req.params);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');
    await ensurePoolSquaresInitialized(client, parsedParams.data.poolId);

    const result = await client.query(
      `
        SELECT
          id,
          square_num,
          participant_id,
          player_id,
          paid_flg
        FROM football_pool.square
        WHERE pool_id = $1
        ORDER BY square_num
      `,
      [parsedParams.data.poolId]
    );

    await client.query('COMMIT');
    res.json({ squares: result.rows });
  } catch (error) {
    await client.query('ROLLBACK');

    if (error instanceof Error && error.message === 'Pool not found') {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    res.status(500).json({
      error: 'Failed to load squares',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.patch('/pools/:poolId/squares/:squareNum', async (req, res) => {
  const parsedParams = squareParams.safeParse(req.params);
  const parsedBody = assignSquareSchema.safeParse(req.body);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  if (!parsedBody.success) {
    res.status(400).json({ error: parsedBody.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    console.log(
      `[square-assignment] request pool=${parsedParams.data.poolId} square=${parsedParams.data.squareNum} participant=${parsedBody.data.participantId} player=${parsedBody.data.playerId} paid=${parsedBody.data.paidFlg} reassign=${parsedBody.data.reassign}`
    );

    await client.query('BEGIN');

    const initResult = await ensurePoolSquaresInitialized(client, parsedParams.data.poolId);
    if (initResult.insertedCount > 0) {
      console.log(
        `[square-assignment] auto-initialized ${initResult.insertedCount} missing squares for pool=${parsedParams.data.poolId}`
      );
    }

    const squareResult = await client.query<{
      id: number;
      participant_id: number | null;
      paid_flg: boolean | null;
    }>(
      `
        SELECT id, participant_id, paid_flg
        FROM football_pool.square
        WHERE pool_id = $1
          AND square_num = $2
        FOR UPDATE
      `,
      [parsedParams.data.poolId, parsedParams.data.squareNum]
    );

    if (squareResult.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Square not found' });
      return;
    }

    if (
      squareResult.rows[0].participant_id !== null &&
      !parsedBody.data.reassign &&
      parsedBody.data.participantId !== squareResult.rows[0].participant_id
    ) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Square already assigned. Set reassign=true to override.' });
      return;
    }

    if (parsedBody.data.participantId !== null) {
      const participantExists = await client.query<{ id: number }>(
        'SELECT id FROM football_pool.users WHERE id = $1',
        [parsedBody.data.participantId]
      );

      if (participantExists.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Participant not found' });
        return;
      }
    }

    if (parsedBody.data.playerId !== null) {
      const playerExists = await client.query<{ id: number }>(
        'SELECT id FROM football_pool.player_team WHERE id = $1',
        [parsedBody.data.playerId]
      );

      if (playerExists.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Player not found' });
        return;
      }
    }

    const updateResult = await client.query<{
      id: number;
      square_num: number;
      participant_id: number | null;
      player_id: number | null;
      paid_flg: boolean | null;
    }>(
      `
        UPDATE football_pool.square
        SET
          participant_id = $3,
          player_id = $4,
          paid_flg = COALESCE($5, paid_flg)
        WHERE pool_id = $1
          AND square_num = $2
        RETURNING id, square_num, participant_id, player_id, paid_flg
      `,
      [
        parsedParams.data.poolId,
        parsedParams.data.squareNum,
        parsedBody.data.participantId,
        parsedBody.data.playerId,
        parsedBody.data.paidFlg ?? null
      ]
    );

    await client.query('COMMIT');

    const assignedSquare = updateResult.rows[0];
    console.log(
      `[square-assignment] saved pool=${parsedParams.data.poolId} square=${assignedSquare.square_num} participant=${assignedSquare.participant_id} player=${assignedSquare.player_id} paid=${assignedSquare.paid_flg}`
    );

    res.json({
      message: 'Square assignment updated',
      poolId: parsedParams.data.poolId,
      squareNum: parsedParams.data.squareNum,
      square: assignedSquare
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[square-assignment] failed', error);

    if (error instanceof Error && error.message === 'Pool not found') {
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    res.status(500).json({
      error: 'Failed to update square assignment',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});
