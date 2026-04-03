import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { db } from '../config/db';
import { requireRole } from '../middleware/auth';

export const setupRouter = Router();

setupRouter.use(requireRole('organizer'));

const imageDir = path.resolve(__dirname, '../../images');
fs.mkdirSync(imageDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, imageDir),
  filename: (_req, file, cb) => {
    const safeBase = path
      .basename(file.originalname, path.extname(file.originalname))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'team-logo';
    cb(null, `${Date.now()}-${safeBase}${path.extname(file.originalname).toLowerCase()}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    cb(null, allowed.includes(file.mimetype));
  }
});

const createUserSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(7).optional()
});

const updateUserSchema = createUserSchema;

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

const poolIdParams = z.object({
  poolId: z.coerce.number().int().positive()
});

const userIdParams = z.object({
  userId: z.coerce.number().int().positive()
});

const teamIdParams = z.object({
  teamId: z.coerce.number().int().positive()
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

setupRouter.post('/images/upload', (req, res) => {
  upload.single('image')(req, res, (error: unknown) => {
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

    if (!req.file) {
      res.status(400).json({ error: 'Image upload failed or file type is unsupported' });
      return;
    }

    res.status(201).json({
      fileName: req.file.filename,
      filePath: `/images/${req.file.filename}`
    });
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

setupRouter.post('/users', async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const id = await nextId(client, 'users');

    await client.query(
      `
        INSERT INTO football_pool.users (id, first_name, last_name, email, phone, created_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
      `,
      [id, parsed.data.firstName, parsed.data.lastName, parsed.data.email, parsed.data.phone ?? null]
    );

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
    const id = await nextId(client, 'player');

    await client.query(
      `
        INSERT INTO football_pool.player (id, team_id, user_id, jersey_num)
        VALUES ($1, $2, $3, $4)
      `,
      [id, parsed.data.teamId, parsed.data.userId, parsed.data.jerseyNum]
    );

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

    const poolExists = await client.query<{ id: number }>(
      'SELECT id FROM football_pool.pool WHERE id = $1',
      [parsedParams.data.poolId]
    );

    if (poolExists.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    const existingSquares = await client.query<{ row_count: number }>(
      'SELECT COUNT(*)::int AS row_count FROM football_pool.square WHERE pool_id = $1',
      [parsedParams.data.poolId]
    );

    if ((existingSquares.rows[0]?.row_count ?? 0) > 0) {
      await client.query('ROLLBACK');
      res.status(409).json({ error: 'Pool already has squares initialized' });
      return;
    }

    await client.query('LOCK TABLE football_pool.square IN EXCLUSIVE MODE');

    const idBaseResult = await client.query<{ id_base: number }>(
      'SELECT COALESCE(MAX(id), 0) AS id_base FROM football_pool.square'
    );

    const idBase = idBaseResult.rows[0].id_base;

    await client.query(
      `
        INSERT INTO football_pool.square (id, pool_id, square_num, participant_id, player_id, paid_flg)
        SELECT
          $2 + gs AS id,
          $1 AS pool_id,
          gs AS square_num,
          NULL AS participant_id,
          NULL AS player_id,
          FALSE AS paid_flg
        FROM generate_series(1, 100) AS gs
      `,
      [parsedParams.data.poolId, idBase]
    );

    await client.query('COMMIT');
    res.status(201).json({ message: 'Initialized 100 squares', poolId: parsedParams.data.poolId });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to initialize squares',
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
          id,
          first_name,
          last_name,
          email,
          phone
        FROM football_pool.users
        ORDER BY last_name, first_name, id
        LIMIT 500
      `
    );

    res.json({ users: result.rows });
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

  try {
    const result = await db.query(
      `
        UPDATE football_pool.users
        SET
          first_name = $2,
          last_name = $3,
          email = $4,
          phone = $5
        WHERE id = $1
        RETURNING id
      `,
      [
        parsedParams.data.userId,
        parsedBody.data.firstName,
        parsedBody.data.lastName,
        parsedBody.data.email,
        parsedBody.data.phone ?? null
      ]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ id: parsedParams.data.userId, message: 'User updated' });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to update user',
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

setupRouter.get('/images', async (_req, res) => {
  try {
    const files = fs
      .readdirSync(imageDir)
      .filter((file) => /\.(png|jpg|jpeg|webp|svg)$/i.test(file))
      .sort((a, b) => a.localeCompare(b));

    const images = files.map((fileName) => ({
      fileName,
      filePath: `/images/${fileName}`
    }));

    res.json({ images });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load images',
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
          pl.id,
          pl.user_id,
          pl.jersey_num,
          u.first_name,
          u.last_name
        FROM football_pool.player pl
        JOIN football_pool.pool p ON p.team_id = pl.team_id
        LEFT JOIN football_pool.users u ON u.id = pl.user_id
        WHERE p.id = $1
        ORDER BY pl.jersey_num, pl.id
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

  try {
    const result = await db.query(
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

    res.json({ squares: result.rows });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load squares',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
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
        'SELECT id FROM football_pool.player WHERE id = $1',
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
    res.status(500).json({
      error: 'Failed to update square assignment',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});
