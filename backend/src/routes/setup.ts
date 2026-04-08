import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { db } from '../config/db';
import { env } from '../config/env';
import { getPoolLeagueDefinition, normalizePayoutsForLeague, supportedLeagueCodes } from '../config/poolLeagues';
import {
  getPoolStructureMode,
  getPoolTemplateDefinition,
  poolStructureModeValues,
  poolTemplateValues,
  resolveTemplateRoundSequence
} from '../config/poolStructures';
import {
  getPoolPayoutScheduleMode,
  poolPayoutScheduleModeValues
} from '../config/poolPayoutSchedules';
import { getPoolTypeDefinition, poolTypeValues } from '../config/poolTypes';
import { requireRole } from '../middleware/auth';
import {
  advancePoolSeasonSimulation,
  cleanupPoolSeasonSimulation,
  createPoolSeasonSimulation,
  getPoolSimulationStatus
} from '../services/poolSimulation';
import { ensurePoolSquaresInitialized } from '../services/poolSquares';
import { ensurePoolDisplayTokenSupport, generateUniquePoolDisplayToken } from '../services/poolDisplay';
import { ensureNotificationSupport } from '../services/notifications';
import { ensurePoolGameStructureSupport } from '../services/poolGameStructureSupport';
import { ensurePoolPayoutStructureSupport } from '../services/poolPayoutStructureSupport';
import { replacePoolRoundPayouts } from '../services/poolPayouts';
import { ensurePoolStructureSupport } from '../services/poolStructureSupport';
import { poolBoardNumberModeValues, syncPoolGameBoardNumbers } from '../services/poolBoardNumbers';
import {
  availableNotificationVariables,
  notificationMarkupFormatValues,
  notificationTemplateKindValues,
  notificationTemplateScopeValues,
  listNotificationTemplates,
  resetNotificationTemplateToGlobal,
  saveNotificationTemplate
} from '../services/notificationTemplates';

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

const notificationLevelSchema = z.enum(['none', 'quarter_win', 'game_total']).optional();
const leagueCodeSchema = z.enum(supportedLeagueCodes).optional();
const poolTypeSchema = z.enum(poolTypeValues).optional().default('season');
const poolStructureModeSchema = z.enum(poolStructureModeValues).optional().default('manual');
const poolTemplateCodeSchema = z.enum(poolTemplateValues).optional().or(z.literal(''));
const poolPayoutScheduleModeSchema = z.enum(poolPayoutScheduleModeValues).optional().default('uniform');
const poolBoardNumberModeSchema = z.enum(poolBoardNumberModeValues).optional().default('per_game');
const optionalDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD format')
  .optional()
  .or(z.literal(''));
const roundPayoutSchema = z.object({
  roundLabel: z.string().trim().min(1).max(80),
  roundSequence: z.number().int().min(1).max(99).nullable().optional(),
  q1Payout: z.number().int().nonnegative().optional().default(0),
  q2Payout: z.number().int().nonnegative().optional().default(0),
  q3Payout: z.number().int().nonnegative().optional().default(0),
  q4Payout: z.number().int().nonnegative().optional().default(0)
});

const memberAssignmentSchema = z
  .object({
    teamId: z.number().int().positive(),
    memberNumber: z.number().int().min(0).max(99).nullable().optional(),
    jerseyNum: z.number().int().min(0).max(99).nullable().optional()
  })
  .transform((value) => ({
    teamId: value.teamId,
    memberNumber: value.memberNumber ?? value.jerseyNum ?? null
  }));

const createUserSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: optionalEmailSchema,
  phone: optionalPhoneSchema,
  venmoAcct: optionalVenmoAcctSchema,
  notificationLevel: notificationLevelSchema,
  notifyOnSquareLead: z.boolean().optional(),
  isPlayer: z.boolean().optional(),
  isMember: z.boolean().optional(),
  playerTeams: z.array(memberAssignmentSchema).optional(),
  memberOrganizations: z.array(memberAssignmentSchema).optional(),
  poolIds: z.array(z.number().int().positive()).optional()
});

const updateUserSchema = createUserSchema;

const createTeamSchema = z.object({
  teamName: z.string().min(1),
  primaryColor: z.string().min(1).optional(),
  secondaryColor: z.string().min(1).optional(),
  logoFile: z.string().min(1).optional(),
  primaryContactId: z.number().int().positive().optional(),
  secondaryContactId: z.number().int().positive().optional(),
  hasMembers: z.boolean().optional(),
  sportTeamId: z.number().int().positive().optional(),
  espnTeamUid: z.string().trim().min(1).max(64).optional(),
  sportTeamAbbr: z.string().trim().min(1).max(16).optional(),
  nflTeamAbbr: z.string().trim().min(1).max(16).optional()
});

const updateTeamSchema = createTeamSchema;

