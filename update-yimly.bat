@echo off
setlocal EnableExtensions

cd /d "%~dp0"
title Yimly - Update

echo ========================================
echo           YIMLY UPDATE
echo ========================================
echo.

echo [1/5] Checking Git...
where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git is not installed or not in PATH.
    echo Install Git for Windows: https://git-scm.com/download/win
    goto FAILED
)

echo [2/5] Checking Docker and Compose...
where docker >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker is not installed or not in PATH.
    goto FAILED
)

docker info >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker Desktop is not running. Start Docker Desktop and retry.
    goto FAILED
)

docker compose version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Docker Compose is unavailable. Update Docker Desktop and retry.
    goto FAILED
)

docker network inspect cloudflared_bridge >nul 2>&1
if errorlevel 1 (
    echo [ERROR] External Docker network "cloudflared_bridge" does not exist.
    echo Start your Cloudflare tunnel stack or create the network before updating.
    goto FAILED
)

if not exist ".env" (
    echo [ERROR] .env is missing. Configure JWT_SECRET before updating.
    goto FAILED
)
findstr /x /c:"JWT_SECRET=change_this_to_a_long_random_secret_in_production" ".env" >nul
if not errorlevel 1 (
    echo [ERROR] JWT_SECRET is still the example placeholder in .env.
    goto FAILED
)
findstr /x /c:"JWT_SECRET=yimly_production_secure_secret_change_me" ".env" >nul
if not errorlevel 1 (
    echo [ERROR] JWT_SECRET uses the former insecure Docker default.
    goto FAILED
)
findstr /r /b /c:"JWT_SECRET=." ".env" >nul
if errorlevel 1 (
    echo [ERROR] JWT_SECRET is missing or empty in .env.
    goto FAILED
)

echo [3/5] Checking Git branch...

for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"
if not "%CURRENT_BRANCH%"=="main" (
    echo [ERROR] This checkout is on branch "%CURRENT_BRANCH%", not "main".
    echo Switch to main and make sure local changes are committed before retrying.
    goto FAILED
)

echo.
echo [4/5] Pulling latest main...
git pull --ff-only origin main
if errorlevel 1 (
    echo [ERROR] Could not update from origin/main. Existing application remains in place.
    echo Check your internet connection and resolve any local Git changes first.
    goto FAILED
)

echo.
echo [5/5] Building the latest Yimly image...
docker compose -f compose.yaml build --pull
if errorlevel 1 (
    echo [ERROR] Docker build failed. The existing container has not been replaced.
    goto FAILED
)

echo.
echo Restarting Yimly with the updated image...
docker compose -f compose.yaml up -d --force-recreate
if errorlevel 1 (
    echo [ERROR] Yimly failed to start. Recent logs:
    docker compose -f compose.yaml logs --tail=100 yimly
    goto FAILED
)

echo.
echo Waiting for Yimly health check (up to 90 seconds)...
set /a ELAPSED=0

:HEALTH_LOOP
for /f "delims=" %%S in ('docker inspect --format="{{.State.Health.Status}}" yimly 2^>nul') do set "HEALTH_STATUS=%%S"
if "%HEALTH_STATUS%"=="healthy" goto HEALTH_PASSED
if "%HEALTH_STATUS%"=="unhealthy" goto HEALTH_FAILED
if %ELAPSED% GEQ 90 goto HEALTH_FAILED
timeout /t 5 /nobreak >nul
set /a ELAPSED+=5
echo Waiting... %ELAPSED%s
goto HEALTH_LOOP

:HEALTH_FAILED
echo.
echo [ERROR] Yimly did not become healthy.
docker compose -f compose.yaml ps
docker compose -f compose.yaml logs --tail=100 yimly
goto FAILED

:HEALTH_PASSED
echo.
echo ========================================
echo       YIMLY UPDATE COMPLETE
echo ========================================
docker compose -f compose.yaml ps
echo.
pause
exit /b 0

:FAILED
echo.
echo ========================================================================
echo                         UPDATE FAILED
echo ========================================================================
echo Update did not complete. Review the error above.
echo Your persistent data and media folders were not intentionally deleted.
echo.
echo ROLLBACK OPTIONS:
echo 1. To restore your database and media from a backup (if available):
echo    powershell -NoProfile -ExecutionPolicy Bypass -File ".\scripts\restore-yimly.ps1"
echo 2. To rollback to a previous Git commit if needed:
echo    git checkout ^<previous_commit_hash^>
echo    docker compose -f compose.yaml up -d --build
echo 3. To view detailed container logs:
echo    docker compose -f compose.yaml logs --tail=100 yimly
echo ========================================================================
echo.
pause
exit /b 1
