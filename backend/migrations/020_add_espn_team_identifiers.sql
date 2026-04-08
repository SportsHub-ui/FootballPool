BEGIN;

ALTER TABLE football_pool.sport_team
	ADD COLUMN IF NOT EXISTS espn_team_id VARCHAR(32),
	ADD COLUMN IF NOT EXISTS espn_team_uid VARCHAR(64),
	ADD COLUMN IF NOT EXISTS espn_slug VARCHAR(128);

DO $$
DECLARE
	name_constraint TEXT;
BEGIN
	SELECT tc.constraint_name
	INTO name_constraint
	FROM information_schema.table_constraints tc
	JOIN information_schema.constraint_column_usage ccu
		ON ccu.constraint_schema = tc.constraint_schema
		AND ccu.constraint_name = tc.constraint_name
	WHERE tc.table_schema = 'football_pool'
		AND tc.table_name = 'sport_team'
		AND tc.constraint_type = 'UNIQUE'
		AND ccu.column_name = 'name'
	LIMIT 1;

	IF name_constraint IS NOT NULL THEN
		EXECUTE format('ALTER TABLE football_pool.sport_team DROP CONSTRAINT %I', name_constraint);
	END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sport_team_scoped_name
	ON football_pool.sport_team (sport_code, league_code, name);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sport_team_espn_uid
	ON football_pool.sport_team (espn_team_uid)
	WHERE espn_team_uid IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sport_team_espn_id
	ON football_pool.sport_team (sport_code, league_code, espn_team_id)
	WHERE espn_team_id IS NOT NULL;

COMMIT;
