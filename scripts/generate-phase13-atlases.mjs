#!/usr/bin/env node
/**
 * DEV ONLY — flat-color placeholder atlases (Tier A smoke tests).
 * **Not for Tier B ship.** Production art: `pnpm art:import` (Kenney CC0).
 * Run: pnpm art:placeholder
 */
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "apps/web/public/assets");

/** @type {Record<string, [number, number, number]>} */
const BIOME_RGB = {
  homeWalk: [0x6b, 0x5a, 0x48],
  homeBlock: [0x4a, 0x3d, 0x32],
  meadowWalk: [0x5a, 0x8a, 0x4a],
  meadowBlock: [0x3d, 0x6a, 0x38],
  scrubWalk: [0x9a, 0x8a, 0x5a],
  scrubBlock: [0x7a, 0x6a, 0x42],
  wetlandWalk: [0x4a, 0x7a, 0x72],
  wetlandBlock: [0x32, 0x5a, 0x52],
  highlandWalk: [0x8a, 0x82, 0x72],
  highlandBlock: [0x6a, 0x62, 0x58],
};

const PALETTE_ROWS = [
  [0xc9, 0xa2, 0x27],
  [0x9a, 0x92, 0x84],
  [0x6b, 0x8f, 0x5e],
  [0x8a, 0x7d, 0x5c],
];

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** @param {number} width @param {number} height @param {Uint8Array} rgba */
function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    raw.set(row, y * (stride + 1) + 1);
  }
  const compressed = deflateSync(raw);
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", compressed),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** @param {number} w @param {number} h @param {(x: number, y: number) => [number, number, number, number]} fn */
function raster(w, h, fn) {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b, a = 255] = fn(x, y);
      const i = (y * w + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return rgba;
}

function fillTile(rgba, tw, th, tx, ty, rgb) {
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      const px = tx * 16 + x;
      const py = ty * 16 + y;
      const i = (py * tw + px) * 4;
      const edge = x === 0 || y === 0 || x === 15 || y === 15;
      rgba[i] = rgb[0];
      rgba[i + 1] = rgb[1];
      rgba[i + 2] = rgb[2];
      rgba[i + 3] = 255;
      if (edge) {
        rgba[i] = Math.max(0, rgb[0] - 30);
        rgba[i + 1] = Math.max(0, rgb[1] - 30);
        rgba[i + 2] = Math.max(0, rgb[2] - 30);
      }
    }
  }
}

