import { mouse, keyboard, Button, Key, Point } from '@nut-tree-fork/nut-js';

// 关闭动作之间的人为延迟，降低远程操作延迟。
try {
  mouse.config.autoDelayMs = 0;
  keyboard.config.autoDelayMs = 0;
  mouse.config.mouseSpeed = 99999; // 让 setPosition 近似瞬移
} catch {
  // 某些版本字段名不同，失败可忽略，不影响基本功能。
}

const buttonMap = {
  left: Button.LEFT,
  middle: Button.MIDDLE,
  right: Button.RIGHT,
};

// 浏览器 KeyboardEvent.code -> nut-js Key 的映射。
const codeToKey = {
  Escape: Key.Escape,
  F1: Key.F1, F2: Key.F2, F3: Key.F3, F4: Key.F4, F5: Key.F5, F6: Key.F6,
  F7: Key.F7, F8: Key.F8, F9: Key.F9, F10: Key.F10, F11: Key.F11, F12: Key.F12,
  Backquote: Key.Grave,
  Digit1: Key.Num1, Digit2: Key.Num2, Digit3: Key.Num3, Digit4: Key.Num4, Digit5: Key.Num5,
  Digit6: Key.Num6, Digit7: Key.Num7, Digit8: Key.Num8, Digit9: Key.Num9, Digit0: Key.Num0,
  Minus: Key.Minus, Equal: Key.Equal, Backspace: Key.Backspace,
  Tab: Key.Tab,
  KeyQ: Key.Q, KeyW: Key.W, KeyE: Key.E, KeyR: Key.R, KeyT: Key.T, KeyY: Key.Y,
  KeyU: Key.U, KeyI: Key.I, KeyO: Key.O, KeyP: Key.P,
  BracketLeft: Key.LeftBracket, BracketRight: Key.RightBracket, Backslash: Key.Backslash,
  CapsLock: Key.CapsLock,
  KeyA: Key.A, KeyS: Key.S, KeyD: Key.D, KeyF: Key.F, KeyG: Key.G, KeyH: Key.H,
  KeyJ: Key.J, KeyK: Key.K, KeyL: Key.L, Semicolon: Key.Semicolon, Quote: Key.Quote,
  Enter: Key.Enter,
  ShiftLeft: Key.LeftShift, ShiftRight: Key.RightShift,
  KeyZ: Key.Z, KeyX: Key.X, KeyC: Key.C, KeyV: Key.V, KeyB: Key.B, KeyN: Key.N, KeyM: Key.M,
  Comma: Key.Comma, Period: Key.Period, Slash: Key.Slash,
  ControlLeft: Key.LeftControl, ControlRight: Key.RightControl,
  AltLeft: Key.LeftAlt, AltRight: Key.RightAlt,
  MetaLeft: Key.LeftSuper, MetaRight: Key.RightSuper,
  Space: Key.Space,
  ContextMenu: Key.Menu,
  Insert: Key.Insert, Delete: Key.Delete, Home: Key.Home, End: Key.End,
  PageUp: Key.PageUp, PageDown: Key.PageDown,
  ArrowUp: Key.Up, ArrowDown: Key.Down, ArrowLeft: Key.Left, ArrowRight: Key.Right,
  NumLock: Key.NumLock, ScrollLock: Key.ScrollLock, Pause: Key.Pause, PrintScreen: Key.Print,
  Numpad0: Key.NumPad0, Numpad1: Key.NumPad1, Numpad2: Key.NumPad2, Numpad3: Key.NumPad3,
  Numpad4: Key.NumPad4, Numpad5: Key.NumPad5, Numpad6: Key.NumPad6, Numpad7: Key.NumPad7,
  Numpad8: Key.NumPad8, Numpad9: Key.NumPad9,
  NumpadAdd: Key.Add, NumpadSubtract: Key.Subtract, NumpadMultiply: Key.Multiply,
  NumpadDivide: Key.Divide, NumpadDecimal: Key.Decimal, NumpadEnter: Key.Enter,
};

export async function moveMouse(x, y) {
  await mouse.setPosition(new Point(Math.round(x), Math.round(y)));
}

export async function mouseDown(button = 'left') {
  await mouse.pressButton(buttonMap[button] ?? Button.LEFT);
}

export async function mouseUp(button = 'left') {
  await mouse.releaseButton(buttonMap[button] ?? Button.LEFT);
}

/**
 * 滚轮滚动，dx/dy 为滚动步数（已在控制端归一化为较小整数）。
 */
export async function scroll(dx = 0, dy = 0) {
  if (dy > 0) await mouse.scrollDown(dy);
  else if (dy < 0) await mouse.scrollUp(-dy);
  if (dx > 0) await mouse.scrollRight(dx);
  else if (dx < 0) await mouse.scrollLeft(-dx);
}

export async function keyDown(code) {
  const key = codeToKey[code];
  if (key !== undefined) await keyboard.pressKey(key);
}

export async function keyUp(code) {
  const key = codeToKey[code];
  if (key !== undefined) await keyboard.releaseKey(key);
}
