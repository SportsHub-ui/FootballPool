ALTER TABLE football_pool.game
  ADD COLUMN IF NOT EXISTS week_num INTEGER;

UPDATE football_pool.game AS g
SET week_num = ranked.week_num
FROM (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY pool_id ORDER BY game_dt ASC, id ASC) AS week_num
  FROM football_pool.game
) AS ranked
WHERE ranked.id = g.id
  AND g.week_num IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_schema = 'football_pool'
      AND table_name = 'game'
      AND constraint_name = 'game_week_num_check'
  ) THEN
    ALTER TABLE football_pool.game
      ADD CONSTRAINT game_week_num_check
      CHECK (week_num IS NULL OR week_num BETWEEN 1 AND 25);
  END IF;
END
$$;
