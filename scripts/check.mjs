import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const skipDirs = new Set(['.git', 'node_modules', 'logs']);
const checkedExts = new Set(['.js', '.mjs']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) walk(path.join(dir, entry.name), out);
      continue;
    }
    if (entry.isFile() && checkedExts.has(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function rel(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

function runSyntaxCheck(file) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error(`syntax check failed: ${rel(file)}`);
  }
}

const files = walk(root).sort((a, b) => rel(a).localeCompare(rel(b)));
for (const file of files) runSyntaxCheck(file);

const publicClient = fs.readFileSync(path.join(root, 'public', 'client.js'), 'utf8');
const cloudClient = fs.readFileSync(path.join(root, 'cloud-server', 'public', 'client.js'), 'utf8');
if (publicClient !== cloudClient) {
  throw new Error('public/client.js and cloud-server/public/client.js are out of sync');
}

console.log(`check ok (${files.length} JavaScript files)`);
