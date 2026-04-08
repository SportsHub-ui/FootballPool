import type { PoolClient } from 'pg';

let ensurePoolGameStructureSupportPromise: Promise<void> | null = null;

export const ensurePoolGameStructureSupport = async (client: PoolClient): Promise<void> => {
  if (!ensurePoolGameStructureSupportPromise) {
    ensurePoolGameStructureSupportPromise = (async () => {
      await client.query(`
        ALTER TABLE football_pool.pool_game
        ADD COLUMN IF NOT EXISTS round_label VARCHAR(80),
        ADD COLUMN IF NOT EXISTS round_sequence SMALLINT,
        ADD COLUMN IF NOT EXISTS bracket_region VARCHAR(64),
        ADD COLUMN IF NOT EXISTS matchup_order SMALLINT,
        ADD COLUMN IF NOT EXISTS championship_flg BOOLEAN DEFAULT FALSE
      `);

      await client.query(`
        UPDATE football_pool.pool_game
        SET championship_flg = COALESCE(championship_flg, FALSE)
      `);

      await client.query(`
        ALTER TABLE football_pool.pool_game
        ALTER COLUMN championship_flg SET DEFAULT FALSE
      `);
    })();
  }

  try {
    await ensurePoolGameStructureSupportPromise;
  } catch (error) {
    ensurePoolGameStructureSupportPromise = null;
    throw error;
  }
};
