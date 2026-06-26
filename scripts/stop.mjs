import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { stopTunnelProcess, clearPublicUrlFile } from './tunnel.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PID_FILE = path.join(ROOT, 'logs', 'pids.json');

function parseConfig() {
  const cfg = {};
  const text = fs.readFileSync(path.join(__dirname, 'config.cmd'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*set\s+"?(\w+)=([^"]*)"?/i);
    if (m) cfg[m[1]] = m[2].trim();
  }
  return cfg;
}

function killPort(port) {
  try {
    execSync(
      `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }"`,
      { stdio: 'ignore' },
    );
  } catch { /* ignore */ }
}

try {
  const pids = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
  for (const pid of Object.values(pids)) {
    try {
      execSync(`taskkill /PID ${pid} /F /T`, { stdio: 'ignore' });
    } catch { /* ignore */ }
  }
} catch { /* ignore */ }

const cfg = parseConfig();
killPort(Number(cfg.PORT) || 8080);
stopTunnelProcess();
clearPublicUrlFile();

try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }

console.log('远程控制服务已停止。');
