import { screen } from '@nut-tree-fork/nut-js';
import sharp from 'sharp';

// 被控端屏幕逻辑尺寸（鼠标坐标系使用的坐标，受 DPI 缩放影响）。
// 注意：screen.grab() 返回的是物理像素，而鼠标定位用的是逻辑像素，
// 两者在开启了显示缩放（如 125%/150%）时并不相等，因此坐标映射必须基于逻辑尺寸。
let logicalSize = { width: 0, height: 0 };

function finiteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

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
 * @param {{ width?: number, quality?: number, region?: {x0:number,y0:number,vw:number,vh:number}|null, mozjpeg?: boolean }} opts
 *   width   - 目标宽度上限（按比例缩放，控制带宽与帧率，绝不放大）
 *   quality - JPEG 质量 1-100
 *   region  - 归一化裁剪区域 [0,1]，用于放大时只发送可视区域，保留原生清晰度
 *   mozjpeg - 是否用 mozjpeg 编码。默认 false：mozjpeg 体积小 ~36% 但编码慢 ~4 倍
 *             （2560×1440→1920 实测 86ms vs 20ms），会把实时帧率压到 ~12fps 并增加
 *             每帧延迟。默认用 libjpeg-turbo 换取流畅度，带宽紧张时可经环境变量开启。
 * @returns {Promise<Buffer>} JPEG 二进制数据
 */
export async function captureFrame({ width = 1366, quality = 55, region = null, mozjpeg = false } = {}) {
  const image = await screen.grab();
  const rgb = await image.toRGB(); // nut-js 默认 BGRA，转换为 RGBA 供 sharp 正确编码

  let pipeline = sharp(rgb.data, {
    raw: { width: rgb.width, height: rgb.height, channels: 4 },
  });

  let targetWidth = width;
  let subsampling = '4:2:0';

  if (region) {
    const rx = clampNumber(finiteNumber(region.x0, 0), 0, 1);
    const ry = clampNumber(finiteNumber(region.y0, 0), 0, 1);
    const rw = clampNumber(finiteNumber(region.vw, 1), 0.05, 1);
    const rh = clampNumber(finiteNumber(region.vh, 1), 0.05, 1);
    const left = clampNumber(Math.round(rx * rgb.width), 0, Math.max(0, rgb.width - 1));
    const top = clampNumber(Math.round(ry * rgb.height), 0, Math.max(0, rgb.height - 1));
    let cw = Math.round(rw * rgb.width);
    let ch = Math.round(rh * rgb.height);
    cw = clampNumber(cw, 1, rgb.width - left);
    ch = clampNumber(ch, 1, rgb.height - top);
    if (cw > 8 && ch > 8 && (cw < rgb.width || ch < rgb.height)) {
      pipeline = pipeline.extract({ left, top, width: cw, height: ch });
      // 放大区域：按原生像素发送（不放大），并用 4:4:4 保留文字锐度
      targetWidth = Math.min(width, cw);
      subsampling = '4:4:4';
    }
  }

  return pipeline
    .resize({ width: targetWidth, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg, chromaSubsampling: subsampling })
    .toBuffer();
}
