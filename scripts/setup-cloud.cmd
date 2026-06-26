@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title 远程控制 - 云服务器配置（固定地址，无需 TUN）

echo.
echo  ============================================================
echo    云服务器模式 - 一次配置，永久固定地址，无需 TUN
echo  ============================================================
echo.
echo  原理：信令服务器部署在境外云端，电脑主动连出去，
echo        手机访问云端固定地址，不依赖 ngrok / TUN。
echo.
echo  免费部署步骤（约 5 分钟）：
echo    1. 注册 https://render.com （可用 GitHub 登录）
echo    2. 把本项目推到 GitHub（或 Fork）
echo    3. Render 控制台 - New - Blueprint - 选本仓库
echo       （会自动读取 render.yaml 部署信令服务）
echo    4. 部署完成后得到地址，如：
echo       https://yuan-cheng-signaling.onrender.com
echo.

set /p CLOUD_URL=请输入云端地址(如 https://xxx.onrender.com): 
set /p ROOM=设备码(默认 myroom01): 
set /p TOKEN=连接密码(默认 abc123): 

if "%ROOM%"=="" set "ROOM=myroom01"
if "%TOKEN%"=="" set "TOKEN=abc123"

if "%CLOUD_URL%"=="" (
  echo [错误] 必须填写云端地址
  pause
  exit /b 1
)

REM 去掉末尾斜杠
if "%CLOUD_URL:~-1%"=="/" set "CLOUD_URL=%CLOUD_URL:~0,-1%"

REM ws/wss 转换
set "SIGNAL_HTTPS=%CLOUD_URL%"
set "SIGNAL_WSS=%CLOUD_URL:https://=wss://%"
set "SIGNAL_WSS=%SIGNAL_WSS:http://=ws://%"

(
echo @echo off
echo chcp 65001 ^>nul
echo REM ========== 远程控制配置（云服务器模式）==========
echo.
echo REM 云服务器模式：无需 TUN、无需 ngrok
echo set "ROLE=host-only"
echo.
echo set "CONTROL_URL=%SIGNAL_HTTPS%"
echo set "SIGNAL_URL=%SIGNAL_WSS%"
echo.
echo REM 出站代理：留空=自动探测本机代理(Clash 7897 等)；也可手动填 http://127.0.0.1:7897
echo set "PROXY_URL="
echo.
echo set "NGROK_AUTHTOKEN="
echo set "NGROK_DOMAIN="
echo set "USE_TUNNEL=0"
echo.
echo set "ROOM=%ROOM%"
echo set "TOKEN=%TOKEN%"
echo.
echo set "WEB_URL=http://localhost:8080"
echo set "PORT=8080"
) > "%~dp0config.cmd"

echo.
echo  ============================================================
echo    配置已保存！
echo.
echo    手机永久地址: %SIGNAL_HTTPS%
echo    设备码: %ROOM%
echo    密码: %TOKEN%
echo.
echo    请把地址加入手机书签，双击「远程控制.vbs」启动即可。
echo    无需开 TUN，电脑开机自启后自动上线。
echo  ============================================================
echo.
pause