const createPoolSchema = z
  .object({
    poolName: z.string().min(1),
    teamId: z.number().int().positive(),
    season: z.number().int().min(2000).max(2100),
    poolType: poolTypeSchema,
    leagueCode: leagueCodeSchema,
    structureMode: poolStructureModeSchema,
    templateCode: poolTemplateCodeSchema,
    startDate: optionalDateSchema,
    endDate: optionalDateSchema,
    primarySportTeamId: z.number().int().positive().optional(),
    primaryTeam: z.string().trim().optional().or(z.literal('')),
    payoutScheduleMode: poolPayoutScheduleModeSchema,
    roundPayouts: z.array(roundPayoutSchema).optional().default([]),
    boardNumberMode: poolBoardNumberModeSchema,
    winnerLoserMode: z.boolean().optional().default(false),
    squareCost: z.number().int().nonnegative(),
    q1Payout: z.number().int().nonnegative(),
    q2Payout: z.number().int().nonnegative(),
    q3Payout: z.number().int().nonnegative(),
    q4Payout: z.number().int().nonnegative(),
    contactNotificationLevel: notificationLevelSchema,
    contactNotifyOnSquareLead: z.boolean().optional()
  })
  .superRefine((value, context) => {
    const startDate = value.startDate?.trim() || '';
    const endDate = value.endDate?.trim() || '';
    const structureMode = getPoolStructureMode(value.structureMode);
    const payoutScheduleMode = getPoolPayoutScheduleMode(value.payoutScheduleMode);
    const poolType = getPoolTypeDefinition(value.poolType);
    const templateDefinition = getPoolTemplateDefinition(value.templateCode || null);
    const leagueCode = String(value.leagueCode ?? 'NFL').trim().toUpperCase();

    if ((startDate && !endDate) || (!startDate && endDate)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['startDate'],
        message: 'Provide both a start date and an end date for date-bounded pools.'
      });
    }

    if (startDate && endDate && endDate < startDate) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endDate'],
        message: 'End date must be on or after the start date.'
      });
    }

    if (structureMode === 'template' && !templateDefinition) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['templateCode'],
        message: 'Choose a supported template when template mode is selected.'
      });
    }

    if (templateDefinition && !templateDefinition.supportedPoolTypes.includes(poolType.code)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['templateCode'],
        message: `${templateDefinition.label} is only available for ${templateDefinition.supportedPoolTypes.join(', ')} pools.`
      });
    }

    if (templateDefinition && !templateDefinition.supportedLeagueCodes.includes(leagueCode)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['templateCode'],
        message: `${templateDefinition.label} is only available for ${templateDefinition.supportedLeagueCodes.join(', ')} pools.`
      });
    }

    if (payoutScheduleMode === 'by_round' && poolType.code !== 'tournament') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payoutScheduleMode'],
        message: 'Round-based payout schedules are currently only supported for tournament pools.'
      });
    }

    if (payoutScheduleMode === 'by_round' && (value.roundPayouts?.length ?? 0) === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['roundPayouts'],
        message: 'Add at least one round payout when using a by-round payout schedule.'
      });
    }

    const seenRoundLabels = new Set<string>();
    const seenRoundSequences = new Set<number>();
    for (const [index, roundPayout] of (value.roundPayouts ?? []).entries()) {
      const normalizedRoundLabel = String(roundPayout.roundLabel ?? '').trim().toLowerCase();
      if (normalizedRoundLabel) {
        if (seenRoundLabels.has(normalizedRoundLabel)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['roundPayouts', index, 'roundLabel'],
            message: 'Each round can only have one payout rule. Use a unique round name.'
          });
        } else {
          seenRoundLabels.add(normalizedRoundLabel);
        }
      }

      if (roundPayout.roundSequence != null) {
        if (seenRoundSequences.has(roundPayout.roundSequence)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['roundPayouts', index, 'roundSequence'],
            message: 'Each round order can only be used once in the payout schedule.'
          });
        } else {
          seenRoundSequences.add(roundPayout.roundSequence);
        }
      }
    }
  });

const updatePoolSchema = createPoolSchema;

const createPlayerSchema = z
  .object({
    teamId: z.number().int().positive(),
    userId: z.number().int().positive(),
    memberNumber: z.number().int().min(0).max(99).nullable().optional(),
    jerseyNum: z.number().int().min(0).max(99).nullable().optional()
  })
  .transform((value) => ({
    teamId: value.teamId,
    userId: value.userId,
    memberNumber: value.memberNumber ?? value.jerseyNum ?? null
  }));

const updatePlayerSchema = z
  .object({
    userId: z.number().int().positive(),
    memberNumber: z.number().int().min(0).max(99).nullable().optional(),
    jerseyNum: z.number().int().min(0).max(99).nullable().optional()
  })
  .transform((value) => ({
    userId: value.userId,
    memberNumber: value.memberNumber ?? value.jerseyNum ?? null
  }));

const poolIdParams = z.object({
  poolId: z.coerce.number().int().positive()
});

const createSimulationSchema = z.object({
  mode: z.enum(['full_year', 'by_game', 'by_quarter']).default('full_year')
});

