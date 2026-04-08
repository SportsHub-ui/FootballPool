BEGIN;

ALTER TABLE football_pool.pool
  ADD COLUMN IF NOT EXISTS sport_code VARCHAR(16) NOT NULL DEFAULT 'FOOTBALL',
  ADD COLUMN IF NOT EXISTS league_code VARCHAR(16) NOT NULL DEFAULT 'NFL',
  ADD COLUMN IF NOT EXISTS primary_sport_team_id INTEGER;

UPDATE football_pool.pool AS p
SET primary_sport_team_id = o.sport_team_id
FROM football_pool.organization AS o
WHERE p.team_id = o.id
  AND p.primary_sport_team_id IS NULL
  AND o.sport_team_id IS NOT NULL;

UPDATE football_pool.pool AS p
SET primary_sport_team_id = st.id
FROM football_pool.sport_team AS st
WHERE p.primary_sport_team_id IS NULL
  AND p.primary_team IS NOT NULL
  AND LOWER(TRIM(st.name)) = LOWER(TRIM(p.primary_team));

UPDATE football_pool.pool AS p
SET primary_team = COALESCE(NULLIF(TRIM(st.name), ''), p.primary_team),
    sport_code = COALESCE(NULLIF(TRIM(st.sport_code), ''), p.sport_code, 'FOOTBALL'),
    league_code = COALESCE(NULLIF(TRIM(st.league_code), ''), p.league_code, 'NFL')
FROM football_pool.sport_team AS st
WHERE st.id = p.primary_sport_team_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'pool'
      AND constraint_name = 'pool_primary_sport_team_id_fkey'
  ) THEN
    ALTER TABLE football_pool.pool
      ADD CONSTRAINT pool_primary_sport_team_id_fkey
      FOREIGN KEY (primary_sport_team_id)
      REFERENCES football_pool.sport_team (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_pool_league_code
  ON football_pool.pool (league_code);

CREATE INDEX IF NOT EXISTS idx_pool_primary_sport_team_id
  ON football_pool.pool (primary_sport_team_id);

COMMIT;
