@echo off
setlocal enabledelayedexpansion
REM ============================================================================
REM EngiRent Hub — disposable Docker-based DEV stack launcher (Windows / PC)
REM
REM Completely separate from Start.bat (the real production launcher, which
REM stays untouched — build+start, NODE_ENV=production, the real .env/
REM storage/). This script is for local testing, design/screenshot
REM verification, and iteration: a throwaway MySQL container
REM (engirent-mysql-dev), a throwaway storage-dev/ folder, and every Node/Next
REM service run via `npm run dev` (hot reload) instead of a production build.
REM
REM Does NOT unblock: a real PayMongo sandbox key (still needed separately —
REM payments/payouts fall back to the existing mock-checkout path here), or
REM the kiosk/Tailscale hardware check. Don't report Phase 4 as passing based
REM on this dev stack alone — see docs/audit/phase4-audit-report.md.
REM ============================================================================

set ROOT=%~dp0
cd /d "%ROOT%"

echo ============================================================
echo  EngiRent Hub — starting disposable DEV stack
echo ============================================================
echo.

echo Checking Docker...
docker ps >nul 2>&1
if not "%errorlevel%"=="0" (
  echo   [FAIL] Docker daemon is not reachable. Start Docker Desktop first, then re-run this script.
  echo.
  pause
  exit /b 1
)
echo   [OK]   Docker daemon is reachable.

echo Ensuring engirent-mysql-dev container is running...
docker start engirent-mysql-dev >nul 2>&1
if not "%errorlevel%"=="0" (
  echo   [FAIL] engirent-mysql-dev container doesn't exist yet. Create it once with:
  echo          docker run -d --name engirent-mysql-dev -e MYSQL_ROOT_PASSWORD=^<pw^> -e MYSQL_DATABASE=engirent_dev -p 3308:3306 --restart unless-stopped mysql:8.0
  echo          then: npx prisma db push  (from server\node_server, with DATABASE_URL pointed at it)
  echo.
  pause
  exit /b 1
)
echo   [OK]   engirent-mysql-dev is running ^(port 3308^).

echo.
echo [1/4] Starting Node API in dev mode against the Docker DB (port 5000)...
start "EngiRent DEV - Node API" cmd /k "cd /d "%ROOT%server\node_server" && npx dotenv -e .env.dev -- npm run dev"

echo [2/4] Starting ML Service (server\python_server\services\ml, port 8001)...
start "EngiRent DEV - ML Service" cmd /k "cd /d "%ROOT%server\python_server\services\ml" && call venv\Scripts\activate && uvicorn app.main:app --host 0.0.0.0 --port 8001"

echo [3/4] Starting Admin Console in dev mode (port 3001)...
start "EngiRent DEV - Admin Console" cmd /k "cd /d "%ROOT%client\admin" && npm run dev"

echo [4/4] Starting Public Site in dev mode (port 3000)...
start "EngiRent DEV - Public Site" cmd /k "cd /d "%ROOT%client\web" && npm run dev"

echo.
echo Waiting for services to come up before running the Components Check...
call :wait_for_http "Node API" "http://localhost:5000/api/v1/health"
call :wait_for_http "Admin Console" "http://localhost:3001"
call :wait_for_http "Public Site" "http://localhost:3000"

echo.
echo ============================================================
echo  Components Check (DEV)
echo ============================================================
set ALL_OK=1

call :check_http "Node API" "http://localhost:5000/api/v1/health"
call :check_http "Admin Console" "http://localhost:3001"
call :check_http "Public Site" "http://localhost:3000"
call :check_port "engirent-mysql-dev" 3308
call :check_storage_dir
call :check_env_file "server\node_server\.env.dev"

echo.
echo   [INFO] PayMongo sandbox key: not configured in .env.dev by design —
echo          payment/payout flows fall back to the mock-checkout path.
echo   [INFO] Kiosk hardware / Tailscale: not covered by this dev stack at all.
echo.
if "%ALL_OK%"=="1" (
  echo ============================================================
  echo  All checks passed. Admin console:  http://localhost:3001
  echo                     Public site:     http://localhost:3000
  echo                     Test users:      see server\node_server\prisma\seed.ts
  echo ============================================================
) else (
  echo ============================================================
  echo  One or more checks FAILED — see [FAIL]/[WARN] lines above.
  echo ============================================================
)
echo.
pause
exit /b 0

REM ── Helpers (mirrors Start.bat's) ───────────────────────────────────────────

:wait_for_http
setlocal
set NAME=%~1
set URL=%~2
set /a TRIES=0
:wait_for_http_loop
for /f %%C in ('curl -s -o nul -w "%%{http_code}" "%URL%" 2^>nul') do set CODE=%%C
if "%CODE%"=="200" (
  echo   [OK]   %NAME% is up at %URL%
  endlocal
  exit /b 0
)
set /a TRIES+=1
if %TRIES% geq 40 (
  echo   [WARN] %NAME% did not respond within 2 minutes — the Components Check below will confirm
  endlocal
  exit /b 1
)
timeout /t 3 /nobreak >nul
goto wait_for_http_loop

:check_http
setlocal
set NAME=%~1
set URL=%~2
for /f %%C in ('curl -s -o nul -w "%%{http_code}" "%URL%" 2^>nul') do set CODE=%%C
if "%CODE%"=="200" (
  echo   [OK]   %NAME% responded 200 at %URL%
) else (
  echo   [FAIL] %NAME% did not respond OK ^(got: %CODE%^) at %URL%
  endlocal & set ALL_OK=0
  exit /b 1
)
endlocal
exit /b 0

:check_port
setlocal
set NAME=%~1
set PORT=%~2
netstat -an | findstr ":%PORT% " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo   [OK]   %NAME% is listening on port %PORT%
) else (
  echo   [FAIL] %NAME% does not appear to be listening on port %PORT%
  endlocal & set ALL_OK=0
  exit /b 1
)
endlocal
exit /b 0

:check_storage_dir
setlocal
if exist "%ROOT%server\node_server\storage-dev\" (
  echo   [OK]   Dev storage directory exists ^(server\node_server\storage-dev\^)
) else (
  echo   [WARN] Dev storage directory not found yet — created automatically on first upload
)
endlocal
exit /b 0

:check_env_file
setlocal
set REL=%~1
if exist "%ROOT%%REL%" (
  echo   [OK]   %REL% exists
) else (
  echo   [FAIL] %REL% is missing
  endlocal & set ALL_OK=0
  exit /b 1
)
endlocal
exit /b 0
