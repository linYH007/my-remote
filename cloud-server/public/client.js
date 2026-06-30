// ========== DOM ==========
const appHome = document.getElementById('appHome');
const appSession = document.getElementById('appSession');
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = true;
ctx.imageSmoothingQuality = 'high';
const stage = document.getElementById('stage');
const screenWrap = document.getElementById('screenWrap');
const zoomHint = document.getElementById('zoomHint');
const statusEl = document.getElementById('status');
const transportEl = document.getElementById('transport');
const statsEl = document.getElementById('stats');
const sessionLoading = document.getElementById('sessionLoading');
const sessionTitle = document.getElementById('sessionTitle');

const connectForm = document.getElementById('connectForm');
const lanFields = document.getElementById('lanConnectFields');
const remoteFields = document.getElementById('remoteConnectFields');
const tokenInput = document.getElementById('tokenInput');
const signalInput = document.getElementById('signalInput');
const roomInput = document.getElementById('roomInput');
const remoteTokenInput = document.getElementById('remoteTokenInput');
const loginError = document.getElementById('loginError');
const disconnectBtn = document.getElementById('disconnectBtn');
const backHomeBtn = document.getElementById('backHomeBtn');
const fullscreenBtn = document.getElementById('fullscreenBtn');
const screenshotBtn = document.getElementById('screenshotBtn');
const typeBtn = document.getElementById('typeBtn');
const mobileKbdBar = document.getElementById('mobileKbdBar');
const mobileTextInput = document.getElementById('mobileTextInput');
const mobileKbdClose = document.getElementById('mobileKbdClose');

const displayRoom = document.getElementById('displayRoom');
const displayToken = document.getElementById('displayToken');
const hostStatus = document.getElementById('hostStatus');
const copyRoomBtn = document.getElementById('copyRoomBtn');
const copyTokenBtn = document.getElementById('copyTokenBtn');
const copyAllBtn = document.getElementById('copyAllBtn');
const togglePassBtn = document.getElementById('togglePassBtn');
const shareWebUrl = document.getElementById('shareWebUrl');
const copyShareUrlBtn = document.getElementById('copyShareUrlBtn');
const shareLanList = document.getElementById('shareLanList');
const shareBadge = document.getElementById('shareBadge');
const shareHint = document.getElementById('shareHint');

const settingsSignal = document.getElementById('settingsSignal');
const settingsRoom = document.getElementById('settingsRoom');
const settingsToken = document.getElementById('settingsToken');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const settingsMsg = document.getElementById('settingsMsg');
const toastEl = document.getElementById('toast');

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];
const STORAGE_KEY = 'remote-control-settings';
const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 10000;
const VIEW_SEND_INTERVAL_MS = 90;
const MOVE_SEND_INTERVAL_MS = 12;
const INPUT_BUFFER_LIMIT = 256_000;

let ws = null;
let pc = null;
let dc = null;
let connected = false;
let transportMode = '';
let frameCount = 0;
let bytesCount = 0;
let connectMode = 'remote';
let passVisible = false;
let hostPollTimer = null;
let gotFirstFrame = false;
let serverInfo = null;
const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
let manualDisconnect = false;
let reconnectTimer = null;
let pingTimer = null;
let sessionParams = null;
let reconnectAttempt = 0;
let hadSuccessfulSession = false;

// ========== 设置持久化 ==========

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveSettings(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function initSettings() {
  const s = loadSettings();
  signalInput.value = s.signal || '';
  roomInput.value = s.room || '';
  remoteTokenInput.value = s.token || '';
  settingsSignal.value = s.signal || `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
  settingsRoom.value = s.room || '';
  settingsToken.value = s.token || '';
}

function getSignalUrl() {
  const manual = signalInput.value.trim();
  if (manual) return manual;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}`;
}

function buildShareHttpUrl(baseUrl) {
  const cfg = getHostConfig();
  const u = new URL(baseUrl);
  u.searchParams.set('mode', 'remote');
  if (cfg.room) u.searchParams.set('room', cfg.room);
  if (cfg.token) u.searchParams.set('token', cfg.token);
  return u.toString();
}

async function fetchServerInfo() {
  try {
    const res = await fetch('/api/server-info');
    if (res.ok) serverInfo = await res.json();
  } catch { /* ignore */ }
}

function updateShareDisplay() {
  let base = serverInfo?.publicWebUrl || serverInfo?.tunnelWebUrl || serverInfo?.shareWebUrl || location.origin;
  shareWebUrl.textContent = buildShareHttpUrl(base);

  if (serverInfo?.permanent) {
    shareBadge.hidden = false;
    shareBadge.textContent = '固定';
    shareLanList.textContent = serverInfo.hint || '地址不会变，请加入手机书签';
  } else if (serverInfo?.tunnelWebUrl) {
    shareBadge.hidden = false;
    shareBadge.textContent = '临时';
    shareLanList.textContent = '地址每次重启会变，请运行「远程控制-首次配置.cmd」';
  } else if (serverInfo?.lanWebUrls?.length) {
    shareBadge.hidden = true;
    shareLanList.textContent = `仅同 WiFi：${serverInfo.lanWebUrls.join('  ')}`;
  } else {
    shareBadge.hidden = true;
    shareLanList.textContent = '请运行桌面「远程控制-首次配置.cmd」设置固定公网地址';
  }
}

function getHostConfig() {
  const s = loadSettings();
  const urlParams = new URLSearchParams(location.search);
  return {
    room: urlParams.get('room') || s.room || '',
    token: urlParams.get('token') || s.token || '',
    signal: urlParams.get('signal') || s.signal || getSignalUrl(),
  };
}

// ========== UI 工具 ==========

function formatDeviceId(id) {
  if (!id) return '—— —— ——';
  const clean = id.replace(/\s/g, '').toUpperCase();
  return clean.match(/.{1,3}/g)?.join(' ') || clean;
}

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toastEl.classList.add('toast--show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toastEl.classList.remove('toast--show');
    setTimeout(() => { toastEl.hidden = true; }, 300);
  }, 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('已复制到剪贴板');
  } catch {
    showToast('复制失败');
  }
}

