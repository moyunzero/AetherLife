#!/usr/bin/env node
/**
 * Import unified player + NPC sprites from assets/character/ (Stardew-style 32×32 sheets).
 * Run: node scripts/import-character-art.mjs
 *
 * Source: assets/character/Walk.png (192×96, 6×3 @ 32px), Idle.png (128×96, 4×3 @ 32px)
 * Output: apps/web/public/assets/sprites/characters.png, npcs.png (16×32 frames, same art)
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { PNG } from "pngjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(root, "assets/character");
const outDir = resolve(root, "apps/web/public/assets");

const CHAR_W = 16;
const CHAR_H = 32;
const SRC_FRAME = 32;
const FACING_COUNT = 4;
const FRAMES_PER_FACING = 6;
const WALK_FRAMES = 4;
const IDLE_FRAMES = 2;
const PALETTE_ROW_COUNT = 4;
const NPC_VARIANT_COUNT = 2;

/** Walk/idle sheet rows: 0=down, 1=up, 2=right (left uses flipX + duplicated atlas row). */
const STARDEW_ROW = { down: 0, up: 1, right: 2 };
/** Atlas facing index order — must match facing.ts FACING_ORDER. */
const FACING_ATLAS_INDEX = { down: 0, left: 1, right: 2, up: 3 };

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

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writePng(relPath, width, height, rgba) {
  const full = resolve(outDir, relPath);
  mkdirSync(dirname(full), { recursive: true });
  createWriteStream(full).end(encodePng(width, height, rgba));
  console.log(`wrote ${relPath} (${width}x${height})`);
}

function loadPng(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${path}`);
  }
  return PNG.sync.read(readFileSync(path));
}

/** @param {import('pngjs').PNG} png @param {number} col @param {number} row */
function extractSrcFrame(png, col, row) {
  const rgba = new Uint8Array(SRC_FRAME * SRC_FRAME * 4);
  for (let y = 0; y < SRC_FRAME; y += 1) {
    for (let x = 0; x < SRC_FRAME; x += 1) {
      const sx = col * SRC_FRAME + x;
      const sy = row * SRC_FRAME + y;
      const si = (sy * png.width + sx) * 4;
      const di = (y * SRC_FRAME + x) * 4;
      rgba[di] = png.data[si];
      rgba[di + 1] = png.data[si + 1];
      rgba[di + 2] = png.data[si + 2];
      rgba[di + 3] = png.data[si + 3];
    }
  }
  return rgba;
}

/** Center-crop 16×32 from 32×32 Stardew cell — 1:1 pixels, no resample blur. */
function centerCropCharFrame(src32) {
  const dst = new Uint8Array(CHAR_W * CHAR_H * 4);
  const offsetX = Math.floor((SRC_FRAME - CHAR_W) / 2);
  for (let y = 0; y < CHAR_H; y += 1) {
    for (let x = 0; x < CHAR_W; x += 1) {
      const si = (y * SRC_FRAME + offsetX + x) * 4;
      const di = (y * CHAR_W + x) * 4;
      dst[di] = src32[si];
      dst[di + 1] = src32[si + 1];
      dst[di + 2] = src32[si + 2];
      dst[di + 3] = src32[si + 3];
    }
  }
  return dst;
}

function blitCharFrame(atlas, atlasW, tx, ty, frameRgba) {
  for (let y = 0; y < CHAR_H; y += 1) {
    for (let x = 0; x < CHAR_W; x += 1) {
      const px = tx * CHAR_W + x;
      const py = ty * CHAR_H + y;
      const ai = (py * atlasW + px) * 4;
      const fi = (y * CHAR_W + x) * 4;
      atlas[ai] = frameRgba[fi];
      atlas[ai + 1] = frameRgba[fi + 1];
      atlas[ai + 2] = frameRgba[fi + 2];
      atlas[ai + 3] = frameRgba[fi + 3];
    }
  }
}

/** @param {"down"|"up"|"right"} stardewFacing */
function stardewRowFor(stardewFacing) {
  return STARDEW_ROW[stardewFacing];
}

/**
 * One palette/variant row: 4 facings × 6 frames (matches characterFrameIndex / npcFrameIndex).
 * @param {import('pngjs').PNG} walkPng
 * @param {import('pngjs').PNG} idlePng
 * @param {Uint8Array} atlas
 * @param {number} atlasW
 * @param {number} rowIndex palette row (characters) or variant block start row (npcs)
 * @param {boolean} npcLayout when true, each facing occupies its own atlas row
 */
function blitCharacterRow(walkPng, idlePng, atlas, atlasW, rowIndex, npcLayout) {
  const facings = [
    { atlasFi: FACING_ATLAS_INDEX.down, stardew: "down" },
    { atlasFi: FACING_ATLAS_INDEX.left, stardew: "right" },
    { atlasFi: FACING_ATLAS_INDEX.right, stardew: "right" },
    { atlasFi: FACING_ATLAS_INDEX.up, stardew: "up" },
  ];
  for (const { atlasFi, stardew } of facings) {
    const atlasRow = npcLayout ? rowIndex * FACING_COUNT + atlasFi : rowIndex;
    const txBase = npcLayout ? 0 : atlasFi * FRAMES_PER_FACING;
    const sheetRow = stardewRowFor(stardew);
    for (let wf = 0; wf < WALK_FRAMES; wf += 1) {
      const frame = centerCropCharFrame(extractSrcFrame(walkPng, wf, sheetRow));
      blitCharFrame(atlas, atlasW, txBase + wf, atlasRow, frame);
    }
    for (let idf = 0; idf < IDLE_FRAMES; idf += 1) {
      const frame = centerCropCharFrame(extractSrcFrame(idlePng, idf, sheetRow));
      blitCharFrame(atlas, atlasW, txBase + WALK_FRAMES + idf, atlasRow, frame);
    }
  }
}

function buildCharactersAtlas(walkPng, idlePng) {
  const cols = FACING_COUNT * FRAMES_PER_FACING;
  const rows = PALETTE_ROW_COUNT;
  const w = cols * CHAR_W;
  const h = rows * CHAR_H;
  const atlas = new Uint8Array(w * h * 4);
  for (let row = 0; row < PALETTE_ROW_COUNT; row += 1) {
    blitCharacterRow(walkPng, idlePng, atlas, w, row, false);
  }
  writePng("sprites/characters.png", w, h, atlas);
}

function buildNpcsAtlas(walkPng, idlePng) {
  const cols = FRAMES_PER_FACING;
  const rows = NPC_VARIANT_COUNT * FACING_COUNT;
  const w = cols * CHAR_W;
  const h = rows * CHAR_H;
  const atlas = new Uint8Array(w * h * 4);
  for (let variant = 0; variant < NPC_VARIANT_COUNT; variant += 1) {
    blitCharacterRow(walkPng, idlePng, atlas, w, variant, true);
  }
  writePng("sprites/npcs.png", w, h, atlas);
}

function main() {
  const walkPng = loadPng(resolve(srcDir, "Walk.png"));
  const idlePng = loadPng(resolve(srcDir, "Idle.png"));
  if (walkPng.width !== 192 || walkPng.height !== 96) {
    console.warn(`warn: Walk.png expected 192×96, got ${walkPng.width}×${walkPng.height}`);
  }
  if (idlePng.width !== 128 || idlePng.height !== 96) {
    console.warn(`warn: Idle.png expected 128×96, got ${idlePng.width}×${idlePng.height}`);
  }
  buildCharactersAtlas(walkPng, idlePng);
  buildNpcsAtlas(walkPng, idlePng);
  console.log("import-character-art: done");
}

main();
