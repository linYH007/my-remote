// ========== DOM ==========
const appHome = document.getElementById('appHome');
const appSession = document.getElementById('appSession');
const canvas = document.getElementById('screen');
const ctx = canvas.getContext('2d', { alpha: false });
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
const kbdToggle = document.getElementById('kbdToggle');

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
  stopHostPoll();
}

function setConnected(on) {
  connected = on;
  statusEl.textContent = on ? '已连接' : '未连接';
  statusEl.className = on ? 'pill pill--on' : 'pill pill--off';
  if (!on) {
    transportEl.textContent = '';
    transportMode = '';
    showHome();
  }
}

function setTransport(mode) {
  transportMode = mode;
  const labels = { lan: '局域网', webrtc: 'P2P 直连', relay: '中继模式' };
  transportEl.textContent = labels[mode] || mode;
  if (mode) sessionLoading.hidden = true;
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

function cleanupConnection() {
  if (dc) { try { dc.close(); } catch { /* ignore */ } dc = null; }
  if (pc) { pc.close(); pc = null; }
  if (ws) { ws.close(); ws = null; }
  connected = false;
  transportMode = '';
}

function disconnect() {
  cleanupConnection();
  setConnected(false);
}

function connectLan(token) {
  cleanupConnection();
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/?token=${encodeURIComponent(token)}`);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => { setConnected(true); setTransport('lan'); };
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') { handleInfoMessage(event.data); return; }
    onFrame(event.data);
  };
  ws.onclose = (event) => {
    setConnected(false);
    if (event.code === 4001) loginError.textContent = '密码错误';
    showToast(event.code === 4001 ? '密码错误' : '连接已断开');
  };
  ws.onerror = () => showToast('连接失败');
}

function connectRemote(signalUrl, room, token) {
  cleanupConnection();
  ws = new WebSocket(signalUrl);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'join', role: 'client', room, token }));
  };

  ws.onmessage = async (event) => {
    if (event.data instanceof ArrayBuffer) { onFrame(event.data); return; }
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }

    switch (msg.type) {
      case 'joined':
        setConnected(true);
        break;
      case 'offer':
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
        setTransport(msg.mode === 'webrtc' ? 'webrtc' : 'relay');
        break;
      case 'error':
        loginError.textContent = msg.message || '连接失败';
        showToast(msg.message || '连接失败');
        disconnect();
        break;
      case 'peer-left':
        showToast('被控端已断开');
        disconnect();
        break;
    }
  };

  ws.onclose = () => { setConnected(false); showToast('连接已断开'); };
  ws.onerror = () => { showToast('无法连接信令服务器'); loginError.textContent = '信令服务器连接失败'; };
}

async function handleOffer(sdp) {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.onicecandidate = (e) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ice', candidate: e.candidate ?? null }));
    }
  };
  pc.ondatachannel = (e) => {
    dc = e.channel;
    dc.binaryType = 'arraybuffer';
    dc.onopen = () => setTransport('webrtc');
    dc.onmessage = (ev) => {
      if (typeof ev.data === 'string') { handleInfoMessage(ev.data); return; }
      onFrame(ev.data);
    };
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed') setTransport('relay');
  };
  await pc.setRemoteDescription(sdp);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  ws.send(JSON.stringify({ type: 'answer', sdp: { type: answer.type, sdp: answer.sdp } }));
}

function handleInfoMessage(data) {
  try {
    JSON.parse(data);
  } catch { /* ignore */ }
}

// ========== 画面 ==========

let drawing = false;
function onFrame(arrayBuffer) {
  bytesCount += arrayBuffer.byteLength;
  frameCount += 1;
  if (!gotFirstFrame) {
    gotFirstFrame = true;
    sessionLoading.hidden = true;
  }
  drawFrame(arrayBuffer);
}

async function drawFrame(arrayBuffer) {
  if (drawing) return;
  drawing = true;
  try {
    const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
  } catch { /* ignore */ } finally {
    drawing = false;
  }
}

setInterval(() => {
  if (!connected) { statsEl.textContent = ''; return; }
  statsEl.textContent = `${frameCount} fps · ${(bytesCount / 1024).toFixed(0)} KB/s`;
  frameCount = 0;
  bytesCount = 0;
}, 1000);

// ========== 输入 ==========

function sendInput(obj) {
  if (!connected) return;
  if (transportMode === 'lan' && ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
    return;
  }
  if (transportMode === 'webrtc' && dc?.readyState === 'open') {
    dc.send(JSON.stringify(obj));
    return;
  }
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'relay', msg: obj }));
  }
}

function normalizedCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    nx: clamp01((e.clientX - rect.left) / rect.width),
    ny: clamp01((e.clientY - rect.top) / rect.height),
  };
}

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function buttonName(b) { return b === 1 ? 'middle' : b === 2 ? 'right' : 'left'; }

let lastMoveSent = 0;
canvas.addEventListener('mousemove', (e) => {
  if (!connected) return;
  const now = performance.now();
  if (now - lastMoveSent < 25) return;
  lastMoveSent = now;
  const { nx, ny } = normalizedCoords(e);
  sendInput({ t: 'm', nx, ny });
});

canvas.addEventListener('mousedown', (e) => {
  if (!connected) return;
  e.preventDefault();
  const { nx, ny } = normalizedCoords(e);
  sendInput({ t: 'd', nx, ny, b: buttonName(e.button) });
});

canvas.addEventListener('mouseup', (e) => {
  if (!connected) return;
  e.preventDefault();
  sendInput({ t: 'u', b: buttonName(e.button) });
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
  if (!connected) return;
  e.preventDefault();
  const dy = stepFromDelta(e.deltaY);
  const dx = stepFromDelta(e.deltaX);
  if (dx || dy) sendInput({ t: 'w', dx, dy });
}, { passive: false });

function stepFromDelta(d) {
  if (!d) return 0;
  return Math.sign(d) * Math.max(1, Math.round(Math.abs(d) / 100));
}

window.addEventListener('keydown', (e) => {
  if (!connected || !kbdToggle.checked) return;
  e.preventDefault();
  sendInput({ t: 'kd', code: e.code });
});

window.addEventListener('keyup', (e) => {
  if (!connected || !kbdToggle.checked) return;
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
