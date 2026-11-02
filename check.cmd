@echo off
REM Builds backend, admin and frontend and writes every message to build-log.txt
REM (Claude reads that file to find and fix the problems.)
setlocal
cd /d "%~dp0"
set "LOG=%~dp0build-log.txt"
set "OLD=%USERPROFILE%\Downloads\dealer-platform\dealer-platform"
if not exist backend\.env if exist "%OLD%\backend\.env" copy /y "%OLD%\backend\.env" backend\.env >nul
if not exist admin\.env.local if exist "%OLD%\admin\.env.local" copy /y "%OLD%\admin\.env.local" admin\.env.local >nul
if not exist frontend\.env.local if exist "%OLD%\frontend\.env.local" copy /y "%OLD%\frontend\.env.local" frontend\.env.local >nul
echo ===== CHECK STARTED %date% %time% > "%LOG%"
node -v >> "%LOG%" 2>&1
call npm -v >> "%LOG%" 2>&1

echo.
echo [1/3] Backend - installing and building (this can take a few minutes)...
echo. >> "%LOG%"
echo ===== BACKEND: npm install >> "%LOG%"
pushd backend
if not exist .env echo !!!!! backend\.env is MISSING >> "%LOG%"
call npm install --no-fund --no-audit >> "%LOG%" 2>&1
echo ===== BACKEND: prisma validate + generate >> "%LOG%"
call npx prisma validate >> "%LOG%" 2>&1
call npx prisma generate >> "%LOG%" 2>&1
echo ===== BACKEND: prisma migrate status >> "%LOG%"
call npx prisma migrate status >> "%LOG%" 2>&1
echo ===== BACKEND: typescript check >> "%LOG%"
call npx tsc --noEmit -p tsconfig.json >> "%LOG%" 2>&1
echo ===== BACKEND: exit code %errorlevel% >> "%LOG%"
echo ===== BACKEND: nest build >> "%LOG%"
call npx nest build >> "%LOG%" 2>&1
echo ===== BACKEND: build exit code %errorlevel% >> "%LOG%"
popd

echo [2/3] Admin - installing and building...
echo. >> "%LOG%"
echo ===== ADMIN: npm install >> "%LOG%"
pushd admin
if not exist .env.local echo !!!!! admin\.env.local is MISSING >> "%LOG%"
call npm install --no-fund --no-audit >> "%LOG%" 2>&1
echo ===== ADMIN: next build >> "%LOG%"
call npx next build >> "%LOG%" 2>&1
echo ===== ADMIN: build exit code %errorlevel% >> "%LOG%"
popd

echo [3/3] Frontend - installing and building...
echo. >> "%LOG%"
echo ===== FRONTEND: npm install >> "%LOG%"
pushd frontend
if not exist .env.local echo !!!!! frontend\.env.local is MISSING >> "%LOG%"
call npm install --no-fund --no-audit >> "%LOG%" 2>&1
echo ===== FRONTEND: next build >> "%LOG%"
call npx next build >> "%LOG%" 2>&1
echo ===== FRONTEND: build exit code %errorlevel% >> "%LOG%"
popd

echo. >> "%LOG%"
echo ===== CHECK FINISHED %date% %time% >> "%LOG%"
echo.
echo Done. Results are in build-log.txt - tell Claude "check done".
pause
