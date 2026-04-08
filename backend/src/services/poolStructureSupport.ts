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
        ADD COLUMN IF NOT EXISTS template_code VARCHAR(64),
        ADD COLUMN IF NOT EXISTS board_number_mode VARCHAR(24) DEFAULT 'per_game',
        ADD COLUMN IF NOT EXISTS tournament_row_numbers JSONB,
        ADD COLUMN IF NOT EXISTS tournament_column_numbers JSONB
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
        UPDATE football_pool.pool
        SET board_number_mode = 'per_game'
        WHERE board_number_mode IS NULL
           OR BTRIM(board_number_mode) = ''
           OR board_number_mode NOT IN ('per_game', 'same_for_tournament')
      `);

      await client.query(`
        ALTER TABLE football_pool.pool
        ALTER COLUMN structure_mode SET DEFAULT 'manual'
      `);

      await client.query(`
        ALTER TABLE football_pool.pool
        ALTER COLUMN board_number_mode SET DEFAULT 'per_game'
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
