# 🚀 FundRaiser - Quick Start Instructions

## What You Need to Do

### 1. Prerequisites (One-Time Setup)

You need to have these installed on your system:

**✓ Node.js 16+ and npm**
- Download: https://nodejs.org/
- After install, verify: Open Command Prompt and run `node --version`

**✓ PostgreSQL 12+**
- Download: https://www.postgresql.org/download/windows/
- Install it (remember the password for user `postgres`)
- After install, PostgreSQL should be running as a service

### 2. Create Database

This is required only once to set up the database schema.

**Open Command Prompt and run:**

```
psql -U postgres -h localhost
```

When prompted for password, enter the PostgreSQL password you set.

**Then in the PostgreSQL prompt, copy-paste this entire SQL block:**

```sql
CREATE DATABASE football_pool;
\c football_pool
CREATE SCHEMA IF NOT EXISTS football_pool;
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
INSERT INTO football_pool.pool (season, name) VALUES (2024, '2024 Season') ON CONFLICT DO NOTHING;
INSERT INTO football_pool.team (team_name) VALUES ('My Team') ON CONFLICT DO NOTHING;
SELECT 'Database initialized successfully' as status;
\q
```

### 3. Create Environment File

In the `backend` folder, create a file named `.env` with this content:

```
APP_ENV=development
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/football_pool
FUNDRAISER_ADMIN_KEY=dev-secret-key-change-in-production
JWT_SECRET=dev-secret-key
JWT_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:5173
LOG_LEVEL=info
```

**Replace `YOUR_PASSWORD` with your PostgreSQL password!**

### 4. Install Dependencies

Open Command Prompt in the project directory and run:

```
cd backend
npm install
cd frontend
npm install
cd ..\..
```

### 5. Start the Application (Every Time You Want to Run It)

**Open TWO separate Command Prompt windows:**

**Window 1 - Backend Server:**
```
cd backend
npm run dev
```

Wait for message: `listening on port 3000`

**Window 2 - Frontend Application:**
```
cd backend\frontend
npm run dev
```

Wait for message showing `http://localhost:5173/`

### 6. Access the Application

Open your web browser and go to:
```
http://localhost:5173
```

You should see the FundRaiser Games page!

---

## 📁 Project Directory Structure

```
Football Pool.worktrees/copilot-worktree-2026-05-18T01-04-53/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── fundraiser-games.ts      ← Public API endpoints
│   │   │   └── fundraiser-admin.ts      ← Admin endpoints
│   │   └── fundraiser-app.ts
│   ├── frontend/
│   │   └── src/
│   │       ├── FundraiserApp.tsx        ← Main React component
│   │       └── FundraiserApp.css        ← Styling
│   ├── .env                             ← Create this file (see Step 3)
│   ├── package.json
│   └── package-lock.json
├── FUNDRAISER_README.md                 ← Complete documentation
├── FUNDRAISER_TESTING.md                ← Test scenarios
├── DEPLOYMENT_CHECKLIST.md              ← Deployment guide
├── SETUP_WINDOWS.md                     ← Windows setup (detailed)
└── ... (other docs)
```

---

## 🎯 What Each Component Does

**Backend (Port 3000)**
- Handles API requests
- Manages database
- Serves game data
- Processes player assignments

**Frontend (Port 5173)**
- React user interface
- Shows game list
- Display 10x10 board
- Allows players to join squares

**Database (PostgreSQL)**
- Stores games, squares, player data
- Persistent storage

---

## ✅ You'll Know It's Working When:

1. **Backend started:** Message says "listening on port 3000"
2. **Frontend started:** Message shows "http://localhost:5173"
3. **Browser loads:** Page shows "Football Pool Fundraiser" title
4. **API works:** You can see games in the list

---

## 🐛 Common Issues & Fixes

### "PostgreSQL connection failed"
- Make sure PostgreSQL is running (check Windows Services)
- Verify password in `.env` file
- Check database name is `football_pool`

### "Port 3000/5173 already in use"
- Another app is using that port
- Close other Node.js apps, or change PORT in `.env`

### "npm command not found"
- Node.js not installed correctly
- Restart Command Prompt after installing Node

### "npm install fails"
- Delete `node_modules` folder
- Delete `package-lock.json`
- Run `npm install` again

---

## 📚 Next Steps

After getting it running:

1. **Explore the API** - See `FUNDRAISER_README.md` for API docs
2. **Test the features** - Follow `FUNDRAISER_TESTING.md`
3. **Create test games** - Use the admin endpoints
4. **Review code** - Check out the implementation files
5. **Deploy** - Follow `DEPLOYMENT_CHECKLIST.md`

---

## 📖 Documentation Files

| File | Purpose |
|------|---------|
| `FUNDRAISER_README.md` | Complete setup & API documentation |
| `FUNDRAISER_TESTING.md` | Test scenarios and examples |
| `SETUP_WINDOWS.md` | Detailed Windows setup guide |
| `DEPLOYMENT_CHECKLIST.md` | Production deployment guide |
| `FUNDRAISER_PROJECT_INDEX.md` | Navigation guide for all docs |
| `FUNDRAISER_IMPLEMENTATION_SUMMARY.md` | Architecture overview |

---

## 🎉 You're Ready!

Follow the steps above and you'll have the FundRaiser application running in ~10 minutes.

**Questions?** Check the documentation files above.

**Happy Fundraising!** 🏈
