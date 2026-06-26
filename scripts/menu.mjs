import { spawn, execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const nodeExe = process.execPath;

function runHidden(script, args = []) {
  spawn(nodeExe, [path.join(__dirname, script), ...args], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

function runVisibleCmd(cmdPath) {
  spawn('cmd', ['/c', 'call', path.join(__dirname, cmdPath)], {
    cwd: ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  }).unref();
}

const ps = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$f = New-Object System.Windows.Forms.Form
$f.Text = '远程控制'
$f.Size = New-Object System.Drawing.Size(300, 280)
$f.StartPosition = 'CenterScreen'
$f.FormBorderStyle = 'FixedDialog'
$f.MaximizeBox = $false
$f.MinimizeBox = $false
$buttons = @(
  @{ Text = '启动远程控制'; Y = 20; Action = 'start' },
  @{ Text = '停止远程控制'; Y = 65; Action = 'stop' },
  @{ Text = 'ngrok 首次配置'; Y = 110; Action = 'setup' },
  @{ Text = '云服务器配置'; Y = 155; Action = 'cloud' }
)
foreach ($b in $buttons) {
  $btn = New-Object System.Windows.Forms.Button
  $btn.Text = $b.Text
  $btn.Size = New-Object System.Drawing.Size(240, 32)
  $btn.Location = New-Object System.Drawing.Point(24, $b.Y)
  $btn.Tag = $b.Action
  $btn.Add_Click({
    $f.Tag = $this.Tag
    $f.Close()
  })
  $f.Controls.Add($btn)
}
$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = '取消'
$cancel.Size = New-Object System.Drawing.Size(240, 32)
$cancel.Location = New-Object System.Drawing.Point(24, 200)
$cancel.Add_Click({ $f.Tag = 'cancel'; $f.Close() })
$f.Controls.Add($cancel)
[void]$f.ShowDialog()
Write-Output $f.Tag
`;

let action = 'cancel';
try {
  action = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-STA', '-Command', ps],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true },
  ).trim();
} catch (e) {
  if (e.stdout) action = String(e.stdout).trim();
}

switch (action) {
  case 'start': runHidden('launch.mjs'); break;
  case 'stop': runHidden('stop.mjs'); break;
  case 'setup': runVisibleCmd('setup-once.cmd'); break;
  case 'cloud': runVisibleCmd('setup-cloud.cmd'); break;
  default: break;
}
