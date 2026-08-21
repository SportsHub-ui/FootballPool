# FundRaiser Setup Guide

## Quick Start

### 1. Environment Variables

Create a `.env` file in the `backend` directory with:

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/football_pool
APP_ENV=development

# Admin API Key (required for admin endpoints)
FUNDRAISER_ADMIN_KEY=your-secret-admin-key-here

# Optional
NODE_ENV=development
PORT=3000
```

### 2. Database Setup

Initialize the database with the simplified schema:

```sql
-- Create schema
CREATE SCHEMA IF NOT EXISTS football_pool;

-- Create team table
CREATE TABLE football_pool.team (
  id SERIAL PRIMARY KEY,
  team_name VARCHAR NOT NULL,
  logo_file VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create games table
CREATE TABLE football_pool.game (
  id SERIAL PRIMARY KEY,
  season INTEGER NOT NULL,
  game_type VARCHAR NOT NULL CHECK (game_type IN ('NFL', 'MADNESS')),
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

-- Create pool table
CREATE TABLE football_pool.pool (
  id SERIAL PRIMARY KEY,
  season INTEGER NOT NULL UNIQUE,
  name VARCHAR NOT NULL,
  square_cost INTEGER DEFAULT 10,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create squares table
CREATE TABLE football_pool.square (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES football_pool.game(id) ON DELETE CASCADE,
  square_num INTEGER NOT NULL CHECK (square_num BETWEEN 1 AND 100),
  player_name VARCHAR,
  row_digit INTEGER,
  col_digit INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_id, square_num)
);

-- Create board numbers table
CREATE TABLE football_pool.game_board_numbers (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES football_pool.game(id) ON DELETE CASCADE,
  row_numbers INTEGER[],
  col_numbers INTEGER[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_id)
);

-- Insert default team
INSERT INTO football_pool.team (team_name) VALUES ('My Team');
```

### 3. Running the Application

**Backend:**
```bash
cd backend
npm install
npm run dev
```

**Frontend:**
In a new terminal:
```bash
cd backend/frontend
npm install
npm run dev
```

Access the app at: http://localhost:5173

## API Documentation

### Public Endpoints (No Auth Required)

#### Get All Games
```
GET /api/games
```
Returns list of games for the current season.

**Response:**
```json
[
  {
    "id": 1,
    "season": 2024,
    "game_type": "NFL",
    "opponent": "Kansas City Chiefs",
    "game_dt": "2024-09-08",
    "is_complete": false,
    "q1_primary_score": null,
    ...
  }
]
```

#### Get Game Board
```
GET /api/games/:gameId/squares
```
Returns board state for a specific game.

**Response:**
```json
{
  "game": { /* game object */ },
  "squares": [
    {
      "id": 1,
      "square_num": 1,
      "player_name": "John Doe",
      "row_digit": 3,
      "col_digit": 7
    },
    ...
  ],
  "boardNumbers": {
    "row_numbers": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    "col_numbers": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
  }
}
```

#### Add Player to Square
```
POST /api/games/:gameId/add-player
Content-Type: application/json
```

**Request Body:**
```json
{
  "squareNum": 25,
  "playerName": "John Doe"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Player assigned to square"
}
```

#### Remove Player from Square
```
POST /api/games/:gameId/remove-player
Content-Type: application/json
```

**Request Body:**
```json
{
  "squareNum": 25
}
```

**Response:**
```json
{
  "success": true,
  "message": "Player removed from square"
}
```

### Admin Endpoints (Requires Admin Key)

All admin endpoints require the `x-admin-key` header:
```
x-admin-key: your-secret-admin-key-here
```

#### Create a Game
```
POST /api/admin/games/create
```

**Request Body:**
```json
{
  "season": 2024,
  "gameType": "NFL",
  "opponent": "Kansas City Chiefs",
  "gameDate": "2024-09-08",
  "rowNumbers": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  "colNumbers": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
}
```

**Response:**
```json
{
  "success": true,
  "gameId": 1,
  "message": "Game created with 100 squares"
}
```

#### Update Game Scores
```
POST /api/admin/games/:gameId/update-scores
```

**Request Body:**
```json
{
  "q1PrimaryScore": 7,
  "q1OpponentScore": 3,
  "q2PrimaryScore": 14,
  "q2OpponentScore": 10,
  "isComplete": false
}
```

#### Get Pool Statistics
```
GET /api/admin/pool/stats
```

**Response:**
```json
{
  "assigned_squares": 45,
  "total_squares": 100,
  "unique_players": 42,
  "total_games": 8
}
```

## Features

### Public Features
- ✓ View all scheduled games (NFL and March Madness)
- ✓ View board for each game with current assignments
- ✓ Join a square by entering your name
- ✓ See who is assigned to each square
- ✓ Remove yourself from a square

### Admin Features (Local Use)
- ✓ Create new games
- ✓ Update game scores
- ✓ View pool statistics

## Limitations (by Design)

- ✗ No user authentication (anyone can join)
- ✗ No duplicate number prevention (squares are first-come, first-served)
- ✗ No payment tracking (outside scope)
- ✗ No notifications (email/SMS)
- ✗ No marketing features
- ✗ Single team only (no multi-org support)

## Deployment Notes

### Vercel/Netlify
The frontend can be deployed to Vercel or Netlify by:
1. Building: `npm run build`
2. Deploying the `dist` folder
3. Setting up API proxy to point to backend

### Environment Variables for Production
- Set `APP_ENV=production`
- Use strong `FUNDRAISER_ADMIN_KEY` value
- Configure proper database credentials
- Set CORS origin appropriately

## Future Enhancements

- [ ] Add number assignment UI (show available row/column numbers)
- [ ] Persist player information (optional email for results)
- [ ] Winnings calculation and display
- [ ] PDF board export
- [ ] Mobile app
