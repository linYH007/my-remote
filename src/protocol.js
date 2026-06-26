export function clamp01(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export async function handleInputMessage(msg, { getLogicalSize, input }) {
  const { width, height } = getLogicalSize();
  switch (msg.t) {
    case 'm':
      await input.moveMouse(clamp01(msg.nx) * width, clamp01(msg.ny) * height);
      break;
    case 'd':
      await input.moveMouse(clamp01(msg.nx) * width, clamp01(msg.ny) * height);
      await input.mouseDown(msg.b);
      break;
    case 'u':
      await input.mouseUp(msg.b);
      break;
    case 'w':
      await input.scroll(msg.dx | 0, msg.dy | 0);
      break;
    case 'kd':
      await input.keyDown(msg.code);
      break;
    case 'ku':
      await input.keyUp(msg.code);
      break;
  }
}
