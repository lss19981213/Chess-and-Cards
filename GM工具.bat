@echo off
rem Chess & Cards · GM 运营管理中台 (WPF Obsidian Gold Edition)
rem 双击直接启动原生 WPF 桌面客户端
setlocal
cd /d "%~dp0"

set "EXE_REL=%~dp0tools\CcGmClient\bin\Release\net10.0-windows\CcGmClient.exe"
set "EXE_DBG=%~dp0tools\CcGmClient\bin\Debug\net10.0-windows\CcGmClient.exe"

if exist "%EXE_REL%" (
    start "" "%EXE_REL%"
    goto :eof
)

if exist "%EXE_DBG%" (
    start "" "%EXE_DBG%"
    goto :eof
)

echo [GM Client] 首次启动，正在编译 WPF 桌面客户端...
dotnet build -c Release "%~dp0tools\CcGmClient\CcGmClient.csproj"
if exist "%EXE_REL%" (
    start "" "%EXE_REL%"
    goto :eof
)

echo [错误] 编译或启动 GM 客户端失败，请检查 .NET SDK 环境。
pause
