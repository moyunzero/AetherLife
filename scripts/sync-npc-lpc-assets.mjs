#!/usr/bin/env node
/**
 * Bake walk + idle from npc-asset/npc-1.png (Universal LPC composite) into a compact
 * runtime spritesheet: apps/web/public/assets/sprites/lpc-npc-1.png
 *
 * Layout: 4 facings × (9 walk + 2 idle) frames, 64×64 each → 704×256 PNG.
 * Facing row order: down, left, right, up (matches facing.ts CARDINALS).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(root, "npc-asset/npc-1.png");
const OUT = resolve(root, "apps/web/public/assets/sprites/lpc-npc-1.png");

const LPC_FRAME = 64;
const WALK_FRAMES = 9;
const IDLE_FRAMES = 2;
const FRAMES_PER_FACING = WALK_FRAMES + IDLE_FRAMES;
const FACING_COUNT = 4;

/** Universal LPC composite: walk rows 8–11, idle rows 22–25 (2 frames each). */
const WALK_BASE_ROW = 8;
const IDLE_BASE_ROW = 22;

/**
 * Row offset inside each LPC animation block — NOT down-first.
 * Verified against npc-asset/npc-1.png: row+0=up, +1=left, +2=down, +3=right.
 */
const LPC_SOURCE_ROW_BY_FACING = {
  up: 0,
  left: 1,
  down: 2,
  right: 3,
};

/** Baked atlas row order matches facing.ts FACING_ORDER. */
const BAKED_FACINGS = ["down", "left", "right", "up"];

function loadPng(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing source PNG: ${path}`);
  }
  return PNG.sync.read(readFileSync(path));
}

function extractFrame(src, col, row) {
  const rgba = new Uint8Array(LPC_FRAME * LPC_FRAME * 4);
  for (let y = 0; y < LPC_FRAME; y += 1) {
    for (let x = 0; x < LPC_FRAME; x += 1) {
      const sx = col * LPC_FRAME + x;
      const sy = row * LPC_FRAME + y;
      const si = (sy * src.width + sx) * 4;
      const di = (y * LPC_FRAME + x) * 4;
      rgba[di] = src.data[si];
      rgba[di + 1] = src.data[si + 1];
      rgba[di + 2] = src.data[si + 2];
      rgba[di + 3] = src.data[si + 3];
    }
  }
  return rgba;
}

function blitFrame(dst, dstCol, dstRow, rgba) {
  for (let y = 0; y < LPC_FRAME; y += 1) {
    for (let x = 0; x < LPC_FRAME; x += 1) {
      const si = (y * LPC_FRAME + x) * 4;
      const dx = dstCol * LPC_FRAME + x;
      const dy = dstRow * LPC_FRAME + y;
      const di = (dy * dst.width + dx) * 4;
      dst.data[di] = rgba[si];
      dst.data[di + 1] = rgba[si + 1];
      dst.data[di + 2] = rgba[si + 2];
      dst.data[di + 3] = rgba[si + 3];
    }
  }
}

function bake() {
  const src = loadPng(SRC);
  const atlasW = FRAMES_PER_FACING * LPC_FRAME;
  const atlasH = FACING_COUNT * LPC_FRAME;
  const atlas = new PNG({ width: atlasW, height: atlasH });

  for (let fi = 0; fi < FACING_COUNT; fi += 1) {
    const facing = BAKED_FACINGS[fi];
    const srcOffset = LPC_SOURCE_ROW_BY_FACING[facing];
    const walkSrcRow = WALK_BASE_ROW + srcOffset;
    const idleSrcRow = IDLE_BASE_ROW + srcOffset;

    for (let wf = 0; wf < WALK_FRAMES; wf += 1) {
      blitFrame(atlas, wf, fi, extractFrame(src, wf, walkSrcRow));
    }
    for (let idf = 0; idf < IDLE_FRAMES; idf += 1) {
      blitFrame(atlas, WALK_FRAMES + idf, fi, extractFrame(src, idf, idleSrcRow));
    }
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, PNG.sync.write(atlas));
  console.log(`wrote ${OUT} (${atlasW}×${atlasH}, ${FACING_COUNT * FRAMES_PER_FACING} frames)`);
}

bake();
