import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

const isProductionLike =
  process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';

// Try common locations so running from repo root or backend folder both work.
const envPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(__dirname, '../../.env')
];

for (const envPath of envPaths) {
  const result = dotenv.config({ path: envPath, override: !isProductionLike });
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
  SCORE_INGEST_PRIMARY_TEAM: z.string().optional().default(''),
  SIMULATION_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .default('true')
    .transform((value) => value === 'true')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(
    `Missing required environment variables: ${missing}. Create backend/.env from backend/.env.example and set DATABASE_URL and JWT_SECRET.`
  );
}

export const env = parsed.data;
