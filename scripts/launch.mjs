import fs from 'fs';
import path from 'path';
import http from 'http';
import net from 'net';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  startFreeTunnel,
  clearPublicUrlFile,
  stopTunnelProcess,
  saveClientInfo,
  readPublicUrlFile,
} from './tunnel.mjs';
import { showNotify } from './notify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');
const PID_FILE = path.join(LOG_DIR, 'pids.json');
const CONFIG_PATH = path.join(__dirname, 'config.cmd');

function parseConfig() {
  const cfg = {};
  const text = fs.readFileSync(CONFIG_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*set\s+"?(\w+)=([^"]*)"?/i);
    if (m) cfg[m[1]] = m[2].trim();
  }
  return cfg;
}

function isRemoteControlUrl(url) {
  return url && !/localhost|127\.0\.0\.1/i.test(url);
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function logFile(name) {
  return path.join(LOG_DIR, name);
}

function spawnHidden(name, args, env) {
  const out = fs.openSync(logFile(`${name}.log`), 'a');
  const err = fs.openSync(logFile(`${name}.err.log`), 'a');
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', out, err],
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

function killPort(port) {
  try {
    execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' },
    );
  } catch { /* ignore */ }
}

function loadPids() {
  try {
    return JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function savePids(pids) {
  fs.writeFileSync(PID_FILE, JSON.stringify(pids, null, 2));
}

function stopExisting(cfg) {
  const pids = loadPids();
  for (const pid of Object.values(pids)) {
    if (!pid) continue;
    try {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    } catch { /* ignore */ }
  }
  if (cfg.ROLE !== 'host-only') killPort(Number(cfg.PORT) || 8080);
  stopTunnelProcess();
  clearPublicUrlFile();
  savePids({});
}

function waitForHttp(port, maxSec = 30) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tick = () => {
      const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else if (++n >= maxSec) reject(new Error('timeout'));
        else setTimeout(tick, 1000);
      });
      req.on('error', () => {
        if (++n >= maxSec) reject(new Error('timeout'));
        else setTimeout(tick, 1000);
      });
      req.setTimeout(1500, () => req.destroy());
    };
    tick();
  });
}

function openBrowser(url) {
  spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function probePort(port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on('error', () => resolve(false));
    sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve(false); });
  });
}

// 自动探测本机 HTTP 代理（Clash/V2Ray 等），供跨网络连云端时出站使用
async function detectProxy(cfg) {
  if (cfg.PROXY_URL) return cfg.PROXY_URL;
  for (const p of [7897, 7890, 7891, 2080, 8889, 1087]) {
    if (await probePort(p)) return `http://127.0.0.1:${p}`;
  }
  return '';
}

function waitTunnelOnline(timeoutMs = 60000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const info = readPublicUrlFile();
      if (info?.provider === 'ngrok-fixed' && info.webUrl) return resolve(info);
      if (info?.provider === 'cloudflare' && info.webUrl) return resolve(info);
      if (Date.now() >= deadline) return resolve(null);
      setTimeout(tick, 1500);
    };
    tick();
  });
}

function buildShareLink(webBase, cfg) {
  const base = webBase.replace(/\/$/, '');
  return `${base}/?mode=remote&room=${encodeURIComponent(cfg.ROOM)}&token=${encodeURIComponent(cfg.TOKEN)}&auto=1`;
}

function persistClientInfo(cfg, controlUrl, permanent) {
  saveClientInfo({
    controlUrl: controlUrl.replace(/\/$/, ''),
    room: cfg.ROOM,
    permanent: !!permanent,
    updatedAt: new Date().toISOString(),
    hint: permanent
      ? '请将此地址加入手机书签，每次打开后输入设备码和密码即可，地址不会变。'
      : '地址可能变化，建议完成「首次配置」设置固定域名。',
  });
}

