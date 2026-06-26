import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const startupDir = path.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup',
);
const nodeExe = process.execPath;
const launchScript = path.join(__dirname, 'launch.mjs');
const vbsName = '远程控制-开机启动.vbs';
const vbsPath = path.join(startupDir, vbsName);

const esc = (p) => p.replace(/\\/g, '\\\\');
const q = 'Chr(34)';
const cmd =
  `${q} & "${esc(nodeExe)}" & ${q} & " " & ${q} & "${esc(launchScript)}" & ${q} & " --boot"`;
const content = [
  'Set WshShell = CreateObject("WScript.Shell")',
  `WshShell.CurrentDirectory = "${esc(ROOT)}"`,
  `WshShell.Run ${cmd}, 0, False`,
  '',
].join('\r\n');

fs.writeFileSync(vbsPath, content, 'utf8');
console.log(`已安装开机自启: ${vbsPath}`);
console.log('下次登录后将静默启动（无黑框）。');
