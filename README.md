# FootballPool
A complete system for managing season-long football pools with real-time square assignment, score tracking, and winnings calculation.

## Features Implemented

### ✅ Backend API (TypeScript + Express)
- Health checks and database diagnostics
- User, team, player, and pool management
- 100-square pool initialization with conflict detection
- Game creation and quarter score tracking
- Automatic winner calculation based on last-digit matching
- Winnings ledger generation and tracking
- Automated score ingestion (mock and ESPN sources)
- Adaptive daily score scheduler with 6:00 AM CT wake-up and faster live-game polling
- Ingestion run history logging and review endpoint
- Server-sent event (SSE) stream for live board refreshes
- Unique pool display links for read-only Squares board viewing
- JWT authentication with fallback mock auth for development
- Request/response logging with assignment-specific debug logs

### ✅ Frontend Dashboard (React + TypeScript + Vite)
- **Organizer View**: Complete setup interface with forms and 100-square grid
  - Create users, teams, players, and pools
  - Initialize and manage square assignments
  - Post game scores (Q1-Q4) with automatic winner calculation
  - View pool diagnostics and winnings ledger

- **Participant View**: Read-only interface with authentication
  - Login with email
  - View assigned squares across pools
  - Track winnings and payout status
  - View game scores and results

### ✅ Testing
- Comprehensive API test suite with supertest + vitest
- Tests for all major endpoints (users, teams, pools, squares, games, winnings)
- Authorization and validation testing
- Square assignment conflict detection tests

### ✅ Database Integration
- PostgreSQL with existing football_pool schema
- Transactional operations with explicit locking for safety
- Automatic ID generation for concurrent operations
- Proper foreign key relationships

## Quick Start

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Running football_pool database

### Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Configure environment
# Create .env with DATABASE_URL, JWT_SECRET, PORT, APP_ENV
cp .env.example .env

# Build
npm run build

# Start API server
npm run dev
```

Backend runs on `http://localhost:3000`

### Frontend Setup

```bash
cd backend/frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Frontend runs on `http://localhost:5173`

### Production Deployment Notes

If the site loads in production but shows no data, the frontend is usually pointing at the wrong API URL.

- **Same host / reverse proxy deployment:** leave `VITE_API_BASE_URL` blank so the app uses relative `/api/...` calls.
- **Separate frontend + backend deployments:** set `VITE_API_BASE_URL=https://<your-backend-host>` when building the frontend.
- For Render backend deployments, also set `DATABASE_URL`, `JWT_SECRET`, and `APP_ENV=production`, then run the SQL migrations before opening the site.

### Run Tests

```bash
cd backend

# Run tests in watch mode
npm test

# Run tests once
npm run test:run

# Run tests with UI
npm run test:ui
```

## API Endpoints

### Health & Diagnostics
- `GET /api/health` - Service status with database time
- `GET /api/db/smoke` - Table row counts
- `GET /api/db/preview` - Pool summaries with statistics
- `GET /api/db/api-usage?hours=24&limit=15` - Organizer dashboard for recent API usage, top routes, hourly traffic, and external API counts

### Authentication
- `POST /api/auth/login` - JWT token generation (email-based)
- `GET /api/auth/verify` - Verify current token validity

### Organizer Setup (requires x-user-role: organizer)
- `POST /api/setup/users` - Create user
- `POST /api/setup/teams` - Create team
- `POST /api/setup/players` - Create player
- `POST /api/setup/pools` - Create pool with payout configuration
- `POST /api/setup/pools/:poolId/squares/init` - Initialize 100 squares
- `GET /api/setup/users` - List users
- `GET /api/setup/pools/:poolId/players` - List players
- `GET /api/setup/pools/:poolId/squares` - List squares
- `PATCH /api/setup/pools/:poolId/squares/:squareNum` - Assign/reassign square