function showHome() {
  appHome.hidden = false;
  appSession.hidden = true;
  startHostPoll();
}

function showSession(title) {
  appHome.hidden = true;
  appSession.hidden = false;
  sessionTitle.textContent = title || '远程桌面';
  sessionLoading.hidden = false;
  gotFirstFrame = false;
  resetViewport();
  stopHostPoll();
}

function setConnected(on) {
  connected = on;
  statusEl.textContent = on ? '已连接' : '未连接';
  statusEl.className = on ? 'pill pill--on' : 'pill pill--off';
  if (!on && manualDisconnect) {
    transportEl.textContent = '';
    transportMode = '';
    hideMobileKeyboardBar();
    showHome();
  }
}

function setReconnecting() {
  connected = false;
  statusEl.textContent = '重连中…';
  statusEl.className = 'pill pill--wait';
}

function stopPing() {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function startPing() {
  stopPing();
  pingTimer = setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
    }
  }, 18000);
}

function getReconnectDelay() {
  const baseDelay = Math.min(RECONNECT_MIN_MS * 2 ** reconnectAttempt, RECONNECT_MAX_MS);
  return Math.min(baseDelay + Math.floor(Math.random() * 500), RECONNECT_MAX_MS);
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  if (!sessionParams || manualDisconnect) return;
  const delay = getReconnectDelay();
  reconnectTimer = setTimeout(() => {
    reconnectAttempt += 1;
    if (sessionParams.kind === 'lan') {
      connectLan(sessionParams.token, true);
    } else {
      connectRemote(sessionParams.signalUrl, sessionParams.room, sessionParams.token, true);
    }
  }, delay);
}

function setTransport(mode) {
  transportMode = mode;
  const labels = { lan: '局域网', webrtc: 'P2P 直连', relay: '中继模式' };
  transportEl.textContent = labels[mode] || mode;
  if (mode) {
    sessionLoading.hidden = true;
    // 通道建立后同步当前可视区域，避免被控端沿用上次的裁剪区域
    setTimeout(() => { if (connected) sendViewNow(); }, 200);
  }
}

function updateHostDisplay() {
  const cfg = getHostConfig();
  displayRoom.textContent = formatDeviceId(cfg.room);
  displayToken.textContent = passVisible ? (cfg.token || '——') : '••••••';
}

async function pollHostStatus() {
  const cfg = getHostConfig();
  if (!cfg.room) {
    hostStatus.textContent = '未配置设备码';
    hostStatus.className = 'pill pill--wait';
    return;
  }
  try {
    const res = await fetch(`/api/room/${encodeURIComponent(cfg.room)}/status`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data.online) {
      hostStatus.textContent = data.hasClient ? '正在被控制' : '在线 · 等待连接';
      hostStatus.className = data.hasClient ? 'pill pill--on' : 'pill pill--on';
    } else {
      hostStatus.textContent = '被控端未上线';
      hostStatus.className = 'pill pill--off';
    }
  } catch {
    // 局域网模式或无 API
    try {
      const res = await fetch('/api/info');
      if (res.ok) {
        const data = await res.json();
        hostStatus.textContent = '局域网 · 在线';
        hostStatus.className = 'pill pill--on';
        if (data.token && !loadSettings().token) {
          displayToken.textContent = passVisible ? data.token : '••••••';
        }
        return;
      }
    } catch { /* ignore */ }
    hostStatus.textContent = '等待被控端启动';
    hostStatus.className = 'pill pill--wait';
  }
}

function startHostPoll() {
  stopHostPoll();
  updateHostDisplay();
  fetchServerInfo().then(() => updateShareDisplay());
  pollHostStatus();
  hostPollTimer = setInterval(() => {
    pollHostStatus();
    updateShareDisplay();
  }, 2500);
}

function stopHostPoll() {
  if (hostPollTimer) {
    clearInterval(hostPollTimer);
    hostPollTimer = null;
  }
}

// ========== 导航 ==========

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('nav-item--active'));
    btn.classList.add('nav-item--active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('panel--active'));
    document.getElementById(tab === 'settings' ? 'panelSettings' : 'panelControl').classList.add('panel--active');
  });
});

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('mode-btn--active'));
    btn.classList.add('mode-btn--active');
    connectMode = btn.dataset.mode;
    const isLan = connectMode === 'lan';
    lanFields.hidden = !isLan;
    remoteFields.hidden = isLan;
  });
});

