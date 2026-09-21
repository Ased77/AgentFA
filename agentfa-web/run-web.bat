@echo off
setlocal
cd /d "%~dp0"

where bun >nul 2>nul
if errorlevel 1 (
  echo [ERROR] bun not found on PATH. Install Bun first: https://bun.sh
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies ^(first run^)...
  call bun install
  if errorlevel 1 (
    echo [ERROR] bun install failed.
    pause
    exit /b 1
  )
)

echo Starting AgentFA web frontend...
echo URL: http://localhost:8443/
echo Press Ctrl+C in this window to stop.
echo.

call bun run dev
set EXIT_CODE=%ERRORLEVEL%

echo.
echo Server exited with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
