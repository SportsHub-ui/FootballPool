CREATE TABLE IF NOT EXISTS football_pool.ingestion_run_log (
  id integer PRIMARY KEY,
  run_mode varchar NOT NULL,
  source varchar NOT NULL,
  total_games integer NOT NULL,
  success_games integer NOT NULL,
  failed_games integer NOT NULL,
  requested_by varchar,
  created_at timestamp NOT NULL DEFAULT now(),
  details_json jsonb
);

CREATE INDEX IF NOT EXISTS idx_ingestion_run_log_created_at
  ON football_pool.ingestion_run_log (created_at DESC);
