@echo off
chcp 65001 >nul
if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
title 远程控制 - 被控端
cd /d "%~dp0.."
call "%~dp0config.cmd"

echo.
echo  ========================================
echo   远程控制 - 被控端
echo  ========================================
echo   信令: %SIGNAL_URL%
if not "%ROOM%"=="" echo   设备码: %ROOM%
if not "%TOKEN%"=="" echo   密码: %TOKEN%
echo  ========================================
echo.
echo  请保持本窗口运行。连接信息会显示在下方。
echo.

set "SIGNAL_URL=%SIGNAL_URL%"
if not "%ROOM%"=="" set "ROOM=%ROOM%"
if not "%TOKEN%"=="" set "TOKEN=%TOKEN%"
call npm run host:remote

echo.
echo [已停止] 按任意键关闭...
pause >nul
