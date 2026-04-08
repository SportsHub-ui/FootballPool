ALTER TABLE football_pool.pool
  ADD COLUMN IF NOT EXISTS payout_schedule_mode VARCHAR(16) NOT NULL DEFAULT 'uniform';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pool_payout_schedule_mode_check'
      AND conrelid = 'football_pool.pool'::regclass
  ) THEN
    ALTER TABLE football_pool.pool
      ADD CONSTRAINT pool_payout_schedule_mode_check
      CHECK (payout_schedule_mode IN ('uniform', 'by_round'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS football_pool.pool_payout_rule (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES football_pool.pool(id) ON DELETE CASCADE,
  round_label VARCHAR(80) NOT NULL,
  round_sequence SMALLINT,
  q1_payout INTEGER NOT NULL DEFAULT 0,
  q2_payout INTEGER NOT NULL DEFAULT 0,
  q3_payout INTEGER NOT NULL DEFAULT 0,
  q4_payout INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT pool_payout_rule_round_sequence_check CHECK (round_sequence IS NULL OR round_sequence >= 1)
);

CREATE INDEX IF NOT EXISTS idx_pool_payout_rule_pool_id
  ON football_pool.pool_payout_rule (pool_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pool_payout_rule_pool_round_sequence
  ON football_pool.pool_payout_rule (pool_id, round_sequence)
  WHERE round_sequence IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pool_payout_rule_pool_round_label
  ON football_pool.pool_payout_rule (pool_id, LOWER(round_label));
