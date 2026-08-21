# 📖 Complete Setup & Run Guide - All You Need to Know

## 🎯 Your Mission

Get the FundRaiser application running on your machine so you can:
- Create games (NFL + March Madness)
- Players join squares
- Track assignments
- Manage the pool

## 📂 Files You Created (Ready to Use)

| File | Purpose | When to Read |
|------|---------|--------------|
| **START_HERE.md** | Overview and summary | First - get oriented |
| **QUICKSTART.md** | Simple 3-step setup | Next - quick guide |
| **SETUP_VISUAL_GUIDE.txt** | Visual ASCII guide | For understanding flow |
| **SETUP_WINDOWS.md** | Detailed Windows steps | For step-by-step |
| **FUNDRAISER_README.md** | Complete API docs | After setup works |
| **FUNDRAISER_TESTING.md** | Test scenarios | To verify it works |
| **setup-fundraiser.bat** | Windows batch script | Optional automation |

## ⏱️ Timeline

```
Time        | Task
──────────────────────────────────────────────
0 min       | Start here
5 min       | Prerequisites installed?
10 min      | Setup: Install dependencies  
15 min      | Create database
20 min      | Configure environment
30 min      | ✅ Ready to launch!
35 min      | Start backend + frontend
40 min      | ✅ Application running!
```

## 🚀 Quick Start (TL;DR Version)

### Prerequisites
```
1. Install Node.js 16+ (nodejs.org)
2. Install PostgreSQL 12+ (postgresql.org)
```

### Setup (One Time)
```
1. Create database with SQL (SETUP_WINDOWS.md has the SQL)
2. Create backend\.env file (template provided)
3. Run: npm install (in backend and frontend)
```

### Run (Every Time)
```
Terminal 1: cd backend && npm run dev
Terminal 2: cd backend\frontend && npm run dev
Browser: http://localhost:5173
```

## 📝 Step-by-Step (Detailed)

### Step 1: Prerequisites (5 minutes)

**Install Node.js:**
- Go to https://nodejs.org/
- Download and install LTS version
- Verify: Run `node --version` in Command Prompt

**Install PostgreSQL:**
- Go to https://www.postgresql.org/download/windows/
- Download and install
- Note: Remember your password for user `postgres`
- Verify: Check Windows Services (PostgreSQL should be running)

### Step 2: Create Database (5 minutes)

**Open Command Prompt:**
```
psql -U postgres -h localhost
```

**Paste this SQL block** (or see SETUP_WINDOWS.md for the full script):
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

### Step 3: Environment File (2 minutes)

**Create file:** `backend\.env`

**Content:**
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

Replace `YOUR_PASSWORD` with your PostgreSQL password!

### Step 4: Install Dependencies (5 minutes)

**Open Command Prompt in project directory:**

```
cd backend
npm install
cd frontend
npm install
cd ..\..
```

### Step 5: Start Application (Every Time)

**Window 1 - Backend:**
```
cd backend
npm run dev
```

Wait for: `listening on port 3000`

**Window 2 - Frontend:**
```
cd backend\frontend
npm run dev
```

Wait for: `http://localhost:5173`

**Browser:**
```
Open: http://localhost:5173
```

## ✅ Verification Checklist

After starting the application, verify:

- [ ] Backend window shows "listening on port 3000"
- [ ] Frontend window shows "http://localhost:5173"
- [ ] Browser loads page without errors
- [ ] Page title is "Football Pool Fundraiser"
- [ ] You see games list (might be empty)
- [ ] You can click on a game
- [ ] Board appears with 100 squares
- [ ] You can click on a square and enter name
- [ ] Click "Join Pool" works

If all above are ✓, you're good to go!

## 🧪 Test Creating a Game

Once running, create a test game:

```bash
curl -X POST http://localhost:3000/api/admin/games/create ^
  -H "x-admin-key: dev-secret-key-change-in-production" ^
  -H "Content-Type: application/json" ^
  -d "{\"season\": 2024, \"gameType\": \"NFL\", \"opponent\": \"Kansas City Chiefs\", \"gameDate\": \"2024-09-08\", \"rowNumbers\": [0,1,2,3,4,5,6,7,8,9], \"colNumbers\": [0,1,2,3,4,5,6,7,8,9]}"
```

Or use the example in FUNDRAISER_README.md.

## 📁 Project Structure

```
Project Root/
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── fundraiser-games.ts      ← Public API
│   │   │   └── fundraiser-admin.ts      ← Admin API
│   │   └── fundraiser-app.ts
│   ├── frontend/
│   │   └── src/
│   │       ├── FundraiserApp.tsx
│   │       └── FundraiserApp.css
│   ├── .env                             ← Create this!
│   ├── package.json
│   └── package-lock.json
├── Documentation/
│   ├── START_HERE.md
│   ├── QUICKSTART.md
│   ├── SETUP_WINDOWS.md
│   ├── SETUP_VISUAL_GUIDE.txt
│   ├── FUNDRAISER_README.md
│   ├── FUNDRAISER_TESTING.md
│   ├── ... (more docs)
└── Scripts/
    └── setup-fundraiser.bat
```

## 🐛 Troubleshooting

### Problem: "PostgreSQL connection failed"
**Solution:** 
- Make sure PostgreSQL service is running
- Check password in backend\.env matches PostgreSQL password
- Verify database name is "football_pool"

### Problem: "Port 3000 already in use"
**Solution:**
- Stop other Node processes
- Or change PORT in backend\.env to 3001

### Problem: "npm: command not found"
**Solution:**
- Node.js not installed properly
- Restart Command Prompt after installing Node

### Problem: "npm install fails"
**Solution:**
- Delete node_modules and package-lock.json
- Run npm install again

See SETUP_WINDOWS.md for more detailed troubleshooting.

## 🎯 What's Running

| Component | Port | Purpose | Command |
|-----------|------|---------|---------|
| Backend API | 3000 | Serves API endpoints | npm run dev |
| Frontend UI | 5173 | React application | npm run dev |
| PostgreSQL | 5432 | Database | Service |

## 📖 After Setup Works

1. Read `FUNDRAISER_README.md` for complete API documentation
2. Follow test scenarios in `FUNDRAISER_TESTING.md`
3. Review architecture in `FUNDRAISER_IMPLEMENTATION_SUMMARY.md`
4. Check deployment guide `DEPLOYMENT_CHECKLIST.md`

## ✨ Success Indicators

You'll know everything is working when:
- ✅ Backend and frontend both start without errors
- ✅ Browser loads application at http://localhost:5173
- ✅ You can see "Games" section (might be empty)
- ✅ You can click on a game and see board
- ✅ You can join a square by clicking and entering name
- ✅ Square shows your name after joining

## 🎉 You're Done!

Once you see ✅ above, you have a working FundRaiser application!

Now you can:
- Create games via admin API
- Players join squares
- Update scores
- View statistics
- Manage the pool

## 📞 Need Help?

- **Setup issues** → Read SETUP_WINDOWS.md
- **API questions** → Read FUNDRAISER_README.md
- **Testing** → Follow FUNDRAISER_TESTING.md
- **Navigation** → Check FUNDRAISER_PROJECT_INDEX.md

---

**Total Setup Time: ~30 minutes (including downloads)**
**Application Ready: 100% ✅**

🏈 **Happy Fundraising!** 🎉
