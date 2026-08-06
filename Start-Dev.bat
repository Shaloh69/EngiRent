@echo off
setlocal enabledelayedexpansion
REM ============================================================================
REM EngiRent Hub — disposable Docker-based DEV stack launcher (Windows / PC)
REM
REM Completely separate from Start.bat (the real production launcher, which
REM stays untouched — build+start, NODE_ENV=production, the real .env/
REM storage/). This script is for local testing, design/screenshot
REM verification, and iteration: a throwaway MySQL container
REM (engirent-mysql-dev), a throwaway storage-dev/ folder, every Node/Next
REM service run via `npm run dev` (hot reload), the Kiosk software running
REM with MOCK_GPIO/MOCK_CAMERA (no Pi needed), and the Phone App via
REM `flutter run -d chrome`.
REM
REM Does NOT unblock: a real PayMongo sandbox key (still needed separately —
REM payments/payouts fall back to the mock-checkout path, see
REM /payments/mock in client/web), or real Pi hardware (solenoids/actuators/
REM real cameras/touchscreen) and Tailscale reachability. Don't report
REM Phase 4 as passing based on this dev stack alone — see
REM docs/audit/phase4-audit-report.md.
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

call :resolve_flutter

echo.
echo [1/6] Starting Node API in dev mode against the Docker DB (port 5000)...
start "EngiRent DEV - Node API" cmd /k "cd /d "%ROOT%server\node_server" && npx dotenv -e .env.dev -- npm run dev"

echo [2/6] Starting ML Service (server\python_server\services\ml, port 8001)...
start "EngiRent DEV - ML Service" cmd /k "cd /d "%ROOT%server\python_server\services\ml" && call venv\Scripts\activate && uvicorn app.main:app --host 0.0.0.0 --port 8001"

echo [3/6] Starting Admin Console in dev mode (port 3001)...
start "EngiRent DEV - Admin Console" cmd /k "cd /d "%ROOT%client\admin" && npm run dev"

echo [4/6] Starting Public Site in dev mode (port 3000)...
start "EngiRent DEV - Public Site" cmd /k "cd /d "%ROOT%client\web" && npm run dev"

echo [5/6] Starting Kiosk with mocked hardware (no Pi needed, port 8090)...
if exist "%ROOT%server\kiosk\venv\Scripts\python.exe" (
  start "EngiRent DEV - Kiosk (mocked hardware)" cmd /k "cd /d "%ROOT%server\kiosk" && venv\Scripts\python.exe -m dotenv -f .env.dev run -- venv\Scripts\python.exe main.py"
) else (
  echo   [WARN] server\kiosk\venv not found — skipping. Create it once with:
  echo          cd server\kiosk ^&^& python -m venv venv ^&^& venv\Scripts\pip install -r requirements.txt -r requirements-dev.txt
)

echo [6/6] Starting Phone App (Flutter web, port 8092)...
if defined FLUTTER_BIN (
  start "EngiRent DEV - Phone App (Flutter web)" cmd /k "cd /d "%ROOT%client\flutter_app" && "%FLUTTER_BIN%" run -d chrome --web-port=8092 --dart-define=API_BASE_URL=http://localhost:5000/api/v1 --dart-define=USE_DEMO_MODE=false"
) else (
  echo   [WARN] flutter not found on PATH or at the known SDK location — skipping. Adjust :resolve_flutter in this script or add flutter to PATH.
)

echo.
echo Waiting for services to come up before running the Components Check...
call :wait_for_http "Node API" "http://localhost:5000/api/v1/health"
call :wait_for_http "Admin Console" "http://localhost:3001"
call :wait_for_http "Public Site" "http://localhost:3000"
if exist "%ROOT%server\kiosk\venv\Scripts\python.exe" call :wait_for_http "Kiosk UI (mocked)" "http://localhost:8090/api/state"

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
if exist "%ROOT%server\kiosk\venv\Scripts\python.exe" (
  call :check_http "Kiosk UI (mocked)" "http://localhost:8090/api/state"
) else (
  echo   [WARN] Kiosk UI check skipped — venv not set up ^(see [5/6] above^)
)

echo.
echo   [INFO] PayMongo sandbox key: not configured in .env.dev by design —
echo          checkout falls back to client/web's /payments/mock page
echo          (POST /payments/confirm with success or failure, no key needed).
echo   [INFO] Phone App (Flutter web): compiles on first run, can take 30-60s+
echo          past this check — watch its own window for "lib\main.dart is
echo          being served at http://localhost:8092".
echo   [INFO] Kiosk: MOCK_GPIO/MOCK_CAMERA simulate all hardware and the UI/
echo          socket wiring is real — only actual Pi hardware (solenoids,
echo          actuators, real cameras, touchscreen) and Tailscale reachability
echo          remain unverified by this dev stack.
echo.
if "%ALL_OK%"=="1" (
  echo ============================================================
  echo  All checks passed. Admin console:  http://localhost:3001
  echo                     Public site:     http://localhost:3000
  echo                     Kiosk UI:        http://localhost:8090
  echo                     Phone App:       http://localhost:8092 ^(once compiled^)
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

:resolve_flutter
setlocal enabledelayedexpansion
set "BIN=flutter"
where flutter >nul 2>&1
if not "!errorlevel!"=="0" (
  if exist "D:\Projects-Shem\Flutter\flutter\bin\flutter.bat" (
    set "BIN=D:\Projects-Shem\Flutter\flutter\bin\flutter.bat"
  ) else (
    set "BIN="
  )
)
endlocal & set "FLUTTER_BIN=%BIN%"
exit /b 0

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
