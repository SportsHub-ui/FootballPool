BEGIN;

-- Promote the normalized shared game table to be the canonical football_pool.game table.
-- 1) Enrich game_new with the fields the app still needs.
-- 2) Repoint dependent foreign keys away from the legacy per-pool game rows.
-- 3) Rename game_new -> game and remove the old legacy table.

ALTER TABLE IF EXISTS football_pool.game_new
  ADD COLUMN IF NOT EXISTS kickoff_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_simulation BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'football_pool'
      AND table_name = 'game_new'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'football_pool.game_new'::regclass
      AND conname = 'game_new_identity_unique'
  ) THEN
    ALTER TABLE football_pool.game_new
      ADD CONSTRAINT game_new_identity_unique
      UNIQUE (season_year, week_number, home_team_id, away_team_id, game_date);
  END IF;
END $$;

UPDATE football_pool.game_new AS gn
SET kickoff_at = COALESCE(src.kickoff_at, gn.game_date::timestamp),
    is_simulation = COALESCE(src.is_simulation, gn.is_simulation, FALSE)
FROM (
  SELECT
    pg.game_id,
    MIN(legacy.game_dt::timestamp) AS kickoff_at,
    BOOL_OR(COALESCE(legacy.is_simulation, FALSE)) AS is_simulation
  FROM football_pool.pool_game AS pg
  JOIN football_pool.game_new AS gn
    ON gn.id = pg.game_id
  LEFT JOIN football_pool.nfl_team AS away_team
    ON away_team.id = gn.away_team_id
  LEFT JOIN football_pool.game AS legacy
    ON legacy.pool_id = pg.pool_id
   AND legacy.game_dt::date = gn.game_date
   AND COALESCE(legacy.week_num, -1) = COALESCE(gn.week_number, -1)
   AND COALESCE(legacy.opponent, '') = COALESCE(away_team.name, '')
  GROUP BY pg.game_id
) AS src
WHERE gn.id = src.game_id;

UPDATE football_pool.game_new
SET kickoff_at = COALESCE(kickoff_at, game_date::timestamp)
WHERE kickoff_at IS NULL;

WITH legacy_map AS (
  SELECT DISTINCT
    legacy.id AS legacy_game_id,
    pg.pool_id,
    pg.game_id AS normalized_game_id
  FROM football_pool.game AS legacy
  JOIN football_pool.pool_game AS pg
    ON pg.pool_id = legacy.pool_id
  JOIN football_pool.game_new AS gn
    ON gn.id = pg.game_id
  LEFT JOIN football_pool.nfl_team AS away_team
    ON away_team.id = gn.away_team_id
  WHERE legacy.game_dt::date = gn.game_date
    AND COALESCE(legacy.week_num, -1) = COALESCE(gn.week_number, -1)
    AND COALESCE(legacy.opponent, '') = COALESCE(away_team.name, '')
)
UPDATE football_pool.winnings_ledger AS wl
SET game_id = legacy_map.normalized_game_id
FROM legacy_map
WHERE wl.game_id = legacy_map.legacy_game_id
  AND wl.pool_id = legacy_map.pool_id;

WITH legacy_map AS (
  SELECT DISTINCT
    legacy.id AS legacy_game_id,
    pg.pool_id,
    pg.game_id AS normalized_game_id
  FROM football_pool.game AS legacy
  JOIN football_pool.pool_game AS pg
    ON pg.pool_id = legacy.pool_id
  JOIN football_pool.game_new AS gn
    ON gn.id = pg.game_id
  LEFT JOIN football_pool.nfl_team AS away_team
    ON away_team.id = gn.away_team_id
  WHERE legacy.game_dt::date = gn.game_date
    AND COALESCE(legacy.week_num, -1) = COALESCE(gn.week_number, -1)
    AND COALESCE(legacy.opponent, '') = COALESCE(away_team.name, '')
)
UPDATE football_pool.notification_log AS nl
SET game_id = legacy_map.normalized_game_id
FROM legacy_map
WHERE nl.game_id = legacy_map.legacy_game_id
  AND nl.pool_id = legacy_map.pool_id;

