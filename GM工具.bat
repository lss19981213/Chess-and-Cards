@echo off
chcp 65001 >nul
title Chess and Cards GM Manager
cd /d "%~dp0"

echo ============================================================
echo   Chess and Cards - GM 运营管理中台
echo ============================================================

set "ROOT=%~dp0"
set "CSPROJ=%ROOT%tools\CcGmClient\CcGmClient.csproj"
set "EXE_PUB=%ROOT%tools\CcGmClient\publish\CcGmClient.exe"
set "EXE_REL=%ROOT%tools\CcGmClient\bin\Release\net10.0-windows\CcGmClient.exe"
set "EXE_DBG=%ROOT%tools\CcGmClient\bin\Debug\net10.0-windows\CcGmClient.exe"

set "TARGET_EXE="

:: 若存在项目源码，每次启动前自动进行极速增量编译（仅耗时约1秒，保证代码改动即时生效）
if exist "%CSPROJ%" (
    echo [GM Client] 正在核对源码并增量更新客户端...
    dotnet build -c Release "%CSPROJ%" --nologo -v q
    if not errorlevel 1 (
        if exist "%EXE_REL%" set "TARGET_EXE=%EXE_REL%"
    )
)

if not defined TARGET_EXE if exist "%EXE_REL%" set "TARGET_EXE=%EXE_REL%"
if not defined TARGET_EXE if exist "%EXE_PUB%" set "TARGET_EXE=%EXE_PUB%"
if not defined TARGET_EXE if exist "%EXE_DBG%" set "TARGET_EXE=%EXE_DBG%"

if defined TARGET_EXE goto :launch_exe

echo [提示] 正在首次编译 WPF 客户端，请稍候...
dotnet build -c Release "%ROOT%tools\CcGmClient\CcGmClient.csproj"
if exist "%EXE_REL%" set "TARGET_EXE=%EXE_REL%"

if defined TARGET_EXE goto :launch_exe

echo [提示] 尝试通过 dotnet run 启动...
dotnet run --project "%ROOT%tools\CcGmClient\CcGmClient.csproj"
if errorlevel 1 goto :fail
exit /b 0

:launch_exe
echo [GM Client] 正在启动客户端：%TARGET_EXE%
start "" "%TARGET_EXE%"
echo [GM Client] 启动指令已发送，窗口已打开。
ping -n 2 127.0.0.1 >nul
exit /b 0

:fail
echo.
echo [错误] 启动 GM 客户端失败，请检查是否已安装 .NET 10 Desktop Runtime。
pause
exit /b 1