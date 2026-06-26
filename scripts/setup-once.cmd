@echo off
chcp 65001 >nul
cd /d "%~dp0.."
title 远程控制 - 首次配置（固定地址）

echo.
echo  ============================================================
echo    远程控制 - 首次配置
echo    一次设置，以后手机用固定地址 + 设备码 + 密码连接
echo  ============================================================
echo.
echo  推荐：ngrok 免费固定域名（注册一次，地址永久不变）
echo    1. 打开 https://dashboard.ngrok.com/signup 注册
echo    2. 复制 Authtoken: https://dashboard.ngrok.com/get-started/your-authtoken
echo    3. 创建免费域名: https://dashboard.ngrok.com/domains
echo       （会得到类似 xxx.ngrok-free.app 的固定地址）
echo.

set /p NGROK_TOKEN=请输入 NGROK Authtoken: 
set /p NGROK_DOMAIN=请输入固定域名(如 mypc.ngrok-free.app): 
set /p ROOM=设备码(默认 myroom01): 
set /p TOKEN=连接密码(默认 abc123): 

if "%ROOM%"=="" set "ROOM=myroom01"
if "%TOKEN%"=="" set "TOKEN=abc123"

if "%NGROK_TOKEN%"=="" (
  echo [错误] 必须填写 ngrok Token 才能获得固定公网地址
  pause
  exit /b 1
)
if "%NGROK_DOMAIN%"=="" (
  echo [错误] 必须填写固定域名
  pause
  exit /b 1
)

set "CONTROL_HTTPS=https://%NGROK_DOMAIN%"

(
echo @echo off
echo chcp 65001 ^>nul
echo REM ========== 远程控制配置（首次配置已写入）==========
echo.
echo REM 角色: full=本机跑服务+被控端, host-only=仅被控端连远程服务器
echo set "ROLE=full"
echo.
echo REM ngrok 固定域名（一次配置，地址永久不变）
echo set "NGROK_AUTHTOKEN=%NGROK_TOKEN%"
echo set "NGROK_DOMAIN=%NGROK_DOMAIN%"
echo set "CONTROL_URL=%CONTROL_HTTPS%"
echo.
echo REM 随机穿透（不推荐，每次地址会变）0=关 1=开
echo set "USE_TUNNEL=0"
echo.
echo REM 设备码与密码（固定，告诉手机端每次输入这两个）
echo set "ROOM=%ROOM%"
echo set "TOKEN=%TOKEN%"
echo.
echo set "SIGNAL_URL=ws://localhost:8080"
echo set "WEB_URL=http://localhost:8080"
echo set "PORT=8080"
) > "%~dp0config.cmd"

echo.
echo  ============================================================
echo    配置已保存！
echo.
echo    永久控制地址: %CONTROL_HTTPS%
echo    设备码: %ROOM%
echo    密码: %TOKEN%
echo.
echo    请把「控制地址」加入手机浏览器书签。
echo    以后不在电脑旁时：打开书签 - 输入设备码和密码 - 连接。
echo  ============================================================
echo.
pause
