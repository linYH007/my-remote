# 远程控制 MVP（向日葵 / ToDesk 简化版）

局域网直连 + **跨网络远程控制**：被控端采集屏幕并注入鼠标键盘，任意设备用浏览器即可控制。

## 两种连接模式

| 模式 | 适用场景 | 被控端命令 | 控制端 |
| --- | --- | --- | --- |
| **局域网** | 同一 WiFi/内网 | `npm start` | 浏览器打开被控端 IP |
| **跨网络** | 不同网络、公网 | `npm run host:remote` | 浏览器打开信令服务器页面 |

## 跨网络架构

```
                    ┌──────────────────┐
                    │  信令服务器 (公网)  │  ← 部署在云服务器/VPS
                    │  WebSocket 房间   │
                    └────────┬─────────┘
           主动连出 (无需端口映射) │
              ┌─────────────────┴─────────────────┐
              │                                   │
     ┌────────┴────────┐                 ┌────────┴────────┐
     │ 被控端 (Windows) │◀── WebRTC P2P ──▶│ 控制端 (浏览器)  │
     │ remote-host.js  │   或信令中继      │ 任意网络         │
     └─────────────────┘                 └─────────────────┘
```

- 被控端**主动连接**公网信令服务器，无需在被控电脑上做端口映射。
- 优先尝试 **WebRTC P2P**（低延迟）；若 NAT 穿透失败，自动降级为**信令中继**（稳定可用，带宽经服务器转发）。

## 环境要求

- Node.js >= 18
- 被控端：Windows
- 跨网络：一台有公网 IP 的服务器部署信令服务（或使用内网穿透工具临时暴露）

## 安装

```bash
npm install
```

---

## 一、局域网模式（同网段）

### 被控端

```bash
npm start
```

控制台会显示访问口令和局域网地址。

### 控制端

浏览器打开 `http://<被控端IP>:5900`，选择「局域网」，输入口令连接。

---

## 二、跨网络模式（不同网络）

### 步骤 1：部署信令服务器（公网 VPS）

在云服务器上克隆项目并启动：

```bash
npm install
npm run signaling
# 默认监听 8080，生产环境建议前面加 Nginx 反代并启用 wss://
```

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 信令服务端口 |

信令服务器同时托管控制端网页（`public/`），控制端直接访问 `http://你的服务器:8080` 即可。

### 步骤 2：被控端注册（Windows 电脑）

```powershell
$env:SIGNAL_URL="ws://你的公网服务器:8080"
# 可选：固定房间号与口令
# $env:ROOM="myroom01"
# $env:TOKEN="abc123"
npm run host:remote
```

控制台会打印：

```
房间号 (ROOM): xxxxx
访问口令 (TOKEN): xxxxxx
```

把 **ROOM + TOKEN** 发给控制端用户。

### 步骤 3：控制端连接（任意网络浏览器）

1. 打开 `http://你的公网服务器:8080`
2. 选择「**跨网络**」
3. 填写信令地址 `ws://你的公网服务器:8080`、房间号、口令
4. 点击连接

也可通过 URL 预填：

```
http://你的服务器:8080/?mode=remote&room=xxxxx&token=xxx&signal=ws://你的服务器:8080
```

### 可选：TURN 服务器（改善 NAT 穿透成功率）

部分对称型 NAT 无法 P2P，可配置 TURN 中继：

```powershell
$env:TURN_URL="turn:your-turn-server:3478"
$env:TURN_USER="username"
$env:TURN_PASS="password"
npm run host:remote
```

控制端浏览器侧 TURN 需在 `public/client.js` 的 `ICE_SERVERS` 中同步配置（或通过信令下发，后续可扩展）。

未配置 TURN 时，WebRTC 失败会自动走信令中继，功能仍可用。

---

## 环境变量汇总

### 局域网被控端 (`npm start`)

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `5900` | 服务端口 |
| `TOKEN` | 随机 | 访问口令 |
| `FRAME_INTERVAL_MS` | `90` | 采集间隔 |
| `FRAME_WIDTH` | `1366` | 画面宽度 |
| `FRAME_QUALITY` | `55` | JPEG 质量 |
| `KEEP_AWAKE` | `1` | Windows 下运行时保持唤醒；设为 `0` 可关闭 |
| `KEEP_AWAKE_DISPLAY` | `1` | 保持屏幕不熄灭；设为 `0` 只防睡眠 |
| `WAKE_SCREEN` | `1` | 远控连接/点击/双击/按键时尝试唤醒锁屏界面 |

### 跨网络被控端 (`npm run host:remote`)

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SIGNAL_URL` | **必填** | 信令 WebSocket 地址 |
| `ROOM` | 随机 | 房间号 |
| `TOKEN` | 随机 | 访问口令 |
| `TURN_URL` / `TURN_USER` / `TURN_PASS` | 无 | TURN 中继（可选） |
| `WEBRTC_TIMEOUT_MS` | `15000` | P2P 超时后切中继 |
| `KEEP_AWAKE` | `1` | Windows 下运行时保持唤醒；设为 `0` 可关闭 |
| `KEEP_AWAKE_DISPLAY` | `1` | 保持屏幕不熄灭；设为 `0` 只防睡眠 |
| `WAKE_SCREEN` | `1` | 远控连接/点击/双击/按键时尝试唤醒锁屏界面 |

---

## 已知限制

- 画面为 JPEG 帧流，高分辨率下带宽占用较大；中继模式流量经服务器转发。
- 仅主显示器；无文件传输、剪贴板、多显示器。
- 跨网络安全为口令 + 房间隔离，未做端到端加密（生产环境建议 wss + DTLS/SRTP）。
- 键盘映射基于美式布局。
- Windows 手动锁屏或进入安全桌面后，项目会用 `WAKE_SCREEN=1` 尝试唤醒显示器和登录输入界面；但普通用户态程序仍不能绕过 Windows 密码。向日葵/ToDesk 类完整锁屏控制通常依赖常驻系统服务、签名驱动或凭据组件。

## 目录结构

```
.
├── package.json
├── signaling/
│   └── server.js       # 公网信令 + 房间 + 中继 + 静态页面托管
├── src/
│   ├── server.js       # 局域网被控端
│   ├── remote-host.js  # 跨网络被控端（WebRTC + 中继）
│   ├── capture.js      # 屏幕采集与 JPEG 编码
│   ├── input.js        # 鼠标/键盘注入
│   ├── protocol.js     # 输入协议共享
│   └── ice-config.js   # STUN/TURN 配置
└── public/
    ├── index.html      # 控制端（局域网 / 跨网络）
    ├── client.js
    └── style.css
```

## 本地调试跨网络（单机模拟）

开三个终端，或双击桌面 **「远程控制.cmd」** 一键按顺序启动（信令 → 被控端 → 浏览器控制页，并自动复制连接信息到剪贴板）。

重新生成桌面启动器：`npm run shortcuts`

配置文件：[`scripts/config.cmd`](scripts/config.cmd)（公网部署时把 `SIGNAL_URL` 和 `WEB_URL` 改成你的服务器地址）

```powershell
# 终端 1：信令
npm run signaling

# 终端 2：被控端
$env:SIGNAL_URL="ws://localhost:8080"; $env:ROOM="test"; $env:TOKEN="123456"; npm run host:remote

# 终端 3：浏览器打开 http://localhost:8080，选跨网络，room=test, token=123456
```
