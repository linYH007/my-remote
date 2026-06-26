import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktop = path.join(os.homedir(), 'Desktop');
const root = path.resolve(__dirname, '..');
const nodeExe = process.execPath;
const esc = (p) => p.replace(/\\/g, '\\\\');
const q = 'Chr(34)';

const vbs = [
  'Set WshShell = CreateObject("WScript.Shell")',
  `WshShell.CurrentDirectory = "${esc(root)}"`,
  'Dim msg, choice',
  'msg = "1 = Start" & vbCrLf & "2 = Stop" & vbCrLf & "3 = ngrok Setup" & vbCrLf & "4 = Cloud Setup"',
  'choice = InputBox(msg, "Remote Control", "1")',
  'If choice = "" Then WScript.Quit',
  'Select Case choice',
  'Case "1"',
  `  WshShell.Run ${q} & "${esc(nodeExe)}" & ${q} & " " & ${q} & "${esc(path.join(__dirname, 'launch.mjs'))}" & ${q}, 0, False`,
  'Case "2"',
  `  WshShell.Run ${q} & "${esc(nodeExe)}" & ${q} & " " & ${q} & "${esc(path.join(__dirname, 'stop.mjs'))}" & ${q}, 0, False`,
  'Case "3"',
  `  WshShell.Run ${q} & "${esc(path.join(__dirname, 'setup-once.cmd'))}" & ${q}, 1, False`,
  'Case "4"',
  `  WshShell.Run ${q} & "${esc(path.join(__dirname, 'setup-cloud.cmd'))}" & ${q}, 1, False`,
  'End Select',
  '',
].join('\r\n');

for (const f of fs.readdirSync(desktop)) {
  if (f.startsWith('远程控制') && (f.endsWith('.cmd') || f.endsWith('.vbs'))) {
    try { fs.unlinkSync(path.join(desktop, f)); } catch { /* ignore */ }
  }
}

fs.writeFileSync(path.join(desktop, '远程控制.vbs'), vbs, 'ascii');
console.log('已创建: 远程控制.vbs');
