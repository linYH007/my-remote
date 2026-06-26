import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';

/** 弹出 Windows 消息框（双击 VBS 启动时给用户可见反馈） */
export function showNotify(title, message, icon = 'Information') {
  const msgFile = path.join(os.tmpdir(), `rc-notify-${Date.now()}.txt`);
  fs.writeFileSync(msgFile, message, 'utf8');
  const esc = (s) => s.replace(/'/g, "''");
  const ps = [
    'Add-Type -AssemblyName System.Windows.Forms',
    `$msg = Get-Content -LiteralPath '${esc(msgFile)}' -Raw -Encoding UTF8`,
    `[System.Windows.Forms.MessageBox]::Show($msg, '${esc(title)}', 'OK', '${icon}') | Out-Null`,
    `Remove-Item -LiteralPath '${esc(msgFile)}' -Force -ErrorAction SilentlyContinue`,
  ].join('; ');
  spawn('powershell', ['-NoProfile', '-Command', ps], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}
