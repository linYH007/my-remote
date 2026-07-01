import { spawn } from 'child_process';

let lastWakeAt = 0;
let wakePromise = null;

function envDisabled(name) {
  return /^(0|false|off|no)$/i.test(String(process.env[name] || '').trim());
}

function numberFromEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function wakeScreen(reason = 'remote input', { force = false } = {}) {
  if (process.platform !== 'win32' || envDisabled('WAKE_SCREEN')) {
    return Promise.resolve(false);
  }

  const now = Date.now();
  const minInterval = numberFromEnv('WAKE_SCREEN_MIN_INTERVAL_MS', 1500, 250, 10000);
  if (!force && now - lastWakeAt < minInterval) {
    return Promise.resolve(false);
  }
  lastWakeAt = now;

  if (wakePromise) return wakePromise;

  const timeoutMs = numberFromEnv('WAKE_SCREEN_TIMEOUT_MS', 1800, 500, 5000);
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class NativeWake {
  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern uint SetThreadExecutionState(uint esFlags);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, UIntPtr dwExtraInfo);
  [DllImport("user32.dll", SetLastError = true)]
  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
"@
$ES_CONTINUOUS = [uint32]0x80000000
$ES_SYSTEM_REQUIRED = [uint32]0x00000001
$ES_DISPLAY_REQUIRED = [uint32]0x00000002
$MOUSEEVENTF_MOVE = [uint32]0x0001
$KEYEVENTF_KEYUP = [uint32]0x0002
$VK_SHIFT = [byte]0x10
[NativeWake]::SetThreadExecutionState($ES_CONTINUOUS -bor $ES_SYSTEM_REQUIRED -bor $ES_DISPLAY_REQUIRED) | Out-Null
[NativeWake]::mouse_event($MOUSEEVENTF_MOVE, 1, 1, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 35
[NativeWake]::mouse_event($MOUSEEVENTF_MOVE, -1, -1, 0, [UIntPtr]::Zero)
[NativeWake]::keybd_event($VK_SHIFT, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 35
[NativeWake]::keybd_event($VK_SHIFT, 0, $KEYEVENTF_KEYUP, [UIntPtr]::Zero)
`;

  wakePromise = new Promise((resolve) => {
    const child = spawn('powershell.exe', [
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

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* ignore */ }
      wakePromise = null;
      resolve(false);
    }, timeoutMs);

    child.once('error', (err) => {
      clearTimeout(timer);
      wakePromise = null;
      console.warn(`[wake] failed to wake screen for ${reason}: ${err.message}`);
      resolve(false);
    });

    child.once('exit', () => {
      clearTimeout(timer);
      wakePromise = null;
      resolve(true);
    });
  });

  return wakePromise;
}

export function wakeScreenSoon(reason = 'remote input', options = {}) {
  wakeScreen(reason, options).catch((err) => {
    console.warn(`[wake] failed to wake screen for ${reason}: ${err.message}`);
  });
}
