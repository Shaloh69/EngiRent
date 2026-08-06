@echo off
setlocal enabledelayedexpansion
REM ============================================================================
REM EngiRent Hub — self-hosted stack launcher (Windows / PC)
REM
REM Launches all four PC-hosted services in their own windows — Node API,
REM Python ML service, Admin console, and the public site — then runs a
REM Components Check and reports pass/fail per service rather than launching
REM blind and hoping. The Raspberry Pi kiosk is NOT started here — it's a
REM separate physical machine, started via its own systemd service
REM (see server/kiosk/setup.sh).
REM ============================================================================

set ROOT=%~dp0
cd /d "%ROOT%"

echo ============================================================
echo  EngiRent Hub — starting self-hosted stack
echo ============================================================
echo.

REM NODE_ENV=production is forced here (not left to each .env) so this
REM launcher always reproduces the real production posture — Render's own
REM render.yaml ran all three Node/Next services via build+start with
REM NODE_ENV=production explicitly set. `next dev` hardcodes NODE_ENV to
REM "development" internally regardless of any env var, and the Admin
REM Console's isDemoMode / the API's confirmPayment dev-confirm bypass both
REM key off NODE_ENV=="production" — running these via `npm run dev` would
REM silently leave demo data and a security bypass live in what's meant to
REM be the real deployment. dotenv.config() (env.ts) never overrides an
REM already-set process env var, so this wins over .env's own NODE_ENV.

echo [1/4] Building and starting Node API (server\node_server, port 5000)...
start "EngiRent - Node API" cmd /k "cd /d "%ROOT%server\node_server" && set NODE_ENV=production && npm run build && npm start"

echo [2/4] Starting ML Service (server\python_server\services\ml, port 8001)...
start "EngiRent - ML Service" cmd /k "cd /d "%ROOT%server\python_server\services\ml" && call venv\Scripts\activate && uvicorn app.main:app --host 0.0.0.0 --port 8001"

echo [3/4] Building and starting Admin Console (client\admin, port 3001)...
start "EngiRent - Admin Console" cmd /k "cd /d "%ROOT%client\admin" && set NODE_ENV=production && npm run build && npm start -- -p 3001"

echo [4/4] Building and starting Public Site (client\web, port 3000)...
start "EngiRent - Public Site" cmd /k "cd /d "%ROOT%client\web" && set NODE_ENV=production && npm run build && npm start"

echo.
echo Building from source takes longer than a dev server to come up — polling
echo each service for up to 2 minutes before running the full Components Check.
call :wait_for_http "Node API" "http://localhost:5000/api/v1/health"
call :wait_for_http "ML Service" "http://localhost:8001/api/v1/health"
call :wait_for_http "Admin Console" "http://localhost:3001"
call :wait_for_http "Public Site" "http://localhost:3000"

echo.
echo ============================================================
echo  Components Check
echo ============================================================
set ALL_OK=1

call :check_http "Node API" "http://localhost:5000/api/v1/health"
call :check_http "ML Service" "http://localhost:8001/api/v1/health"
call :check_http "Admin Console" "http://localhost:3001"
call :check_http "Public Site" "http://localhost:3000"
call :check_port "MySQL" 3306
call :check_storage_dir
call :check_paymongo_keys
call :check_env_file "server\node_server\.env"
call :check_env_file "server\python_server\services\ml\.env"

echo.
if "%ALL_OK%"=="1" (
  echo ============================================================
  echo  All checks passed. Admin console:  http://localhost:3001
  echo                     Public site:     http://localhost:3000
  echo ============================================================
) else (
  echo ============================================================
  echo  One or more checks FAILED — see [FAIL]/[WARN] lines above.
  echo  Services are still running in their own windows; fix the
  echo  reported issue^(s^) and re-run this script to re-check.
  echo ============================================================
)
echo.
pause
exit /b 0

REM ── Helpers ──────────────────────────────────────────────────────────────

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
  echo   [WARN] %NAME% did not respond within 2 minutes ^(still building/starting?^) — the Components Check below will confirm
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
if exist "%ROOT%server\node_server\storage\" (
  echo   [OK]   Local storage directory exists ^(server\node_server\storage\^)
) else (
  echo   [WARN] Local storage directory not found yet — created automatically on first upload
)
endlocal
exit /b 0

:check_paymongo_keys
setlocal
findstr /C:"PAYMONGO_SECRET_KEY=sk_test_your" "%ROOT%server\node_server\.env" >nul 2>&1
if %errorlevel%==0 (
  echo   [WARN] PAYMONGO_SECRET_KEY still looks like the placeholder value in server\node_server\.env
) else (
  echo   [OK]   PAYMONGO_SECRET_KEY appears to be configured
)
endlocal
exit /b 0

:check_env_file
setlocal
set REL=%~1
if exist "%ROOT%%REL%" (
  echo   [OK]   %REL% exists
) else (
  echo   [FAIL] %REL% is missing — copy the matching .env.example and fill it in
  endlocal & set ALL_OK=0
  exit /b 1
)
endlocal
exit /b 0
