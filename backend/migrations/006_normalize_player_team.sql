-- Simplify player storage:
--   * `users.is_player_flg` tracks whether a user is a player
--   * `player_team` stores the team assignment and jersey number

ALTER TABLE football_pool.users
  ADD COLUMN IF NOT EXISTS is_player_flg BOOLEAN DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS football_pool.player_team (
  id INTEGER PRIMARY KEY,
  user_id INTEGER,
  team_id INTEGER NOT NULL,
  jersey_num INTEGER,
  created_at TIMESTAMP
);

ALTER TABLE football_pool.player_team
  ADD COLUMN IF NOT EXISTS user_id INTEGER,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP;

DO $$
BEGIN
  -- Backfill from the legacy single-team player table.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'football_pool'
      AND table_name = 'player'
      AND column_name = 'team_id'
  ) THEN
    INSERT INTO football_pool.player_team (id, user_id, team_id, jersey_num, created_at)
    SELECT
      p.id,
      p.user_id,
      p.team_id,
      p.jersey_num,
      NOW()
    FROM football_pool.player p
    WHERE p.user_id IS NOT NULL
      AND p.team_id IS NOT NULL
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Backfill from the prior normalized model where player_team pointed at player.id.
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'football_pool'
      AND table_name = 'player_team'
      AND column_name = 'player_id'
  ) AND EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'football_pool'
      AND table_name = 'player'
  ) THEN
    UPDATE football_pool.player_team pt
    SET user_id = p.user_id
    FROM football_pool.player p
    WHERE pt.player_id = p.id
      AND (pt.user_id IS NULL OR pt.user_id <> p.user_id);
  END IF;
END
$$;

DELETE FROM football_pool.player_team
WHERE user_id IS NULL;

ALTER TABLE football_pool.player_team
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN team_id SET NOT NULL;

ALTER TABLE football_pool.player_team
  DROP CONSTRAINT IF EXISTS player_team_player_id_fkey,
  DROP CONSTRAINT IF EXISTS player_team_player_id_team_id_key,
  DROP CONSTRAINT IF EXISTS player_team_user_id_team_id_key;

ALTER TABLE football_pool.player_team
  DROP COLUMN IF EXISTS player_id;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'player_team'
      AND constraint_name = 'player_team_user_id_team_id_key'
  ) THEN
    ALTER TABLE football_pool.player_team
      ADD CONSTRAINT player_team_user_id_team_id_key UNIQUE (user_id, team_id);
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

ALTER TABLE football_pool.square
  DROP CONSTRAINT IF EXISTS square_player_id_fkey;

ALTER TABLE football_pool.square
  ADD CONSTRAINT square_player_id_fkey
  FOREIGN KEY (player_id)
  REFERENCES football_pool.player_team (id)
  DEFERRABLE INITIALLY IMMEDIATE;

UPDATE football_pool.users u
SET is_player_flg = EXISTS (
  SELECT 1
  FROM football_pool.player_team pt
  WHERE pt.user_id = u.id
);

DROP TABLE IF EXISTS football_pool.player;
