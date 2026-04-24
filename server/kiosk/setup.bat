@echo off
:: EngiRent Kiosk – Windows launcher
:: Double-click this to SSH into the Pi and run setup.sh automatically.
:: Edit PI_HOST and PI_USER below to match your Pi's IP and username.

set PI_USER=engirent
set PI_HOST=engirent-kiosk.local
set PI_KIOSK_DIR=/home/engirent/engirent/server/kiosk

echo ======================================================
echo   EngiRent Kiosk Remote Setup
echo   Connecting to %PI_USER%@%PI_HOST%
echo ======================================================
echo.
echo   [1] Full setup  (first-time install / re-run setup.sh)
echo   [2] Update deps (pip install -r requirements.txt only)
echo   [3] Push .env   (copy local .env to Pi and restart service)
echo.
set /p CHOICE="Choose an option (1, 2 or 3): "
echo.

:: Check if ssh is available
where ssh >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: ssh not found. Install OpenSSH from Windows Settings ^> Apps ^> Optional Features.
    pause
    exit /b 1
)

if "%CHOICE%"=="2" goto update_deps
if "%CHOICE%"=="3" goto push_env

:full_setup
echo Running full setup.sh on the Pi...
echo (You will be prompted for the Pi password)
echo.
ssh -t %PI_USER%@%PI_HOST% "cd %PI_KIOSK_DIR% && sudo bash setup.sh"
goto done

:update_deps
echo Updating Python dependencies on the Pi...
echo (You will be prompted for the Pi password)
echo.
ssh -t %PI_USER%@%PI_HOST% "cd %PI_KIOSK_DIR% && source venv/bin/activate && pip install --upgrade -r requirements.txt && echo Done."
goto done

:push_env
echo Pushing .env to Pi and restarting service...
echo (You will be prompted for the Pi password)
echo.
scp "%~dp0.env" %PI_USER%@%PI_HOST%:%PI_KIOSK_DIR%/.env
ssh -t %PI_USER%@%PI_HOST% "sudo systemctl restart engirent-kiosk.service && echo Service restarted."
goto done

:done
echo.
echo ======================================================
if %errorlevel% equ 0 (
    echo   Finished successfully!
) else (
    echo   Encountered an error. Check the output above.
)
echo ======================================================
pause
