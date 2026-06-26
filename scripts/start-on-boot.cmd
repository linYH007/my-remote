@echo off
chcp 65001 >nul
cd /d "%~dp0.."
call "%~dp0config.cmd"
set "ROOT=%CD%"

if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"

REM 开机自启：只启动信令 + 被控端，不打开浏览器
if exist "%TEMP%\remote-control-signaling.ok" del /f /q "%TEMP%\remote-control-signaling.ok" >nul 2>&1

start /MIN "RemoteControl-Signaling" /D "%ROOT%" cmd /k call "%~dp0start-signaling.cmd"

set /a TRIES=0
:WAIT_SIGNAL
set /a TRIES+=1
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL%==0 goto SIGNAL_OK
if %TRIES% GEQ 30 goto SIGNAL_FAIL
timeout /t 2 /nobreak >nul
goto WAIT_SIGNAL

:SIGNAL_OK
start /MIN "RemoteControl-Host" /D "%ROOT%" cmd /k call "%~dp0start-remote-host.cmd"
exit /b 0

:SIGNAL_FAIL
REM 仍尝试启动被控端，信令可能稍后可用
start /MIN "RemoteControl-Host" /D "%ROOT%" cmd /k call "%~dp0start-remote-host.cmd"
exit /b 1
