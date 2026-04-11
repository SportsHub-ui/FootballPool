ALTER TABLE football_pool.organization
  ADD COLUMN IF NOT EXISTS display_token VARCHAR(32);

ALTER TABLE football_pool.organization
  ADD COLUMN IF NOT EXISTS display_rotation_seconds INTEGER NOT NULL DEFAULT 30;

UPDATE football_pool.organization
SET display_rotation_seconds = 30
WHERE display_rotation_seconds IS NULL
   OR display_rotation_seconds < 5;

UPDATE football_pool.organization
SET display_token = SUBSTRING(md5(id::text || clock_timestamp()::text || random()::text) FROM 1 FOR 16)
WHERE display_token IS NULL
   OR BTRIM(display_token) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_organization_display_token
  ON football_pool.organization (display_token);
