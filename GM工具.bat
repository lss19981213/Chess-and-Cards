@echo off
rem Chess & Cards GM Tool launcher
rem Double-click to open the desktop window (no console window shown).
setlocal
cd /d "%~dp0"

set "PS1=%~dp0tools\gm-tool.ps1"

where pwsh >nul 2>nul
if %errorlevel%==0 (
  start "" pwsh -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%PS1%"
  goto :eof
)

start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%PS1%"