async function main() {
  const bootOnly = process.argv.includes('--boot');
  const cfg = parseConfig();
  ensureLogDir();
  stopExisting(cfg);

  const port = cfg.PORT || '8080';
  const role = cfg.ROLE || 'full';
  let webBase = cfg.CONTROL_URL || cfg.WEB_URL;
  let signalingPid = null;
  let tunnelInfo = null;
  let tunnelError = null;
  let tunnelWatchPid = null;

  if (role === 'host-only') {
    if (!isRemoteControlUrl(cfg.SIGNAL_URL)) {
      console.error('host-only 模式请在 config.cmd 设置远程 SIGNAL_URL');
      process.exit(1);
    }
    webBase = cfg.CONTROL_URL || cfg.SIGNAL_URL.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
    persistClientInfo(cfg, webBase, true);
  } else {
    signalingPid = spawnHidden('signaling', ['signaling/server.js'], { PORT: port });
    try {
      await waitForHttp(port);
    } catch {
      console.error('信令服务器启动失败，详见 logs/signaling.err.log');
      process.exit(1);
    }

    if (cfg.NGROK_AUTHTOKEN && cfg.NGROK_DOMAIN) {
      fs.appendFileSync(logFile('tunnel.log'), `[${new Date().toISOString()}] 后台启动隧道(mode=${cfg.TUNNEL_MODE || 'auto'})…\n`);
      tunnelWatchPid = spawnHidden('tunnel-watch', ['scripts/tunnel-watch.mjs']);
      webBase = cfg.WEB_URL || `http://127.0.0.1:${port}`;
      persistClientInfo(cfg, webBase, false);
      tunnelError = '正在建立公网隧道…';
    } else if (cfg.TUNNEL_MODE === 'cloudflare' || cfg.USE_TUNNEL === '1') {
      try {
        tunnelWatchPid = spawnHidden('tunnel-watch', ['scripts/tunnel-watch.mjs']);
        webBase = cfg.WEB_URL || `http://127.0.0.1:${port}`;
        tunnelError = '正在建立 Cloudflare 隧道…';
      } catch (e) {
        fs.appendFileSync(logFile('tunnel.err.log'), `[${new Date().toISOString()}] ${e.message}\n`);
      }
    } else if (isRemoteControlUrl(cfg.CONTROL_URL)) {
      webBase = cfg.CONTROL_URL;
      persistClientInfo(cfg, webBase, true);
    } else {
      persistClientInfo(cfg, webBase, false);
    }
  }

  const hostSignal = role === 'host-only'
    ? cfg.SIGNAL_URL
    : `ws://127.0.0.1:${port}`;

  // 跨网络(host-only)时，被控端经本机代理出站连云端，无需 TUN
  let proxyUrl = '';
  if (role === 'host-only' || /^wss:/i.test(hostSignal)) {
    proxyUrl = await detectProxy(cfg);
    if (proxyUrl) {
      fs.appendFileSync(logFile('tunnel.log'), `[${new Date().toISOString()}] 被控端将经代理出站: ${proxyUrl}\n`);
    }
  }

  const hostPid = spawnHidden('host', ['src/remote-host.js'], {
    SIGNAL_URL: hostSignal,
    ROOM: cfg.ROOM,
    TOKEN: cfg.TOKEN,
    PROXY_URL: proxyUrl,
  });

  savePids({
    signaling: signalingPid,
    host: hostPid,
    tunnelWatch: tunnelWatchPid || null,
    tunnel: tunnelInfo?.tunnelPid || null,
    ngrok: tunnelInfo?.ngrokPid || null,
  });

  const publicUrl = (cfg.CONTROL_URL || tunnelInfo?.webUrl || webBase || '').replace(/\/$/, '');
  const localUrl = (cfg.WEB_URL || `http://127.0.0.1:${port}`).replace(/\/$/, '');

  if (!bootOnly) {
    await new Promise((r) => setTimeout(r, 2000));
    // 云服务器模式：电脑是被控端，控制页在云端，不在本机打开
    if (role !== 'host-only') {
      const openUrl = `${localUrl}/?mode=remote&room=${encodeURIComponent(cfg.ROOM)}&token=${encodeURIComponent(cfg.TOKEN)}&auto=1`;
      openBrowser(openUrl);
    }

    const tunnel = role === 'host-only' ? null : await waitTunnelOnline(120000);

    if (role === 'host-only') {
      showNotify(
        '远程控制已启动（云服务器模式）',
        [
          `手机地址: ${publicUrl}`,
          '',
          `设备码: ${cfg.ROOM}`,
          `密码: ${cfg.TOKEN}`,
          '',
          '无需 TUN，电脑主动连到云服务器。',
        ].join('\r\n'),
      );
    } else if (tunnel?.provider === 'ngrok-fixed') {
      tunnelError = null;
      showNotify(
        '远程控制已启动',
        [
          `公网地址: ${tunnel.webUrl}`,
          '',
          `设备码: ${cfg.ROOM}`,
          `密码: ${cfg.TOKEN}`,
          '',
          '手机收藏此地址即可，地址永久不变。',
        ].join('\r\n'),
      );
    } else if (tunnel?.provider === 'cloudflare') {
      tunnelError = null;
      showNotify(
        '远程控制已启动（无需 TUN）',
        [
          `手机请访问: ${tunnel.webUrl}`,
          '',
          `设备码: ${cfg.ROOM}`,
          `密码: ${cfg.TOKEN}`,
          '',
          '此地址由 Cloudflare 出站隧道提供，无需开 TUN。',
          '注意：每次重启电脑后地址可能变化，',
          '弹窗里的地址以本次为准，或查看 logs/public-url.json。',
          '',
          '如需永久固定地址：运行「远程控制-云服务器配置.cmd」',
        ].join('\r\n'),
      );
    } else {
      showNotify(
        '远程控制 - 公网隧道未建立',
        [
          '本地服务已运行，但公网隧道未能建立。',
          '',
          `局域网: ${localUrl}`,
          `设备码: ${cfg.ROOM}  密码: ${cfg.TOKEN}`,
          '',
          '可尝试：双击停止后重新启动，',
          '或运行「远程控制-云服务器配置.cmd」使用固定云地址。',
        ].join('\r\n'),
        'Warning',
      );
    }

    const activePublicUrl = tunnel?.webUrl || publicUrl || localUrl;
    const permanent = tunnel?.permanent || tunnel?.provider === 'ngrok-fixed' || role === 'host-only';
    try {
      const clip = [
        '【远程控制 - 连接信息】',
        '',
        `① 手机浏览器访问:`,
        activePublicUrl,
        '',
        `② 每次输入:`,
        `   设备码: ${cfg.ROOM}`,
        `   密码: ${cfg.TOKEN}`,
        '',
        tunnel?.provider === 'cloudflare'
          ? 'Cloudflare 地址，重启后可能变化，以弹窗为准。'
          : tunnel?.provider === 'ngrok-fixed'
            ? '地址已固定，重启后仍用同一链接。'
            : permanent ? '地址已固定。' : '请查看弹窗获取最新公网地址。',
      ].join('\r\n');
      spawn('powershell', ['-NoProfile', '-Command', `Set-Clipboard -Value '${clip.replace(/'/g, "''")}'`], {
        stdio: 'ignore',
        windowsHide: true,
      }).unref();
    } catch { /* ignore */ }
  }
}

main().catch((e) => {
  showNotify('远程控制启动失败', e.message, 'Error');
  console.error(e.message);
  process.exit(1);
});
