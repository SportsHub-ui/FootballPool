BEGIN;

ALTER TABLE football_pool.pool
  ADD COLUMN IF NOT EXISTS pool_type VARCHAR(32) NOT NULL DEFAULT 'season',
  ADD COLUMN IF NOT EXISTS winner_loser_flg BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE football_pool.pool
SET pool_type = COALESCE(NULLIF(TRIM(pool_type), ''), 'season')
WHERE pool_type IS NULL OR NULLIF(TRIM(pool_type), '') IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'pool'
      AND constraint_name = 'pool_pool_type_check'
  ) THEN
    ALTER TABLE football_pool.pool
      ADD CONSTRAINT pool_pool_type_check
      CHECK (pool_type IN ('season', 'single_game', 'playoff_series', 'tournament'));
  END IF;
END
$$;

COMMIT;
