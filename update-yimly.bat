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

echo [3/5] Checking Git branch and pulling main...
for /f "delims=" %%B in ('git branch --show-current') do set "CURRENT_BRANCH=%%B"
if not "%CURRENT_BRANCH%"=="main" (
    echo [ERROR] This checkout is on branch "%CURRENT_BRANCH%", not "main".
    echo Switch to main and make sure local changes are committed before retrying.
    goto FAILED
)

git pull --ff-only origin main
if errorlevel 1 (
    echo [ERROR] Could not update from origin/main.
    echo Check your internet connection and resolve any local Git changes first.
    goto FAILED
)

echo.
echo [4/5] Building the latest Yimly image...
docker compose -f compose.yaml build --pull
if errorlevel 1 (
    echo [ERROR] Docker build failed. The existing container has not been replaced.
    goto FAILED
)

echo.
echo [5/5] Restarting Yimly with the updated image...
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
echo Update did not complete. Review the error above.
echo Your persistent data/media folders were not intentionally deleted.
echo.
pause
exit /b 1
