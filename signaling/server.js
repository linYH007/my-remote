import http from 'http';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const PUBLIC_URL_FILE = path.join(__dirname, '..', 'logs', 'public-url.json');
const CLIENT_INFO_FILE = path.join(__dirname, '..', 'logs', 'client-info.json');

function readTunnelInfo() {
  try {
    return JSON.parse(fs.readFileSync(PUBLIC_URL_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function readClientInfo() {
  try {
    return JSON.parse(fs.readFileSync(CLIENT_INFO_FILE, 'utf8'));
  } catch {
    return null;
  }
}

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public'), {
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

function getLanAddresses() {
  const result = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets || []) {
      if (net.family === 'IPv4' && !net.internal) result.push(net.address);
    }
  }
  return result;
}

app.get('/api/server-info', (_req, res) => {
  const lan = getLanAddresses();
  const webUrls = lan.map((ip) => `http://${ip}:${PORT}`);
  const tunnel = readTunnelInfo();
  const clientInfo = readClientInfo();
  const publicWeb = clientInfo?.controlUrl || tunnel?.webUrl || process.env.PUBLIC_WEB_URL || null;
  res.json({
    port: PORT,
    lanAddresses: lan,
    localWebUrl: `http://localhost:${PORT}`,
    lanWebUrls: webUrls,
    publicWebUrl: publicWeb,
    tunnelWebUrl: tunnel?.webUrl || null,
    shareWebUrl: publicWeb || (webUrls[0] ? `http://${webUrls[0]}:${PORT}` : `http://localhost:${PORT}`),
    tunnelProvider: tunnel?.provider || null,
    permanent: !!(clientInfo?.permanent || tunnel?.permanent),
    room: clientInfo?.room || null,
    hint: clientInfo?.hint || (publicWeb
      ? '永久地址：请加入手机书签，每次输入设备码和密码即可。'
      : '请运行「远程控制-首次配置.cmd」设置固定公网地址。'),
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
        if (!ws.roomId || !ws.role) return;
        forwardJson(rooms.get(ws.roomId), ws.role, msg);
        break;
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
  console.log('================ 信令服务器已启动 ================');
  console.log(`端口: ${PORT}`);
  console.log(`控制端页面: http://localhost:${PORT}`);
  console.log('==================================================');
});
