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
 * @param {{ width?: number, quality?: number, region?: {x0:number,y0:number,vw:number,vh:number}|null }} opts
 *   width   - 目标宽度上限（按比例缩放，控制带宽与帧率，绝不放大）
 *   quality - JPEG 质量 1-100
 *   region  - 归一化裁剪区域 [0,1]，用于放大时只发送可视区域，保留原生清晰度
 * @returns {Promise<Buffer>} JPEG 二进制数据
 */
export async function captureFrame({ width = 1366, quality = 55, region = null } = {}) {
  const image = await screen.grab();
  const rgb = await image.toRGB(); // nut-js 默认 BGRA，转换为 RGBA 供 sharp 正确编码

  let pipeline = sharp(rgb.data, {
    raw: { width: rgb.width, height: rgb.height, channels: 4 },
  });

  let targetWidth = width;
  let subsampling = '4:2:0';

  if (region) {
    const rx = Math.max(0, Math.min(1, region.x0 ?? 0));
    const ry = Math.max(0, Math.min(1, region.y0 ?? 0));
    const rw = Math.max(0.05, Math.min(1, region.vw ?? 1));
    const rh = Math.max(0.05, Math.min(1, region.vh ?? 1));
    const left = Math.round(rx * rgb.width);
    const top = Math.round(ry * rgb.height);
    let cw = Math.round(rw * rgb.width);
    let ch = Math.round(rh * rgb.height);
    cw = Math.min(cw, rgb.width - left);
    ch = Math.min(ch, rgb.height - top);
    if (cw > 8 && ch > 8 && (cw < rgb.width || ch < rgb.height)) {
      pipeline = pipeline.extract({ left, top, width: cw, height: ch });
      // 放大区域：按原生像素发送（不放大），并用 4:4:4 保留文字锐度
      targetWidth = Math.min(width, cw);
      subsampling = '4:4:4';
    }
  }

  return pipeline
    .resize({ width: targetWidth, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true, chromaSubsampling: subsampling })
    .toBuffer();
}
