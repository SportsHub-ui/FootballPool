#!/bin/bash
# FundRaiser Quick Start Script

echo "=================================="
echo "FundRaiser Application Setup"
echo "=================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check prerequisites
echo -e "${BLUE}Step 1: Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${YELLOW}Node.js not found. Please install Node.js 16+${NC}"
    exit 1
fi

if ! command -v psql &> /dev/null; then
    echo -e "${YELLOW}PostgreSQL client not found. Please install PostgreSQL${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js and PostgreSQL found${NC}"
echo ""

# Step 2: Setup database
echo -e "${BLUE}Step 2: Database setup...${NC}"
read -p "PostgreSQL connection string (default: postgresql://postgres@localhost:5432/football_pool): " DB_URL
DB_URL=${DB_URL:-postgresql://postgres@localhost:5432/football_pool}

echo -e "${YELLOW}Creating database schema...${NC}"
psql "$DB_URL" << EOF
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
EOF

echo -e "${GREEN}✓ Database setup complete${NC}"
echo ""

# Step 3: Setup environment variables
echo -e "${BLUE}Step 3: Environment setup...${NC}"
read -p "Enter admin API key (leave empty to generate): " ADMIN_KEY
if [ -z "$ADMIN_KEY" ]; then
    ADMIN_KEY=$(openssl rand -hex 32)
    echo -e "${YELLOW}Generated admin key: $ADMIN_KEY${NC}"
fi

cat > backend/.env << EOF
APP_ENV=development
NODE_ENV=development
PORT=3000
DATABASE_URL=$DB_URL
FUNDRAISER_ADMIN_KEY=$ADMIN_KEY
JWT_SECRET=dev-secret-key
JWT_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:5173
LOG_LEVEL=info
EOF

echo -e "${GREEN}✓ Environment file created${NC}"
echo ""

# Step 4: Install dependencies
echo -e "${BLUE}Step 4: Installing dependencies...${NC}"

echo "Installing backend dependencies..."
cd backend
npm install --quiet
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}Backend npm install failed${NC}"
    exit 1
fi

echo "Installing frontend dependencies..."
cd frontend
npm install --quiet
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}Frontend npm install failed${NC}"
    exit 1
fi

cd ../..
echo -e "${GREEN}✓ Dependencies installed${NC}"
echo ""

# Step 5: Summary
echo -e "${GREEN}=================================="
echo "Setup Complete!"
echo "==================================${NC}"
echo ""
echo -e "${BLUE}To start the application:${NC}"
echo ""
echo "Terminal 1 - Backend:"
echo "  cd backend"
echo "  npm run dev"
echo ""
echo "Terminal 2 - Frontend:"
echo "  cd backend/frontend"
echo "  npm run dev"
echo ""
echo -e "${BLUE}Then open: http://localhost:5173${NC}"
echo ""
echo -e "${BLUE}Admin API Key: $ADMIN_KEY${NC}"
echo -e "${YELLOW}Save this key! You'll need it for admin endpoints${NC}"
echo ""
echo -e "${BLUE}Example: Create a game${NC}"
echo "  curl -X POST http://localhost:3000/api/admin/games/create \\"
echo "    -H 'x-admin-key: $ADMIN_KEY' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{"
echo "      \"season\": 2024,"
echo "      \"gameType\": \"NFL\","
echo "      \"opponent\": \"Kansas City Chiefs\","
echo "      \"gameDate\": \"2024-09-08\","
echo "      \"rowNumbers\": [0,1,2,3,4,5,6,7,8,9],"
echo "      \"colNumbers\": [0,1,2,3,4,5,6,7,8,9]"
echo "    }'"
echo ""
echo -e "${BLUE}Documentation:${NC}"
echo "  - FUNDRAISER_README.md - Setup and API docs"
echo "  - FUNDRAISER_TESTING.md - Testing guide"
echo "  - FUNDRAISER_IMPLEMENTATION_SUMMARY.md - Overview"
echo ""
