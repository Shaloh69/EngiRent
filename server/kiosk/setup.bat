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

:: Check if ssh is available
where ssh >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: ssh not found. Install OpenSSH from Windows Settings ^> Apps ^> Optional Features.
    pause
    exit /b 1
)

echo Connecting and running setup.sh on the Pi...
echo (You will be prompted for the Pi password)
echo.

ssh -t %PI_USER%@%PI_HOST% "cd %PI_KIOSK_DIR% && sudo bash setup.sh"

echo.
echo ======================================================
if %errorlevel% equ 0 (
    echo   Setup finished successfully!
    echo   The kiosk will auto-start on next reboot.
) else (
    echo   Setup encountered an error. Check the output above.
)
echo ======================================================
pause
