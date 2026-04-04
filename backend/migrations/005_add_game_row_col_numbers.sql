-- Add board number mappings to each game
ALTER TABLE football_pool.game
  ADD COLUMN IF NOT EXISTS row_numbers JSONB,
  ADD COLUMN IF NOT EXISTS col_numbers JSONB;
