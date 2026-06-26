@echo off
chcp 65001 >nul
call "%~dp0config.cmd"

set "URL=%WEB_URL%/?mode=remote&room=%ROOM%&token=%TOKEN%&signal=%SIGNAL_URL%&auto=1"
echo Opening: %URL%
start "" "%URL%"
