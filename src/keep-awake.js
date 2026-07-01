import { spawn } from 'child_process';

let keepAwakeChild = null;
let hooksInstalled = false;

function envDisabled(name) {
  return /^(0|false|off|no)$/i.test(String(process.env[name] || '').trim());
}

function numberFromEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function installShutdownHooks() {
  if (hooksInstalled) return;
  hooksInstalled = true;
  process.once('exit', stopKeepAwake);
  process.once('SIGINT', () => {
    stopKeepAwake();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    stopKeepAwake();
    process.exit(143);
  });
}

export function startKeepAwake(label = 'remote-control') {
  if (process.platform !== 'win32' || envDisabled('KEEP_AWAKE')) return false;
  if (keepAwakeChild) return true;

  const intervalSeconds = numberFromEnv('KEEP_AWAKE_INTERVAL_SECONDS', 30, 5, 300);
  const requireDisplay = !envDisabled('KEEP_AWAKE_DISPLAY');
  const displayFlag = requireDisplay ? ' -bor $ES_DISPLAY_REQUIRED' : '';

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$parentId = ${process.pid}
$intervalSeconds = ${intervalSeconds}
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NativePower {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
}
"@
$ES_CONTINUOUS = [uint32]0x80000000
$ES_SYSTEM_REQUIRED = [uint32]0x00000001
$ES_DISPLAY_REQUIRED = [uint32]0x00000002
$flags = $ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED${displayFlag}
try {
  while (Get-Process -Id $parentId -ErrorAction SilentlyContinue) {
    [NativePower]::SetThreadExecutionState($flags) | Out-Null
    Start-Sleep -Seconds $intervalSeconds
  }
} finally {
  [NativePower]::SetThreadExecutionState($ES_CONTINUOUS) | Out-Null
}
`;

  keepAwakeChild = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], {
    stdio: 'ignore',
    windowsHide: true,
  });

  const child = keepAwakeChild;
  child.once('error', (err) => {
    if (keepAwakeChild === child) keepAwakeChild = null;
    console.warn(`[awake] failed to start keep-awake helper: ${err.message}`);
  });
  child.once('exit', () => {
    if (keepAwakeChild === child) keepAwakeChild = null;
  });

  installShutdownHooks();
  console.log(`[awake] keep-awake enabled for ${label}${requireDisplay ? ' (system + display)' : ' (system)'}`);
  return true;
}

export function stopKeepAwake() {
  const child = keepAwakeChild;
  keepAwakeChild = null;
  if (child && !child.killed) {
    try { child.kill(); } catch { /* ignore */ }
  }
}