// ========== 复制 / 显示密码 ==========

copyRoomBtn.addEventListener('click', () => {
  const cfg = getHostConfig();
  if (cfg.room) copyText(cfg.room);
});

copyTokenBtn.addEventListener('click', () => {
  const cfg = getHostConfig();
  if (cfg.token) copyText(cfg.token);
});

copyShareUrlBtn.addEventListener('click', () => {
  copyText(shareWebUrl.textContent);
});

copyAllBtn.addEventListener('click', () => {
  const cfg = getHostConfig();
  const link = shareWebUrl.textContent || buildShareHttpUrl(location.origin);
  copyText(
    `【远程控制 - 请在浏览器打开以下链接】\n${link}\n\n设备码: ${cfg.room}\n密码: ${cfg.token}\n\n注意：不要打开 ws:// 开头的地址`,
  );
});

togglePassBtn.addEventListener('click', () => {
  passVisible = !passVisible;
  updateHostDisplay();
});

saveSettingsBtn.addEventListener('click', () => {
  saveSettings({
    signal: settingsSignal.value.trim(),
    room: settingsRoom.value.trim(),
    token: settingsToken.value.trim(),
  });
  initSettings();
  updateHostDisplay();
  settingsMsg.textContent = '设置已保存';
  showToast('设置已保存');
  setTimeout(() => { settingsMsg.textContent = ''; }, 2000);
});

// ========== 连接 ==========

connectForm.addEventListener('submit', (e) => {
  e.preventDefault();
  loginError.textContent = '';
  if (connectMode === 'lan') {
    const token = tokenInput.value.trim();
    if (!token) {
      loginError.textContent = '请输入连接密码';
      return;
    }
    showSession('局域网远程桌面');
    connectLan(token);
  } else {
    const room = roomInput.value.trim();
    const token = remoteTokenInput.value.trim();
    const signal = getSignalUrl();
    if (!room || !token) {
      loginError.textContent = '请填写设备码与密码';
      return;
    }
    saveSettings({ ...loadSettings(), room, token, signal: signalInput.value.trim() || undefined });
    showSession(`远程 · ${formatDeviceId(room)}`);
    connectRemote(signal, room, token);
  }
});

disconnectBtn.addEventListener('click', () => disconnect());
backHomeBtn.addEventListener('click', () => disconnect());

fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    appSession.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

function screenshotFilename() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `remote-${ts}.png`;
}

async function takeScreenshot() {
  if (!connected || !gotFirstFrame || !canvas.width || !canvas.height) {
    showToast('暂无画面，请等待连接');
    return;
  }
  try {
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('empty'))), 'image/png');
    });
    const name = screenshotFilename();
    const file = new File([blob], name, { type: 'image/png' });

    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: '远程截图' });
      showToast('截图已保存');
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast('截图已保存');
  } catch (err) {
    if (err?.name !== 'AbortError') showToast('截图失败');
  }
}

screenshotBtn.addEventListener('click', () => { takeScreenshot(); });

function cleanupPeerConnection() {
  if (dc) {
    dc.onopen = null;
    dc.onmessage = null;
    dc.onclose = null;
    dc.onerror = null;
    try { dc.close(); } catch { /* ignore */ }
    dc = null;
  }
  if (pc) {
    pc.onicecandidate = null;
    pc.ondatachannel = null;
    pc.onconnectionstatechange = null;
    pc.close();
    pc = null;
  }
}

function requestRelayFallback() {
  if (transportMode === 'relay') return;
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'mode', mode: 'relay' }));
  }
  cleanupPeerConnection();
  setTransport('relay');
}

function cleanupConnection() {
  stopPing();
  cleanupPeerConnection();
  if (ws) {
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    ws.close();
    ws = null;
  }
  connected = false;
  transportMode = '';
}

function disconnect() {
  manualDisconnect = true;
  clearTimeout(reconnectTimer);
  hideMobileKeyboardBar();
  cleanupConnection();
  setConnected(false);
}

function connectRemote(signalUrl, room, token, isReconnect = false) {
  sessionParams = { kind: 'remote', signalUrl, room, token };
  if (!isReconnect) {
    manualDisconnect = false;
    reconnectAttempt = 0;
    hadSuccessfulSession = false;
  }
  cleanupConnection();
  ws = new WebSocket(signalUrl);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', role: 'client', room, token }));
  };

  ws.onmessage = async (event) => {
    if (event.data instanceof ArrayBuffer) { onFrame(event.data); return; }
    if (event.data instanceof Blob) { onFrame(await event.data.arrayBuffer()); return; }
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case 'joined':
        hadSuccessfulSession = true;
        reconnectAttempt = 0;
        setConnected(true);
        startPing();
        break;
      case 'pong':
        break;
      case 'peer-present':
        showToast('被控端在线，等待画面…');
        break;
      case 'offer':
        setConnected(true);
        await handleOffer(msg.sdp);
        break;
      case 'ice':
        if (pc && msg.candidate) {
          try { await pc.addIceCandidate(msg.candidate); } catch { /* ignore */ }
        }
        break;
      case 'info':
        handleInfoMessage(JSON.stringify(msg));
        break;
      case 'mode':
        if (msg.mode !== 'webrtc') cleanupPeerConnection();
        setConnected(true);
        setTransport(msg.mode === 'webrtc' ? 'webrtc' : 'relay');
        break;
      case 'error':
        if (hadSuccessfulSession && msg.message === 'invalid room or token') {
          setReconnecting();
          showToast('等待被控端恢复...');
          scheduleReconnect();
          break;
        }
        loginError.textContent = msg.message || '连接失败';
        showToast(msg.message || '连接失败');
        manualDisconnect = true;
        disconnect();
        break;
      case 'peer-left':
        cleanupPeerConnection();
        setReconnecting();
        showToast('被控端暂时离线，等待恢复…');
        transportEl.textContent = '';
        transportMode = '';
        break;
    }
  };

  ws.onclose = () => {
    stopPing();
    cleanupPeerConnection();
    transportEl.textContent = '';
    transportMode = '';
    if (manualDisconnect) {
      setConnected(false);
      showToast('连接已断开');
      return;
    }
    setReconnecting();
    showToast('连接断开，正在重连…');
    scheduleReconnect();
  };
  ws.onerror = () => {
    if (!manualDisconnect) showToast('网络波动，正在重连…');
  };
}

