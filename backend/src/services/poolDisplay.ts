import { randomBytes } from 'crypto';
import type { PoolClient } from 'pg';

let ensurePoolDisplayTokenSupportPromise: Promise<void> | null = null;

export const ensurePoolDisplayTokenSupport = async (client: PoolClient): Promise<void> => {
  if (!ensurePoolDisplayTokenSupportPromise) {
    ensurePoolDisplayTokenSupportPromise = (async () => {
      await client.query(`
        ALTER TABLE football_pool.pool
        ADD COLUMN IF NOT EXISTS display_token VARCHAR(32)
      `);

      await client.query(`
        UPDATE football_pool.pool
        SET display_token = SUBSTRING(md5(id::text || clock_timestamp()::text || random()::text) FROM 1 FOR 16)
        WHERE display_token IS NULL
           OR BTRIM(display_token) = ''
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_display_token
          ON football_pool.pool (display_token)
      `);
    })();
  }

  try {
    await ensurePoolDisplayTokenSupportPromise;
  } catch (error) {
    ensurePoolDisplayTokenSupportPromise = null;
    throw error;
  }
};

export const generateUniquePoolDisplayToken = async (client: PoolClient): Promise<string> => {
  await ensurePoolDisplayTokenSupport(client);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const token = randomBytes(9).toString('base64url');
    const existing = await client.query(`SELECT 1 FROM football_pool.pool WHERE display_token = $1 LIMIT 1`, [token]);

    if ((existing.rowCount ?? 0) === 0) {
      return token;
    }
  }

  throw new Error('Failed to generate a unique pool display token.');
};
