import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// 检测前台窗口是否处于文本输入状态（有文本光标）
const PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class CaretHelper {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int L; public int T; public int R; public int B; }
  [StructLayout(LayoutKind.Sequential)]
  public struct GUITHREADINFO {
    public int cbSize; public int flags; public IntPtr hwndActive; public IntPtr hwndFocus;
    public IntPtr hwndCapture; public IntPtr hwndMenuOwner; public IntPtr hwndMoveSize;
    public IntPtr hwndCaret; public RECT rcCaret;
  }
  [DllImport("user32.dll")] public static extern bool GetGUIThreadInfo(int idThread, ref GUITHREADINFO gi);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
  public static bool HasTextCaret() {
    var gi = new GUITHREADINFO();
    gi.cbSize = Marshal.SizeOf(typeof(GUITHREADINFO));
    var hwnd = GetForegroundWindow();
    if (hwnd == IntPtr.Zero) return false;
    int pid;
    int tid = GetWindowThreadProcessId(hwnd, out pid);
    if (!GetGUIThreadInfo(tid, ref gi)) return false;
    if (gi.hwndCaret != IntPtr.Zero) return true;
    if (gi.hwndFocus != IntPtr.Zero) {
      var sb = new System.Text.StringBuilder(256);
      GetClassName(gi.hwndFocus, sb, 256);
      var cls = sb.ToString().ToUpperInvariant();
      if (cls.Contains("EDIT") || cls.Contains("RICHEDIT") || cls.Contains("TEXTBOX") || cls.Contains("COMBOBOX"))
        return true;
    }
    return false;
  }
}
"@
[CaretHelper]::HasTextCaret()
`;

export async function hasTextCaretFocus() {
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', PS],
      { timeout: 2500, windowsHide: true },
    );
    return stdout.trim().toLowerCase() === 'true';
  } catch {
    return false;
  }
}
