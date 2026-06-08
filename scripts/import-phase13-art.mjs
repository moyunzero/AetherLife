#!/usr/bin/env node
/**
 * Phase 13.1 — import CC0 Kenney Roguelike tiles (dev-only rollback).
 * Run: pnpm art:import:roguelike
 *
 * **Not** the production art path — default ship uses Tiny Town via `pnpm art:import:farm`.
 * Source: scripts/vendor/phase13/kenney/ (Kenney Roguelike/RPG pack, CC0).
 * See apps/web/public/assets/CREDITS.md for attribution.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { PNG } from "pngjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "apps/web/public/assets");
const kenneySheet = resolve(
  root,
  "scripts/vendor/phase13/kenney/Spritesheet/roguelikeSheet_transparent.png",
);

const TILE = 16;
const STEP = 17; // 16px tile + 1px margin per Kenney sheet

/** @type {Record<string, { walk: [number, number][]; blocked: [number, number]; shore: [number, number] }>} */
const BIOME_TILES = {
  home: {
    walk: [
      [7, 7],
      [7, 8],
      [7, 9],
      [15, 3],
    ],
    blocked: [4, 13],
    shore: [4, 11],
  },
  meadow: {
    walk: [
      [0, 6],
      [1, 6],
      [2, 6],
      [3, 6],
    ],
    blocked: [4, 13],
    shore: [4, 12],
  },
  scrub: {
    walk: [
      [15, 1],
      [15, 2],
      [15, 3],
      [15, 4],
    ],
    blocked: [16, 1],
    shore: [16, 2],
  },
  wetland: {
    walk: [
      [27, 12],
      [28, 12],
      [29, 12],
      [31, 12],
    ],
    blocked: [28, 13],
    shore: [27, 14],
  },
  highland: {
    walk: [
      [33, 2],
      [34, 2],
      [35, 2],
      [33, 3],
    ],
    blocked: [36, 2],
    shore: [34, 3],
  },
};

/** decor.png frame order — must match homeLayout frame indices. */
const DECOR_FRAMES = [
  [22, 17], // 0 door closed
  [23, 17], // 1 door open
  [32, 10], // 2 bush
  [28, 16], // 3 tree SW
  [29, 16], // 4 tree SE
  [28, 15], // 5 tree NW
  [29, 15], // 6 tree NE
  [21, 14], // 7 fence
  [30, 19], // 8 landmark / sign
  [27, 12], // 9 reeds (wetland water edge)
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

function loadKenneySheet() {
  if (!existsSync(kenneySheet)) {
    throw new Error(
      `Missing Kenney sheet at ${kenneySheet}. Extract Roguelike pack to scripts/vendor/phase13/kenney/`,
    );
  }
  return PNG.sync.read(readFileSync(kenneySheet));
}

/** @param {import('pngjs').PNG} sheet @param {number} col @param {number} row */
function extractTile(sheet, col, row) {
  const rgba = new Uint8Array(TILE * TILE * 4);
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const sx = col * STEP + x;
      const sy = row * STEP + y;
      const si = (sy * sheet.width + sx) * 4;
      const di = (y * TILE + x) * 4;
      rgba[di] = sheet.data[si];
      rgba[di + 1] = sheet.data[si + 1];
      rgba[di + 2] = sheet.data[si + 2];
      rgba[di + 3] = sheet.data[si + 3];
    }
  }
  return rgba;
}

function blitTile(atlas, atlasW, tx, ty, tileRgba) {
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const px = tx * TILE + x;
      const py = ty * TILE + y;
      const ai = (py * atlasW + px) * 4;
      const ti = (y * TILE + x) * 4;
      atlas[ai] = tileRgba[ti];
      atlas[ai + 1] = tileRgba[ti + 1];
      atlas[ai + 2] = tileRgba[ti + 2];
      atlas[ai + 3] = tileRgba[ti + 3];
    }
  }
}

const CHAR_W = 16;
const CHAR_H = 32;

/** Blit one 16×32 character frame into atlas (Phase 13.3). */
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