function connectLan(token, isReconnect = false) {
  sessionParams = { kind: 'lan', token };
  if (!isReconnect) {
    manualDisconnect = false;
    reconnectAttempt = 0;
    hadSuccessfulSession = false;
  }
  cleanupConnection();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/?token=${encodeURIComponent(token)}`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    hadSuccessfulSession = true;
    reconnectAttempt = 0;
    setConnected(true);
    setTransport('lan');
    startPing();
  };
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') { handleInfoMessage(event.data); return; }
    onFrame(event.data);
  };
  ws.onclose = (event) => {
    stopPing();
    if (!manualDisconnect && event.code !== 4001) {
      setReconnecting();
      showToast('连接断开，正在重连...');
      scheduleReconnect();
      return;
    }
    manualDisconnect = true;
    setConnected(false);
    if (event.code === 4001) loginError.textContent = '密码错误';
    showToast(event.code === 4001 ? '密码错误' : '连接已断开');
  };
  ws.onerror = () => showToast('连接失败');
}

async function handleOffer(sdp) {
  cleanupPeerConnection();
  setConnected(true);
  const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc = peer;
  peer.onicecandidate = (e) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate ?? null }));
    }
  };
  peer.ondatachannel = (e) => {
    dc = e.channel;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => {
      setConnected(true);
      setTransport('webrtc');
    };
    dc.onmessage = (ev) => {
      if (typeof ev.data === 'string') { handleInfoMessage(ev.data); return; }
      onFrame(ev.data);
    };
    dc.onclose = () => requestRelayFallback();
    dc.onerror = () => requestRelayFallback();
  };
  peer.onconnectionstatechange = () => {
    if (peer.connectionState === 'failed' || peer.connectionState === 'disconnected') {
      requestRelayFallback();
    }
  };
  await peer.setRemoteDescription(sdp);
  const answer = await peer.createAnswer();
  await peer.setLocalDescription(answer);
  if (pc !== peer || ws?.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'answer', sdp: { type: answer.type, sdp: answer.sdp } }));
}

function handleInfoMessage(data) {
  try {
    JSON.parse(data);
  } catch { /* ignore */ }
}

// ========== 画面 ==========

const view = { zoom: 1, panX: 0.5, panY: 0.5 };
const VIEW_ZOOM_MIN = 1;
const VIEW_ZOOM_MAX = 6;
const WHEEL_ZOOM_SPEED = 0.006;
const PINCH_ZOOM_SPEED = 1.45;
const PAN_SPEED = 2.2;
const PAN_START_PX = 5;

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function getVisibleRegion() {
  const z = view.zoom;
  const vw = 1 / z;
  const vh = 1 / z;
  return {
    x0: clamp(view.panX - vw / 2, 0, 1 - vw),
    y0: clamp(view.panY - vh / 2, 0, 1 - vh),
    vw,
    vh,
  };
}

// 区域高清：不再用 CSS 放大整帧（会糊），而是把可视区域发给被控端，
// 被控端只裁剪并按原生像素发送该区域，放大后依然清晰。
let lastViewSent = 0;
let viewSendTimer = null;
let viewportRaf = null;
let renderedRegion = { x0: 0, y0: 0, vw: 1, vh: 1 };
let gestureRect = null;

function setCanvasQuality() {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

function sendViewNow() {
  const full = view.zoom <= 1.01;
  const { x0, y0, vw, vh } = getVisibleRegion();
  lastViewSent = Date.now();
  sendInput({ t: 'view', full, x0, y0, vw, vh });
}

function sendViewThrottled() {
  clearTimeout(viewSendTimer);
  const since = Date.now() - lastViewSent;
  if (since >= VIEW_SEND_INTERVAL_MS) {
    sendViewNow();
  } else {
    viewSendTimer = setTimeout(sendViewNow, VIEW_SEND_INTERVAL_MS - since);
  }
}

function getViewportRect() {
  const stageRect = stage.getBoundingClientRect();
  const layoutWidth = screenWrap.offsetWidth || canvas.clientWidth;
  const layoutHeight = screenWrap.offsetHeight || canvas.clientHeight;
  if (layoutWidth > 0 && layoutHeight > 0) {
    return {
      left: stageRect.left + (stageRect.width - layoutWidth) / 2,
      top: stageRect.top + (stageRect.height - layoutHeight) / 2,
      width: layoutWidth,
      height: layoutHeight,
    };
  }
  return canvas.getBoundingClientRect();
}

function queueViewportPaint() {
  if (viewportRaf) return;
  viewportRaf = requestAnimationFrame(() => {
    viewportRaf = null;
    paintViewport();
  });
}

function paintViewport() {
  const target = getVisibleRegion();
  const frame = renderedRegion || { x0: 0, y0: 0, vw: 1, vh: 1 };
  const rect = getViewportRect();
  if (view.zoom <= 1.01 || !rect.width || !rect.height) {
    screenWrap.style.transform = 'none';
    return;
  }

  const scaleX = frame.vw / target.vw;
  const scaleY = frame.vh / target.vh;
  const scale = clamp((scaleX + scaleY) / 2, 1, VIEW_ZOOM_MAX);
  const offsetX = ((target.x0 - frame.x0) / frame.vw) * rect.width;
  const offsetY = ((target.y0 - frame.y0) / frame.vh) * rect.height;
  screenWrap.style.transform = `matrix(${scale}, 0, 0, ${scale}, ${-offsetX * scale}, ${-offsetY * scale})`;
}

function applyViewport({ syncRemote = true } = {}) {
  view.zoom = clamp(view.zoom, VIEW_ZOOM_MIN, VIEW_ZOOM_MAX);
  const { vw, vh } = getVisibleRegion();
  view.panX = clamp(view.panX, vw / 2, 1 - vw / 2);
  view.panY = clamp(view.panY, vh / 2, 1 - vh / 2);
  // 画面由被控端按区域采集，这里不做 CSS 缩放
  queueViewportPaint();
  zoomHint.hidden = view.zoom <= 1.01;
  if (!zoomHint.hidden) {
    zoomHint.textContent = `${view.zoom.toFixed(1)}× 高清 · 双指缩放 · 双击还原`;
  }
  if (syncRemote) sendViewThrottled();
}

function resetViewport() {
  view.zoom = 1;
  view.panX = 0.5;
  view.panY = 0.5;
  applyViewport();
}

function zoomAtClientPoint(clientX, clientY, nextZoom) {
  const rect = getViewportRect();
  if (!rect.width || !rect.height) return;
  const ux = clamp01((clientX - rect.left) / rect.width);
  const uy = clamp01((clientY - rect.top) / rect.height);
  const focus = normalizedCoords({ clientX, clientY });
  const zoom = clamp(nextZoom, VIEW_ZOOM_MIN, VIEW_ZOOM_MAX);
  const vw = 1 / zoom;
  const vh = 1 / zoom;
  view.zoom = zoom;
  view.panX = focus.nx - ux * vw + vw / 2;
  view.panY = focus.ny - uy * vh + vh / 2;
  applyViewport();
}

let latestFrame = null;
let frameDrawScheduled = false;
let decodingFrame = false;

function onFrame(arrayBuffer) {
  bytesCount += arrayBuffer.byteLength;
  frameCount += 1;
  if (!gotFirstFrame) {
    gotFirstFrame = true;
    sessionLoading.hidden = true;
  }
  latestFrame = arrayBuffer;
  scheduleFrameDraw();
}

function scheduleFrameDraw() {
  if (frameDrawScheduled || decodingFrame) return;
  frameDrawScheduled = true;
  requestAnimationFrame(processLatestFrame);
}

async function processLatestFrame() {
  frameDrawScheduled = false;
  if (!latestFrame || decodingFrame) return;
  const frame = latestFrame;
  latestFrame = null;
  decodingFrame = true;
  try {
    await drawFrame(frame);
  } finally {
    decodingFrame = false;
    if (latestFrame) scheduleFrameDraw();
  }
}

async function drawFrame(arrayBuffer) {
  try {
    const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      setCanvasQuality();
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    renderedRegion = getVisibleRegion();
    queueViewportPaint();
  } catch { /* ignore */ }
}

setInterval(() => {
  if (!connected) { statsEl.textContent = ''; return; }
  statsEl.textContent = `${frameCount} fps · ${(bytesCount / 1024).toFixed(0)} KB/s`;
  frameCount = 0;
  bytesCount = 0;
}, 1000);

// ========== 输入 ==========

let pendingMoveInput = null;
let moveInputRaf = null;
let lastMoveInputSent = 0;

function transportBufferedAmount() {
  if (transportMode === 'lan') return ws?.bufferedAmount ?? 0;
  if (transportMode === 'webrtc') return dc?.bufferedAmount ?? 0;
  return ws?.bufferedAmount ?? 0;
}

function sendInputNow(obj, { urgent = false } = {}) {
  if (!connected) return;
  if (!urgent && transportBufferedAmount() > INPUT_BUFFER_LIMIT) return;
  if (transportMode === 'lan' && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
    return true;
  }
  if (transportMode === 'webrtc' && dc?.readyState === 'open') {
    dc.send(JSON.stringify(obj));
    return true;
  }
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'relay', msg: obj }));
    return true;
  }
  return false;
}

function scheduleMoveInput() {
  if (moveInputRaf) return;
  moveInputRaf = requestAnimationFrame(flushMoveInput);
}

function flushMoveInput(now = performance.now()) {
  moveInputRaf = null;
  if (!pendingMoveInput) return;
  if (now - lastMoveInputSent < MOVE_SEND_INTERVAL_MS) {
    scheduleMoveInput();
    return;
  }
  const move = pendingMoveInput;
  pendingMoveInput = null;
  if (sendInputNow(move)) lastMoveInputSent = now;
  if (pendingMoveInput) scheduleMoveInput();
}

function flushPendingMoveInput() {
  if (!pendingMoveInput) return;
  const move = pendingMoveInput;
  pendingMoveInput = null;
  if (moveInputRaf) {
    cancelAnimationFrame(moveInputRaf);
    moveInputRaf = null;
  }
  if (sendInputNow(move, { urgent: true })) lastMoveInputSent = performance.now();
}

function sendInput(obj) {
  if (obj?.t === 'm') {
    pendingMoveInput = obj;
    scheduleMoveInput();
    return;
  }
  if (obj?.t === 'click' || obj?.t === 'dc' || obj?.t === 'd' || obj?.t === 'u' || obj?.t === 'kd' || obj?.t === 'ku') {
    flushPendingMoveInput();
  }
  sendInputNow(obj, { urgent: obj?.t !== 'view' && obj?.t !== 'w' });
}

function normalizedCoords(e) {
  const rect = gestureRect || getViewportRect();
  if (!rect.width || !rect.height) return { nx: 0.5, ny: 0.5 };
  const ux = clamp01((e.clientX - rect.left) / rect.width);
  const uy = clamp01((e.clientY - rect.top) / rect.height);
  const { x0, y0, vw, vh } = getVisibleRegion();
  return {
    nx: clamp01(x0 + ux * vw),
    ny: clamp01(y0 + uy * vh),
  };
}

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function buttonName(b) { return b === 1 ? 'middle' : b === 2 ? 'right' : 'left'; }

function tapKey(code) {
  sendInput({ t: 'kd', code });
  sendInput({ t: 'ku', code });
}

let pointerActive = false;
let pointerIntent = 'click';
let pointerStart = null;
let pinchActive = false;
let pinchStartDist = 0;
let pinchStartZoom = 1;
let lastTapTime = 0;
let lastTapPos = null;
const DOUBLE_TAP_MS = 500;

function sendClick(nx, ny, button) {
  sendInput({ t: 'click', nx, ny, b: button });
}

function sendDoubleClick(nx, ny, button) {
  sendInput({ t: 'dc', nx, ny, b: button });
}

let lastProcessedTap = 0;
let pendingTouchTap = null;
let touchTapTimer = null;
let touchStart = null;
let touchMode = 'tap';
let touchMoveRaf = null;
let pendingTouchMove = null;

function coordsFromClient(clientX, clientY) {
  return normalizedCoords({ clientX, clientY, button: 0 });
}

function sendCursorMove(clientX, clientY, { immediate = false } = {}) {
  const { nx, ny } = coordsFromClient(clientX, clientY);
  const move = { t: 'm', nx, ny };
  if (immediate) {
    pendingMoveInput = null;
    sendInputNow(move, { urgent: true });
    lastMoveInputSent = performance.now();
  } else {
    sendInput(move);
  }
}

function queueTouchCursorMove(clientX, clientY) {
  pendingTouchMove = { clientX, clientY };
  if (touchMoveRaf) return;
  touchMoveRaf = requestAnimationFrame(() => {
    touchMoveRaf = null;
    if (!pendingTouchMove) return;
    const next = pendingTouchMove;
    pendingTouchMove = null;
    sendCursorMove(next.clientX, next.clientY);
  });
}

function clearTouchMoveQueue() {
  pendingTouchMove = null;
  if (touchMoveRaf) {
    cancelAnimationFrame(touchMoveRaf);
    touchMoveRaf = null;
  }
}

function processCanvasTap(clientX, clientY) {
  if (!connected || pinchActive) return;
  const now = Date.now();
  if (now - lastProcessedTap < 80) return;
  lastProcessedTap = now;

  const { nx, ny } = coordsFromClient(clientX, clientY);
  const button = 'left';
  const isDoubleTap = lastTapTime > 0
    && (now - lastTapTime) < DOUBLE_TAP_MS
    && lastTapPos
    && Math.hypot(nx - lastTapPos.nx, ny - lastTapPos.ny) < 0.15;

  if (isDoubleTap) {
    lastTapTime = 0;
    lastTapPos = null;
    if (view.zoom > 1.01) {
      resetViewport();
    } else {
      sendClick(nx, ny, button);
    }
    return;
  }

  sendClick(nx, ny, button);
  lastTapTime = now;
  lastTapPos = { nx, ny };
}

canvas.addEventListener('touchstart', (e) => {
  if (!connected || pinchActive || e.touches.length !== 1) return;
  const t = e.touches[0];
  gestureRect = getViewportRect();
  touchStart = { x: t.clientX, y: t.clientY, panX: view.panX, panY: view.panY };
  touchMode = 'tap';
  pendingTouchTap = { x: t.clientX, y: t.clientY };
  if (view.zoom <= 1.01) sendCursorMove(t.clientX, t.clientY, { immediate: true });

  if (document.activeElement === mobileTextInput) {
    e.preventDefault();
    mobileTextInput.blur();
    clearTimeout(touchTapTimer);
    touchTapTimer = setTimeout(() => {
      if (pendingTouchTap && touchMode === 'tap') {
        processCanvasTap(pendingTouchTap.x, pendingTouchTap.y);
        pendingTouchTap = null;
      }
    }, 120);
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  if (!connected || !touchStart || pinchActive || e.touches.length !== 1) return;
  const t = e.touches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  if (Math.hypot(dx, dy) <= PAN_START_PX) return;

  touchMode = 'pan';
  pendingTouchTap = null;
  clearTimeout(touchTapTimer);

  if (view.zoom > 1.01) {
    e.preventDefault();
    const rect = gestureRect || getViewportRect();
    const { vw, vh } = getVisibleRegion();
    view.panX = touchStart.panX - (dx / rect.width) * vw * PAN_SPEED;
    view.panY = touchStart.panY - (dy / rect.height) * vh * PAN_SPEED;
    applyViewport();
  } else {
    e.preventDefault();
    queueTouchCursorMove(t.clientX, t.clientY);
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  if (!connected || pinchActive || e.changedTouches.length !== 1) return;

  if (touchMode === 'pan') {
    touchStart = null;
    touchMode = 'tap';
    pendingTouchTap = null;
    gestureRect = null;
    clearTouchMoveQueue();
    sendViewNow();
    return;
  }

  if (!pendingTouchTap) {
    touchStart = null;
    return;
  }

  const t = e.changedTouches[0];
  const dx = t.clientX - pendingTouchTap.x;
  const dy = t.clientY - pendingTouchTap.y;
  if (Math.hypot(dx, dy) > 25) {
    pendingTouchTap = null;
    touchStart = null;
    gestureRect = null;
    clearTouchMoveQueue();
    clearTimeout(touchTapTimer);
    return;
  }

  e.preventDefault();
  clearTimeout(touchTapTimer);
  processCanvasTap(t.clientX, t.clientY);
  pendingTouchTap = null;
  touchStart = null;
  gestureRect = null;
  clearTouchMoveQueue();
}, { passive: false });

canvas.addEventListener('touchcancel', () => {
  pendingTouchTap = null;
  touchStart = null;
  gestureRect = null;
  touchMode = 'tap';
  clearTouchMoveQueue();
  clearTimeout(touchTapTimer);
}, { passive: true });

canvas.addEventListener('pointerdown', (e) => {
  if (!connected || pinchActive || isTouchDevice) return;
  e.preventDefault();
  canvas.setPointerCapture?.(e.pointerId);
  pointerActive = true;
  pointerIntent = 'click';
  gestureRect = getViewportRect();
  pointerStart = { x: e.clientX, y: e.clientY, panX: view.panX, panY: view.panY };
  if (view.zoom <= 1.01) sendCursorMove(e.clientX, e.clientY, { immediate: true });
});

canvas.addEventListener('pointermove', (e) => {
  if (!connected || !pointerActive || pinchActive) return;
  if (!pointerStart) return;

  const dx = e.clientX - pointerStart.x;
  const dy = e.clientY - pointerStart.y;
  const dist = Math.hypot(dx, dy);

  if (view.zoom > 1.01 && dist > PAN_START_PX) {
    pointerIntent = 'pan';
    const rect = gestureRect || getViewportRect();
    const { vw, vh } = getVisibleRegion();
    view.panX = pointerStart.panX - (dx / rect.width) * vw * PAN_SPEED;
    view.panY = pointerStart.panY - (dy / rect.height) * vh * PAN_SPEED;
    applyViewport();
    return;
  }

  if (view.zoom <= 1.01) {
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const latest = events?.length ? events[events.length - 1] : e;
    sendCursorMove(latest.clientX, latest.clientY);
  }
});

canvas.addEventListener('pointerup', (e) => {
  if (!connected || pinchActive || isTouchDevice) return;
  const wasPan = pointerIntent === 'pan';
  pointerActive = false;

  if (wasPan) {
    pointerStart = null;
    gestureRect = null;
    sendViewNow();
    return;
  }

  processCanvasTap(e.clientX, e.clientY);
  pointerStart = null;
  gestureRect = null;
});

canvas.addEventListener('dblclick', (e) => {
  if (!connected || isTouchDevice) return;
  e.preventDefault();
  const { nx, ny } = normalizedCoords(e);
  sendDoubleClick(nx, ny, buttonName(e.button));
});

canvas.addEventListener('pointercancel', () => {
  if (!pointerActive) return;
  pointerActive = false;
  pointerStart = null;
  gestureRect = null;
  if (view.zoom <= 1.01) sendInput({ t: 'u', b: 'left' });
});

function pinchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.hypot(dx, dy);
}

function pinchCenterNorm(touches) {
  const cx = (touches[0].clientX + touches[1].clientX) / 2;
  const cy = (touches[0].clientY + touches[1].clientY) / 2;
  const rect = gestureRect || getViewportRect();
  if (!rect.width || !rect.height) return { nx: 0.5, ny: 0.5 };
  const ux = (cx - rect.left) / rect.width;
  const uy = (cy - rect.top) / rect.height;
  const { x0, y0, vw, vh } = getVisibleRegion();
  return { nx: clamp01(x0 + ux * vw), ny: clamp01(y0 + uy * vh) };
}

stage.addEventListener('touchstart', (e) => {
  if (!connected || e.touches.length !== 2) return;
  e.preventDefault();
  pinchActive = true;
  pointerActive = false;
  gestureRect = getViewportRect();
  pinchStartDist = pinchDistance(e.touches);
  pinchStartZoom = view.zoom;
  const c = pinchCenterNorm(e.touches);
  view.panX = c.nx;
  view.panY = c.ny;
}, { passive: false });

stage.addEventListener('touchmove', (e) => {
  if (!connected || !pinchActive || e.touches.length !== 2) return;
  e.preventDefault();
  const dist = pinchDistance(e.touches);
  if (pinchStartDist > 0) {
    const ratio = Math.max(0.1, dist / pinchStartDist);
    view.zoom = pinchStartZoom * Math.pow(ratio, PINCH_ZOOM_SPEED);
    // 中心在捏合开始时已锁定，缩放过程中不再变更，避免区域采集延迟导致抖动
    applyViewport();
  }
}, { passive: false });

function endPinch() {
  pinchActive = false;
  pinchStartDist = 0;
  gestureRect = null;
  sendViewNow();
}

stage.addEventListener('touchend', (e) => {
  if (e.touches.length < 2) endPinch();
}, { passive: false });

stage.addEventListener('touchcancel', endPinch, { passive: false });

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
  if (!connected) return;
  e.preventDefault();
  if (e.ctrlKey) {
    const factor = Math.exp(-e.deltaY * WHEEL_ZOOM_SPEED);
    zoomAtClientPoint(e.clientX, e.clientY, view.zoom * factor);
    return;
  }
  const dy = stepFromDelta(e.deltaY);
  const dx = stepFromDelta(e.deltaX);
  if (dx || dy) sendInput({ t: 'w', dx, dy });
}, { passive: false });

function stepFromDelta(d) {
  if (!d) return 0;
  return Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / 100));
}

// 手机软键盘：仅通过顶部「打字」按钮手动打开
let mobileTextPrevLen = 0;
let mobileComposing = false;

function flushMobileTextInput() {
  if (!connected) return;
  const val = mobileTextInput.value;
  if (val.length > mobileTextPrevLen) {
    sendInput({ t: 'type', text: val.slice(mobileTextPrevLen) });
  } else if (val.length < mobileTextPrevLen) {
    const n = mobileTextPrevLen - val.length;
    for (let i = 0; i < n; i++) tapKey('Backspace');
  }
  mobileTextPrevLen = val.length;
}

function showMobileKeyboardBar(show) {
  if (!isTouchDevice) return;
  mobileKbdBar.hidden = !show;
}

function hideMobileKeyboardBar() {
  showMobileKeyboardBar(false);
  mobileTextInput.blur();
  mobileTextInput.value = '';
  mobileTextPrevLen = 0;
}

function openTypingBar() {
  showMobileKeyboardBar(true);
  mobileTextInput.placeholder = '输入内容发送到电脑…';
  mobileTextInput.focus();
}

if (isTouchDevice && typeBtn) typeBtn.hidden = false;

typeBtn?.addEventListener('click', () => {
  openTypingBar();
});

mobileKbdClose.addEventListener('click', () => {
  hideMobileKeyboardBar();
});

mobileTextInput.addEventListener('compositionstart', () => {
  mobileComposing = true;
});

mobileTextInput.addEventListener('compositionend', () => {
  mobileComposing = false;
  flushMobileTextInput();
});

mobileTextInput.addEventListener('input', () => {
  if (mobileComposing) return;
  flushMobileTextInput();
});

mobileTextInput.addEventListener('keydown', (e) => {
  if (!connected) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    tapKey('Enter');
    mobileTextInput.value = '';
    mobileTextPrevLen = 0;
  }
});

document.querySelectorAll('.mobile-kbd-btn[data-code]').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (!connected) return;
    tapKey(btn.dataset.code);
    mobileTextInput.focus();
  });
});

// 桌面物理键盘（非触摸设备）
window.addEventListener('keydown', (e) => {
  if (!connected || isTouchDevice) return;
  e.preventDefault();
  sendInput({ t: 'kd', code: e.code });
});

window.addEventListener('keyup', (e) => {
  if (!connected || isTouchDevice) return;
  e.preventDefault();
  sendInput({ t: 'ku', code: e.code });
});

// ========== 初始化 ==========

initSettings();
startHostPoll();

const urlParams = new URLSearchParams(location.search);
if (urlParams.get('room')) roomInput.value = urlParams.get('room');
if (urlParams.get('token')) remoteTokenInput.value = urlParams.get('token');
if (urlParams.get('signal')) signalInput.value = urlParams.get('signal');

if (urlParams.get('mode') === 'remote') {
  document.querySelector('.mode-btn[data-mode="remote"]')?.click();
} else if (urlParams.get('mode') === 'lan') {
  document.querySelector('.mode-btn[data-mode="lan"]')?.click();
}

// URL 带 auto=1 时自动连接
if (urlParams.get('auto') === '1' && urlParams.get('room') && urlParams.get('token')) {
  setTimeout(() => connectForm.requestSubmit(), 400);
}
