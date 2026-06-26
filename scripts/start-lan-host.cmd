@echo off
chcp 65001 >nul
title Remote Control - LAN Host
cd /d "%~dp0.."

echo.
echo  ========================================
echo   Remote Control - Host (LAN)
echo  ========================================
echo.

call npm start

echo.
echo [Stopped] Press any key to close...
pause >nul
