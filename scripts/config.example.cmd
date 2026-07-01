@echo off
chcp 65001 >nul
REM ========== 远程控制配置模板 ==========
REM 复制本文件为 config.cmd 后填写。或运行「远程控制-云服务器配置.cmd」自动生成。

REM full=本机完整服务  host-only=仅被控端（信令在云端，无需 TUN，推荐跨网络）
set "ROLE=host-only"

REM 【云服务器模式】部署到 Render 后得到的固定地址
REM 例: https://yuan-cheng-signaling.onrender.com
set "CONTROL_URL="
REM 同一地址的 wss 形式，例: wss://yuan-cheng-signaling.onrender.com
set "SIGNAL_URL="

REM 出站代理：留空=自动探测本机代理(Clash 7897 等)；也可手动 http://127.0.0.1:7897
set "PROXY_URL="

REM 固定设备码与密码 - 手机端每次输入这两个
set "ROOM=myroom01"
set "TOKEN=abc123"

REM 远控运行期间保持唤醒，尽量防止自动睡眠/熄屏/锁屏；0=关闭
set "KEEP_AWAKE=1"
REM 远控连接/点击/双击/按键时尝试唤醒锁屏界面；0=关闭
set "WAKE_SCREEN=1"

REM 以下为 full 模式(本地信令+穿透)才需要，host-only 模式留空即可
set "TUNNEL_MODE=auto"
set "NGROK_AUTHTOKEN="
set "NGROK_DOMAIN="
set "USE_TUNNEL=0"

set "WEB_URL=http://localhost:8080"
set "PORT=8080"
