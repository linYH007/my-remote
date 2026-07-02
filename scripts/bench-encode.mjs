import sharp from 'sharp';

// Synthesize a realistic desktop-entropy RGBA buffer (gradients + text-like noise).
function makeFrame(w, h) {
  const data = Buffer.allocUnsafe(w * h * 4);
  let seed = 1234567;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const base = ((x ^ y) & 0xff);
      const noise = rnd() < 0.12 ? 255 : 0; // sparse high-contrast "text"
      data[i] = (base + noise) & 0xff;
      data[i + 1] = (128 + (x & 0x7f) + noise) & 0xff;
      data[i + 2] = (200 - (y & 0x7f)) & 0xff;
      data[i + 3] = 255;
    }
  }
  return data;
}

const SRC_W = 2560, SRC_H = 1440;   // physical grab size
const TARGET_W = 1920, QUALITY = 72;
const raw = makeFrame(SRC_W, SRC_H);

async function encode(mozjpeg) {
  return sharp(raw, { raw: { width: SRC_W, height: SRC_H, channels: 4 } })
    .resize({ width: TARGET_W, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: QUALITY, mozjpeg, chromaSubsampling: '4:2:0' })
    .toBuffer();
}

async function run(label, mozjpeg) {
  await encode(mozjpeg); // warm
  const N = 30;
  const t0 = process.hrtime.bigint();
  let bytes = 0;
  for (let i = 0; i < N; i++) bytes += (await encode(mozjpeg)).length;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(`${label.padEnd(18)} ${ms.toFixed(1)} ms/frame  ${(bytes / N / 1024).toFixed(0)} KB/frame  ~${(1000 / ms).toFixed(1)} fps ceiling`);
  return { ms, kb: bytes / N / 1024 };
}

console.log(`source ${SRC_W}x${SRC_H} -> ${TARGET_W}w q${QUALITY}, 30 frames each\n`);
const moz = await run('mozjpeg:true', true);
const turbo = await run('mozjpeg:false', false);
console.log(`\nencode speedup: ${(moz.ms / turbo.ms).toFixed(2)}x   size delta: ${((turbo.kb / moz.kb - 1) * 100).toFixed(1)}%`);
