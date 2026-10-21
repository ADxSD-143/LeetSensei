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

const SEAL_COLOR = [230, 57, 70]; // vermilion seal ground
const SEAL_SHADE = [165, 28, 40]; // deeper seal toward the bottom
const MOON_COLOR = [246, 241, 228]; // ivory crescent
const BLADE_COLOR = [255, 255, 255]; // polished steel
const INK_COLOR = [11, 12, 16]; // obsidian, for the blade separation shadow

/** Katana stroke in unit space: lower-left to upper-right. */
const BLADE_STROKE = [0.22, 0.74, 0.78, 0.26];

/** Crescent moon: a disc with an offset disc subtracted. */
const MOON = { cx: 0.47, cy: 0.43, r: 0.3, cutCx: 0.61, cutCy: 0.35, cutR: 0.27 };

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

  const cornerRadius = 0.22 * size;
  const moonCx = MOON.cx * size;
  const moonCy = MOON.cy * size;
  const moonR = MOON.r * size;
  const cutCx = MOON.cutCx * size;
  const cutCy = MOON.cutCy * size;
  const cutR = MOON.cutR * size;

  const [ax, ay, bx, by] = BLADE_STROKE.map((value) => value * size);
  const bladeRadius = Math.max(0.85, 0.05 * size);
  const underlayRadius = Math.max(1.4, 0.085 * size);

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

      // Seal ground with a soft vertical shade.
      const shade = Math.min(1, Math.max(0, py / size)) * 0.18;
      const groundR = Math.round(SEAL_COLOR[0] * (1 - shade) + SEAL_SHADE[0] * shade);
      const groundG = Math.round(SEAL_COLOR[1] * (1 - shade) + SEAL_SHADE[1] * shade);
      const groundB = Math.round(SEAL_COLOR[2] * (1 - shade) + SEAL_SHADE[2] * shade);
      let pixel = [groundR, groundG, groundB, bgAlpha];

      // Crescent: inside the disc, outside the offset disc.
      const discDist = Math.hypot(px - moonCx, py - moonCy) - moonR;
      const cutDist = Math.hypot(px - cutCx, py - cutCy) - cutR;
      const moonAlpha = coverage(discDist) * (1 - coverage(cutDist)) * bgAlpha;
      if (moonAlpha > 0) {
        pixel = over(pixel, [MOON_COLOR[0], MOON_COLOR[1], MOON_COLOR[2], moonAlpha]);
      }

      // Blade: an ink underlay separates it from the moon, then steel on top.
      const bladeDist = segmentDistance(px, py, ax, ay, bx, by);
      const underlayAlpha = coverage(bladeDist - underlayRadius) * bgAlpha;
      if (underlayAlpha > 0) {
        pixel = over(pixel, [INK_COLOR[0], INK_COLOR[1], INK_COLOR[2], underlayAlpha * 0.5]);
      }
      const bladeAlpha = coverage(bladeDist - bladeRadius) * bgAlpha;
      if (bladeAlpha > 0) {
        pixel = over(pixel, [BLADE_COLOR[0], BLADE_COLOR[1], BLADE_COLOR[2], bladeAlpha]);
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
