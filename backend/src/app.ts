import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import path from 'path';
import { authRouter } from './routes/auth';
import { dbSmokeRouter } from './routes/dbSmoke';
import { gamesRouter } from './routes/games';
import { healthRouter } from './routes/health';
import { ingestionRouter } from './routes/ingestion';
import { participantRouter } from './routes/participant';
import { poolsRouter } from './routes/pools';
import { setupRouter } from './routes/setup';
import { winningsRouter } from './routes/winnings';
import { mockAuth } from './middleware/auth';

export const app = express();

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);
app.use(cors());
app.use(express.json());
app.use('/images', express.static(path.resolve(__dirname, '../images')));
app.use((req, res, next) => {
  const startedAt = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${durationMs}ms)`
    );
  });

  next();
});
app.use(mockAuth);

app.get('/', (_req, res) => {
  res.json({ service: 'footballpool-backend', status: 'running' });
});

app.use('/api/health', healthRouter);
app.use('/api/db', dbSmokeRouter);
app.use('/api/auth', authRouter);
app.use('/api/pools', poolsRouter);
app.use('/api/setup', setupRouter);
app.use('/api/games', gamesRouter);
app.use('/api/winnings', winningsRouter);
app.use('/api/participant', participantRouter);
app.use('/api/ingestion', ingestionRouter);
