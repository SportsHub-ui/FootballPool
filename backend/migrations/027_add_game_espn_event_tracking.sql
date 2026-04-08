BEGIN;

ALTER TABLE football_pool.game
  ADD COLUMN IF NOT EXISTS espn_event_id VARCHAR(32),
  ADD COLUMN IF NOT EXISTS espn_event_uid VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_game_espn_event_id
  ON football_pool.game (espn_event_id)
  WHERE espn_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_game_espn_event_uid
  ON football_pool.game (espn_event_uid)
  WHERE espn_event_uid IS NOT NULL;

COMMIT;
