BEGIN;

ALTER TABLE football_pool.pool
  ADD COLUMN IF NOT EXISTS board_number_mode VARCHAR(24) DEFAULT 'per_game',
  ADD COLUMN IF NOT EXISTS tournament_row_numbers JSONB,
  ADD COLUMN IF NOT EXISTS tournament_column_numbers JSONB;

UPDATE football_pool.pool
SET board_number_mode = 'per_game'
WHERE board_number_mode IS NULL
   OR BTRIM(board_number_mode) = ''
   OR board_number_mode NOT IN ('per_game', 'same_for_tournament');

ALTER TABLE football_pool.pool
  ALTER COLUMN board_number_mode SET DEFAULT 'per_game';

COMMIT;
