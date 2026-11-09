@echo off
rem Chess & Cards GM 工具启动器：双击即可打开桌面窗口，不显示命令行黑框
setlocal
cd /d "%~dp0"

where pwsh >nul 2>nul
if %errorlevel%==0 (
  start "" pwsh -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0tools\GM工具.ps1"
  goto :eof
)

start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0tools\GM工具.ps1"
