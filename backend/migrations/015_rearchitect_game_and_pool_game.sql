-- Migration: Normalize NFL games and pool-game mapping
-- 1. Create nfl_team, game, and pool_game tables
-- 2. Preload nfl_team
-- 3. Migrate existing data

BEGIN;

-- 1. Create nfl_team table
CREATE TABLE IF NOT EXISTS football_pool.nfl_team (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL UNIQUE,
    primary_color VARCHAR,
    logo_url VARCHAR
);

-- 2. Preload all 32 NFL teams
INSERT INTO football_pool.nfl_team (name, primary_color, logo_url) VALUES
('Arizona Cardinals', '#97233F', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-cardinals.png'),
('Atlanta Falcons', '#A71930', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-falcons.png'),
('Baltimore Ravens', '#241773', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-ravens.png'),
('Buffalo Bills', '#00338D', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-bills.png'),
('Carolina Panthers', '#0085CA', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-panthers.png'),
('Chicago Bears', '#0B162A', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-bears.png'),
('Cincinnati Bengals', '#FB4F14', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-bengals.png'),
('Cleveland Browns', '#311D00', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-browns.png'),
('Dallas Cowboys', '#003594', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-cowboys.png'),
('Denver Broncos', '#002244', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-broncos.png'),
('Detroit Lions', '#0076B6', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-lions.png'),
('Green Bay Packers', '#203731', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-packers.png'),
('Houston Texans', '#03202F', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-texans.png'),
('Indianapolis Colts', '#002C5F', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-colts.png'),
('Jacksonville Jaguars', '#006778', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-jaguars.png'),
('Kansas City Chiefs', '#E31837', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-chiefs.png'),
('Las Vegas Raiders', '#000000', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-raiders.png'),
('Los Angeles Chargers', '#0080C6', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-chargers.png'),
('Los Angeles Rams', '#003594', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-rams.png'),
('Miami Dolphins', '#008E97', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-dolphins.png'),
('Minnesota Vikings', '#4F2683', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-vikings.png'),
('New England Patriots', '#002244', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-patriots.png'),
('New Orleans Saints', '#D3BC8D', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-saints.png'),
('New York Giants', '#0B2265', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-giants.png'),
('New York Jets', '#125740', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-jets.png'),
('Philadelphia Eagles', '#004C54', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-eagles.png'),
('Pittsburgh Steelers', '#FFB612', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-steelers.png'),
('San Francisco 49ers', '#AA0000', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-49ers.png'),
('Seattle Seahawks', '#002244', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-seahawks.png'),
('Tampa Bay Buccaneers', '#D50A0A', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-buccaneers.png'),
('Tennessee Titans', '#4B92DB', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-titans.png'),
('Washington Commanders', '#5A1414', 'https://static.nfl.com/static/content/public/static/img/logos/nfl-commanders.png')
ON CONFLICT (name) DO NOTHING;

-- 3. Create new game table (unique NFL game per season)
CREATE TABLE IF NOT EXISTS football_pool.game_new (
    id SERIAL PRIMARY KEY,
    season_year INTEGER NOT NULL,
    week_number INTEGER NOT NULL,
    home_team_id INTEGER NOT NULL REFERENCES football_pool.nfl_team(id),
    away_team_id INTEGER NOT NULL REFERENCES football_pool.nfl_team(id),
    game_date DATE NOT NULL,
    state VARCHAR(32) NOT NULL,
    current_quarter INTEGER,
    time_remaining_in_quarter VARCHAR(16),
    scores_by_quarter JSONB,
    final_score_home INTEGER,
    final_score_away INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. Create pool_game table
CREATE TABLE IF NOT EXISTS football_pool.pool_game (
    id SERIAL PRIMARY KEY,
    pool_id INTEGER NOT NULL REFERENCES football_pool.pool(id),
    game_id INTEGER NOT NULL REFERENCES football_pool.game_new(id),
    row_numbers JSONB,
    column_numbers JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(pool_id, game_id)
);

-- 5. Migrate unique games to game_new using nfl_team references
INSERT INTO football_pool.game_new (
    season_year, week_number, home_team_id, away_team_id, game_date, state, current_quarter, time_remaining_in_quarter, scores_by_quarter, final_score_home, final_score_away, created_at, updated_at
)
SELECT DISTINCT
    p.season AS season_year,
    g.week_num AS week_number,
    n1.id AS home_team_id,
    n2.id AS away_team_id,
    g.game_dt::date AS game_date,
    'finished'::VARCHAR(32) AS state,
    NULL::INTEGER AS current_quarter,
    NULL::VARCHAR(16) AS time_remaining_in_quarter,
    jsonb_build_object(
        '1', jsonb_build_object('home', g.q1_primary_score, 'away', g.q1_opponent_score),
        '2', jsonb_build_object('home', g.q2_primary_score, 'away', g.q2_opponent_score),
        '3', jsonb_build_object('home', g.q3_primary_score, 'away', g.q3_opponent_score),
        '4', jsonb_build_object('home', g.q4_primary_score, 'away', g.q4_opponent_score)
    ) AS scores_by_quarter,
    g.q4_primary_score AS final_score_home,
    g.q4_opponent_score AS final_score_away,
    NOW(),
    NOW()
FROM football_pool.game g
JOIN football_pool.pool p ON g.pool_id = p.id
JOIN football_pool.nfl_team n1 ON n1.name = p.primary_team
JOIN football_pool.nfl_team n2 ON n2.name = g.opponent;

-- 6. Migrate pool-specific game data to pool_game
INSERT INTO football_pool.pool_game (
    pool_id, game_id, row_numbers, column_numbers, created_at, updated_at
)
SELECT
    g.pool_id,
    gn.id,
    g.row_numbers,
    g.col_numbers,
    NOW(),
    NOW()
FROM football_pool.game g
JOIN football_pool.pool p ON g.pool_id = p.id
JOIN football_pool.nfl_team n1 ON n1.name = p.primary_team
JOIN football_pool.nfl_team n2 ON n2.name = g.opponent
JOIN football_pool.game_new gn ON
    gn.season_year = p.season AND
    gn.week_number = g.week_num AND
    gn.home_team_id = n1.id AND
    gn.away_team_id = n2.id AND
    gn.game_date = g.game_dt;

-- 7. (Optional) Remove old columns or drop old game table after validation
-- ALTER TABLE football_pool.game DROP COLUMN ...
-- DROP TABLE football_pool.game;

COMMIT;
