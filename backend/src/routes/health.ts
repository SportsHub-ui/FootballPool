import { Router } from 'express';
import { db } from '../config/db';

export const healthRouter = Router();

healthRouter.get('/', async (_req, res) => {
  try {
    const dbResult = await db.query('SELECT NOW() AS database_time');

    res.json({
      status: 'ok',
      databaseTime: dbResult.rows[0].database_time
    });
  } catch (error) {
    res.status(503).json({
      status: 'error',
      message: 'Database connection failed',
      detail: error instanceof Error ? error.message : 'Unknown database error'
    });
  }
});
