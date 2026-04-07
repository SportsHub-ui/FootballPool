import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

const isProductionLike =
  process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
const isTestLike = process.env.NODE_ENV === 'test' || process.env.APP_ENV === 'test';

// Try common locations so running from repo root or backend folder both work.
const envPaths = [
  ...(isTestLike
    ? [
        path.resolve(process.cwd(), '.env.test'),
        path.resolve(process.cwd(), 'backend/.env.test'),
        path.resolve(__dirname, '../../.env.test')
      ]
    : []),
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(__dirname, '../../.env')
];

for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath, override: false });
  if (!result.error) {
    break;
  }
}

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  APP_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SCORE_INGEST_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((value) => value === 'true'),
  SCORE_INGEST_SOURCE: z.enum(['mock', 'payload', 'espn']).default('mock'),
  SCORE_INGEST_INTERVAL_MINUTES: z.coerce.number().int().positive().default(30),
  SCORE_INGEST_ACTIVE_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
  SCORE_INGEST_DAILY_START_HOUR_CT: z.coerce.number().int().min(0).max(23).default(6),
  SCORE_INGEST_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  SCORE_INGEST_PRIMARY_TEAM: z.string().optional().default(''),
  SIMULATION_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .default('true')
    .transform((value) => value === 'true'),
  EMAIL_NOTIFICATIONS_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .default('true')
    .transform((value) => value === 'true'),
  EMAIL_FROM: z.string().optional().default('noreply@footballpool.local'),
  SMTP_HOST: z.string().optional().default(''),
  SMTP_PORT: z.coerce.number().int().positive().optional().default(587),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .default('false')
    .transform((value) => value === 'true'),
  SMTP_USER: z.string().optional().default(''),
  SMTP_PASS: z.string().optional().default('')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(
    `Missing required environment variables: ${missing}. Create backend/.env from backend/.env.example and set DATABASE_URL and JWT_SECRET.`
  );
}

export const env = parsed.data;
