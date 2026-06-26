import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

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

function cleanupRole(roomId, role) {
  const room = rooms.get(roomId);
  if (!room) return;
  const other = role === 'host' ? room.client : room.host;
  if (other) sendJson(other, { type: 'peer-left', role });
  if (role === 'host') {
    room.host = null;
    room.token = null;
    room.hostSince = null;
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
    if (isBinary) {
      if (!ws.roomId || !ws.role) return;
      const room = rooms.get(ws.roomId);
      if (!room) return;
      const target = peerOf(room, ws.role);
      if (target && target.readyState === target.OPEN) target.send(raw, { binary: true });
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
          if (room.host && room.host.readyState === room.host.OPEN) {
            sendJson(ws, { type: 'error', message: 'room already has host' });
            ws.close();
            return;
          }
          room.host = ws;
          room.token = token;
          room.hostSince = Date.now();
          ws.roomId = roomId;
          ws.role = 'host';
          sendJson(ws, { type: 'joined', role: 'host', room: roomId });
          if (room.client) sendJson(ws, { type: 'peer-present', role: 'client' });
        } else {
          if (!room.host || room.token !== token) {
            sendJson(ws, { type: 'error', message: 'invalid room or token' });
            ws.close();
            return;
          }
          if (room.client && room.client.readyState === room.client.OPEN) {
            sendJson(ws, { type: 'error', message: 'room already has client' });
            ws.close();
            return;
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
      case 'relay':
        if (!ws.roomId || !ws.role) return;
        forwardJson(rooms.get(ws.roomId), ws.role, msg);
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    if (ws.roomId && ws.role) cleanupRole(ws.roomId, ws.role);
  });
});

// 心跳：清理掉线连接，避免云平台空闲断开后残留死房间
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 30000);
wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, () => {
  console.log(`[cloud-signaling] listening on :${PORT}`);
});
