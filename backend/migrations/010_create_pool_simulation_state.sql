CREATE TABLE IF NOT EXISTS football_pool.pool_simulation_state (
  pool_id INTEGER PRIMARY KEY REFERENCES football_pool.pool(id) ON DELETE CASCADE,
  mode VARCHAR(20) NOT NULL CHECK (mode IN ('full_year', 'by_game', 'by_quarter')),
  current_game_id INTEGER NULL REFERENCES football_pool.game(id) ON DELETE SET NULL,
  next_quarter INTEGER NULL CHECK (next_quarter BETWEEN 1 AND 9),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
