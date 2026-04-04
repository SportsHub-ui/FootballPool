CREATE SCHEMA IF NOT EXISTS football_pool;

CREATE TABLE IF NOT EXISTS football_pool.users (
  id INTEGER PRIMARY KEY,
  first_name VARCHAR,
  last_name VARCHAR,
  email VARCHAR,
  phone VARCHAR,
  created_at TIMESTAMP,
  is_player_flg BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS football_pool.team (
  id INTEGER PRIMARY KEY,
  team_name VARCHAR,
  primary_color VARCHAR,
  secondary_color VARCHAR,
  logo_file VARCHAR,
  primary_contact_id INTEGER,
  secondary_contact_id INTEGER,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS football_pool.player_team (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  team_id INTEGER NOT NULL,
  jersey_num INTEGER,
  created_at TIMESTAMP,
  UNIQUE (user_id, team_id)
);

CREATE TABLE IF NOT EXISTS football_pool.pool (
  id INTEGER PRIMARY KEY,
  pool_name VARCHAR,
  team_id INTEGER,
  season INTEGER,
  primary_team VARCHAR,
  square_cost INTEGER,
  q1_payout INTEGER,
  q2_payout INTEGER,
  q3_payout INTEGER,
  q4_payout INTEGER,
  created_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS football_pool.square (
  id INTEGER PRIMARY KEY,
  pool_id INTEGER,
  square_num INTEGER,
  participant_id INTEGER,
  player_id INTEGER,
  paid_flg BOOLEAN
);

CREATE TABLE IF NOT EXISTS football_pool.game (
  id INTEGER PRIMARY KEY,
  is_simulation BOOLEAN,
  opponent VARCHAR,
  game_dt DATE,
  pool_id INTEGER,
  week_num INTEGER,
  q1_primary_score INTEGER,
  q2_primary_score INTEGER,
  q3_primary_score INTEGER,
  q4_primary_score INTEGER,
  q1_opponent_score INTEGER,
  q2_opponent_score INTEGER,
  q3_opponent_score INTEGER,
  q4_opponent_score INTEGER
);

CREATE TABLE IF NOT EXISTS football_pool.game_square_numbers (
  id INTEGER PRIMARY KEY,
  game_id INTEGER,
  square_id INTEGER,
  row_digit INTEGER,
  col_digit INTEGER
);

CREATE TABLE IF NOT EXISTS football_pool.winnings_ledger (
  id INTEGER PRIMARY KEY,
  game_id INTEGER,
  pool_id INTEGER,
  quarter INTEGER,
  winner_user_id INTEGER,
  amount_won INTEGER,
  payout_status VARCHAR
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'team'
      AND constraint_name = 'team_primary_contact_id_fkey'
  ) THEN
    ALTER TABLE football_pool.team
      ADD CONSTRAINT team_primary_contact_id_fkey
      FOREIGN KEY (primary_contact_id)
      REFERENCES football_pool.users (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'team'
      AND constraint_name = 'team_secondary_contact_id_fkey'
  ) THEN
    ALTER TABLE football_pool.team
      ADD CONSTRAINT team_secondary_contact_id_fkey
      FOREIGN KEY (secondary_contact_id)
      REFERENCES football_pool.users (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'player_team'
      AND constraint_name = 'player_team_user_id_fkey'
  ) THEN
    ALTER TABLE football_pool.player_team
      ADD CONSTRAINT player_team_user_id_fkey
      FOREIGN KEY (user_id)
      REFERENCES football_pool.users (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'player_team'
      AND constraint_name = 'player_team_team_id_fkey'
  ) THEN
    ALTER TABLE football_pool.player_team
      ADD CONSTRAINT player_team_team_id_fkey
      FOREIGN KEY (team_id)
      REFERENCES football_pool.team (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'pool'
      AND constraint_name = 'pool_team_id_fkey'
  ) THEN
    ALTER TABLE football_pool.pool
      ADD CONSTRAINT pool_team_id_fkey
      FOREIGN KEY (team_id)
      REFERENCES football_pool.team (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'square'
      AND constraint_name = 'square_pool_id_fkey'
  ) THEN
    ALTER TABLE football_pool.square
      ADD CONSTRAINT square_pool_id_fkey
      FOREIGN KEY (pool_id)
      REFERENCES football_pool.pool (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'square'
      AND constraint_name = 'square_participant_id_fkey'
  ) THEN
    ALTER TABLE football_pool.square
      ADD CONSTRAINT square_participant_id_fkey
      FOREIGN KEY (participant_id)
      REFERENCES football_pool.users (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'square'
      AND constraint_name = 'square_player_id_fkey'
  ) THEN
    ALTER TABLE football_pool.square
      ADD CONSTRAINT square_player_id_fkey
      FOREIGN KEY (player_id)
      REFERENCES football_pool.player_team (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'game'
      AND constraint_name = 'game_pool_id_fkey'
  ) THEN
    ALTER TABLE football_pool.game
      ADD CONSTRAINT game_pool_id_fkey
      FOREIGN KEY (pool_id)
      REFERENCES football_pool.pool (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'game_square_numbers'
      AND constraint_name = 'game_square_numbers_game_id_fkey'
  ) THEN
    ALTER TABLE football_pool.game_square_numbers
      ADD CONSTRAINT game_square_numbers_game_id_fkey
      FOREIGN KEY (game_id)
      REFERENCES football_pool.game (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'game_square_numbers'
      AND constraint_name = 'game_square_numbers_square_id_fkey'
  ) THEN
    ALTER TABLE football_pool.game_square_numbers
      ADD CONSTRAINT game_square_numbers_square_id_fkey
      FOREIGN KEY (square_id)
      REFERENCES football_pool.square (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'winnings_ledger'
      AND constraint_name = 'winnings_ledger_game_id_fkey'
  ) THEN
    ALTER TABLE football_pool.winnings_ledger
      ADD CONSTRAINT winnings_ledger_game_id_fkey
      FOREIGN KEY (game_id)
      REFERENCES football_pool.game (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'winnings_ledger'
      AND constraint_name = 'winnings_ledger_pool_id_fkey'
  ) THEN
    ALTER TABLE football_pool.winnings_ledger
      ADD CONSTRAINT winnings_ledger_pool_id_fkey
      FOREIGN KEY (pool_id)
      REFERENCES football_pool.pool (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'winnings_ledger'
      AND constraint_name = 'winnings_ledger_winner_user_id_fkey'
  ) THEN
    ALTER TABLE football_pool.winnings_ledger
      ADD CONSTRAINT winnings_ledger_winner_user_id_fkey
      FOREIGN KEY (winner_user_id)
      REFERENCES football_pool.users (id)
      DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END
$$;