const advanceSimulationSchema = z.object({
  source: z.enum(['espn', 'mock']).optional(),
  action: z.enum(['complete', 'live']).optional().default('complete')
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

const notificationTemplateParams = z.object({
  recipientScope: z.enum(notificationTemplateScopeValues),
  notificationKind: z.enum(notificationTemplateKindValues)
});

const notificationTemplateQuerySchema = z.object({
  poolId: z.coerce.number().int().positive().optional()
});

const deleteNotificationTemplateQuerySchema = z.object({
  poolId: z.coerce.number().int().positive()
});

const updateNotificationTemplateSchema = z.object({
  poolId: z.coerce.number().int().positive().optional(),
  subjectTemplate: z.string().trim().min(1).max(255),
  bodyTemplate: z.string().trim().min(1),
  markupFormat: z.enum(notificationMarkupFormatValues).default('plain_text')
});

const sportTeamQuerySchema = z.object({
  leagueCode: z.string().trim().max(16).optional()
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

const resolveRequestedMemberAssignments = (
  payload: z.infer<typeof createUserSchema> | z.infer<typeof updateUserSchema>
): Array<{ teamId: number; memberNumber: number | null }> => payload.memberOrganizations ?? payload.playerTeams ?? [];

const isMemberSelected = (payload: z.infer<typeof createUserSchema> | z.infer<typeof updateUserSchema>): boolean =>
  payload.isMember ?? payload.isPlayer ?? false;

const resolveSportTeamId = async (
  client: Pick<PoolClient, 'query'>,
  payload: z.infer<typeof createTeamSchema>
): Promise<number | null> => {
  if (payload.sportTeamId != null) {
    const existing = await client.query<{ id: number }>(
      `SELECT id
       FROM football_pool.sport_team
       WHERE id = $1
       LIMIT 1`,
      [payload.sportTeamId]
    );

    if ((existing.rowCount ?? 0) === 0) {
      throw new Error('Selected sport team was not found.');
    }

    return Number(existing.rows[0].id);
  }

  const espnTeamUid = payload.espnTeamUid?.trim() || '';
  if (espnTeamUid) {
    const result = await client.query<{ id: number }>(
      `SELECT id
       FROM football_pool.sport_team
       WHERE espn_team_uid = $1
       LIMIT 1`,
      [espnTeamUid]
    );

    if ((result.rowCount ?? 0) > 0) {
      return Number(result.rows[0].id);
    }
  }

  const abbreviation = payload.sportTeamAbbr?.trim() || payload.nflTeamAbbr?.trim() || '';
  if (!abbreviation) {
    return null;
  }

  const result = await client.query<{ id: number }>(
    `SELECT id
     FROM football_pool.sport_team
     WHERE sport_code = 'FOOTBALL'
       AND league_code = 'NFL'
       AND UPPER(COALESCE(abbreviation, '')) = UPPER($1)
     LIMIT 1`,
    [abbreviation]
  );

  if ((result.rowCount ?? 0) === 0) {
    throw new Error(`No sport team was found for abbreviation ${abbreviation}.`);
  }

  return Number(result.rows[0].id);
};

const resolvePrimaryTeamName = async (
  client: PoolClient,
  organizationId: number,
  explicitPrimaryTeam?: string | null
): Promise<string> => {
  const providedValue = explicitPrimaryTeam?.trim();
  if (providedValue) {
    return providedValue;
  }

  const result = await client.query<{ primary_team_name: string | null }>(
    `SELECT COALESCE(st.name, o.team_name) AS primary_team_name
     FROM football_pool.organization o
     LEFT JOIN football_pool.sport_team st ON st.id = o.sport_team_id
     WHERE o.id = $1
     LIMIT 1`,
    [organizationId]
  );

  const resolved = result.rows[0]?.primary_team_name?.trim();
  if (!resolved) {
    throw new Error('Preferred team could not be derived from the selected organization.');
  }

  return resolved;
};

const resolvePrimarySportTeamContext = async (
  client: PoolClient,
  payload: z.infer<typeof createPoolSchema>
): Promise<{
  sportCode: string;
  leagueCode: string;
  primarySportTeamId: number | null;
  primaryTeamName: string | null;
}> => {
  const fallbackDefinition = getPoolLeagueDefinition(payload.leagueCode);

  if (payload.primarySportTeamId != null) {
    const result = await client.query<{
      id: number;
      name: string | null;
      sport_code: string | null;
      league_code: string | null;
    }>(
      `SELECT id, name, sport_code, league_code
       FROM football_pool.sport_team
       WHERE id = $1
       LIMIT 1`,
      [payload.primarySportTeamId]
    );

    if ((result.rowCount ?? 0) === 0) {
      throw new Error('Selected preferred sport team was not found.');
    }

    const row = result.rows[0];
    return {
      sportCode: row.sport_code?.trim() || fallbackDefinition.sportCode,
      leagueCode: row.league_code?.trim() || fallbackDefinition.leagueCode,
      primarySportTeamId: Number(row.id),
      primaryTeamName: row.name?.trim() || null
    };
  }

  const providedName = payload.primaryTeam?.trim();
  if (providedName) {
    const result = await client.query<{ id: number; name: string | null }>(
      `SELECT id, name
       FROM football_pool.sport_team
       WHERE UPPER(COALESCE(league_code, '')) = UPPER($1)
         AND (
           LOWER(name) = LOWER($2)
           OR UPPER(COALESCE(abbreviation, '')) = UPPER($3)
         )
       LIMIT 1`,
      [fallbackDefinition.leagueCode, providedName, providedName]
    );

    if ((result.rowCount ?? 0) > 0) {
      return {
        sportCode: fallbackDefinition.sportCode,
        leagueCode: fallbackDefinition.leagueCode,
        primarySportTeamId: Number(result.rows[0].id),
        primaryTeamName: result.rows[0].name?.trim() || providedName
      };
    }

    return {
      sportCode: fallbackDefinition.sportCode,
      leagueCode: fallbackDefinition.leagueCode,
      primarySportTeamId: null,
      primaryTeamName: providedName
    };
  }

  return {
    sportCode: fallbackDefinition.sportCode,
    leagueCode: fallbackDefinition.leagueCode,
    primarySportTeamId: null,
    primaryTeamName: null
  };
};

const resolveOrCreateNamedSportTeam = async (
  client: PoolClient,
  name: string,
  sportCode: string,
  leagueCode: string
): Promise<number> => {
  const normalizedName = name.trim();
  const result = await client.query<{ id: number }>(
    `INSERT INTO football_pool.sport_team (name, sport_code, league_code)
     VALUES ($1, $2, $3)
     ON CONFLICT (sport_code, league_code, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [normalizedName, sportCode, leagueCode]
  );

  return Number(result.rows[0].id);
};

const normalizeOptionalDateValue = (value?: string | null): string | null => {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
};

const resolvePoolStructureSettings = (value: {
  season: number;
  poolType?: string | null;
  structureMode?: string | null;
  templateCode?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}) => {
  const poolType = getPoolTypeDefinition(value.poolType);

  if (poolType.code === 'season') {
    return {
      structureMode: 'manual' as const,
      templateCode: null,
      startDate: null,
      endDate: null
    };
  }

  const structureMode = getPoolStructureMode(value.structureMode ?? (value.templateCode ? 'template' : 'manual'));
  const templateDefinition = structureMode === 'template' ? getPoolTemplateDefinition(value.templateCode ?? null) : null;
  const defaultWindow = templateDefinition?.getDefaultDateWindow(value.season);
  let startDate = normalizeOptionalDateValue(value.startDate) ?? defaultWindow?.startDate ?? null;
  let endDate = normalizeOptionalDateValue(value.endDate) ?? defaultWindow?.endDate ?? null;

  if (poolType.code === 'single_game') {
    if (startDate && !endDate) {
      endDate = startDate;
    }

    if (endDate && !startDate) {
      startDate = endDate;
    }
  }

  return {
    structureMode,
    templateCode: templateDefinition?.code ?? null,
    startDate,
    endDate
  };
};

const addDaysToDateString = (baseDate: string, offsetDays: number): string => {
  const date = new Date(`${baseDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, offsetDays));
  return date.toISOString().slice(0, 10);
};

const getTournamentChampionshipDate = (leagueCode: string, season: number, endDate?: string | null, templateCode?: string | null): string => {
  const explicitEndDate = normalizeOptionalDateValue(endDate);
  if (explicitEndDate) {
    return explicitEndDate;
  }

  const templateDefinition = getPoolTemplateDefinition(templateCode ?? null);
  if (templateDefinition) {
    return templateDefinition.getDefaultDateWindow(season).endDate;
  }
  const normalizedLeague = leagueCode.trim().toUpperCase();

  if (normalizedLeague === 'NFL' || normalizedLeague === 'NCAAF') {
    return `${season + 1}-02-15`;
  }

  if (normalizedLeague === 'NCAAB') {
    return `${season}-04-07`;
  }

  if (normalizedLeague === 'NBA' || normalizedLeague === 'NHL') {
    return `${season}-06-20`;
  }

  if (normalizedLeague === 'MLB') {
    return `${season}-11-01`;
  }

  return `${season}-12-31`;
};

const buildTournamentTemplateScaffold = (options: {
  season: number;
  leagueCode: string;
  templateCode?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): Array<{
  roundLabel: string;
  roundSequence: number;
  bracketRegion: string | null;
  matchupOrder: number;
  championshipFlg: boolean;
  opponentLabel: string;
  gameDate: string;
}> => {
  const templateDefinition = getPoolTemplateDefinition(options.templateCode ?? null);
  if (!templateDefinition) {
    return [];
  }

  const defaultWindow = templateDefinition.getDefaultDateWindow(options.season);
  const scaffoldStartDate = normalizeOptionalDateValue(options.startDate) ?? defaultWindow.startDate;
  const scaffoldEndDate = getTournamentChampionshipDate(
    options.leagueCode,
    options.season,
    options.endDate ?? defaultWindow.endDate,
    options.templateCode
  );

  const scaffoldEntries: Array<{
    roundLabel: string;
    roundSequence: number;
    bracketRegion: string | null;
    matchupOrder: number;
    championshipFlg: boolean;
    opponentLabel: string;
    gameDate: string;
  }> = [];

  for (let roundIndex = 0; roundIndex < templateDefinition.rounds.length; roundIndex += 1) {
    const round = templateDefinition.rounds[roundIndex];
    const previousRound = roundIndex > 0 ? templateDefinition.rounds[roundIndex - 1] : null;
    const regions = round.regions?.length ? round.regions : [null];
    const gamesPerRegion = Math.max(1, Math.ceil(round.gameCount / regions.length));

    for (let index = 0; index < round.gameCount; index += 1) {
      const region = regions[Math.min(Math.floor(index / gamesPerRegion), regions.length - 1)];
      const matchupOrder = (index % gamesPerRegion) + 1;

      let opponentLabel: string;
      if (round.championship) {
        opponentLabel = 'Winner of Final Four Game 1 vs Winner of Final Four Game 2';
      } else if (previousRound) {
        const priorRoundLabel = previousRound.label;
        const firstSource = Math.max(1, matchupOrder * 2 - 1);
        const secondSource = matchupOrder * 2;
        const regionPrefix = region ? `${region} ` : '';
        opponentLabel = `${regionPrefix}Winner of ${priorRoundLabel} Game ${firstSource} vs Winner of ${priorRoundLabel} Game ${secondSource}`;
      } else if (region) {
        opponentLabel = `${region} ${round.label} Game ${matchupOrder}`;
      } else {
        opponentLabel = `${round.label} Game ${index + 1}`;
      }

      scaffoldEntries.push({
        roundLabel: round.label,
        roundSequence: round.sequence,
        bracketRegion: region,
        matchupOrder,
        championshipFlg: Boolean(round.championship),
        opponentLabel,
        gameDate: round.championship
          ? scaffoldEndDate
          : addDaysToDateString(scaffoldStartDate, round.dateOffsetDays ?? Math.max(0, (round.sequence - 1) * 3))
      });
    }
  }

  return scaffoldEntries;
};

const ensureTournamentChampionshipPlaceholder = async (
  client: PoolClient,
  options: {
    poolId: number;
    season: number;
    sportCode: string;
    leagueCode: string;
    primaryTeamName: string | null;
    winnerLoserMode: boolean;
    startDate?: string | null;
    endDate?: string | null;
    templateCode?: string | null;
  }
): Promise<void> => {
  await ensurePoolGameStructureSupport(client);

  const homeTeamId = await resolveOrCreateNamedSportTeam(
    client,
    options.primaryTeamName?.trim() || (options.winnerLoserMode ? 'Winning Score' : 'Home Team'),
    options.sportCode,
    options.leagueCode
  );

  const scaffoldEntries = buildTournamentTemplateScaffold(options);
  if (scaffoldEntries.length > 0) {
    for (const entry of scaffoldEntries) {
      const awayTeamId = await resolveOrCreateNamedSportTeam(client, entry.opponentLabel, options.sportCode, options.leagueCode);
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
         VALUES ($1, $2, $3, $4, $5::date, $5::timestamp, 'scheduled', FALSE, '{}'::jsonb, NOW(), NOW())
         ON CONFLICT (season_year, week_number, home_team_id, away_team_id, game_date)
         DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [options.season, entry.roundSequence, homeTeamId, awayTeamId, entry.gameDate]
      );

      const gameId = Number(gameResult.rows[0]?.id);
      await client.query(
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
         VALUES ($1, $2, NULL, NULL, $3, $4, $5, $6, $7, NOW(), NOW())
         ON CONFLICT (pool_id, game_id)
         DO UPDATE SET
           round_label = EXCLUDED.round_label,
           round_sequence = EXCLUDED.round_sequence,
           bracket_region = EXCLUDED.bracket_region,
           matchup_order = EXCLUDED.matchup_order,
           championship_flg = EXCLUDED.championship_flg,
           updated_at = NOW()`,
        [
          options.poolId,
          gameId,
          entry.roundLabel,
          entry.roundSequence,
          entry.bracketRegion,
          entry.matchupOrder,
          entry.championshipFlg
        ]
      );
    }

    return;
  }

  const existing = await client.query<{ has_game: number }>(
    `SELECT 1 AS has_game
     FROM football_pool.pool_game
     WHERE pool_id = $1
     LIMIT 1`,
    [options.poolId]
  );

  if ((existing.rowCount ?? 0) > 0) {
    return;
  }

  const awayTeamId = await resolveOrCreateNamedSportTeam(client, 'Championship Game', options.sportCode, options.leagueCode);
  const gameDate = getTournamentChampionshipDate(options.leagueCode, options.season, options.endDate, options.templateCode);

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
     VALUES ($1, 1, $2, $3, $4::date, $4::timestamp, 'scheduled', FALSE, '{}'::jsonb, NOW(), NOW())
     ON CONFLICT (season_year, week_number, home_team_id, away_team_id, game_date)
     DO UPDATE SET updated_at = NOW()
     RETURNING id`,
    [options.season, homeTeamId, awayTeamId, gameDate]
  );

  const gameId = Number(gameResult.rows[0]?.id);

  await client.query(
    `INSERT INTO football_pool.pool_game (
       pool_id,
       game_id,
       row_numbers,
       column_numbers,
       round_label,
       round_sequence,
       championship_flg,
       created_at,
       updated_at
     )
     VALUES ($1, $2, NULL, NULL, 'Championship', $3, TRUE, NOW(), NOW())
     ON CONFLICT (pool_id, game_id) DO NOTHING`,
    [options.poolId, gameId, resolveTemplateRoundSequence(options.templateCode ?? null, 'Championship') ?? 1]
  );
};

setupRouter.get('/notifications/templates', async (req, res) => {
  const parsedQuery = notificationTemplateQuerySchema.safeParse(req.query);

  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.issues });
    return;
  }

  const selectedPoolId = parsedQuery.data.poolId ?? null;
  const client = await db.connect();

  try {
    await ensureNotificationSupport(client);
    const templates = await listNotificationTemplates(client, selectedPoolId);
    res.status(200).json({
      templates,
      availableVariables: availableNotificationVariables,
      selectedPoolId
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load notification templates',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.put('/notifications/templates/:recipientScope/:notificationKind', async (req, res) => {
  const parsedParams = notificationTemplateParams.safeParse(req.params);
  const parsedBody = updateNotificationTemplateSchema.safeParse(req.body);

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
    await ensureNotificationSupport(client);
    const template = await saveNotificationTemplate(
      client,
      parsedParams.data.recipientScope,
      parsedParams.data.notificationKind,
      {
        poolId: parsedBody.data.poolId ?? null,
        subjectTemplate: parsedBody.data.subjectTemplate,
        bodyTemplate: parsedBody.data.bodyTemplate,
        markupFormat: parsedBody.data.markupFormat
      }
    );

    res.status(200).json({ template });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to save notification template',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

setupRouter.delete('/notifications/templates/:recipientScope/:notificationKind', async (req, res) => {
  const parsedParams = notificationTemplateParams.safeParse(req.params);
  const parsedQuery = deleteNotificationTemplateQuerySchema.safeParse(req.query);

  if (!parsedParams.success) {
    res.status(400).json({ error: parsedParams.error.issues });
    return;
  }

  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.issues });
    return;
  }

  const client = await db.connect();

  try {
    await ensureNotificationSupport(client);
    const reset = await resetNotificationTemplateToGlobal(
      client,
      parsedParams.data.recipientScope,
      parsedParams.data.notificationKind,
      parsedQuery.data.poolId
    );

    res.status(200).json({
      reset,
      poolId: parsedQuery.data.poolId
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to reset notification template',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
  }
});

const syncUserPlayerFlag = async (client: PoolClient, userId: number): Promise<void> => {
  const assignmentCount = await client.query<{ assignment_count: number }>(
    `
      SELECT COUNT(*)::int AS assignment_count
      FROM football_pool.member_organization
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
  memberNumber: number | null
): Promise<number> => {
  const duplicateCheck = await client.query<{ id: number }>(
    `
      SELECT id
      FROM football_pool.member_organization
      WHERE user_id = $1
        AND team_id = $2
      LIMIT 1
    `,
    [userId, teamId]
  );

  if ((duplicateCheck.rowCount ?? 0) > 0) {
    throw new Error('Member is already assigned to this organization.');
  }

  const playerTeamId = await nextId(client, 'member_organization');

  await client.query(
    `
      INSERT INTO football_pool.member_organization (id, user_id, team_id, jersey_num, created_at)
      VALUES ($1, $2, $3, $4, NOW())
    `,
    [playerTeamId, userId, teamId, memberNumber]
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

  const requestedAssignments = resolveRequestedMemberAssignments(parsed.data);
  const shouldMarkMember = isMemberSelected(parsed.data);

  if (shouldMarkMember && hasDuplicateTeamAssignments(requestedAssignments.map((assignment) => ({ teamId: assignment.teamId, jerseyNum: assignment.memberNumber ?? -1 })))) {
    res.status(400).json({ error: 'A member cannot be assigned to the same organization more than once.' });
    return;
  }

  if (hasDuplicateIds(parsed.data.poolIds ?? [])) {
    res.status(400).json({ error: 'A user cannot be assigned to the same pool more than once.' });
    return;
  }

  const client = await db.connect();

  try {
    await ensureNotificationSupport(client);

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
        INSERT INTO football_pool.users (
          id,
          first_name,
          last_name,
          email,
          phone,
          venmo_acct,
          created_at,
          is_player_flg,
          notification_level,
          notify_on_square_lead_flg
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9)
      `,
      [
        id,
        parsed.data.firstName,
        parsed.data.lastName,
        parsed.data.email ? parsed.data.email : null,
        parsed.data.phone ? parsed.data.phone : null,
        parsed.data.venmoAcct ? parsed.data.venmoAcct : null,
        shouldMarkMember,
        parsed.data.notificationLevel ?? 'none',
        parsed.data.notifyOnSquareLead ?? false
      ]
    );

    if (shouldMarkMember) {
      for (const assignment of requestedAssignments) {
        await createPlayerTeamAssignment(client, id, assignment.teamId, assignment.memberNumber ?? null);
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
    const id = await nextId(client, 'organization');
    const resolvedSportTeamId = await resolveSportTeamId(client, parsed.data);
    const tracksMembers = parsed.data.hasMembers ?? true;

    await client.query(
      `
        INSERT INTO football_pool.organization (
          id,
          team_name,
          primary_color,
          secondary_color,
          logo_file,
          primary_contact_id,
          secondary_contact_id,
          has_members_flg,
          sport_team_id,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      `,
      [
        id,
        parsed.data.teamName,
        parsed.data.primaryColor ?? null,
        parsed.data.secondaryColor ?? null,
        parsed.data.logoFile ?? null,
        parsed.data.primaryContactId ?? null,
        parsed.data.secondaryContactId ?? null,
        tracksMembers,
        resolvedSportTeamId
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({
      id,
      sport_team_id: resolvedSportTeamId,
      nfl_team_id: resolvedSportTeamId,
      has_members_flg: tracksMembers
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to create organization',
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
        FROM football_pool.member_organization
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

    const id = await createPlayerTeamAssignment(client, parsed.data.userId, parsed.data.teamId, parsed.data.memberNumber ?? null);

    await client.query('COMMIT');
    res.status(201).json({ id });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to create member',
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
        FROM football_pool.member_organization
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
        FROM football_pool.member_organization
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
        UPDATE football_pool.member_organization
        SET
          user_id = $2,
          jersey_num = $3
        WHERE id = $1
        RETURNING id
      `,
      [parsedParams.data.playerId, parsedBody.data.userId, parsedBody.data.memberNumber ?? null]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Player not found' });
      return;
    }

    await syncUserPlayerFlag(client, targetPlayer.rows[0].user_id);
    await syncUserPlayerFlag(client, parsedBody.data.userId);
    await client.query('COMMIT');

    res.json({ id: parsedParams.data.playerId, message: 'Member updated' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to update member',
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
        FROM football_pool.member_organization
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
      res.status(409).json({ error: 'Cannot delete a member while squares are still linked to that member.' });
      return;
    }

    await client.query(
      `
        DELETE FROM football_pool.member_organization
        WHERE id = $1
      `,
      [parsedParams.data.playerId]
    );

    await syncUserPlayerFlag(client, assignmentResult.rows[0].user_id);
    await client.query('COMMIT');

    res.json({ id: parsedParams.data.playerId, message: 'Member deleted' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({
      error: 'Failed to delete member',
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
    await ensurePoolDisplayTokenSupport(client);
    await ensureNotificationSupport(client);
    await ensurePoolStructureSupport(client);
    await ensurePoolPayoutStructureSupport(client);
    await client.query('BEGIN');
    const id = await nextId(client, 'pool');
    const displayToken = await generateUniquePoolDisplayToken(client);
    const poolType = getPoolTypeDefinition(parsed.data.poolType);
    const structureSettings = resolvePoolStructureSettings(parsed.data);
    const primarySportTeam = await resolvePrimarySportTeamContext(client, parsed.data);
    const normalizedPayouts = normalizePayoutsForLeague(primarySportTeam.leagueCode, {
      q1Payout: parsed.data.q1Payout,
      q2Payout: parsed.data.q2Payout,
      q3Payout: parsed.data.q3Payout,
      q4Payout: parsed.data.q4Payout
    });
    const primaryTeamName =
      primarySportTeam.primaryTeamName ??
      (poolType.requiresPreferredTeam || Boolean(parsed.data.primaryTeam?.trim())
        ? await resolvePrimaryTeamName(client, parsed.data.teamId, parsed.data.primaryTeam ?? null)
        : null);

    if (poolType.requiresPreferredTeam && !primaryTeamName?.trim()) {
      throw new Error(`A preferred team is required for ${poolType.label.toLowerCase()} pools.`);
    }

    await client.query(
      `
        INSERT INTO football_pool.pool (
          id,
          pool_name,
          team_id,
          season,
          pool_type,
          primary_team,
          primary_sport_team_id,
          sport_code,
          league_code,
          winner_loser_flg,
          start_date,
          end_date,
          structure_mode,
          template_code,
          payout_schedule_mode,
          board_number_mode,
          tournament_row_numbers,
          tournament_column_numbers,
          square_cost,
          q1_payout,
          q2_payout,
          q3_payout,
          q4_payout,
          display_token,
          sign_in_req_flg,
          contact_notification_level,
          contact_notify_on_square_lead_flg,
          created_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
          $11::date, $12::date, $13, $14, $15, $16, NULL, NULL,
          $17, $18, $19, $20, $21, $22, FALSE, $23, $24, NOW()
        )
      `,
      [
        id,
        parsed.data.poolName,
        parsed.data.teamId,
        parsed.data.season,
        poolType.code,
        primaryTeamName,
        primarySportTeam.primarySportTeamId,
        primarySportTeam.sportCode,
        primarySportTeam.leagueCode,
        parsed.data.winnerLoserMode ?? poolType.defaultWinnerLoserMode,
        structureSettings.startDate,
        structureSettings.endDate,
        structureSettings.structureMode,
        structureSettings.templateCode,
        getPoolPayoutScheduleMode(parsed.data.payoutScheduleMode),
        parsed.data.boardNumberMode,
        parsed.data.squareCost,
        normalizedPayouts.q1Payout,
        normalizedPayouts.q2Payout,
        normalizedPayouts.q3Payout,
        normalizedPayouts.q4Payout,
        displayToken,
        parsed.data.contactNotificationLevel ?? 'none',
        parsed.data.contactNotifyOnSquareLead ?? false
      ]
    );

    await replacePoolRoundPayouts(client, {
      poolId: id,
      leagueCode: primarySportTeam.leagueCode,
      payoutScheduleMode: parsed.data.payoutScheduleMode,
      roundPayouts: parsed.data.roundPayouts
    });

    await ensurePoolSquaresInitialized(client, id);

    if (poolType.code === 'tournament') {
      await ensureTournamentChampionshipPlaceholder(client, {
        poolId: id,
        season: parsed.data.season,
        sportCode: primarySportTeam.sportCode,
        leagueCode: primarySportTeam.leagueCode,
        primaryTeamName,
        winnerLoserMode: parsed.data.winnerLoserMode ?? poolType.defaultWinnerLoserMode,
        startDate: structureSettings.startDate,
        endDate: structureSettings.endDate,
        templateCode: structureSettings.templateCode
      });

    }

    await client.query('COMMIT');
    res.status(201).json({ id, displayToken });
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
  const requestedAction = parsedBody.data.action ?? 'complete';

  try {
    await client.query('BEGIN');
    const result = await advancePoolSeasonSimulation(client, parsedParams.data.poolId, requestedSource, requestedAction);
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
        const fallbackResult = await advancePoolSeasonSimulation(client, parsedParams.data.poolId, 'mock', requestedAction);
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
  const client = await db.connect();

  try {
    await ensureNotificationSupport(client);

    const result = await client.query(
      `
        SELECT
          u.id,
          u.first_name,
          u.last_name,
          u.email,
          u.phone,
          u.venmo_acct,
          u.is_player_flg,
          u.notification_level,
          u.notify_on_square_lead_flg,
          pt.team_id,
          pt.jersey_num,
          t.team_name
        FROM football_pool.users u
        LEFT JOIN football_pool.member_organization pt ON pt.user_id = u.id
        LEFT JOIN football_pool.organization t ON t.id = pt.team_id
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
      notification_level: string;
      notify_on_square_lead_flg: boolean;
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
        notification_level: row.notification_level ?? 'none',
        notify_on_square_lead_flg: Boolean(row.notify_on_square_lead_flg),
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
  } finally {
    client.release();
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

  const requestedAssignments = resolveRequestedMemberAssignments(parsedBody.data);
  const shouldMarkMember = isMemberSelected(parsedBody.data);

  if (shouldMarkMember && hasDuplicateTeamAssignments(requestedAssignments.map((assignment) => ({ teamId: assignment.teamId, jerseyNum: assignment.memberNumber ?? -1 })))) {
    res.status(400).json({ error: 'A member cannot be assigned to the same organization more than once.' });
    return;
  }

  if (hasDuplicateIds(parsedBody.data.poolIds ?? [])) {
    res.status(400).json({ error: 'A user cannot be assigned to the same pool more than once.' });
    return;
  }

  const client = await db.connect();

  try {
    await ensureNotificationSupport(client);
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
          is_player_flg = COALESCE($7, is_player_flg),
          notification_level = COALESCE($8, notification_level),
          notify_on_square_lead_flg = COALESCE($9, notify_on_square_lead_flg)
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
        shouldMarkMember,
        parsedBody.data.notificationLevel ?? null,
        parsedBody.data.notifyOnSquareLead ?? null
      ]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (parsedBody.data.isPlayer !== undefined || parsedBody.data.isMember !== undefined) {
      const assignments = shouldMarkMember ? requestedAssignments : [];

      await client.query(
        `
          UPDATE football_pool.square AS sq
          SET player_id = NULL
          FROM football_pool.member_organization AS pt
          WHERE sq.player_id = pt.id
            AND pt.user_id = $1
        `,
        [parsedParams.data.userId]
      );

      const remainingSquareRefs = await client.query<{ ref_count: number }>(
        `
          SELECT COUNT(*)::int AS ref_count
          FROM football_pool.square AS sq
          JOIN football_pool.member_organization AS pt
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
          DELETE FROM football_pool.member_organization
          WHERE user_id = $1
        `,
        [parsedParams.data.userId]
      );

      if (assignments.length > 0) {
        for (const assignment of assignments) {
          await createPlayerTeamAssignment(client, parsedParams.data.userId, assignment.teamId, assignment.memberNumber ?? null);
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
          FROM football_pool.organization
          WHERE primary_contact_id = $1
             OR secondary_contact_id = $1
        `,
        [parsedParams.data.userId]
      ),
      db.query<{ assignment_count: number }>(
        `
          SELECT COUNT(*)::int AS assignment_count
          FROM football_pool.member_organization
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
          secondary_contact_id,
          COALESCE(has_members_flg, TRUE) AS has_members_flg,
          sport_team_id
        FROM football_pool.organization
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

setupRouter.get('/sport-teams', async (req, res) => {
  const parsedQuery = sportTeamQuerySchema.safeParse(req.query);

  if (!parsedQuery.success) {
    res.status(400).json({ error: parsedQuery.error.issues });
    return;
  }

  try {
    const requestedLeagueCode = parsedQuery.data.leagueCode?.trim().toUpperCase() || null;
    const result = await db.query(
      `SELECT id,
              name,
              abbreviation,
              sport_code,
              league_code,
              espn_team_uid
       FROM football_pool.sport_team
       WHERE ($1::text IS NULL OR UPPER(COALESCE(league_code, '')) = $1)
       ORDER BY name, id
       LIMIT 1000`,
      [requestedLeagueCode]
    );

    res.json({ sportTeams: result.rows });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to load sport teams',
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
    const resolvedSportTeamId = await resolveSportTeamId(db, parsedBody.data);

    const result = await db.query(
      `
        UPDATE football_pool.organization
        SET
          team_name = $2,
          primary_color = $3,
          secondary_color = $4,
          logo_file = $5,
          primary_contact_id = $6,
          secondary_contact_id = $7,
          has_members_flg = COALESCE($8, has_members_flg),
          sport_team_id = COALESCE($9, sport_team_id)
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
        parsedBody.data.secondaryContactId ?? null,
        parsedBody.data.hasMembers ?? null,
        resolvedSportTeamId
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
          (SELECT COUNT(*)::int FROM football_pool.member_organization WHERE team_id = $1) AS player_refs
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
        DELETE FROM football_pool.organization
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
  const client = await db.connect();

  try {
    await ensurePoolDisplayTokenSupport(client);
    await ensureNotificationSupport(client);
    await ensurePoolStructureSupport(client);
    await ensurePoolPayoutStructureSupport(client);

    const result = await client.query(
      `
        SELECT
          p.id,
          p.pool_name,
          p.team_id,
          p.season,
          p.pool_type,
          p.primary_team,
          p.primary_sport_team_id,
          p.sport_code,
          p.league_code,
          COALESCE(p.winner_loser_flg, FALSE) AS winner_loser_flg,
          p.start_date,
          p.end_date,
          COALESCE(p.structure_mode, 'manual') AS structure_mode,
          p.template_code,
          COALESCE(p.payout_schedule_mode, 'uniform') AS payout_schedule_mode,
          COALESCE(p.board_number_mode, 'per_game') AS board_number_mode,
          COALESCE(payout_rules.round_payouts, '[]'::json) AS round_payouts,
          p.square_cost,
          p.q1_payout,
          p.q2_payout,
          p.q3_payout,
          p.q4_payout,
          p.display_token,
          p.contact_notification_level,
          p.contact_notify_on_square_lead_flg,
          t.team_name,
          COALESCE(t.has_members_flg, TRUE) AS has_members_flg
        FROM football_pool.pool p
        LEFT JOIN football_pool.organization t ON t.id = p.team_id
        LEFT JOIN LATERAL (
          SELECT json_agg(
                   json_build_object(
                     'roundLabel', pr.round_label,
                     'roundSequence', pr.round_sequence,
                     'q1Payout', pr.q1_payout,
                     'q2Payout', pr.q2_payout,
                     'q3Payout', pr.q3_payout,
                     'q4Payout', pr.q4_payout
                   )
                   ORDER BY COALESCE(pr.round_sequence, 32767), LOWER(pr.round_label), pr.id
                 ) AS round_payouts
          FROM football_pool.pool_payout_rule pr
          WHERE pr.pool_id = p.id
        ) payout_rules ON TRUE
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
  } finally {
    client.release();
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

  const client = await db.connect();

  try {
    await ensureNotificationSupport(client);
    await ensurePoolStructureSupport(client);
    await ensurePoolPayoutStructureSupport(client);
    await client.query('BEGIN');

    const poolType = getPoolTypeDefinition(parsedBody.data.poolType);
    const structureSettings = resolvePoolStructureSettings(parsedBody.data);
    const primarySportTeam = await resolvePrimarySportTeamContext(client, parsedBody.data);
    const normalizedPayouts = normalizePayoutsForLeague(primarySportTeam.leagueCode, {
      q1Payout: parsedBody.data.q1Payout,
      q2Payout: parsedBody.data.q2Payout,
      q3Payout: parsedBody.data.q3Payout,
      q4Payout: parsedBody.data.q4Payout
    });
    const primaryTeamName =
      primarySportTeam.primaryTeamName ??
      (poolType.requiresPreferredTeam || Boolean(parsedBody.data.primaryTeam?.trim())
        ? await resolvePrimaryTeamName(client, parsedBody.data.teamId, parsedBody.data.primaryTeam ?? null)
        : null);

    if (poolType.requiresPreferredTeam && !primaryTeamName?.trim()) {
      throw new Error(`A preferred team is required for ${poolType.label.toLowerCase()} pools.`);
    }

    const result = await client.query(
      `
        UPDATE football_pool.pool
        SET
          pool_name = $2,
          team_id = $3,
          season = $4,
          pool_type = $5,
          primary_team = $6,
          primary_sport_team_id = $7,
          sport_code = $8,
          league_code = $9,
          winner_loser_flg = $10,
          start_date = $11::date,
          end_date = $12::date,
          structure_mode = $13,
          template_code = $14,
          payout_schedule_mode = $15,
          board_number_mode = $16::varchar,
          tournament_row_numbers = CASE WHEN $16::text = 'same_for_tournament' THEN tournament_row_numbers ELSE NULL END,
          tournament_column_numbers = CASE WHEN $16::text = 'same_for_tournament' THEN tournament_column_numbers ELSE NULL END,
          square_cost = $17,
          q1_payout = $18,
          q2_payout = $19,
          q3_payout = $20,
          q4_payout = $21,
          contact_notification_level = COALESCE($22, contact_notification_level),
          contact_notify_on_square_lead_flg = COALESCE($23, contact_notify_on_square_lead_flg)
        WHERE id = $1
        RETURNING id
      `,
      [
        parsedParams.data.poolId,
        parsedBody.data.poolName,
        parsedBody.data.teamId,
        parsedBody.data.season,
        poolType.code,
        primaryTeamName,
        primarySportTeam.primarySportTeamId,
        primarySportTeam.sportCode,
        primarySportTeam.leagueCode,
        parsedBody.data.winnerLoserMode ?? poolType.defaultWinnerLoserMode,
        structureSettings.startDate,
        structureSettings.endDate,
        structureSettings.structureMode,
        structureSettings.templateCode,
        getPoolPayoutScheduleMode(parsedBody.data.payoutScheduleMode),
        parsedBody.data.boardNumberMode,
        parsedBody.data.squareCost,
        normalizedPayouts.q1Payout,
        normalizedPayouts.q2Payout,
        normalizedPayouts.q3Payout,
        normalizedPayouts.q4Payout,
        parsedBody.data.contactNotificationLevel ?? null,
        parsedBody.data.contactNotifyOnSquareLead ?? null
      ]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    await replacePoolRoundPayouts(client, {
      poolId: parsedParams.data.poolId,
      leagueCode: primarySportTeam.leagueCode,
      payoutScheduleMode: parsedBody.data.payoutScheduleMode,
      roundPayouts: parsedBody.data.roundPayouts
    });

    if (poolType.code === 'tournament') {
      await ensureTournamentChampionshipPlaceholder(client, {
        poolId: parsedParams.data.poolId,
        season: parsedBody.data.season,
        sportCode: primarySportTeam.sportCode,
        leagueCode: primarySportTeam.leagueCode,
        primaryTeamName,
        winnerLoserMode: parsedBody.data.winnerLoserMode ?? poolType.defaultWinnerLoserMode,
        startDate: structureSettings.startDate,
        endDate: structureSettings.endDate,
        templateCode: structureSettings.templateCode
      });

      await syncPoolGameBoardNumbers(client, parsedParams.data.poolId, {
        overwriteExisting: parsedBody.data.boardNumberMode === 'same_for_tournament'
      });
    }

    await client.query('COMMIT');
    res.json({ id: parsedParams.data.poolId, message: 'Pool updated' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    res.status(500).json({
      error: 'Failed to update pool',
      detail: error instanceof Error ? error.message : 'Unknown error'
    });
  } finally {
    client.release();
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

    const poolResult = await client.query<{ id: number }>(
      `
        SELECT id
        FROM football_pool.pool
        WHERE id = $1
        FOR UPDATE
      `,
      [parsedParams.data.poolId]
    );

    if ((poolResult.rowCount ?? 0) === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Pool not found' });
      return;
    }

    const linkedGamesResult = await client.query<{ game_id: number }>(
      `
        SELECT DISTINCT game_id
        FROM football_pool.pool_game
        WHERE pool_id = $1
      `,
      [parsedParams.data.poolId]
    );

    const linkedGameIds = linkedGamesResult.rows
      .map((row) => Number(row.game_id))
      .filter((gameId) => Number.isFinite(gameId));

    await client.query(
      `
        DELETE FROM football_pool.game_square_numbers
        WHERE square_id IN (
                SELECT id
                FROM football_pool.square
                WHERE pool_id = $1
              )
           OR game_id IN (
                SELECT game_id
                FROM football_pool.pool_game
                WHERE pool_id = $1
              )
      `,
      [parsedParams.data.poolId]
    );

    await client.query(
      `DELETE FROM football_pool.winnings_ledger WHERE pool_id = $1`,
      [parsedParams.data.poolId]
    );

    await client.query(
      `DELETE FROM football_pool.user_pool WHERE pool_id = $1`,
      [parsedParams.data.poolId]
    );

    await client.query(
      `DELETE FROM football_pool.square WHERE pool_id = $1`,
      [parsedParams.data.poolId]
    );

    await client.query(
      `DELETE FROM football_pool.pool_simulation_state WHERE pool_id = $1`,
      [parsedParams.data.poolId]
    );

    await client.query(
      `DELETE FROM football_pool.pool_game WHERE pool_id = $1`,
      [parsedParams.data.poolId]
    );

    if (linkedGameIds.length > 0) {
      await client.query(
        `
          DELETE FROM football_pool.game g
          WHERE g.id = ANY($1::int[])
            AND NOT EXISTS (
              SELECT 1
              FROM football_pool.pool_game pg
              WHERE pg.game_id = g.id
            )
        `,
        [linkedGameIds]
      );
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
        FROM football_pool.member_organization pt
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
          pt.jersey_num AS member_number,
          u.first_name,
          u.last_name
        FROM football_pool.member_organization pt
        JOIN football_pool.pool p ON p.team_id = pt.team_id
        JOIN football_pool.organization o ON o.id = p.team_id
        LEFT JOIN football_pool.users u ON u.id = pt.user_id
        WHERE p.id = $1
          AND COALESCE(o.has_members_flg, TRUE) = TRUE
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
        'SELECT id FROM football_pool.member_organization WHERE id = $1',
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

