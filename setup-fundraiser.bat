@echo off
REM FundRaiser Quick Start Script for Windows
REM This is a batch file version of the setup script

echo.
echo ==================================
echo FundRaiser Application Setup
echo ==================================
echo.

REM Step 1: Check prerequisites
echo Step 1: Checking prerequisites...
echo.

REM Check if node is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js not found. Please install Node.js 16+
    echo Download from: https://nodejs.org/
    exit /b 1
)

echo ✓ Node.js found
node --version
echo.

REM Check if npm is installed
where npm >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm not found
    exit /b 1
)

echo ✓ npm found
npm --version
echo.

REM Step 2: Environment setup
echo Step 2: Setting up environment...
echo.

REM Create .env file with defaults
(
    echo APP_ENV=development
    echo NODE_ENV=development
    echo PORT=3000
    echo DATABASE_URL=postgresql://postgres@localhost:5432/football_pool
    echo FUNDRAISER_ADMIN_KEY=dev-secret-key-change-in-production
    echo JWT_SECRET=dev-secret-key
    echo JWT_EXPIRES_IN=7d
    echo FRONTEND_URL=http://localhost:5173
    echo LOG_LEVEL=info
) > backend\.env

echo ✓ Environment file created at: backend\.env
echo.

REM Step 3: Install dependencies
echo Step 3: Installing dependencies...
echo.

echo Installing backend dependencies...
cd backend
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Backend npm install failed
    cd ..
    exit /b 1
)

echo ✓ Backend dependencies installed
echo.

echo Installing frontend dependencies...
cd frontend
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Frontend npm install failed
    cd ..\..
    exit /b 1
)

echo ✓ Frontend dependencies installed
echo.

cd ..\..

REM Step 4: Summary
echo ==================================
echo Setup Complete!
echo ==================================
echo.

echo To start the application, open TWO separate terminal windows:
echo.

echo Terminal 1 - Backend:
echo   cd backend
echo   npm run dev
echo.

echo Terminal 2 - Frontend:
echo   cd backend\frontend
echo   npm run dev
echo.

echo Then open your browser to: http://localhost:5173
echo.

echo IMPORTANT: Before running, make sure PostgreSQL is running and you have:
echo   1. PostgreSQL installed and running
echo   2. A database named 'football_pool' created
echo   3. Updated DATABASE_URL in backend\.env if needed
echo.

echo Run the database setup SQL from: FUNDRAISER_README.md
echo Admin API Key: dev-secret-key-change-in-production
echo.

echo Documentation:
echo   - FUNDRAISER_README.md - Setup and API docs
echo   - FUNDRAISER_TESTING.md - Testing guide
echo   - FUNDRAISER_PROJECT_INDEX.md - Complete navigation
echo.

pause
