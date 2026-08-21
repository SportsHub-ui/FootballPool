# FundRaiser Setup Guide - Windows

## Prerequisites

Before starting, ensure you have:

1. **Node.js 16+** - Download from https://nodejs.org/
   - Verify: Open Command Prompt and run: `node --version`

2. **PostgreSQL 12+** - Download from https://www.postgresql.org/download/windows/
   - Install with default settings
   - Remember the password you set for the `postgres` user
   - Verify: PostgreSQL should be running as a service

3. **Git** - Download from https://git-scm.com/download/win
   - (Optional, but recommended)

## Setup Steps

### Step 1: Navigate to Project Directory

Open Command Prompt and navigate to the project:
```cmd
cd C:\Users\jeffp\Documents\GitHub\FootballPool.worktrees\copilot-worktree-2026-05-18T01-04-53
```

### Step 2: Create PostgreSQL Database

Open PostgreSQL Command Line (`psql`):

```cmd
psql -U postgres -h localhost
```

When prompted, enter the PostgreSQL password you set during installation.

In the PostgreSQL prompt, run these commands:

```sql
-- Create database
CREATE DATABASE football_pool;

-- Connect to the database
\c football_pool

-- Create schema
CREATE SCHEMA IF NOT EXISTS football_pool;

-- Create tables
CREATE TABLE IF NOT EXISTS football_pool.team (
  id SERIAL PRIMARY KEY,
  team_name VARCHAR NOT NULL,
  logo_file VARCHAR,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS football_pool.game (
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

CREATE TABLE IF NOT EXISTS football_pool.pool (
  id SERIAL PRIMARY KEY,
  season INTEGER NOT NULL UNIQUE,
  name VARCHAR NOT NULL,
  square_cost INTEGER DEFAULT 10,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS football_pool.square (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES football_pool.game(id) ON DELETE CASCADE,
  square_num INTEGER NOT NULL CHECK (square_num BETWEEN 1 AND 100),
  player_name VARCHAR,
  row_digit INTEGER,
  col_digit INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_id, square_num)
);

CREATE TABLE IF NOT EXISTS football_pool.game_board_numbers (
  id SERIAL PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES football_pool.game(id) ON DELETE CASCADE,
  row_numbers INTEGER[],
  col_numbers INTEGER[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(game_id)
);

-- Add initial data
INSERT INTO football_pool.pool (season, name) VALUES (2024, '2024 Season') ON CONFLICT DO NOTHING;
INSERT INTO football_pool.team (team_name) VALUES ('My Team') ON CONFLICT DO NOTHING;

-- Verify
SELECT 'Database initialized successfully' as status;
\q
```

### Step 3: Create Environment Configuration

In your project directory, create `backend\.env` with these contents:

```
APP_ENV=development
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:PASSWORD@localhost:5432/football_pool
FUNDRAISER_ADMIN_KEY=dev-secret-key-change-in-production
JWT_SECRET=dev-secret-key
JWT_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:5173
LOG_LEVEL=info
```

**Replace `PASSWORD` with your PostgreSQL password!**

### Step 4: Install Dependencies

In Command Prompt, in the project directory:

**Install Backend Dependencies:**
```cmd
cd backend
npm install
cd ..
```

**Install Frontend Dependencies:**
```cmd
cd backend\frontend
npm install
cd ..\..
```

### Step 5: Start the Application

Open **two separate Command Prompt windows**.

**Window 1 - Backend:**
```cmd
cd C:\Users\jeffp\Documents\GitHub\FootballPool.worktrees\copilot-worktree-2026-05-18T01-04-53\backend
npm run dev
```

You should see output like:
```
[nodemon] starting `tsx watch src/server.ts`
listening on port 3000
```

**Window 2 - Frontend:**
```cmd
cd C:\Users\jeffp\Documents\GitHub\FootballPool.worktrees\copilot-worktree-2026-05-18T01-04-53\backend\frontend
npm run dev
```

You should see output like:
```
  VITE v5.0.0  ready in 234 ms

  ➜  Local:   http://localhost:5173/
```

### Step 6: Access the Application

Open your web browser and navigate to:
```
http://localhost:5173
```

You should see the FundRaiser Games List page.

## Troubleshooting

### PostgreSQL Connection Failed
- Make sure PostgreSQL service is running (check Services on Windows)
- Verify DATABASE_URL in `backend\.env` has correct password
- Check that database name is `football_pool`

### Port Already in Use
- If port 3000 or 5173 is already in use, stop the other processes
- Or change PORT in `backend\.env`

### npm install Failed
- Delete `node_modules` folder and `package-lock.json`
- Run `npm install` again

### Database Tables Not Created
- Make sure you ran all the CREATE TABLE commands
- Check that you're connected to `football_pool` database (`\c football_pool`)

## Testing the API

Once the application is running, you can test the API:

**List Games:**
```cmd
curl http://localhost:3000/api/games
```

**Create a Game (Admin):**
```cmd
curl -X POST http://localhost:3000/api/admin/games/create ^
  -H "x-admin-key: dev-secret-key-change-in-production" ^
  -H "Content-Type: application/json" ^
  -d "{\"season\": 2024, \"gameType\": \"NFL\", \"opponent\": \"Kansas City Chiefs\", \"gameDate\": \"2024-09-08\", \"rowNumbers\": [0,1,2,3,4,5,6,7,8,9], \"colNumbers\": [0,1,2,3,4,5,6,7,8,9]}"
```

## Next Steps

1. Read `FUNDRAISER_README.md` for complete documentation
2. Follow test scenarios in `FUNDRAISER_TESTING.md`
3. Review deployment options in `DEPLOYMENT_CHECKLIST.md`

## Support

Check the documentation files:
- `FUNDRAISER_PROJECT_INDEX.md` - Complete navigation guide
- `FUNDRAISER_IMPLEMENTATION_SUMMARY.md` - Architecture overview
- `FUNDRAISER_TESTING.md` - Test scenarios

---

**Happy Fundraising!** 🏈🎉
