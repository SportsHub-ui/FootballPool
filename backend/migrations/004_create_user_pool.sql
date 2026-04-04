-- Create user_pool junction table to track pools users are following
CREATE TABLE IF NOT EXISTS football_pool.user_pool (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  pool_id INTEGER NOT NULL,
  created_at TIMESTAMP,
  UNIQUE(user_id, pool_id)
);

-- Add foreign key constraint for user_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'user_pool'
      AND constraint_name = 'user_pool_user_id_fkey'
  ) THEN
    ALTER TABLE football_pool.user_pool
      ADD CONSTRAINT user_pool_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES football_pool.users (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

-- Add foreign key constraint for pool_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'user_pool'
      AND constraint_name = 'user_pool_pool_id_fkey'
  ) THEN
    ALTER TABLE football_pool.user_pool
      ADD CONSTRAINT user_pool_pool_id_fkey
      FOREIGN KEY (pool_id)
      REFERENCES football_pool.pool (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;
