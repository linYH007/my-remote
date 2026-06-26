import { screen } from '@nut-tree-fork/nut-js';
import sharp from 'sharp';

// 被控端屏幕逻辑尺寸（鼠标坐标系使用的坐标，受 DPI 缩放影响）。
// 注意：screen.grab() 返回的是物理像素，而鼠标定位用的是逻辑像素，
// 两者在开启了显示缩放（如 125%/150%）时并不相等，因此坐标映射必须基于逻辑尺寸。
let logicalSize = { width: 0, height: 0 };

export function getLogicalSize() {
  return logicalSize;
}

export async function refreshLogicalSize() {
  logicalSize = {
    width: await screen.width(),
    height: await screen.height(),
  };
  return logicalSize;
}

/**
 * 采集一帧屏幕并编码为 JPEG。
 * @param {{ width?: number, quality?: number }} opts
 *   width   - 缩放后的宽度（按比例缩放，控制带宽与帧率）
 *   quality - JPEG 质量 1-100
 * @returns {Promise<Buffer>} JPEG 二进制数据
 */
export async function captureFrame({ width = 1366, quality = 55 } = {}) {
  const image = await screen.grab();
  const rgb = await image.toRGB(); // nut-js 默认 BGRA，转换为 RGBA 供 sharp 正确编码

  return sharp(rgb.data, {
    raw: { width: rgb.width, height: rgb.height, channels: 4 },
  })
    .resize({ width, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality })
    .toBuffer();
}
