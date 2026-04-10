DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'football_pool'
      AND table_name = 'pool_simulation_state'
  ) THEN
    ALTER TABLE football_pool.pool_simulation_state
      DROP CONSTRAINT IF EXISTS pool_simulation_state_next_quarter_check;

    ALTER TABLE football_pool.pool_simulation_state
      ADD CONSTRAINT pool_simulation_state_next_quarter_check
      CHECK (next_quarter IS NULL OR next_quarter BETWEEN 1 AND 9);
  END IF;
END $$;
