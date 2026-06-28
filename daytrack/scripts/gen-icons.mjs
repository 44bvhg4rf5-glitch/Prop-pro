// Generates DayTrack app icons (PNG) with zero dependencies.
// Draws a gradient square with three ascending bars (a tracking motif).
//   node scripts/gen-icons.mjs
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outDir, { recursive: true });

// ── minimal PNG encoder (RGBA, 8-bit) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(S, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit, RGBA
  const stride = S * 4;
  const raw = Buffer.alloc((stride + 1) * S);
  for (let y = 0; y < S; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);

function fillRound(buf, S, x, y, w, h, r, col) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (px < 0 || px >= S || py < 0 || py >= S) continue;
      const cx = px < x + r ? x + r : (px > x + w - r ? x + w - r : px);
      const cy = py < y + r ? y + r : (py > y + h - r ? y + h - r : py);
      const dx = px - cx, dy = py - cy;
      if (dx * dx + dy * dy > r * r) continue;
      const i = (py * S + px) * 4;
      buf[i] = col[0]; buf[i + 1] = col[1]; buf[i + 2] = col[2]; buf[i + 3] = 255;
    }
  }
}

function makeIcon(S) {
  const buf = Buffer.alloc(S * S * 4);
  const top = [99, 102, 241], bot = [139, 92, 246]; // indigo -> violet
  for (let y = 0; y < S; y++) {
    const t = y / (S - 1);
    const r = lerp(top[0], bot[0], t), g = lerp(top[1], bot[1], t), b = lerp(top[2], bot[2], t);
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
  }
  const barW = Math.round(S * 0.13);
  const gap = Math.round(S * 0.075);
  const totalW = barW * 3 + gap * 2;
  const x0 = Math.round((S - totalW) / 2);
  const baseY = Math.round(S * 0.75);
  const heights = [0.26, 0.41, 0.56];
  const rad = barW * 0.45;
  for (let bi = 0; bi < 3; bi++) {
    const bx = x0 + bi * (barW + gap);
    const bh = Math.round(heights[bi] * S);
    fillRound(buf, S, bx, baseY - bh, barW, bh, rad, [255, 255, 255]);
  }
  return buf;
}

for (const S of [180, 192, 512]) {
  const png = encodePNG(S, makeIcon(S));
  fs.writeFileSync(path.join(outDir, `icon-${S}.png`), png);
  console.log(`wrote icons/icon-${S}.png (${png.length} bytes)`);
}
