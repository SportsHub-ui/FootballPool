BEGIN;

-- Ensure the generic reference table has the metadata columns needed for seeded sports.
ALTER TABLE football_pool.sport_team
	ADD COLUMN IF NOT EXISTS sport_code VARCHAR(16) NOT NULL DEFAULT 'FOOTBALL',
	ADD COLUMN IF NOT EXISTS league_code VARCHAR(16) NOT NULL DEFAULT 'NFL',
	ADD COLUMN IF NOT EXISTS abbreviation VARCHAR(16);

-- Seed the current NFL reference teams so sport_team is fully populated after migration.
WITH seed_data (name, abbreviation, primary_color, logo_url, sport_code, league_code) AS (
	VALUES
		('Arizona Cardinals', 'ARI', '#97233F', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-cardinals.png', 'FOOTBALL', 'NFL'),
		('Atlanta Falcons', 'ATL', '#A71930', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-falcons.png', 'FOOTBALL', 'NFL'),
		('Baltimore Ravens', 'BAL', '#241773', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-ravens.png', 'FOOTBALL', 'NFL'),
		('Buffalo Bills', 'BUF', '#00338D', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-bills.png', 'FOOTBALL', 'NFL'),
		('Carolina Panthers', 'CAR', '#0085CA', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-panthers.png', 'FOOTBALL', 'NFL'),
		('Chicago Bears', 'CHI', '#0B162A', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-bears.png', 'FOOTBALL', 'NFL'),
		('Cincinnati Bengals', 'CIN', '#FB4F14', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-bengals.png', 'FOOTBALL', 'NFL'),
		('Cleveland Browns', 'CLE', '#311D00', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-browns.png', 'FOOTBALL', 'NFL'),
		('Dallas Cowboys', 'DAL', '#003594', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-cowboys.png', 'FOOTBALL', 'NFL'),
		('Denver Broncos', 'DEN', '#002244', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-broncos.png', 'FOOTBALL', 'NFL'),
		('Detroit Lions', 'DET', '#0076B6', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-lions.png', 'FOOTBALL', 'NFL'),
		('Green Bay Packers', 'GB', '#203731', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-packers.png', 'FOOTBALL', 'NFL'),
		('Houston Texans', 'HOU', '#03202F', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-texans.png', 'FOOTBALL', 'NFL'),
		('Indianapolis Colts', 'IND', '#002C5F', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-colts.png', 'FOOTBALL', 'NFL'),
		('Jacksonville Jaguars', 'JAX', '#006778', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-jaguars.png', 'FOOTBALL', 'NFL'),
		('Kansas City Chiefs', 'KC', '#E31837', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-chiefs.png', 'FOOTBALL', 'NFL'),
		('Las Vegas Raiders', 'LV', '#000000', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-raiders.png', 'FOOTBALL', 'NFL'),
		('Los Angeles Chargers', 'LAC', '#0080C6', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-chargers.png', 'FOOTBALL', 'NFL'),
		('Los Angeles Rams', 'LAR', '#003594', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-rams.png', 'FOOTBALL', 'NFL'),
		('Miami Dolphins', 'MIA', '#008E97', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-dolphins.png', 'FOOTBALL', 'NFL'),
		('Minnesota Vikings', 'MIN', '#4F2683', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-vikings.png', 'FOOTBALL', 'NFL'),
		('New England Patriots', 'NE', '#002244', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-patriots.png', 'FOOTBALL', 'NFL'),
		('New Orleans Saints', 'NO', '#D3BC8D', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-saints.png', 'FOOTBALL', 'NFL'),
		('New York Giants', 'NYG', '#0B2265', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-giants.png', 'FOOTBALL', 'NFL'),
		('New York Jets', 'NYJ', '#125740', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-jets.png', 'FOOTBALL', 'NFL'),
		('Philadelphia Eagles', 'PHI', '#004C54', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-eagles.png', 'FOOTBALL', 'NFL'),
		('Pittsburgh Steelers', 'PIT', '#FFB612', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-steelers.png', 'FOOTBALL', 'NFL'),
		('San Francisco 49ers', 'SF', '#AA0000', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-49ers.png', 'FOOTBALL', 'NFL'),
		('Seattle Seahawks', 'SEA', '#002244', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-seahawks.png', 'FOOTBALL', 'NFL'),
		('Tampa Bay Buccaneers', 'TB', '#D50A0A', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-buccaneers.png', 'FOOTBALL', 'NFL'),
		('Tennessee Titans', 'TEN', '#4B92DB', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-titans.png', 'FOOTBALL', 'NFL'),
		('Washington Commanders', 'WSH', '#5A1414', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-commanders.png', 'FOOTBALL', 'NFL')
)
INSERT INTO football_pool.sport_team (name, abbreviation, primary_color, logo_url, sport_code, league_code)
SELECT name, abbreviation, primary_color, logo_url, sport_code, league_code
FROM seed_data
ON CONFLICT (name) DO UPDATE
SET abbreviation = EXCLUDED.abbreviation,
	sport_code = EXCLUDED.sport_code,
	league_code = EXCLUDED.league_code,
	primary_color = COALESCE(NULLIF(football_pool.sport_team.primary_color, ''), EXCLUDED.primary_color),
	logo_url = COALESCE(NULLIF(football_pool.sport_team.logo_url, ''), EXCLUDED.logo_url);

-- Backfill organization links where the organization name matches the seeded sport team.
UPDATE football_pool.organization AS o
SET sport_team_id = st.id
FROM football_pool.sport_team AS st
WHERE o.sport_team_id IS NULL
	AND o.team_name IS NOT NULL
	AND LOWER(TRIM(o.team_name)) = LOWER(TRIM(st.name));

CREATE INDEX IF NOT EXISTS idx_sport_team_league_name
	ON football_pool.sport_team (league_code, sport_code, name);

COMMIT;
