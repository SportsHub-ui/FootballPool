BEGIN;

ALTER TABLE football_pool.pool
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS structure_mode VARCHAR(16) NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS template_code VARCHAR(64);

UPDATE football_pool.pool
SET structure_mode = 'manual'
WHERE structure_mode IS NULL
   OR NULLIF(BTRIM(structure_mode), '') IS NULL
   OR structure_mode NOT IN ('manual', 'template');

UPDATE football_pool.pool
SET template_code = NULLIF(BTRIM(template_code), '');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'pool'
      AND constraint_name = 'pool_structure_mode_check'
  ) THEN
    ALTER TABLE football_pool.pool
      ADD CONSTRAINT pool_structure_mode_check
      CHECK (structure_mode IN ('manual', 'template'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'pool'
      AND constraint_name = 'pool_date_window_check'
  ) THEN
    ALTER TABLE football_pool.pool
      ADD CONSTRAINT pool_date_window_check
      CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date);
  END IF;
END
$$;

COMMIT;
