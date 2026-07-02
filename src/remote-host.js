import crypto from 'crypto';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { RTCPeerConnection } from 'werift';
import { captureFrame, getLogicalSize, refreshLogicalSize } from './capture.js';
import * as input from './input.js';
import { handleInputMessage } from './protocol.js';
import { getRtcConfiguration } from './ice-config.js';
import { startKeepAwake } from './keep-awake.js';
import { wakeScreenSoon } from './wake-screen.js';

const SIGNAL_URL = process.env.SIGNAL_URL;
const PROXY_URL = process.env.PROXY_URL || '';
const ROOM = process.env.ROOM || crypto.randomBytes(3).toString('hex');
const TOKEN = process.env.TOKEN || crypto.randomBytes(3).toString('hex');

const FRAME_INTERVAL_MS = Number(process.env.FRAME_INTERVAL_MS) || 66;
const FRAME_WIDTH = Number(process.env.FRAME_WIDTH) || 1920;
const FRAME_QUALITY = Number(process.env.FRAME_QUALITY) || 72;
// mozjpeg 体积更小但编码慢约 4 倍，会拖低帧率、增大延迟。默认关闭优先流畅度，
// 带宽极紧张时可设 FRAME_MOZJPEG=1 换取更小的帧体积。
const FRAME_MOZJPEG = process.env.FRAME_MOZJPEG === '1';
const SKIP_WEBRTC = process.env.SKIP_WEBRTC === '1' || /^wss:/i.test(SIGNAL_URL || '');
const WEBRTC_TIMEOUT_MS = SKIP_WEBRTC ? 0 : (Number(process.env.WEBRTC_TIMEOUT_MS) || 15000);
const MAX_BUFFERED = Number(process.env.MAX_BUFFERED) || 3_000_000;
const SIGNAL_RECONNECT_MIN_MS = Number(process.env.SIGNAL_RECONNECT_MIN_MS) || 1000;
const SIGNAL_RECONNECT_MAX_MS = Number(process.env.SIGNAL_RECONNECT_MAX_MS) || 15000;
const WEBRTC_DISCONNECTED_GRACE_MS = Number(process.env.WEBRTC_DISCONNECTED_GRACE_MS) || 3000;

if (!SIGNAL_URL) {
  console.error('请设置环境变量 SIGNAL_URL，指向公网信令服务器 WebSocket 地址');
  console.error('例: set SIGNAL_URL=ws://your-server.com:8080');
  process.exit(1);
}

let ws = null;
let pc = null;
let dc = null;
let transport = null; // 'webrtc' | 'relay'
let captureTimer = null;
let busy = false;
let currentRegion = null; // 控制端放大时的可视区域，用于裁剪发送
let webrtcTimer = null;
let webrtcDisconnectedTimer = null;
let signalPingTimer = null;
let signalReconnectTimer = null;
let signalReconnectAttempt = 0;

function startSignalPing() {
  if (signalPingTimer) clearInterval(signalPingTimer);
  signalPingTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
    }
  }, 18000);
}

function stopSignalPing() {
  if (signalPingTimer) {
    clearInterval(signalPingTimer);
    signalPingTimer = null;
  }
}

function clearSignalReconnect() {
  if (signalReconnectTimer) {
    clearTimeout(signalReconnectTimer);
    signalReconnectTimer = null;
  }
}

function scheduleSignalReconnect() {
  clearSignalReconnect();
  const baseDelay = Math.min(
    SIGNAL_RECONNECT_MIN_MS * 2 ** signalReconnectAttempt,
    SIGNAL_RECONNECT_MAX_MS,
  );
  const delay = Math.min(baseDelay + Math.floor(Math.random() * 500), SIGNAL_RECONNECT_MAX_MS);
  signalReconnectTimer = setTimeout(() => {
    signalReconnectTimer = null;
    signalReconnectAttempt += 1;
    connectSignaling();
  }, delay);
  return delay;
}

function clearWebRtcFallback() {
  if (webrtcDisconnectedTimer) {
    clearTimeout(webrtcDisconnectedTimer);
    webrtcDisconnectedTimer = null;
  }
}

function scheduleWebRtcFallback(reason) {
  if (transport !== 'webrtc' || webrtcDisconnectedTimer) return;
  webrtcDisconnectedTimer = setTimeout(() => {
    webrtcDisconnectedTimer = null;
    if (transport === 'webrtc') {
      console.warn(`[webrtc] ${reason}，切换到中继模式`);
      activateTransport('relay');
    }
  }, WEBRTC_DISCONNECTED_GRACE_MS);
}