### Simulation Controls
- `GET /api/setup/pools/:poolId/simulation` - Get simulation readiness and active mode
- `POST /api/setup/pools/:poolId/simulation` - Start a simulation (`full_year`, `by_game`, or `by_quarter`)
- `POST /api/setup/pools/:poolId/simulation/advance` - Complete the next game or quarter for step-by-step simulations
- `DELETE /api/setup/pools/:poolId/simulation` - Remove simulated games, winnings, and square assignments

### Games & Scoring
- `POST /api/games` - Create game
- `GET /api/games?poolId=X` - List games for pool
- `GET /api/games/:gameId` - Get game details
- `PATCH /api/games/:gameId/scores` - Update Q1-Q4 scores (triggers winner calculation)

### Score Ingestion
- `GET /api/ingestion/events` - SSE stream for live score-update notifications used by the frontend boards
- `POST /api/ingestion/games/:gameId/scores` - Ingest scores for one game (source: mock/payload/espn, organizer)
- `POST /api/ingestion/run` - Run ingestion for eligible games (organizer)
- `GET /api/ingestion/history` - Fetch last 25 ingestion runs (organizer)

### Winnings Management
- `GET /api/winnings/pool/:poolId` - All winnings for pool (organizer)
- `GET /api/winnings/game/:gameId` - Winnings for specific game (organizer)
- `GET /api/winnings/user/:userId` - User's winnings across pools
- `PATCH /api/winnings/:winningId/payout` - Mark winning as paid (organizer)

### Participant Access
- `GET /api/participant/pools` - Pools user is in
- `GET /api/participant/pools/:poolId/squares` - User's squares
- `GET /api/participant/pools/:poolId/games` - Games for pool
- `GET /api/participant/pools/:poolId/board` - Public pool square board with win heat data
- `GET /api/participant/winnings` - User's winnings summary

### Display Links
- Every pool gets an automatically generated `display_token`.
- Open the app with `?display=<display_token>` to launch directly into the Squares page for that pool in display-only mode.
- The display view hides menus, sign-in, and pool/game selectors and opens on the last completed game for the linked pool.
- `GET /api/landing/display/:displayToken` - Resolve a public read-only board payload for the linked pool

## Authentication

### Development Mode
Use request headers for testing:
- `x-user-id`: User ID
- `x-user-role`: `organizer`, `participant`, or `player`

### Production Mode
Use JWT tokens:
1. Call `POST /api/auth/login` with email/password
2. Receive JWT token in response
3. Include in requests: `Authorization: Bearer <token>`

## Architecture

### Backend Structure
```
backend/
├── src/
│   ├── app.ts - Express app setup
│   ├── server.ts - Server entry point
│   ├── config/ - Configuration (env, db, jwt)
│   ├── middleware/ - Authentication & logging
│   ├── routes/ - API endpoints
│   │   ├── auth.ts
│   │   ├── setup.ts
│   │   ├── games.ts
│   │   ├── winnings.ts
│   │   ├── participant.ts
│   │   └── ...
│   ├── types/ - TypeScript interfaces
│   └── api.test.ts - Integration tests
├── migrations/ - SQL migration scripts
└── package.json
```

### Frontend Structure
```
backend/frontend/
├── src/
│   ├── main.tsx - Entry point with role router
│   ├── App.tsx - Organizer dashboard
│   ├── ParticipantView.tsx - Participant interface
│   ├── App.css - Styling
│   └── ...
└── package.json
```

## Key Features Explained

### Square Assignment
- 100 squares per pool (rows 0-9, columns 0-9)
- Automatic conflict detection (prevents double assignment)
- Reassignment support with explicit flag
- Last-digit matching for winner calculation

