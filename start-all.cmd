@echo off
REM Starts the 4 apps, each in its own window:
REM   Dealership Portal  http://localhost:3000   (dealer-portal)  - for dealers
REM   Platform Admin     http://localhost:3001   (admin)          - main admin, platform owners
REM   Dealer websites    http://<dealer-id>.localhost:3002 (frontend) - view only
REM   Backend API        http://localhost:4000   (backend)
cd /d "%~dp0"

if not exist backend\.env (
  echo backend\.env is missing - running the settings setup first...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-env.ps1"
  if not exist backend\.env (
    echo Setup did not create backend\.env. Stopping.
    pause
    exit /b 1
  )
)

if not exist dealer-portal\node_modules (
  echo Installing the Dealership Portal packages - first time only, takes a minute...
  pushd dealer-portal
  call npm install --no-fund --no-audit
  popd
)

echo Seeding the 5 website designs (safe to run again)...
pushd backend
call npm run db:seed
popd

start "Backend API :4000" cmd /k "cd /d %~dp0backend && npm run start:dev"
timeout /t 8 /nobreak >nul
start "Dealership Portal :3000" cmd /k "cd /d %~dp0dealer-portal && npm run dev"
start "Platform Admin :3001" cmd /k "cd /d %~dp0admin && npm run dev"
start "Websites :3002" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Started.
echo   Dealership Portal : http://localhost:3000
echo   Platform Admin    : http://localhost:3001
echo   Dealer websites   : http://^<dealer-id^>.localhost:3002
pause
