@echo off
chcp 65001 >nul
call "%~dp0config.cmd"

set "LINK=%WEB_URL%/?mode=remote&room=%ROOM%&token=%TOKEN%&signal=%SIGNAL_URL%"

powershell -NoProfile -Command "$t = @('======== 远程控制 连接信息 ========','','信令地址: %SIGNAL_URL%','控制端页面: %WEB_URL%','房间号 ROOM: %ROOM%','口令 TOKEN: %TOKEN%','','一键链接（发给控制端）:','%LINK%','','================================') -join [Environment]::NewLine; Set-Clipboard -Value $t; Write-Host $t; Write-Host ''; Write-Host '已复制到剪贴板！' -ForegroundColor Green"

echo.
pause
