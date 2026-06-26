import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

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

let removed = 0;
for (const f of fs.readdirSync(startupDir)) {
  if (f.includes('远程控制') && (f.endsWith('.lnk') || f.endsWith('.vbs'))) {
    fs.unlinkSync(path.join(startupDir, f));
    console.log(`已移除: ${f}`);
    removed++;
  }
}
console.log(removed ? '开机自启已取消。' : '未找到开机自启项。');
