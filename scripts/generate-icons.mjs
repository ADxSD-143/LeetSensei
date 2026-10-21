// Generates the extension icon PNGs with no third-party dependencies.
//
// Shapes are rasterised from signed-distance fields evaluated in pixel space,
// so a single code path produces clean antialiased output at every required
// size (16/32/48/128).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'icons');
const SIZES = [16, 32, 48, 128];

const BACKGROUND = [11, 15, 25]; // deep obsidian ink
const SUN_COLOR = [235, 28, 70]; // Japanese scarlet / Hinomaru crimson
const AURA_COLOR = [0, 225, 255]; // Katana neon cyan energy aura
const BLADE_COLOR = [255, 255, 255]; // Katana blade steel white
const GOLD_ACCENT = [255, 195, 45]; // Golden ki accent

/** Katana check-slash strokes in unit space: cutting down-left to up-right. */
const KATANA_STROKES = [
  [0.22, 0.54, 0.42, 0.73],
  [0.42, 0.73, 0.8, 0.26],
];

/** Sensei headband / kanji horizon stroke: represents discipline and focus. */
const HEADBAND_STROKE = [0.28, 0.26, 0.72, 0.26];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Coverage of a 1px-wide antialias band around a distance field. */
function coverage(distance) {
  return Math.max(0, Math.min(1, 0.5 - distance));
}

function roundedRectDistance(x, y, halfWidth, halfHeight, radius) {
  const dx = Math.abs(x) - (halfWidth - radius);
  const dy = Math.abs(y) - (halfHeight - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const lengthSquared = vx * vx + vy * vy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared));
  return Math.hypot(wx - t * vx, wy - t * vy);
}

/** Source-over composite of `top` onto `bottom`, both as [r, g, b, alpha]. */
function over(bottom, top) {
  const outAlpha = top[3] + bottom[3] * (1 - top[3]);
  if (outAlpha === 0) return [0, 0, 0, 0];
  const result = [0, 0, 0, 0];
  for (let channel = 0; channel < 3; channel += 1) {
    result[channel] =
      (top[channel] * top[3] + bottom[channel] * bottom[3] * (1 - top[3])) / outAlpha;
  }
  result[3] = outAlpha;
  return result;
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const strokes = KATANA_STROKES.map(([ax, ay, bx, by]) => [
    ax * size,
    ay * size,
    bx * size,
    by * size,
  ]);
  const headband = [
    HEADBAND_STROKE[0] * size,
    HEADBAND_STROKE[1] * size,
    HEADBAND_STROKE[2] * size,
    HEADBAND_STROKE[3] * size,
  ];

  const cornerRadius = 0.22 * size;
  const sunRadius = 0.34 * size;
  const sunCenterY = size * 0.5;
  const sunCenterX = size * 0.5;

  const auraRadius = Math.max(1.2, 0.088 * size);
  const bladeRadius = Math.max(0.7, 0.048 * size);
  const headbandAuraRadius = Math.max(0.8, 0.042 * size);
  const headbandRadius = Math.max(0.5, 0.024 * size);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;

      const bgDist = roundedRectDistance(
        px - size / 2,
        py - size / 2,
        size / 2,
        size / 2,
        cornerRadius,
      );
      const bgAlpha = coverage(bgDist);
      if (bgAlpha <= 0) continue;

      let pixel = [BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], bgAlpha];

      const rimDist = Math.abs(bgDist + 1.2);
      const rimAlpha = Math.max(0, 1 - rimDist / 1.5) * 0.45 * bgAlpha;
      pixel = over(pixel, [AURA_COLOR[0], AURA_COLOR[1], AURA_COLOR[2], rimAlpha]);

      const sunDist = Math.hypot(px - sunCenterX, py - sunCenterY) - sunRadius;
      const sunAlpha = coverage(sunDist) * bgAlpha;
      if (sunAlpha > 0) {
        const sunGrad = Math.max(0, Math.min(1, (py - (sunCenterY - sunRadius)) / (sunRadius * 2)));
        const sunR = Math.round(SUN_COLOR[0] * (1 - sunGrad * 0.15));
        const sunG = Math.round(SUN_COLOR[1] + sunGrad * 20);
        const sunB = Math.round(SUN_COLOR[2] + sunGrad * 15);
        pixel = over(pixel, [sunR, sunG, sunB, sunAlpha]);
      }

      if (size >= 24) {
        const hbDist = segmentDistance(px, py, headband[0], headband[1], headband[2], headband[3]);
        const hbAuraAlpha = coverage(hbDist - headbandAuraRadius) * 0.7 * bgAlpha;
        pixel = over(pixel, [GOLD_ACCENT[0], GOLD_ACCENT[1], GOLD_ACCENT[2], hbAuraAlpha]);
        const hbAlpha = coverage(hbDist - headbandRadius) * bgAlpha;
        pixel = over(pixel, [BLADE_COLOR[0], BLADE_COLOR[1], BLADE_COLOR[2], hbAlpha]);
      }

      let auraAlpha = 0;
      let bladeAlpha = 0;
      for (const [ax, ay, bx, by] of strokes) {
        const dist = segmentDistance(px, py, ax, ay, bx, by);
        auraAlpha = Math.max(auraAlpha, coverage(dist - auraRadius));
        bladeAlpha = Math.max(bladeAlpha, coverage(dist - bladeRadius));
      }

      if (auraAlpha > 0) {
        pixel = over(pixel, [
          AURA_COLOR[0],
          AURA_COLOR[1],
          AURA_COLOR[2],
          auraAlpha * 0.85 * bgAlpha,
        ]);
      }
      if (bladeAlpha > 0) {
        pixel = over(pixel, [BLADE_COLOR[0], BLADE_COLOR[1], BLADE_COLOR[2], bladeAlpha * bgAlpha]);
      }

      const offset = (y * size + x) * 4;
      rgba[offset] = Math.round(pixel[0]);
      rgba[offset + 1] = Math.round(pixel[1]);
      rgba[offset + 2] = Math.round(pixel[2]);
      rgba[offset + 3] = Math.round(pixel[3] * 255);
    }
  }
  return encodePng(size, size, rgba);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, renderIcon(size));
  console.log(`wrote ${file}`);
}
