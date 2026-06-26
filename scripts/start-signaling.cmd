@echo off
chcp 65001 >nul
if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
title 远程控制 - 信令服务器
cd /d "%~dp0.."
call "%~dp0config.cmd"

echo.
echo  ========================================
echo   远程控制 - 信令服务器
echo  ========================================
echo   端口: %PORT%
echo   页面: %WEB_URL%
echo  ========================================
echo.
echo  请保持本窗口运行，不要关闭。
echo.

set "PORT=%PORT%"
call npm run signaling

echo.
echo [已停止] 按任意键关闭...
pause >nul
