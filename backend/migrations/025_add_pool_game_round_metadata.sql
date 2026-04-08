BEGIN;

ALTER TABLE football_pool.pool_game
  ADD COLUMN IF NOT EXISTS round_label VARCHAR(80),
  ADD COLUMN IF NOT EXISTS round_sequence SMALLINT,
  ADD COLUMN IF NOT EXISTS bracket_region VARCHAR(64),
  ADD COLUMN IF NOT EXISTS matchup_order SMALLINT,
  ADD COLUMN IF NOT EXISTS championship_flg BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE football_pool.pool_game
SET championship_flg = COALESCE(championship_flg, FALSE);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'pool_game'
      AND constraint_name = 'pool_game_round_sequence_check'
  ) THEN
    ALTER TABLE football_pool.pool_game
      ADD CONSTRAINT pool_game_round_sequence_check
      CHECK (round_sequence IS NULL OR round_sequence >= 1);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'pool_game'
      AND constraint_name = 'pool_game_matchup_order_check'
  ) THEN
    ALTER TABLE football_pool.pool_game
      ADD CONSTRAINT pool_game_matchup_order_check
      CHECK (matchup_order IS NULL OR matchup_order >= 1);
  END IF;
END
$$;

COMMIT;
