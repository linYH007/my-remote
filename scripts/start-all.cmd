@echo off
chcp 65001 >nul
cd /d "%~dp0.."
call "%~dp0config.cmd"
set "ROOT=%CD%"

REM 确保双击桌面图标时也能找到 node/npm
if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"

echo.
echo  ========================================
echo   远程控制 - 一键启动
echo  ========================================
echo   信令: %SIGNAL_URL%
echo   房间: %ROOM%    口令: %TOKEN%
echo  ========================================
echo.

echo [1/3] 启动信令服务器...
start "RemoteControl-Signaling" /D "%ROOT%" cmd /k call "%~dp0start-signaling.cmd"

echo [2/3] 等待信令服务器就绪...
set /a TRIES=0
:WAIT_SIGNAL
set /a TRIES+=1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL%==0 goto SIGNAL_OK
if %TRIES% GEQ 20 (
  echo.
  echo  [错误] 信令服务器未能启动！
  echo  请查看标题为「RemoteControl-Signaling」的黑窗口中的报错。
  echo  常见原因：8080 端口被占用、未安装 Node.js。
  echo.
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto WAIT_SIGNAL
:SIGNAL_OK
echo      信令服务器已就绪 (http://127.0.0.1:%PORT%)

echo [3/3] 启动被控端...
start "RemoteControl-Host" /D "%ROOT%" cmd /k call "%~dp0start-remote-host.cmd"

echo      等待被控端注册...
timeout /t 3 /nobreak >nul

set "LINK=%WEB_URL%/?mode=remote&room=%ROOM%&token=%TOKEN%&signal=%SIGNAL_URL%&auto=1"
echo.
echo  打开控制页...
start "" "%LINK%"

powershell -NoProfile -Command "$t = @('远程控制 连接信息','ROOM: %ROOM%','TOKEN: %TOKEN%','链接: %LINK%') -join [Environment]::NewLine; Set-Clipboard -Value $t" >nul 2>&1

echo.
echo  ========================================
echo   启动完成！
echo   - 请保持信令服务器、被控端两个窗口运行
echo   - 控制页已在浏览器打开
echo   - 连接信息已复制到剪贴板
echo  ========================================
echo.
timeout /t 8 >nul
