@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found on PATH. Install Node.js first.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies ^(first run^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
)

echo Starting AgentFA web frontend...
echo URL: http://localhost:8443/
echo Press Ctrl+C in this window to stop.
echo.

call npm run dev
set EXIT_CODE=%ERRORLEVEL%

echo.
echo Server exited with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%