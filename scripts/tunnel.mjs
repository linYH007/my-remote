import fs from 'fs';
import path from 'path';
import http from 'http';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_URL_FILE = path.join(__dirname, '..', 'logs', 'public-url.json');
const CLIENT_INFO_FILE = path.join(__dirname, '..', 'logs', 'client-info.json');

let activeClose = null;

function saveInfo(info) {
  fs.mkdirSync(path.dirname(PUBLIC_URL_FILE), { recursive: true });
  fs.writeFileSync(PUBLIC_URL_FILE, JSON.stringify(info, null, 2));
}

export function saveClientInfo(info) {
  fs.mkdirSync(path.dirname(CLIENT_INFO_FILE), { recursive: true });
  fs.writeFileSync(CLIENT_INFO_FILE, JSON.stringify(info, null, 2));
}

function toSignalUrl(webUrl) {
  return webUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
}

function wrapResult(t, provider, permanent = false) {
  activeClose = () => {
    try { t.close?.(); } catch { /* ignore */ }
    try { t.stop?.(); } catch { /* ignore */ }
    try { t.proc?.kill(); } catch { /* ignore */ }
  };
  const info = {
    webUrl: t.webUrl.replace(/\/$/, ''),
    signalUrl: toSignalUrl(t.webUrl),
    provider,
    permanent,
    tunnelPid: t.tunnelPid || t.proc?.pid || null,
    updatedAt: new Date().toISOString(),
  };
  saveInfo(info);
  return info;
}

function waitNgrokLocalApi(domain, timeoutMs = 25000) {
  const host = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      const req = http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            const hit = json.tunnels?.find((t) => t.public_url?.includes(host));
            if (hit) {
              resolve(hit.public_url.replace(/\/$/, ''));
              return;
            }
          } catch { /* ignore */ }
          retry();
        });
      });
      req.on('error', retry);
      req.setTimeout(2000, () => req.destroy());
      function retry() {
        if (Date.now() >= deadline) reject(new Error('ngrok 尚未连上'));
        else setTimeout(poll, 1000);
      }
    };
    poll();
  });
}

function killProcessByName(name) {
  try {
    spawn('taskkill', ['/IM', `${name}.exe`, '/F'], { stdio: 'ignore', windowsHide: true });
  } catch { /* ignore */ }
}

function resolveCloudflaredExe() {
  if (process.env.CLOUDFLARED_PATH && fs.existsSync(process.env.CLOUDFLARED_PATH)) {
    return process.env.CLOUDFLARED_PATH;
  }
  const winget = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft', 'WinGet', 'Packages',
    'Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe',
    'cloudflared.exe',
  );
  if (fs.existsSync(winget)) return winget;
  return 'cloudflared';
}

async function startNgrokWithTimeout(port, authtoken, domain, timeoutMs = 8000) {
  return Promise.race([
    startNgrokFixed(port, authtoken, domain),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('ngrok 连接超时（未开 TUN 时正常，将自动切换备用通道）')), timeoutMs);
    }),
  ]);
}

/** ngrok 后台常驻：即使暂时连不上也持续重试 */
function startNgrokDetached(port, domain) {
  const host = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const logPath = path.join(__dirname, '..', 'logs', 'ngrok-cli.log');
  killProcessByName('ngrok');
  const out = fs.openSync(logPath, 'a');
  const proc = spawn('ngrok', ['http', String(port), `--domain=${host}`, '--log=stdout'], {
    stdio: ['ignore', out, out],
    windowsHide: true,
    detached: true,
  });
  proc.unref();
  return {
    webUrl: `https://${host}`,
    signalUrl: `wss://${host}`,
    close: () => { try { proc.kill(); } catch { /* ignore */ } },
    stop: () => { try { proc.kill(); } catch { /* ignore */ } },
    proc,
    tunnelPid: proc.pid,
    pending: true,
  };
}

/** ngrok 固定域名：优先等待 CLI 连上，失败则后台继续重试 */
async function startNgrokCli(port, domain) {
  const detached = startNgrokDetached(port, domain);
  try {
    const webUrl = await waitNgrokLocalApi(domain, 18000);
    return { ...detached, webUrl, signalUrl: toSignalUrl(webUrl), pending: false };
  } catch {
    return detached;
  }
}

/** ngrok 固定域名：用内置 SDK 直接连接（TUN 模式下可绕过墙，且不受旧 CLI 版本限制） */
async function startNgrokFixed(port, authtoken, domain) {
  const ngrok = await import('@ngrok/ngrok');
  const listener = await ngrok.forward({
    addr: Number(port),
    authtoken,
    domain: domain.replace(/^https?:\/\//, '').replace(/\/$/, ''),
  });
  const webUrl = listener.url().replace(/\/$/, '');
  return {
    webUrl,
    signalUrl: toSignalUrl(webUrl),
    close: () => listener.close(),
    stop: () => listener.close(),
    pending: false,
  };
}

function waitCloudflaredUrl(logPath, timeoutMs = 60000, getText = null) {
  const re = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const poll = () => {
      try {
        const text = getText ? getText() : fs.readFileSync(logPath, 'utf8');
        const m = text.match(re);
        if (m) {
          resolve(m[0].replace(/\/$/, ''));
          return;
        }
      } catch { /* ignore */ }
      if (Date.now() >= deadline) reject(new Error('Cloudflare 隧道超时'));
      else setTimeout(poll, 500);
    };
    poll();
  });
}