### Winner Calculation
Score: 24-28
- Last digit of score: 4
- Last digit of opponent: 8
- Winning square: Row 8, Column 4 (square #85)
- Q1-Q4 payouts defined per pool

### Logging
- All HTTP requests logged: `[timestamp] METHOD PATH -> STATUS (Xms)`
- Square assignments logged: `[square-assignment] request/saved` with payloads
- Ingestion scheduler and run outcomes logged: `[score-ingest] ...`
- View logs in backend terminal during development

### Ingestion Configuration
Optional backend `.env` settings:
- `SCORE_INGEST_ENABLED=false` - Starts the automatic scheduler on boot when `true`
- `SCORE_INGEST_SOURCE=mock` - `mock`, `payload`, or `espn`
- `SCORE_INGEST_DAILY_START_HOUR_CT=6` - Daily wake-up hour in Central Time
- `SCORE_INGEST_INTERVAL_MINUTES=30` - Low-frequency polling cadence before games go live
- `SCORE_INGEST_ACTIVE_INTERVAL_SECONDS=60` - Faster cadence while games are close to kickoff or live
- `SCORE_INGEST_REQUEST_TIMEOUT_MS=8000` - Timeout per ESPN request
- `SCORE_INGEST_PRIMARY_TEAM=` - Optional team hint used for ESPN game matching
- `SIMULATION_ENABLED=true` - Enables organizer simulation tools on the backend
- `VITE_ENABLE_SIMULATION_CONTROLS=true` - Shows simulation controls in the frontend
- `EMAIL_NOTIFICATIONS_ENABLED=true` - Turns notification delivery on/off globally
- `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` - SMTP settings used for winner and live-leader emails; if `SMTP_HOST` is blank, the app logs the email payload instead

### Live Score Update Process
The live score flow is designed to scale across many pools while keeping ESPN/API usage low.

1. **Daily wake-up at 6:00 AM CT**
   - The scheduler starts each day at `SCORE_INGEST_DAILY_START_HOUR_CT`.
   - If no pool-linked games are scheduled for that day, it goes back to sleep until the next morning.

2. **Only today’s games are monitored**
   - The scheduler looks at the shared game schedule for the current day rather than polling every pool separately.
   - This keeps work proportional to actual NFL activity.

3. **Adaptive polling**
   - Before kickoff, polling stays relatively slow (`SCORE_INGEST_INTERVAL_MINUTES`).
   - Once a game is near kickoff or in progress, polling increases to the faster live interval (`SCORE_INGEST_ACTIVE_INTERVAL_SECONDS`).
   - After the last game completes, the scheduler sleeps until the next day.

4. **Shared central game updates**
   - Scores are applied to the shared game record that all pools reference.
   - Winner and payout processing only re-runs when the score/state actually changed, which reduces unnecessary database work.

5. **Push-style frontend refreshes via SSE**
   - The backend publishes `game-updated` and scheduler status events on `GET /api/ingestion/events`.
   - Open organizer, display-only, and participant boards listen to that stream and automatically refresh when their selected game changes.

This approach avoids constant browser polling, reduces repeated ESPN requests, and scales better as more pools are added.

### Simulation Modes
Use **Pool Maintenance** to start the simulation, then use the **Score Ingestion** page to advance it when applicable.

- **Full Year**
  - Current one-click behavior.
  - Assigns all 100 squares, randomizes row/column numbers for every game, and fills the season with simulated scores immediately.

- **By Game**
  - Assigns squares and prepares only the first game initially.
  - Use **Complete Game** to fetch ESPN scores when available; if ESPN is unavailable, the app automatically uses a mock score and notifies you.
  - After the game completes, the next game is automatically prepared.

- **By Quarter**
  - Assigns squares and prepares only the first game initially.
  - Use **Complete Quarter** to fetch the next posted ESPN quarter when available; if not, the app automatically uses a mock quarter score and notifies you.
  - After quarter 4 is completed, the app automatically advances to the next game.

This is mainly intended for demo and testing flows so the board can be watched as a season progresses gradually instead of completing all at once.

## Development Notes

- TypeScript in strict mode throughout
- Zod for request validation
- pg for PostgreSQL connections with pooling
- React hooks for state management
- Responsive CSS Grid layouts
- No external UI component library (custom CSS)

## Future Enhancements

- Role-based access control (RBAC) with user roles in database
- Password hashing with bcrypt
- Email notifications for winners
- File-based persistent logging
- Admin management panel
- Automated payout calculations
- Mobile app support

- Full auth, scoring automation, notifications, and role-specific UI are planned next.
