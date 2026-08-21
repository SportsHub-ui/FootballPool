# FundRaiser Testing Guide

## Test Scenarios

### 1. Game List Display
**Steps:**
1. Navigate to home page
2. Verify NFL games section displays all NFL games
3. Verify March Madness section displays all madness games
4. Verify each game shows opponent name and date

**Expected:** Both game types display correctly with no errors

### 2. Board View
**Steps:**
1. Click on a game from the list
2. Verify board displays 100 squares in 10x10 grid
3. Verify already assigned squares show player names
4. Verify available squares are clickable
5. Verify board numbers are displayed (if configured)

**Expected:** Board displays correctly, available squares are interactive

### 3. Adding a Player
**Steps:**
1. From board view, click an available square
2. Enter a player name
3. Click "Join Pool" button
4. Verify square is now marked as assigned
5. Verify player name appears on the square
6. Refresh page and verify change persists

**Expected:** Player successfully added, persists after refresh

### 4. Multiple Players Same Square
**Steps:**
1. Try to add a second player to an already assigned square
2. Verify error message "Square already assigned" appears

**Expected:** Cannot assign duplicate, shows appropriate error

### 5. Empty Player Name
**Steps:**
1. Click an available square
2. Try to submit without entering a name
3. Verify submit button is disabled

**Expected:** Form validation prevents empty submission

### 6. Navigation
**Steps:**
1. From board view, click "Games" tab
2. Verify returns to games list
3. Click another game
4. Verify new board loads correctly

**Expected:** Navigation works smoothly between views

### 7. Admin Endpoints

#### Create Game
```bash
curl -X POST http://localhost:3000/api/admin/games/create \
  -H "x-admin-key: your-secret-admin-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "season": 2024,
    "gameType": "NFL",
    "opponent": "Kansas City Chiefs",
    "gameDate": "2024-09-08",
    "rowNumbers": [0,1,2,3,4,5,6,7,8,9],
    "colNumbers": [0,1,2,3,4,5,6,7,8,9]
  }'
```

**Expected:** Response includes gameId and success message

#### Get Game Squares
```bash
curl http://localhost:3000/api/games/1/squares
```

**Expected:** Returns game data, 100 squares, and board numbers

#### Add Player (Public)
```bash
curl -X POST http://localhost:3000/api/games/1/add-player \
  -H "Content-Type: application/json" \
  -d '{
    "squareNum": 25,
    "playerName": "John Doe"
  }'
```

**Expected:** Success response, square now assigned

#### Get Statistics
```bash
curl -X GET http://localhost:3000/api/admin/pool/stats \
  -H "x-admin-key: your-secret-admin-key-here"
```

**Expected:** Returns stats with assigned/total squares and player counts

### 8. Error Handling

#### Invalid Game ID
```bash
curl http://localhost:3000/api/games/99999/squares
```

**Expected:** 404 error response

#### Invalid Admin Key
```bash
curl -X POST http://localhost:3000/api/admin/games/create \
  -H "x-admin-key: wrong-key" \
  -H "Content-Type: application/json" \
  -d '{"season": 2024, "gameType": "NFL", "opponent": "Test", "gameDate": "2024-09-08"}'
```

**Expected:** 401 Unauthorized response

#### Missing Required Fields
```bash
curl -X POST http://localhost:3000/api/admin/games/create \
  -H "x-admin-key: your-secret-admin-key-here" \
  -H "Content-Type: application/json" \
  -d '{"season": 2024}'
```

**Expected:** 400 Bad Request with validation errors

## Automated Testing

### Unit Tests
```bash
cd backend
npm test
```

### Integration Tests
Create test data first:
```bash
# Reset test database
npm run db:clean:test

# Run with test database
npm run test:run
```

## Performance Testing

### Load Test with Siege
```bash
# Install siege: brew install siege (macOS) or apt-get install siege (Linux)

# Test list games endpoint
siege -c 10 -r 100 http://localhost:3000/api/games

# Test board view
siege -c 20 -r 50 http://localhost:3000/api/games/1/squares
```

**Acceptance Criteria:**
- Response time < 200ms for 95% of requests
- No errors under normal load

## Browser Compatibility

- ✓ Chrome/Edge (latest 2 versions)
- ✓ Firefox (latest 2 versions)
- ✓ Safari (latest 2 versions)
- ✓ Mobile browsers (iOS Safari, Chrome Android)

## Accessibility Testing

1. Test keyboard navigation (Tab through elements)
2. Test screen reader (NVDA, JAWS, VoiceOver)
3. Verify color contrast ratios (WCAG AA minimum 4.5:1)
4. Test with zoom levels (100%, 150%, 200%)

## Test Data

### Sample SQL to Create Test Data
```sql
-- Clear existing data
TRUNCATE TABLE football_pool.square CASCADE;
TRUNCATE TABLE football_pool.game_board_numbers CASCADE;
TRUNCATE TABLE football_pool.game CASCADE;
TRUNCATE TABLE football_pool.pool CASCADE;

-- Create test pool
INSERT INTO football_pool.pool (season, name) VALUES (2024, '2024 Season');

-- Create test games
INSERT INTO football_pool.game (season, game_type, opponent, game_dt, is_complete) VALUES
  (2024, 'NFL', 'Kansas City Chiefs', '2024-09-08', false),
  (2024, 'NFL', 'Las Vegas Raiders', '2024-09-15', false),
  (2024, 'MADNESS', 'Elite Eight - East Region', '2025-03-25', false);

-- Create squares for first game (with some assigned)
INSERT INTO football_pool.square (game_id, square_num, player_name) 
SELECT 1, n, CASE WHEN n <= 5 THEN 'Player ' || n ELSE NULL END
FROM generate_series(1, 100) n;

-- Create board numbers
INSERT INTO football_pool.game_board_numbers (game_id, row_numbers, col_numbers)
VALUES (1, '{0,1,2,3,4,5,6,7,8,9}', '{0,1,2,3,4,5,6,7,8,9}');
```

## Known Limitations

1. No duplicate checking across squares (first name to claim wins)
2. No player name uniqueness enforcement
3. No data backup mechanism (admin responsibility)
4. Admin operations visible to anyone with API access

## Success Criteria

All tests pass when:
- ✓ Games display correctly
- ✓ Board shows all 100 squares
- ✓ Players can successfully join squares
- ✓ Square assignments persist
- ✓ Admin endpoints work with proper auth
- ✓ Error cases handled gracefully
- ✓ Performance acceptable (<200ms response times)