async function startPeerTransport() {
  if (SKIP_WEBRTC) {
    await activateTransport('relay');
  } else {
    await startWebRtc();
  }
}

function connectSignaling() {
  const opts = {};
  // 跨网络(wss) + 本机有代理时，经代理出站连云端，绕过对境外的直连限制（无需 TUN）
  if (PROXY_URL && /^wss:/i.test(SIGNAL_URL)) {
    opts.agent = new HttpsProxyAgent(PROXY_URL);
  }
  ws = new WebSocket(SIGNAL_URL, opts);
  const socket = ws;

  ws.on('open', () => {
    if (ws !== socket) return;
    signalReconnectAttempt = 0;
    clearSignalReconnect();
    console.log('[signaling] 已连接:', SIGNAL_URL, PROXY_URL ? `(经代理 ${PROXY_URL})` : '');
    startSignalPing();
    ws.send(JSON.stringify({ type: 'join', role: 'host', room: ROOM, token: TOKEN }));
  });

  ws.on('message', async (raw, isBinary) => {
    if (ws !== socket) return;
    if (isBinary) return;

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'joined':
        console.log('[signaling] 已注册房间:', ROOM);
        break;
      case 'pong':
        break;
      case 'peer-present':
      case 'peer-joined':
        currentRegion = null;
        wakeScreenSoon('remote peer joined', { force: true });
        console.log('[signaling] 控制端已加入，开始建立连接…');
        await startPeerTransport();
        break;
      case 'answer':
        if (pc) await pc.setRemoteDescription(msg.sdp);
        break;
      case 'ice':
        if (pc && msg.candidate) {
          try {
            await pc.addIceCandidate(msg.candidate);
          } catch (err) {
            console.warn('[webrtc] addIceCandidate:', err.message);
          }
        }
        break;
      case 'relay':
        if (msg.msg) await handleInput(msg.msg);
        break;
      case 'mode':
        if (msg.mode === 'relay') await activateTransport('relay');
        break;
      case 'peer-left':
        console.log('[signaling] 控制端已断开');
        currentRegion = null;
        stopCapture();
        cleanupWebRtc();
        transport = null;
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (ws !== socket) return;
    console.log('[signaling] 连接断开，准备重连…');
    stopSignalPing();
    stopCapture();
    cleanupWebRtc();
    currentRegion = null;
    transport = null;
    ws = null;
    const delay = scheduleSignalReconnect();
    console.log(`[signaling] ${Math.round(delay / 1000)} 秒后重连`);
  });

  ws.on('error', (err) => {
    if (ws !== socket) return;
    console.error('[signaling] 错误:', err.message);
  });
}

async function startWebRtc() {
  cleanupWebRtc();
  transport = null;

  pc = new RTCPeerConnection(getRtcConfiguration());
  dc = pc.createDataChannel('control', { ordered: true });

  dc.onopen = () => {
    if (transport === 'relay') return;
    console.log('[webrtc] DataChannel 已连接');
    activateTransport('webrtc');
  };

  dc.onmessage = ({ data }) => {
    if (typeof data === 'string') {
      try {
        handleInput(JSON.parse(data));
      } catch {
        /* ignore */
      }
    }
  };
  dc.onclose = () => scheduleWebRtcFallback('data channel closed');
  dc.onerror = () => scheduleWebRtcFallback('data channel error');

  pc.onIceCandidate.subscribe((candidate) => {
    sendSignal({ type: 'ice', candidate: candidate ?? null });
  });

  pc.connectionStateChange.subscribe((state) => {
    if (state === 'connected' && dc?.readyState === 'open') {
      clearWebRtcFallback();
      activateTransport('webrtc');
    }
    if (state === 'failed') {
      console.warn('[webrtc] 连接失败，切换到中继模式');
      activateTransport('relay');
    }
    if (state === 'disconnected' || state === 'closed') {
      scheduleWebRtcFallback(state);
    }
  });

  webrtcTimer = setTimeout(() => {
    if (transport !== 'webrtc') {
      console.warn('[webrtc] 超时未建立 P2P，切换到中继模式');
      activateTransport('relay');
    }
  }, WEBRTC_TIMEOUT_MS);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal({ type: 'offer', sdp: { type: offer.type, sdp: offer.sdp } });
}

