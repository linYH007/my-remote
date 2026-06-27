import crypto from 'crypto';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { RTCPeerConnection } from 'werift';
import { captureFrame, getLogicalSize, refreshLogicalSize } from './capture.js';
import * as input from './input.js';
import { handleInputMessage } from './protocol.js';
import { getRtcConfiguration } from './ice-config.js';
import { hasTextCaretFocus } from './text-focus.js';

const SIGNAL_URL = process.env.SIGNAL_URL;
const PROXY_URL = process.env.PROXY_URL || '';
const ROOM = process.env.ROOM || crypto.randomBytes(3).toString('hex');
const TOKEN = process.env.TOKEN || crypto.randomBytes(3).toString('hex');

const FRAME_INTERVAL_MS = Number(process.env.FRAME_INTERVAL_MS) || 66;
const FRAME_WIDTH = Number(process.env.FRAME_WIDTH) || 1920;
const FRAME_QUALITY = Number(process.env.FRAME_QUALITY) || 72;
const SKIP_WEBRTC = process.env.SKIP_WEBRTC === '1' || /^wss:/i.test(SIGNAL_URL || '');
const WEBRTC_TIMEOUT_MS = SKIP_WEBRTC ? 0 : (Number(process.env.WEBRTC_TIMEOUT_MS) || 15000);
const MAX_BUFFERED = Number(process.env.MAX_BUFFERED) || 3_000_000;

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
let webrtcTimer = null;
let lastTextFocus = false;
let focusPollTimer = null;

function connectSignaling() {
  const opts = {};
  // 跨网络(wss) + 本机有代理时，经代理出站连云端，绕过对境外的直连限制（无需 TUN）
  if (PROXY_URL && /^wss:/i.test(SIGNAL_URL)) {
    opts.agent = new HttpsProxyAgent(PROXY_URL);
  }
  ws = new WebSocket(SIGNAL_URL, opts);

  ws.on('open', () => {
    console.log('[signaling] 已连接:', SIGNAL_URL, PROXY_URL ? `(经代理 ${PROXY_URL})` : '');
    ws.send(JSON.stringify({ type: 'join', role: 'host', room: ROOM, token: TOKEN }));
  });

  ws.on('message', async (raw, isBinary) => {
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
      case 'peer-joined':
        console.log('[signaling] 控制端已加入，开始建立连接…');
        startFocusPoll();
        if (SKIP_WEBRTC) {
          await activateTransport('relay');
        } else {
          await startWebRtc();
        }
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
      case 'peer-left':
        console.log('[signaling] 控制端已断开');
        stopFocusPoll();
        stopCapture();
        cleanupWebRtc();
        transport = null;
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    console.log('[signaling] 连接断开，5 秒后重连…');
    stopCapture();
    cleanupWebRtc();
    setTimeout(connectSignaling, 5000);
  });

  ws.on('error', (err) => {
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

  pc.onIceCandidate.subscribe((candidate) => {
    sendSignal({ type: 'ice', candidate: candidate ?? null });
  });

  pc.connectionStateChange.subscribe((state) => {
    if (state === 'connected' && dc?.readyState === 'open') {
      activateTransport('webrtc');
    }
    if (state === 'failed') {
      console.warn('[webrtc] 连接失败，切换到中继模式');
      activateTransport('relay');
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
  if (webrtcTimer) {
    clearTimeout(webrtcTimer);
    webrtcTimer = null;
  }
  if (dc) {
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

function startCapture() {
  stopCapture();
  captureTimer = setInterval(async () => {
    if (busy || !transport) return;

    const canSendWebRtc = transport === 'webrtc' && dc?.readyState === 'open' && dc.bufferedAmount < MAX_BUFFERED;
    const canSendRelay = transport === 'relay' && ws?.readyState === WebSocket.OPEN && ws.bufferedAmount < MAX_BUFFERED;
    if (!canSendWebRtc && !canSendRelay) return;
    // 网络拥塞时跳帧，优先保证流畅
    if (transport === 'relay' && ws.bufferedAmount > MAX_BUFFERED * 0.85) return;

    busy = true;
    try {
      const frame = await captureFrame({ width: FRAME_WIDTH, quality: FRAME_QUALITY });
      if (transport === 'webrtc' && dc?.readyState === 'open') {
        dc.send(frame);
      } else if (transport === 'relay' && ws?.readyState === WebSocket.OPEN) {
        ws.send(frame, { binary: true });
      }
    } catch (err) {
      console.error('[capture] 采集失败:', err.message);
    } finally {
      busy = false;
    }
  }, FRAME_INTERVAL_MS);
}

function stopCapture() {
  if (captureTimer) {
    clearInterval(captureTimer);
    captureTimer = null;
  }
}

async function checkAndNotifyTextFocus() {
  const focused = await hasTextCaretFocus();
  if (focused !== lastTextFocus) {
    lastTextFocus = focused;
    sendSignal({ type: 'text-focus', focused });
    console.log('[text-focus]', focused ? '输入框已聚焦' : '输入框失焦');
  }
  return focused;
}

function startFocusPoll() {
  stopFocusPoll();
  lastTextFocus = false;
  focusPollTimer = setInterval(() => {
    checkAndNotifyTextFocus().catch(() => {});
  }, 500);
}

function stopFocusPoll() {
  if (focusPollTimer) {
    clearInterval(focusPollTimer);
    focusPollTimer = null;
  }
  lastTextFocus = false;
}

async function handleInput(msg) {
  try {
    await handleInputMessage(msg, { getLogicalSize, input });
    if (msg.t === 'click' || msg.t === 'd' || msg.t === 'dc') {
      setTimeout(() => checkAndNotifyTextFocus().catch(() => {}), 120);
      setTimeout(() => checkAndNotifyTextFocus().catch(() => {}), 400);
    }
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

connectSignaling();
