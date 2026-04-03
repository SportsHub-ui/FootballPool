import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../middleware/auth';
import { db } from '../config/db';
import {
  getScoresForGame,
  listEligibleGamesForIngestion,
  type IngestionSource
} from '../services/scoreIngestion';
import {
  processGameScores,
  type QuarterScoresInput
} from '../services/scoreProcessing';

export const ingestionRouter = Router();

ingestionRouter.use(requireRole('organizer'));

const scoresSchema = z.object({
  q1PrimaryScore: z.number().int().nonnegative(),
  q1OpponentScore: z.number().int().nonnegative(),
  q2PrimaryScore: z.number().int().nonnegative(),
  q2OpponentScore: z.number().int().nonnegative(),
  q3PrimaryScore: z.number().int().nonnegative(),
  q3OpponentScore: z.number().int().nonnegative(),
  q4PrimaryScore: z.number().int().nonnegative(),
  q4OpponentScore: z.number().int().nonnegative()
});

const ingestOneSchema = z.object({
  source: z.enum(['mock', 'payload', 'espn']).default('mock'),
  scores: scoresSchema.optional()
});

const ingestBatchSchema = z.object({
  source: z.enum(['mock', 'payload', 'espn']).default('mock'),
  gameIds: z.array(z.number().int().positive()).optional(),
  scoresByGameId: z.record(scoresSchema).optional()
});

const logIngestionRun = async (params: {
  runMode: 'single' | 'batch' | 'scheduler';
  source: IngestionSource;
  totalGames: number;
  successGames: number;
  failedGames: number;
  requestedBy: string | null;
  details: unknown;
}): Promise<void> => {
  const client = await db.connect();
  try {
    const idResult = await client.query(
      'SELECT COALESCE(MAX(id), 0) + 1 as next_id FROM football_pool.ingestion_run_log'
    );

    await client.query(
      `INSERT INTO football_pool.ingestion_run_log
         (id, run_mode, source, total_games, success_games, failed_games, requested_by, details_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        idResult.rows[0].next_id,
        params.runMode,
        params.source,
        params.totalGames,
        params.successGames,
        params.failedGames,
        params.requestedBy,
        JSON.stringify(params.details)
      ]
    );
  } finally {
    client.release();
  }
};

ingestionRouter.post('/games/:gameId/scores', async (req, res) => {
  try {
    const { gameId } = z.object({ gameId: z.coerce.number().int().positive() }).parse(req.params);
    const input = ingestOneSchema.parse(req.body ?? {});

    const scores = await getScoresForGame(
      gameId,
      input.source as IngestionSource,
      input.scores as QuarterScoresInput | undefined
    );

    const result = await processGameScores(gameId, scores);

    await logIngestionRun({
      runMode: 'single',
      source: input.source,
      totalGames: 1,
      successGames: 1,
      failedGames: 0,
      requestedBy: String(req.auth?.userId ?? ''),
      details: {
        gameId,
        scores,
        result
      }
    });

    res.json({
      message: 'Score ingestion completed',
      gameId,
      source: input.source,
      scores,
      ...result
    });
  } catch (error) {
    console.error('Ingest one game error:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Score ingestion failed' });
  }
});

ingestionRouter.post('/run', async (req, res) => {
  try {
    const input = ingestBatchSchema.parse(req.body ?? {});
    const source = input.source as IngestionSource;

    const targetGameIds = input.gameIds && input.gameIds.length > 0
      ? input.gameIds
      : await listEligibleGamesForIngestion();

    const results: Array<{ gameId: number; ok: boolean; detail: string }> = [];

    for (const gameId of targetGameIds) {
      try {
        const scores = await getScoresForGame(
          gameId,
          source,
          input.scoresByGameId?.[String(gameId)] as QuarterScoresInput | undefined
        );

        await processGameScores(gameId, scores);
        results.push({ gameId, ok: true, detail: 'processed' });
      } catch (error) {
        results.push({
          gameId,
          ok: false,
          detail: error instanceof Error ? error.message : 'failed'
        });
      }
    }

    const success = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;

    await logIngestionRun({
      runMode: 'batch',
      source,
      totalGames: results.length,
      successGames: success,
      failedGames: failed,
      requestedBy: String(req.auth?.userId ?? ''),
      details: {
        targetGameIds,
        results
      }
    });

    res.json({
      message: 'Ingestion run completed',
      source,
      total: results.length,
      success,
      failed,
      results
    });
  } catch (error) {
    console.error('Ingestion run error:', error);
    res.status(400).json({ error: error instanceof Error ? error.message : 'Ingestion run failed' });
  }
});

ingestionRouter.get('/history', async (_req, res) => {
  try {
    const client = await db.connect();
    try {
      const result = await client.query(
        `SELECT id, run_mode, source, total_games, success_games, failed_games,
                requested_by, created_at, details_json
         FROM football_pool.ingestion_run_log
         ORDER BY created_at DESC
         LIMIT 25`
      );

      res.json({ runs: result.rows });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Ingestion history error:', error);
    res.status(500).json({ error: 'Failed to fetch ingestion history' });
  }
});