function writePng(relPath, width, height, rgba) {
  const full = resolve(outDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  const buf = encodePng(width, height, rgba);
  createWriteStream(full).end(buf);
  console.log(`wrote ${relPath} (${width}x${height})`);
}

// biomes.png — 5 biome rows × 6 tiles (4 walk + blocked + shore), 16px cells
{
  const cols = 6;
  const rows = 5;
  const biomes = ["home", "meadow", "scrub", "wetland", "highland"];
  const rgbByBiome = [
    [BIOME_RGB.homeWalk, BIOME_RGB.homeBlock],
    [BIOME_RGB.meadowWalk, BIOME_RGB.meadowBlock],
    [BIOME_RGB.scrubWalk, BIOME_RGB.scrubBlock],
    [BIOME_RGB.wetlandWalk, BIOME_RGB.wetlandBlock],
    [BIOME_RGB.highlandWalk, BIOME_RGB.highlandBlock],
  ];
  const w = cols * 16;
  const h = rows * 16;
  const rgba = new Uint8Array(w * h * 4);
  biomes.forEach((_, row) => {
    const [walk, block] = rgbByBiome[row];
    for (let v = 0; v < 4; v += 1) {
      const tint = v * 6;
      fillTile(rgba, w, h, v, row, [
        Math.min(255, walk[0] + tint),
        Math.min(255, walk[1] + tint),
        Math.min(255, walk[2] + tint),
      ]);
    }
    fillTile(rgba, w, h, 4, row, block);
    fillTile(rgba, w, h, 5, row, [
      Math.min(255, walk[0] + 20),
      Math.min(255, walk[1] + 30),
      Math.min(255, walk[2] + 10),
    ]);
  });
  writePng("tiles/biomes.png", w, h, rgba);
}

// Lazy biome decor placeholders (16×16)
for (const name of ["biome-scrub", "biome-wetland", "biome-highland"]) {
  const rgb = name.includes("scrub")
    ? BIOME_RGB.scrubWalk
    : name.includes("wetland")
      ? BIOME_RGB.wetlandWalk
      : BIOME_RGB.highlandWalk;
  writePng(
    `tiles/${name}.png`,
    16,
    16,
    raster(16, 16, () => [...rgb, 255]),
  );
}

// characters.png — 4 palette rows × 4 dirs × 6 frames (16px)
{
  const cols = 24;
  const rows = 4;
  const w = cols * 16;
  const h = rows * 16;
  const rgba = raster(w, h, (x, y) => {
    const row = Math.floor(y / 16);
    const col = Math.floor(x / 16);
    const dir = Math.floor(col / 6);
    const frame = col % 6;
    const [r, g, b] = PALETTE_ROWS[row];
    const walk = frame < 4;
    const bob = walk ? (frame % 2) * 2 : 0;
    const shade = dir * 8 + (walk ? 0 : 12);
    return [Math.min(255, r - shade + bob), Math.min(255, g - shade), Math.min(255, b - shade), 255];
  });
  writePng("sprites/characters.png", w, h, rgba);
}

// npcs.png — 4 dir rows × 6 frames
{
  const w = 96;
  const h = 64;
  const rgba = raster(w, h, (x, y) => {
    const col = Math.floor(x / 16);
    const frame = col % 6;
    const bob = frame < 4 ? (frame % 2) * 2 : 0;
    return [0x8a - bob, 0x7d - bob, 0x5c, 255];
  });
  writePng("sprites/npcs.png", w, h, rgba);
}

// ui-speech.png — ellipsis bubble 32×32
{
  writePng(
    "sprites/ui-speech.png",
    32,
    32,
    raster(32, 32, (x, y) => {
      const cx = 16;
      const cy = 14;
      const d = Math.hypot(x - cx, y - cy);
      if (d > 13) return [0, 0, 0, 0];
      if (y > 26 && x > 10 && x < 18) return [0xf5, 0xf0, 0xe6, 255];
      const dot = (x >= 10 && x <= 12 && y >= 13 && y <= 15)
        || (x >= 15 && x <= 17 && y >= 13 && y <= 15)
        || (x >= 20 && x <= 22 && y >= 13 && y <= 15);
      return dot ? [0x2a, 0x28, 0x24, 255] : [0xf5, 0xf0, 0xe6, 255];
    }),
  );
}

// tiles/decor.png — door closed/open, bush, 2×2 tree, fence, landmark, reeds (16px frames)
{
  const frameCount = 10;
  const w = frameCount * 16;
  const h = 16;
  const colors = [
    [0x5a, 0x48, 0x38],
    [0x7a, 0x62, 0x48],
    [0x4a, 0x7a, 0x3a],
    [0x3a, 0x6a, 0x32],
    [0x2a, 0x5a, 0x28],
    [0x1a, 0x4a, 0x22],
    [0x6a, 0x5a, 0x42],
    [0x8a, 0x72, 0x52],
    [0xc9, 0xa2, 0x27],
    [0x5a, 0x8a, 0x72],
  ];
  const rgba = raster(w, h, (x, y) => {
    const frame = Math.floor(x / 16);
    const [r, g, b] = colors[frame] ?? colors[0];
    const shade = (x % 16) + (y % 16);
    return [Math.min(255, r + (shade % 5)), Math.min(255, g + (shade % 3)), b, 255];
  });
  writePng("tiles/decor.png", w, h, rgba);
}

console.log("Phase 13 atlases generated.");
