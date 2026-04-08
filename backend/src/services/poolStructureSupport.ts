import type { PoolClient } from 'pg';

let ensurePoolStructureSupportPromise: Promise<void> | null = null;

export const ensurePoolStructureSupport = async (client: PoolClient): Promise<void> => {
  if (!ensurePoolStructureSupportPromise) {
    ensurePoolStructureSupportPromise = (async () => {
      await client.query(`
        ALTER TABLE football_pool.pool
        ADD COLUMN IF NOT EXISTS start_date DATE,
        ADD COLUMN IF NOT EXISTS end_date DATE,
        ADD COLUMN IF NOT EXISTS structure_mode VARCHAR(16) DEFAULT 'manual',
        ADD COLUMN IF NOT EXISTS template_code VARCHAR(64)
      `);

      await client.query(`
        UPDATE football_pool.pool
        SET structure_mode = 'manual'
        WHERE structure_mode IS NULL
           OR BTRIM(structure_mode) = ''
           OR structure_mode NOT IN ('manual', 'template')
      `);

      await client.query(`
        UPDATE football_pool.pool
        SET template_code = NULLIF(BTRIM(template_code), '')
      `);

      await client.query(`
        ALTER TABLE football_pool.pool
        ALTER COLUMN structure_mode SET DEFAULT 'manual'
      `);
    })();
  }

  try {
    await ensurePoolStructureSupportPromise;
  } catch (error) {
    ensurePoolStructureSupportPromise = null;
    throw error;
  }
};
