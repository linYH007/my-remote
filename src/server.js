import http from 'http';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { captureFrame, getLogicalSize, refreshLogicalSize } from './capture.js';
import * as input from './input.js';
import { handleInputMessage } from './protocol.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT) || 5900;
// 访问口令：默认随机生成，也可通过环境变量 TOKEN 指定。
const TOKEN = process.env.TOKEN || crypto.randomBytes(3).toString('hex');

// 画面参数：可通过环境变量调节带宽/帧率。
const FRAME_INTERVAL_MS = Number(process.env.FRAME_INTERVAL_MS) || 90; // 约 11 fps
const FRAME_WIDTH = Number(process.env.FRAME_WIDTH) || 1366;
const FRAME_QUALITY = Number(process.env.FRAME_QUALITY) || 55;
const MAX_BUFFERED = 2_000_000; // 客户端积压超过该字节数则跳过本帧，避免延迟堆积

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/info', (_req, res) => {
  res.json({ mode: 'lan', token: TOKEN, port: PORT });
});

app.get('/api/server-info', (_req, res) => {
  const lan = getLanAddresses();
  const webUrls = lan.map((ip) => `http://${ip}:${PORT}`);
  res.json({
    port: PORT,
    lanAddresses: lan,
    localWebUrl: `http://localhost:${PORT}`,
    lanWebUrls: webUrls,
    shareWebUrl: webUrls[0] || `http://localhost:${PORT}`,
    hint: '控制端请在浏览器打开 http:// 开头的链接。ws:// 是程序内部地址，不能当网址打开。',
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', async (ws, req) => {
  const reqUrl = new URL(req.url, 'http://localhost');
  if (reqUrl.searchParams.get('token') !== TOKEN) {
    ws.close(4001, 'invalid token');
    return;
  }

  console.log('[ws] 控制端已连接:', req.socket.remoteAddress);
  await refreshLogicalSize();
  ws.send(JSON.stringify({ type: 'info', size: getLogicalSize() }));

  let busy = false;
  const timer = setInterval(async () => {
    if (busy || ws.readyState !== ws.OPEN || ws.bufferedAmount > MAX_BUFFERED) return;
    busy = true;
    try {
      const frame = await captureFrame({ width: FRAME_WIDTH, quality: FRAME_QUALITY });
      ws.send(frame);
    } catch (err) {
      console.error('[capture] 采集失败:', err.message);
    } finally {
      busy = false;
    }
  }, FRAME_INTERVAL_MS);

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    try {
      await handleInputMessage(msg, { getLogicalSize, input });
    } catch (err) {
      console.error('[input] 注入失败:', err.message);
    }
  });

  ws.on('close', () => {
    clearInterval(timer);
    console.log('[ws] 控制端已断开');
  });
});

function getLanAddresses() {
  const result = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) result.push(net.address);
    }
  }
  return result;
}

server.listen(PORT, () => {
  console.log('================ 远程控制 MVP 已启动 ================');
  console.log(`访问口令 (TOKEN): ${TOKEN}`);
  console.log('在同一局域网的设备浏览器中打开下列任一地址：');
  console.log(`  本机:   http://localhost:${PORT}`);
  for (const ip of getLanAddresses()) {
    console.log(`  局域网: http://${ip}:${PORT}`);
  }
  console.log('打开后在页面输入上面的口令即可开始控制。');
  console.log('=====================================================');
});