function cleanupWebRtc() {
  clearWebRtcFallback();
  if (webrtcTimer) {
    clearTimeout(webrtcTimer);
    webrtcTimer = null;
  }
  if (dc) {
    dc.onopen = null;
    dc.onmessage = null;
    dc.onclose = null;
    dc.onerror = null;
    try {
      dc.close();
    } catch {
      /* ignore */
    }
    dc = null;
  }
  if (pc) {
    pc.close().catch(() => {});
    pc = null;
  }
}

function sendSignal(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

async function activateTransport(mode) {
  if (transport === mode) return;
  transport = mode;
  if (mode === 'relay') {
    cleanupWebRtc();
  } else {
    clearWebRtcFallback();
  }
  console.log(`[transport] 使用 ${mode === 'webrtc' ? 'WebRTC P2P' : '信令中继'} 传输`);
  sendSignal({ type: 'mode', mode });

  await refreshLogicalSize();
  const info = { type: 'info', size: getLogicalSize() };
  if (mode === 'webrtc' && dc?.readyState === 'open') {
    dc.send(JSON.stringify(info));
  } else {
    sendSignal(info);
  }
  startCapture();
}

let lastSentRegionKey = '';

function regionKey(r) {
  return r ? `${r.x0.toFixed(4)},${r.y0.toFixed(4)},${r.vw.toFixed(4)},${r.vh.toFixed(4)}` : 'full';
}

// 采集并发送一帧。区域变化时先发一条 framemeta 说明这帧对应的采集区域，
// 控制端据此在放大平移时精确定位画面，避免每帧「吸附」到过期位置造成卡顿。
async function captureAndSend() {
  if (busy || !transport) return;

  const canSendWebRtc = transport === 'webrtc' && dc?.readyState === 'open' && dc.bufferedAmount < MAX_BUFFERED;
  const canSendRelay = transport === 'relay' && ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED;
  if (!canSendWebRtc && !canSendRelay) return;
  // 网络拥塞时跳帧，优先保证流畅
  if (transport === 'relay' && ws.bufferedAmount > MAX_BUFFERED * 0.85) return;

  busy = true;
  const region = currentRegion;
  try {
    const frame = await captureFrame({ width: FRAME_WIDTH, quality: FRAME_QUALITY, region, mozjpeg: FRAME_MOZJPEG });
    const key = regionKey(region);
    const meta = key !== lastSentRegionKey ? JSON.stringify({ type: 'framemeta', region: region || null }) : null;
    if (transport === 'webrtc' && dc?.readyState === 'open') {
      if (meta) dc.send(meta);
      dc.send(frame);
      lastSentRegionKey = key;
    } else if (transport === 'relay' && ws?.readyState === WebSocket.OPEN) {
      if (meta) ws.send(meta);
      ws.send(frame, { binary: true });
      lastSentRegionKey = key;
    }
  } catch (err) {
    console.error('[capture] 采集失败:', err.message);
  } finally {
    busy = false;
  }
}

function startCapture() {
  stopCapture();
  lastSentRegionKey = ''; // 通道重建后，首帧重新声明当前区域
  captureTimer = setInterval(captureAndSend, FRAME_INTERVAL_MS);
}

function stopCapture() {
  if (captureTimer) {
    clearInterval(captureTimer);
    captureTimer = null;
  }
}

async function handleInput(msg) {
  // 控制端可视区域更新：放大时只发送该区域，保证清晰
  if (msg && msg.t === 'view') {
    if (msg.full) {
      currentRegion = null;
    } else {
      currentRegion = { x0: msg.x0, y0: msg.y0, vw: msg.vw, vh: msg.vh };
    }
    // 区域一变立即出一帧，不必等下个采集周期，缩短放大平移的画面延迟。
    captureAndSend();
    return;
  }
  try {
    await handleInputMessage(msg, { getLogicalSize, input });
  } catch (err) {
    console.error('[input] 注入失败:', err.message);
  }
}

console.log('================ 远程被控端已启动 ================');
console.log(`信令服务器: ${SIGNAL_URL}`);
console.log(`房间号 (ROOM): ${ROOM}`);
console.log(`访问口令 (TOKEN): ${TOKEN}`);
console.log('请将以上 ROOM + TOKEN 告知控制端用户');
console.log('==================================================');

startKeepAwake('remote host');
connectSignaling();