function uniqueColors(rgba) {
  const s = new Set();
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    s.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`);
  }
  return s.size;
}

function buildBiomesAtlas(sheet) {
  const cols = 6;
  const rows = 5;
  const w = cols * TILE;
  const h = rows * TILE;
  const atlas = new Uint8Array(w * h * 4);
  const order = ["home", "meadow", "scrub", "wetland", "highland"];
  order.forEach((biome, row) => {
    const spec = BIOME_TILES[biome];
    spec.walk.forEach(([c, r], v) => {
      const tile = extractTile(sheet, c, r);
      const colors = uniqueColors(tile);
      if (colors < 4) {
        console.warn(`warn: ${biome} walk v${v} (${c},${r}) only ${colors} colors`);
      }
      blitTile(atlas, w, v, row, tile);
    });
    blitTile(atlas, w, 4, row, extractTile(sheet, spec.blocked[0], spec.blocked[1]));
    blitTile(atlas, w, 5, row, extractTile(sheet, spec.shore[0], spec.shore[1]));
  });
  writePng("tiles/biomes.png", w, h, atlas);
}

function buildLazyPacks(sheet) {
  const packs = [
    ["tiles/biome-scrub.png", BIOME_TILES.scrub.walk[0]],
    ["tiles/biome-wetland.png", BIOME_TILES.wetland.walk[0]],
    ["tiles/biome-highland.png", BIOME_TILES.highland.walk[0]],
  ];
  for (const [path, [c, r]] of packs) {
    writePng(path, TILE, TILE, extractTile(sheet, c, r));
  }
}

function buildDecorAtlas(sheet) {
  const frameCount = DECOR_FRAMES.length;
  const w = frameCount * TILE;
  const atlas = new Uint8Array(w * TILE * 4);
  DECOR_FRAMES.forEach(([c, r], i) => {
    blitTile(atlas, w, i, 0, extractTile(sheet, c, r));
  });
  writePng("tiles/decor.png", w, TILE, atlas);
}

const LPC_FRAME = 64;
const LPC_VENDOR = resolve(root, "scripts/vendor/phase13/lpc");
/** Walk cycle columns in 576×256 LPC sheets (9 frames per row). */
const LPC_WALK_COLS = [0, 1, 2, 3];
const LPC_IDLE_COLS = [0, 1];
const FACING_COUNT = 4;
const FRAMES_PER_FACING = 6;
const WALK_FRAMES = 4;
const IDLE_FRAMES = 2;
const PALETTE_ROW_COUNT = 4;
const NPC_VARIANT_COUNT = 2;

function loadLpcPng(filename) {
  const full = resolve(LPC_VENDOR, filename);
  if (!existsSync(full)) {
    throw new Error(`Missing LPC sheet ${full} — download from Universal LPC Character Generator repo`);
  }
  return PNG.sync.read(readFileSync(full));
}

/** @param {import('pngjs').PNG} png @param {number} col @param {number} row */
function extractLpcFrame(png, col, row) {
  const rgba = new Uint8Array(LPC_FRAME * LPC_FRAME * 4);
  for (let y = 0; y < LPC_FRAME; y += 1) {
    for (let x = 0; x < LPC_FRAME; x += 1) {
      const sx = col * LPC_FRAME + x;
      const sy = row * LPC_FRAME + y;
      const si = (sy * png.width + sx) * 4;
      const di = (y * LPC_FRAME + x) * 4;
      rgba[di] = png.data[si];
      rgba[di + 1] = png.data[si + 1];
      rgba[di + 2] = png.data[si + 2];
      rgba[di + 3] = png.data[si + 3];
    }
  }
  return rgba;
}

/** Crop opaque bbox from 64×64 LPC frame → 16×32 (NN, bottom-aligned). */
function fitLpcToCharFrame(src64) {
  const dst = new Uint8Array(CHAR_W * CHAR_H * 4);
  let minX = LPC_FRAME;
  let minY = LPC_FRAME;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < LPC_FRAME; y += 1) {
    for (let x = 0; x < LPC_FRAME; x += 1) {
      const si = (y * LPC_FRAME + x) * 4;
      if (src64[si + 3] < 128) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return dst;

  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const outW = Math.max(1, Math.min(CHAR_W, Math.round((bw * CHAR_W) / Math.max(bw, bh))));
  const outH = Math.max(1, Math.min(CHAR_H, Math.round((bh * CHAR_H) / Math.max(bw, bh))));
  const offsetX = Math.floor((CHAR_W - outW) / 2);
  const offsetY = CHAR_H - outH;

  for (let dy = 0; dy < outH; dy += 1) {
    for (let dx = 0; dx < outW; dx += 1) {
      const sx = minX + Math.min(bw - 1, Math.floor((dx * bw) / outW));
      const sy = minY + Math.min(bh - 1, Math.floor((dy * bh) / outH));
      const si = (sy * LPC_FRAME + sx) * 4;
      const di = ((offsetY + dy) * CHAR_W + (offsetX + dx)) * 4;
      dst[di] = src64[si];
      dst[di + 1] = src64[si + 1];
      dst[di + 2] = src64[si + 2];
      dst[di + 3] = src64[si + 3];
    }
  }
  return dst;
}

/**
 * Compose one palette row: 4 facings × 6 frames (4 walk + 2 idle), LPC row order down/left/right/up.
 * @param {import('pngjs').PNG} walkPng
 * @param {import('pngjs').PNG} idlePng
 * @param {Uint8Array} atlas
 * @param {number} atlasW
 * @param {number} paletteRow
 */
function blitLpcBodyRow(walkPng, idlePng, atlas, atlasW, paletteRow) {
  for (let fi = 0; fi < FACING_COUNT; fi += 1) {
    for (let wf = 0; wf < WALK_FRAMES; wf += 1) {
      const frame = fitLpcToCharFrame(extractLpcFrame(walkPng, LPC_WALK_COLS[wf], fi));
      blitCharFrame(atlas, atlasW, fi * FRAMES_PER_FACING + wf, paletteRow, frame);
    }
    for (let idf = 0; idf < IDLE_FRAMES; idf += 1) {
      const frame = fitLpcToCharFrame(extractLpcFrame(idlePng, LPC_IDLE_COLS[idf], fi));
      blitCharFrame(atlas, atlasW, fi * FRAMES_PER_FACING + WALK_FRAMES + idf, paletteRow, frame);
    }
  }
}

function buildCharactersAtlas() {
  const bodies = [
    ["body-male-walk.png", "body-male-idle.png"],
    ["body-female-walk.png", "body-female-idle.png"],
    ["body-teen-walk.png", "body-teen-idle.png"],
    ["body-muscular-walk.png", "body-muscular-idle.png"],
  ];
  const cols = FACING_COUNT * FRAMES_PER_FACING;
  const rows = PALETTE_ROW_COUNT;
  const w = cols * CHAR_W;
  const h = rows * CHAR_H;
  const atlas = new Uint8Array(w * h * 4);
  bodies.forEach(([walkFile, idleFile], row) => {
    blitLpcBodyRow(loadLpcPng(walkFile), loadLpcPng(idleFile), atlas, w, row);
  });
  writePng("sprites/characters.png", w, h, atlas);
}

/** NPC sheet: 2 variants × 4 facing rows × 6 frames (matches npcFrameIndex). */
function buildNpcsAtlas() {
  const variants = [
    ["body-female-walk.png", "body-female-idle.png"],
    ["body-teen-walk.png", "body-teen-idle.png"],
  ];
  const cols = FRAMES_PER_FACING;
  const rows = NPC_VARIANT_COUNT * FACING_COUNT;
  const w = cols * CHAR_W;
  const h = rows * CHAR_H;
  const atlas = new Uint8Array(w * h * 4);
  variants.forEach(([walkFile, idleFile], variant) => {
    const walkPng = loadLpcPng(walkFile);
    const idlePng = loadLpcPng(idleFile);
    for (let fi = 0; fi < FACING_COUNT; fi += 1) {
      const atlasRow = variant * FACING_COUNT + fi;
      for (let wf = 0; wf < WALK_FRAMES; wf += 1) {
        const frame = fitLpcToCharFrame(extractLpcFrame(walkPng, LPC_WALK_COLS[wf], fi));
        blitCharFrame(atlas, w, wf, atlasRow, frame);
      }
      for (let idf = 0; idf < IDLE_FRAMES; idf += 1) {
        const frame = fitLpcToCharFrame(extractLpcFrame(idlePng, LPC_IDLE_COLS[idf], fi));
        blitCharFrame(atlas, w, WALK_FRAMES + idf, atlasRow, frame);
      }
    }
  });
  writePng("sprites/npcs.png", w, h, atlas);
}

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  if (flags.has("--help") || flags.has("-h")) {
    console.log(
      "Usage: node scripts/import-phase13-art.mjs [--tiles-only|--decor-only|--characters|--npcs|--all]",
    );
    process.exit(0);
  }
  const all = flags.has("--all") || flags.size === 0;
  return {
    tiles: all || flags.has("--tiles-only"),
    decor: all || flags.has("--decor-only"),
    characters: all || flags.has("--characters"),
    npcs: all || flags.has("--npcs"),
  };
}

function main() {
  const { tiles, decor, characters, npcs } = parseArgs(process.argv);
  if (tiles || decor) {
    const sheet = loadKenneySheet();
    if (tiles) {
      buildBiomesAtlas(sheet);
      buildLazyPacks(sheet);
    }
    if (decor) {
      buildDecorAtlas(sheet);
    }
  }
  if (characters) {
    buildCharactersAtlas();
  }
  if (npcs) {
    buildNpcsAtlas();
  }
  console.log("import-phase13-art: done");
}

main();
