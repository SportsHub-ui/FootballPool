# FundRaiser Refactoring - Database Migration

## Simplified Schema

This document outlines the simplified database schema for the FundRaiser application.

### Removed Tables
- `organization` - Not needed, single team only
- `users` - Simplified to minimal player info  
- `player_team` - Redundant
- `winnings_ledger` - Keep simple in pool table
- `notifications` - Remove notification system

### New Simplified Schema

```sql
-- Single team configuration (no need to query)
CREATE TABLE IF NOT EXISTS football_pool.team (
  id INTEGER PRIMARY KEY,
  team_name VARCHAR NOT NULL,
  logo_file VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Games for a season (NFL + March Madness)
CREATE TABLE IF NOT EXISTS football_pool.game (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL,
  game_type VARCHAR NOT NULL, -- 'NFL' or 'MADNESS'
  opponent VARCHAR NOT NULL,
  game_dt DATE NOT NULL,
  is_complete BOOLEAN DEFAULT FALSE,
  q1_primary_score INTEGER,
  q2_primary_score INTEGER,
  q3_primary_score INTEGER,
  q4_primary_score INTEGER,
  q1_opponent_score INTEGER,
  q2_opponent_score INTEGER,
  q3_opponent_score INTEGER,
  q4_opponent_score INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pool for a single season
CREATE TABLE IF NOT EXISTS football_pool.pool (
  id INTEGER PRIMARY KEY,
  season INTEGER NOT NULL UNIQUE,
  name VARCHAR NOT NULL,
  square_cost INTEGER DEFAULT 10,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Squares for each game
CREATE TABLE IF NOT EXISTS football_pool.square (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES football_pool.game(id),
  square_num INTEGER NOT NULL,
  player_name VARCHAR,
  row_digit INTEGER,
  col_digit INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_id, square_num)
);

-- Board numbers for games
CREATE TABLE IF NOT EXISTS football_pool.game_board_numbers (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES football_pool.game(id),
  row_numbers INTEGER[] NOT NULL,
  col_numbers INTEGER[] NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_id)
);
```

## Migrations

### Phase 1: Add new tables (backwards compatible)
- Create new simplified tables alongside existing ones
- Populate with current data

### Phase 2: Remove old tables
- Drop: organization, users, player_team, winnings_ledger
- Keep: game, pool, square (with refactored structure)

### Phase 3: Remove auth tables
- Drop auth-related tables

## API Changes

### Endpoints to Keep (Simplified)
- `GET /api/games` - List all games for current season
- `POST /api/games/add-player` - Add player name to square
- `POST /api/games/remove-player` - Remove player from square
- `GET /api/pool/squares/:gameId` - Get board state for game

### Endpoints to Remove
- All `/api/auth/*`
- All `/api/organizations/*`
- All `/api/admin/*`
- All marketing endpoints
- All simulation endpoints

## Frontend Changes

### New Pages
1. **Join Page** - Simple form to add player name to available square
2. **Board View** - Display current game squares with player assignments
3. **Admin Dashboard** (optional, local only) - Setup games, view results

### Components to Remove
- Login/Auth components
- Organization management
- User management
- Marketing dashboard
- Metrics dashboard
- Notification templates
