import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { startFreeTunnel, saveClientInfo, readPublicUrlFile } from './tunnel.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'config.cmd');
const LOG = path.join(__dirname, '..', 'logs', 'tunnel-watch.log');

function log(msg) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
}

function parseConfig() {
  const cfg = {};
  const text = fs.readFileSync(CONFIG_PATH, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*set\s+"?(\w+)=([^"]*)"?/i);
    if (m) cfg[m[1]] = m[2].trim();
  }
  return cfg;
}

async function main() {
  const cfg = parseConfig();
  const port = cfg.PORT || '8080';
  log('tunnel-watch 启动');

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      log(`第 ${attempt}/${maxAttempts} 次尝试建立隧道…`);
      const info = await startFreeTunnel(port, {
        ngrokToken: cfg.NGROK_AUTHTOKEN,
        ngrokDomain: cfg.NGROK_DOMAIN,
        mode: cfg.TUNNEL_MODE || 'auto',
        allowRandom: cfg.USE_TUNNEL === '1',
      });
      saveClientInfo({
        controlUrl: info.webUrl,
        room: cfg.ROOM,
        permanent: info.permanent,
        provider: info.provider,
        ngrokPendingUrl: info.ngrokPendingUrl || cfg.CONTROL_URL,
        updatedAt: new Date().toISOString(),
        hint: info.provider === 'cloudflare'
          ? 'Cloudflare 出站隧道，无需 TUN；重启后地址可能变化'
          : '请将此地址加入手机书签。',
      });
      log(`隧道就绪 ${info.provider} ${info.webUrl}`);
      setInterval(() => {}, 1 << 30);
      return;
    } catch (e) {
      log(`第 ${attempt} 次失败: ${e.message}`);
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, 5000));
    }
  }
  log('所有尝试均失败，进程退出');
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  try {
    process.on(sig, () => { log(`收到 ${sig}，退出`); process.exit(0); });
  } catch { /* ignore */ }
}

main();