/** Cloudflare 快速隧道（国内网络通常可用，但地址每次启动会变） */
async function startCloudflaredCli(port) {
  killProcessByName('cloudflared');
  const logPath = path.join(__dirname, '..', 'logs', 'cloudflared.log');
  fs.writeFileSync(logPath, `[${new Date().toISOString()}] starting\n`);
  let captured = '';
  const append = (buf) => {
    const s = buf.toString();
    captured += s;
    fs.appendFileSync(logPath, s);
  };
  const cfExe = resolveCloudflaredExe();
  const proc = spawn(cfExe, ['tunnel', '--url', `http://127.0.0.1:${port}`, '--loglevel', 'info'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  proc.stdout.on('data', append);
  proc.stderr.on('data', append);
  proc.on('error', (e) => {
    if (e.code === 'ENOENT') throw new Error('未安装 cloudflared，请运行 winget install Cloudflare.cloudflared');
  });
  const webUrl = await waitCloudflaredUrl(logPath, 90000, () => captured);
  proc.unref();
  return {
    webUrl,
    signalUrl: toSignalUrl(webUrl),
    close: () => { try { proc.kill(); } catch { /* ignore */ } },
    stop: () => { try { proc.kill(); } catch { /* ignore */ } },
    proc,
    tunnelPid: proc.pid,
    pending: false,
  };
}

/**
 * @param {string|number} port
 * @param {{ ngrokToken?: string, ngrokDomain?: string, allowRandom?: boolean, mode?: string }} opts
 * mode: auto=先ngrok后cloudflare | ngrok=仅ngrok | cloudflare=仅cloudflare(无需TUN)
 */
export async function startFreeTunnel(port, opts = {}) {
  const {
    ngrokToken,
    ngrokDomain,
    allowRandom = false,
    mode = 'auto',
    cloudflareFallback = false,
  } = opts;
  const errors = [];
  const host = ngrokDomain?.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const tunnelMode = mode || (cloudflareFallback ? 'auto' : 'auto');

  if (tunnelMode === 'cloudflare') {
    const t = await startCloudflaredCli(port);
    return wrapResult(t, 'cloudflare', false);
  }

  if (ngrokToken && ngrokDomain && tunnelMode !== 'cloudflare') {
    try {
      const t = await startNgrokWithTimeout(port, ngrokToken, ngrokDomain, 8000);
      return wrapResult(t, 'ngrok-fixed', true);
    } catch (e) {
      errors.push(`ngrok: ${e.message}`);
      if (tunnelMode === 'ngrok') {
        throw new Error(errors.join('；'));
      }
    }
  }

  if (tunnelMode === 'auto' || allowRandom || tunnelMode === 'cloudflare') {
    try {
      const t = await startCloudflaredCli(port);
      const info = wrapResult(t, 'cloudflare', false);
      if (host) info.ngrokPendingUrl = `https://${host}`;
      info.note = 'Cloudflare 出站隧道，无需 TUN；重启后地址可能变化';
      return info;
    } catch (e) {
      errors.push(`Cloudflare: ${e.message}`);
    }
  }

  throw new Error(
    errors.length ? `${errors.join('；')}` : '未配置公网穿透。请检查 TUNNEL_MODE 或运行首次配置。',
  );
}

export function readPublicUrlFile() {
  try {
    return JSON.parse(fs.readFileSync(PUBLIC_URL_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function readClientInfoFile() {
  try {
    return JSON.parse(fs.readFileSync(CLIENT_INFO_FILE, 'utf8'));
  } catch {
    return null;
  }
}

export function clearPublicUrlFile() {
  try { fs.unlinkSync(PUBLIC_URL_FILE); } catch { /* ignore */ }
  try { fs.unlinkSync(CLIENT_INFO_FILE); } catch { /* ignore */ }
}

export function stopTunnelProcess() {
  if (activeClose) {
    try { activeClose(); } catch { /* ignore */ }
    activeClose = null;
  }
  const info = readPublicUrlFile();
  if (info?.tunnelPid) {
    try {
      spawn('taskkill', ['/PID', String(info.tunnelPid), '/F', '/T'], { stdio: 'ignore', windowsHide: true });
    } catch { /* ignore */ }
  }
  killProcessByName('ngrok');
  killProcessByName('cloudflared');
  clearPublicUrlFile();
}
