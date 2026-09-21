@echo off
setlocal
cd /d "%~dp0"

rem --- locate Bun -------------------------------------------------------------
rem Prefer PATH, then fall back to the standard install locations. The fallback
rem matters when this file is launched by double-click: Explorer keeps the
rem environment it had at logon, so a PATH entry added by the Bun installer is
rem not visible in that window even though Bun is installed.
set "BUN_EXE="

for /f "delims=" %%i in ('where bun 2^>nul') do (
  if not defined BUN_EXE set "BUN_EXE=%%i"
)

if not defined BUN_EXE if exist "%USERPROFILE%\.bun\bin\bun.exe" set "BUN_EXE=%USERPROFILE%\.bun\bin\bun.exe"
if not defined BUN_EXE if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links\bun.exe" set "BUN_EXE=%LOCALAPPDATA%\Microsoft\WinGet\Links\bun.exe"
if not defined BUN_EXE if exist "%ProgramFiles%\Bun\bun.exe" set "BUN_EXE=%ProgramFiles%\Bun\bun.exe"

if not defined BUN_EXE (
  echo [ERROR] Bun not found.
  echo   Install it, then reopen this window:
  echo     powershell -c "irm bun.sh/install.ps1 ^| iex"
  pause
  exit /b 1
)

rem Put Bun's own directory first so anything it spawns sees it too.
for %%i in ("%BUN_EXE%") do set "PATH=%%~dpi;%PATH%"

if not exist "node_modules" (
  echo Installing dependencies ^(first run^)...
  call "%BUN_EXE%" install
  if errorlevel 1 (
    echo [ERROR] bun install failed.
    pause
    exit /b 1
  )
)

echo Starting AgentFA web frontend...
echo Bun: %BUN_EXE%
echo URL: http://localhost:8443/
echo Press Ctrl+C in this window to stop.
echo.

call "%BUN_EXE%" run dev
set EXIT_CODE=%ERRORLEVEL%

echo.
echo Server exited with code %EXIT_CODE%.
pause
exit /b %EXIT_CODE%
