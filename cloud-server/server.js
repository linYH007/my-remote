import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const MAX_RELAY_BUFFERED = Number(process.env.MAX_RELAY_BUFFERED) || 3_000_000;

const app = express();
// 禁止缓存 HTML/JS/CSS，确保手机端每次都拿到最新界面（解决「更新后手机仍是旧页面」问题）
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders(res, filePath) {
    if (/\.(html|js|css)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));

app.get('/healthz', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

app.get('/api/server-info', (_req, res) => {
  res.json({
    port: PORT,
    cloud: true,
    permanent: true,
    hint: '云端固定地址：手机加入书签，每次输入设备码和密码即可。',
  });
});

/** @type {Map<string, { host: import('ws').WebSocket|null, client: import('ws').WebSocket|null, token: string|null, hostSince: number|null }>} */
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, { host: null, client: null, token: null, hostSince: null });
  }
  return rooms.get(roomId);
}

function sendJson(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

function peerOf(room, role) {
  return role === 'host' ? room.client : room.host;
}

function forwardJson(room, fromRole, msg) {
  if (!room) return;
  const target = peerOf(room, fromRole);
  if (target && target.readyState === target.OPEN) sendJson(target, msg);
}

function cleanupRole(roomId, role, closingWs) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (role === 'host' && room.host !== closingWs) return;
  if (role === 'client' && room.client !== closingWs) return;
  const other = role === 'host' ? room.client : room.host;
  if (other) sendJson(other, { type: 'peer-left', role });
  if (role === 'host') {
    room.host = null;
    room.hostSince = null;
    if (!room.client) room.token = null;
  } else {
    room.client = null;
  }
  if (!room.host && !room.client) rooms.delete(roomId);
}

app.get('/api/room/:id/status', (req, res) => {
  const room = rooms.get(req.params.id);
  const hostOnline = !!(room?.host && room.host.readyState === room.host.OPEN);
  res.json({
    online: hostOnline,
    hasClient: !!(room?.client && room.client.readyState === room.client.OPEN),
    since: room?.hostSince ?? null,
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.roomId = null;
  ws.role = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw, isBinary) => {
    ws.isAlive = true;
    if (isBinary) {
      if (!ws.roomId || !ws.role) return;
      const room = rooms.get(ws.roomId);
      if (!room) return;
      const target = peerOf(room, ws.role);
      if (target && target.readyState === target.OPEN && target.bufferedAmount < MAX_RELAY_BUFFERED) {
        target.send(raw, { binary: true });
      }
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.type) {
      case 'join': {
        const { role, room: roomId, token } = msg;
        if (!roomId || !token || (role !== 'host' && role !== 'client')) {
          sendJson(ws, { type: 'error', message: 'invalid join' });
          ws.close();
          return;
        }
        const room = getRoom(roomId);
        if (role === 'host') {
          // 被控端重连时替换旧连接，避免「room already has host」导致掉线
          if (room.host) {
            try { room.host.close(); } catch { /* ignore */ }
            room.host = null;
          }
          room.host = ws;
          room.token = token;
          room.hostSince = Date.now();
          ws.roomId = roomId;
          ws.role = 'host';
          sendJson(ws, { type: 'joined', role: 'host', room: roomId });
          if (room.client) sendJson(ws, { type: 'peer-present', role: 'client' });
        } else {
          if (room.token !== token) {
            sendJson(ws, { type: 'error', message: 'invalid room or token' });
            ws.close();
            return;
          }
          if (room.client && room.client.readyState === room.client.OPEN) {
            try { room.client.close(); } catch { /* ignore */ }
          }
          room.client = ws;
          ws.roomId = roomId;
          ws.role = 'client';
          sendJson(ws, { type: 'joined', role: 'client', room: roomId });
          sendJson(room.host, { type: 'peer-joined', role: 'client' });
        }
        break;
      }
      case 'offer':
      case 'answer':
      case 'ice':
      case 'info':
      case 'mode':
      case 'text-focus':
      case 'framemeta':
      case 'relay':
        if (!ws.roomId || !ws.role) return;
        forwardJson(rooms.get(ws.roomId), ws.role, msg);
        break;
      case 'ping':
        sendJson(ws, { type: 'pong', t: msg.t || Date.now() });
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (ws.roomId && ws.role) cleanupRole(ws.roomId, ws.role, ws);
  });
});

// 心跳保活（Render/移动网络易断，间隔放宽）
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS) || 25000;
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, HEARTBEAT_INTERVAL_MS);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`[cloud-signaling] listening on :${PORT}`);
});
