ALTER TABLE football_pool.pool
ADD COLUMN IF NOT EXISTS display_token VARCHAR(32);

UPDATE football_pool.pool
SET display_token = SUBSTRING(md5(id::text || clock_timestamp()::text || random()::text) FROM 1 FOR 16)
WHERE display_token IS NULL
   OR BTRIM(display_token) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_pool_display_token
  ON football_pool.pool (display_token);
