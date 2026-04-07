BEGIN;

DROP INDEX IF EXISTS football_pool.ux_sport_team_espn_uid;
DROP INDEX IF EXISTS football_pool.ux_sport_team_espn_id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_sport_team_espn_uid
	ON football_pool.sport_team (espn_team_uid);

CREATE UNIQUE INDEX IF NOT EXISTS ux_sport_team_espn_id
	ON football_pool.sport_team (sport_code, league_code, espn_team_id);

COMMIT;
