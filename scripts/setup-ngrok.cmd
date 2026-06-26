@echo off
chcp 65001 >nul
echo.
echo  ========================================
echo   配置 ngrok 免费公网地址（推荐）
echo  ========================================
echo.
echo  1. 浏览器将打开 ngrok 注册页
echo  2. 免费注册后复制 Authtoken
echo  3. 粘贴到下方并回车
echo.
start "" "https://dashboard.ngrok.com/get-started/your-authtoken"
echo.
set /p TOKEN="请粘贴 NGROK Authtoken: "
if "%TOKEN%"=="" (
  echo 未输入 Token，已取消。
  pause
  exit /b 1
)

powershell -NoProfile -Command ^
  "$p='%~dp0config.cmd'; $c=Get-Content $p -Raw -Encoding UTF8; $c=$c -replace 'set \"NGROK_AUTHTOKEN=.*\"','set \"NGROK_AUTHTOKEN=%TOKEN%\"'; Set-Content $p $c -Encoding UTF8 -NoNewline"

echo.
echo  已保存到 config.cmd ！重新双击「远程控制.vbs」即可获取稳定公网地址。
echo.
pause
