#!/usr/bin/env node

import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

const root = new URL("..", import.meta.url).pathname;
const iconDir = join(root, "assets");
const cwsDir = join(root, "docs/cws/assets");

await mkdir(iconDir, { recursive: true });
await mkdir(cwsDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  await writeFile(join(iconDir, `icon-${size}.png`), png(size, size, iconPainter(size)));
}

await writeFile(join(cwsDir, "store-icon-128.png"), png(128, 128, iconPainter(128)));
await writeIfMissing(join(cwsDir, "screenshot-library-1280x800.png"), png(1280, 800, screenshotPainter));
await writeIfMissing(join(cwsDir, "promo-small-440x280.png"), png(440, 280, promoPainter));
await writeIfMissing(join(cwsDir, "promo-marquee-1400x560.png"), png(1400, 560, marqueePainter));

console.log("Prepared Session Rescue extension icons and preserved curated CWS media");

async function writeIfMissing(filePath, data) {
  try {
    await access(filePath);
  } catch {
    await writeFile(filePath, data);
  }
}

function iconPainter(size) {
  return (x, y) => {
    const radius = size * 0.18;
    const inset = size * 0.14;
    const inBox = x >= inset && y >= inset && x < size - inset && y < size - inset;
    const stripe = Math.abs(x - y) < Math.max(2, size * 0.08);
    if (!inBox) return [247, 248, 251, 255];
    if (stripe) return [29, 78, 216, 255];
    if (x < radius || y > size - radius) return [15, 118, 110, 255];
    return [23, 32, 51, 255];
  };
}

function screenshotPainter(x, y, width, height) {
  if (y < 86) return [255, 255, 255, 255];
  if (x < 260) return [238, 243, 249, 255];
  if ((x > 310 && x < 1170 && y > 130 && y < 178) || (x > 310 && x < 1170 && y > 210 && y < 250)) {
    return [255, 255, 255, 255];
  }
  if (x > 310 && x < 1170 && y > 290 && y < 720) {
    const card = Math.floor((x - 310) / 286);
    const gutter = (x - 310) % 286;
    if (gutter < 260 && (y - 290) % 140 < 118) {
      return card % 2 === 0 ? [255, 255, 255, 255] : [245, 249, 252, 255];
    }
  }
  if (x > 42 && x < 218 && y > 38 && y < 52) return [23, 32, 51, 255];
  if (x > 52 && x < 200 && y > 132 && y < 144) return [29, 78, 216, 255];
  if (x > 52 && x < 220 && y > 174 && y < 186) return [15, 118, 110, 255];
  return [246, 248, 251, 255];
}

function promoPainter(x, y, width, height) {
  const left = x < width * 0.42;
  if (left) return [23, 32, 51, 255];
  if (x > width * 0.5 && x < width * 0.9 && y > height * 0.24 && y < height * 0.38) return [29, 78, 216, 255];
  if (x > width * 0.5 && x < width * 0.82 && y > height * 0.48 && y < height * 0.58) return [15, 118, 110, 255];
  return [247, 248, 251, 255];
}

function marqueePainter(x, y, width, height) {
  if (x < width * 0.36) return [23, 32, 51, 255];
  if (x > width * 0.43 && x < width * 0.85 && y > height * 0.24 && y < height * 0.35) return [29, 78, 216, 255];
  if (x > width * 0.43 && x < width * 0.75 && y > height * 0.48 && y < height * 0.58) return [15, 118, 110, 255];
  if (x > width * 0.43 && x < width * 0.66 && y > height * 0.66 && y < height * 0.74) return [203, 65, 11, 255];
  return [247, 248, 251, 255];
}

function png(width, height, painter) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = painter(x, y, width, height);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr(width, height)),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function ihdr(width, height) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 2;
  return buffer;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