WITH legacy_map AS (
  SELECT DISTINCT
    legacy.id AS legacy_game_id,
    pg.pool_id,
    pg.game_id AS normalized_game_id
  FROM football_pool.game AS legacy
  JOIN football_pool.pool_game AS pg
    ON pg.pool_id = legacy.pool_id
  JOIN football_pool.game_new AS gn
    ON gn.id = pg.game_id
  LEFT JOIN football_pool.nfl_team AS away_team
    ON away_team.id = gn.away_team_id
  WHERE legacy.game_dt::date = gn.game_date
    AND COALESCE(legacy.week_num, -1) = COALESCE(gn.week_number, -1)
    AND COALESCE(legacy.opponent, '') = COALESCE(away_team.name, '')
)
UPDATE football_pool.pool_simulation_state AS pss
SET current_game_id = legacy_map.normalized_game_id
FROM legacy_map
WHERE pss.current_game_id = legacy_map.legacy_game_id
  AND pss.pool_id = legacy_map.pool_id;

WITH legacy_map AS (
  SELECT DISTINCT
    legacy.id AS legacy_game_id,
    pg.game_id AS normalized_game_id
  FROM football_pool.game AS legacy
  JOIN football_pool.pool_game AS pg
    ON pg.pool_id = legacy.pool_id
  JOIN football_pool.game_new AS gn
    ON gn.id = pg.game_id
  LEFT JOIN football_pool.nfl_team AS away_team
    ON away_team.id = gn.away_team_id
  WHERE legacy.game_dt::date = gn.game_date
    AND COALESCE(legacy.week_num, -1) = COALESCE(gn.week_number, -1)
    AND COALESCE(legacy.opponent, '') = COALESCE(away_team.name, '')
)
UPDATE football_pool.game_square_numbers AS gsn
SET game_id = legacy_map.normalized_game_id
FROM legacy_map
WHERE gsn.game_id = legacy_map.legacy_game_id;

ALTER TABLE IF EXISTS football_pool.winnings_ledger
  DROP CONSTRAINT IF EXISTS winnings_ledger_game_id_fkey;
ALTER TABLE IF EXISTS football_pool.notification_log
  DROP CONSTRAINT IF EXISTS notification_log_game_id_fkey;
ALTER TABLE IF EXISTS football_pool.pool_simulation_state
  DROP CONSTRAINT IF EXISTS pool_simulation_state_current_game_id_fkey;
ALTER TABLE IF EXISTS football_pool.game_square_numbers
  DROP CONSTRAINT IF EXISTS game_square_numbers_game_id_fkey;
ALTER TABLE IF EXISTS football_pool.game
  DROP CONSTRAINT IF EXISTS game_pool_id_fkey;

DROP TABLE IF EXISTS football_pool.game_legacy CASCADE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'football_pool'
      AND table_name = 'game_new'
  ) THEN
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'football_pool'
        AND table_name = 'game'
    ) THEN
      ALTER TABLE football_pool.game RENAME TO game_legacy;
    END IF;

    ALTER TABLE football_pool.game_new RENAME TO game;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_game_game_date
  ON football_pool.game (game_date);

ALTER TABLE IF EXISTS football_pool.winnings_ledger
  ADD CONSTRAINT winnings_ledger_game_id_fkey
  FOREIGN KEY (game_id)
  REFERENCES football_pool.game (id)
  DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE IF EXISTS football_pool.notification_log
  ADD CONSTRAINT notification_log_game_id_fkey
  FOREIGN KEY (game_id)
  REFERENCES football_pool.game (id)
  ON DELETE CASCADE;

ALTER TABLE IF EXISTS football_pool.pool_simulation_state
  ADD CONSTRAINT pool_simulation_state_current_game_id_fkey
  FOREIGN KEY (current_game_id)
  REFERENCES football_pool.game (id)
  ON DELETE SET NULL;

ALTER TABLE IF EXISTS football_pool.game_square_numbers
  ADD CONSTRAINT game_square_numbers_game_id_fkey
  FOREIGN KEY (game_id)
  REFERENCES football_pool.game (id)
  DEFERRABLE INITIALLY IMMEDIATE;

DROP TABLE IF EXISTS football_pool.game_legacy CASCADE;

COMMIT;
