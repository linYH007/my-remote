@echo off
chcp 65001 >nul
cd /d "%~dp0.."
if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"

echo.
echo  正在取消开机自启...
echo.
call npm run autostart:uninstall
echo.
pause
