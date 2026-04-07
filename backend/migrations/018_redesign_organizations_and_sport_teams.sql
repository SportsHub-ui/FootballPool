BEGIN;

-- Rename the app-owned team/player tables to reflect the organization/member model.
DO $$
BEGIN
	IF to_regclass('football_pool.team') IS NOT NULL
		AND to_regclass('football_pool.organization') IS NULL THEN
		ALTER TABLE football_pool.team RENAME TO organization;
	END IF;
END
$$;

DO $$
BEGIN
	IF to_regclass('football_pool.player_team') IS NOT NULL
		AND to_regclass('football_pool.member_organization') IS NULL THEN
		ALTER TABLE football_pool.player_team RENAME TO member_organization;
	END IF;
END
$$;

-- Rename the NFL-specific reference table so it can support additional sports later.
DO $$
BEGIN
	IF to_regclass('football_pool.nfl_team') IS NOT NULL
		AND to_regclass('football_pool.sport_team') IS NULL THEN
		ALTER TABLE football_pool.nfl_team RENAME TO sport_team;
	END IF;
END
$$;

ALTER TABLE football_pool.organization
	ADD COLUMN IF NOT EXISTS has_members_flg BOOLEAN NOT NULL DEFAULT TRUE,
	ADD COLUMN IF NOT EXISTS sport_team_id INTEGER;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints
		WHERE constraint_schema = 'football_pool'
			AND table_name = 'organization'
			AND constraint_name = 'organization_sport_team_id_fkey'
	) THEN
		ALTER TABLE football_pool.organization
			ADD CONSTRAINT organization_sport_team_id_fkey
			FOREIGN KEY (sport_team_id)
			REFERENCES football_pool.sport_team (id)
			DEFERRABLE INITIALLY IMMEDIATE;
	END IF;
END
$$;

ALTER TABLE football_pool.sport_team
	ADD COLUMN IF NOT EXISTS sport_code VARCHAR(16) NOT NULL DEFAULT 'FOOTBALL',
	ADD COLUMN IF NOT EXISTS league_code VARCHAR(16) NOT NULL DEFAULT 'NFL',
	ADD COLUMN IF NOT EXISTS abbreviation VARCHAR(16);

UPDATE football_pool.sport_team
SET abbreviation = CASE name
	WHEN 'Arizona Cardinals' THEN 'ARI'
	WHEN 'Atlanta Falcons' THEN 'ATL'
	WHEN 'Baltimore Ravens' THEN 'BAL'
	WHEN 'Buffalo Bills' THEN 'BUF'
	WHEN 'Carolina Panthers' THEN 'CAR'
	WHEN 'Chicago Bears' THEN 'CHI'
	WHEN 'Cincinnati Bengals' THEN 'CIN'
	WHEN 'Cleveland Browns' THEN 'CLE'
	WHEN 'Dallas Cowboys' THEN 'DAL'
	WHEN 'Denver Broncos' THEN 'DEN'
	WHEN 'Detroit Lions' THEN 'DET'
	WHEN 'Green Bay Packers' THEN 'GB'
	WHEN 'Houston Texans' THEN 'HOU'
	WHEN 'Indianapolis Colts' THEN 'IND'
	WHEN 'Jacksonville Jaguars' THEN 'JAX'
	WHEN 'Kansas City Chiefs' THEN 'KC'
	WHEN 'Las Vegas Raiders' THEN 'LV'
	WHEN 'Los Angeles Chargers' THEN 'LAC'
	WHEN 'Los Angeles Rams' THEN 'LAR'
	WHEN 'Miami Dolphins' THEN 'MIA'
	WHEN 'Minnesota Vikings' THEN 'MIN'
	WHEN 'New England Patriots' THEN 'NE'
	WHEN 'New Orleans Saints' THEN 'NO'
	WHEN 'New York Giants' THEN 'NYG'
	WHEN 'New York Jets' THEN 'NYJ'
	WHEN 'Philadelphia Eagles' THEN 'PHI'
	WHEN 'Pittsburgh Steelers' THEN 'PIT'
	WHEN 'San Francisco 49ers' THEN 'SF'
	WHEN 'Seattle Seahawks' THEN 'SEA'
	WHEN 'Tampa Bay Buccaneers' THEN 'TB'
	WHEN 'Tennessee Titans' THEN 'TEN'
	WHEN 'Washington Commanders' THEN 'WSH'
	ELSE abbreviation
END
WHERE COALESCE(abbreviation, '') = '';

UPDATE football_pool.organization AS o
SET sport_team_id = st.id
FROM football_pool.sport_team AS st
WHERE o.sport_team_id IS NULL
	AND o.team_name IS NOT NULL
	AND LOWER(TRIM(o.team_name)) = LOWER(TRIM(st.name));

UPDATE football_pool.organization AS o
SET sport_team_id = st.id
FROM football_pool.pool AS p
JOIN football_pool.sport_team AS st
	ON LOWER(TRIM(st.name)) = LOWER(TRIM(p.primary_team))
WHERE p.team_id = o.id
	AND o.sport_team_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_organization_sport_team_id
	ON football_pool.organization (sport_team_id);

CREATE INDEX IF NOT EXISTS idx_sport_team_lookup
	ON football_pool.sport_team (league_code, sport_code, abbreviation);

COMMIT;
