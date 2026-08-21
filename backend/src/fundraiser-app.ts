import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import path from 'path';
import { fundraiserGamesRouter } from './routes/fundraiser-games';
import { fundraiserAdminRouter } from './routes/fundraiser-admin';

export const fundraiserApp = express();

// Security middleware
fundraiserApp.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);
fundraiserApp.use(cors({ origin: true, credentials: true }));
fundraiserApp.use(express.json());
fundraiserApp.use(express.static(path.resolve(__dirname, '../images')));

// Logging middleware
fundraiserApp.use((req: Request, res: Response, next: NextFunction) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`
    );
  });

  next();
});

// Routes - NO AUTH REQUIRED FOR PUBLIC ENDPOINTS
fundraiserApp.use('/api/games', fundraiserGamesRouter);
fundraiserApp.use('/api/admin', fundraiserAdminRouter); // Admin routes with simple secret key auth

// Serve static files for frontend
fundraiserApp.use(express.static(path.resolve(__dirname, '../frontend/dist')));

// SPA fallback
fundraiserApp.get('*', (_req, res) => {
  res.sendFile(path.resolve(__dirname, '../frontend/dist/index.html'));
});

export default fundraiserApp;
