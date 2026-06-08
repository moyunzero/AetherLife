#!/usr/bin/env node
/**
 * Phase 13.2 — Kenney Tiny Town (CC0) farm/pastoral tile pass.
 * Run: node scripts/import-phase13.2-farm-art.mjs [--tiles-only|--decor-only|--all]
 *
 * Replaces Roguelike dungeon tiles with Tiny Town 16×16 pastoral art.
 * Target display: CELL_PX=48 (3× scale). Pastoral color lift is runtime-only in `pastoralTint.ts` (13.2).
 * Characters/NPCs: `pnpm art:import:character` — not modified by this script.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { PNG } from "pngjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "apps/web/public/assets");
const tinyTownSheet = resolve(
  root,
  "scripts/vendor/phase13.2/tiny-town/Tilemap/tilemap_packed.png",
);

const TILE = 16;
const STEP = 17;
const COLS = 12;

/**
 * Biome walk/blocked/shore — Tiny Town tile indices.
 * @type {Record<string, { walk: number[]; blocked: number; shore: number }>}
 */
/** Walk/blocked must be opaque fills — no shrub/autotile corners (show black at 3× scale @ CELL_PX=48). */
const BIOME_TILES = {
  home: {
    // Uniform warm fills (low quadrant variance) — path tiles 72/73 stripe when cell-scaled.
    walk: [12, 13, 24, 96],
    blocked: 51,
    shore: 12,
  },
  meadow: {
    walk: [12, 13, 24, 96],
    blocked: 52,
    shore: 13,
  },
  scrub: {
    walk: [13, 14, 36, 37],
    blocked: 52,
    shore: 24,
  },
  wetland: {
    walk: [43, 43, 44, 44],
    blocked: 43,
    shore: 44,
  },
  highland: {
    walk: [88, 89, 90, 91],
    blocked: 88,
    shore: 89,
  },
};

/** decor.png frame order — must match homeLayout.ts frame indices. */
const DECOR_FRAMES = [
  85, // 0 door closed (wood wall)
  86, // 1 door open
  28, // 2 bush / shrub
  30, // 3 tree (single tile; sheet 48–61 are cobble/roof, not canopy)
  43, // 4 tree alt (2×2 compat — unused when size=1)
  47, // 5 tree alt
  30, // 6 tree alt
  125, // 7 fence — solidified row-10 rail (108 is stone arch)
  104, // 8 landmark — well (blue rim; 103 is bucket prop)
  44, // 9 wetland shore / reeds
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

function loadSheet() {
  if (!existsSync(tinyTownSheet)) {
    throw new Error(
      `Missing Tiny Town sheet at ${tinyTownSheet}. Extract kenney_tiny-town.zip to scripts/vendor/phase13.2/tiny-town/`,
    );
  }
  return PNG.sync.read(readFileSync(tinyTownSheet));
}

/** @param {import('pngjs').PNG} sheet @param {number} index */
/** Fill transparent pixels with mean opaque color — 3× floor scale otherwise shows black gaps. */
function solidifyTileRgba(rgba) {
  const out = new Uint8Array(rgba);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sn = 0;
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] >= 255) {
      sr += out[i];
      sg += out[i + 1];
      sb += out[i + 2];
      sn += 1;
    }
  }
  if (sn === 0) return out;
  const ar = Math.round(sr / sn);
  const ag = Math.round(sg / sn);
  const ab = Math.round(sb / sn);
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] < 255) {
      out[i] = ar;
      out[i + 1] = ag;
      out[i + 2] = ab;
      out[i + 3] = 255;
    }
  }
  return out;
}

function extractTileByIndex(sheet, index) {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
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
  return solidifyTileRgba(rgba);
}

/** Isotropic pastoral floor — Tiny Town autotile indices stripe at 3× CELL_PX. */
function hashNoise(x, y, seed) {
  return Math.imul(x ^ seed, 0x9e3779b9) ^ Math.imul(y, 0x85ebca6b);
}

function makePastoralWalkTile(seed, palette) {
  const rgba = new Uint8Array(TILE * TILE * 4);
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      const h = hashNoise(x, y, seed) >>> 0;
      const [r, g, b] = palette[h % palette.length];
      const i = (y * TILE + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

const HOME_WALK_PALETTE = [
  [198, 174, 106],
  [188, 164, 98],
  [208, 184, 116],
  [178, 154, 90],
  [218, 194, 126],
];

const MEADOW_WALK_PALETTE = [
  [170, 196, 118],
  [158, 184, 108],
  [182, 206, 128],
  [148, 172, 98],
  [192, 216, 138],
];

const PASTORAL_BLOCKED_PALETTE = [
  [128, 97, 97],
  [118, 88, 88],
  [138, 106, 106],
  [108, 78, 78],
];

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
    if (biome === "home") {
      for (let v = 0; v < 4; v += 1) {
        blitTile(atlas, w, v, row, makePastoralWalkTile(0x484f4d00 + v, HOME_WALK_PALETTE));
      }
      blitTile(atlas, w, 4, row, makePastoralWalkTile(0x484f4db0, PASTORAL_BLOCKED_PALETTE));
      blitTile(atlas, w, 5, row, makePastoralWalkTile(0x484f4d50, HOME_WALK_PALETTE));
    } else if (biome === "meadow") {
      for (let v = 0; v < 4; v += 1) {
        blitTile(atlas, w, v, row, makePastoralWalkTile(0x4d454100 + v, MEADOW_WALK_PALETTE));
      }
      blitTile(atlas, w, 4, row, makePastoralWalkTile(0x4d4541b0, PASTORAL_BLOCKED_PALETTE));
      blitTile(atlas, w, 5, row, makePastoralWalkTile(0x4d454150, MEADOW_WALK_PALETTE));
    } else {
      spec.walk.forEach((tileIndex, v) => {
        const tile = extractTileByIndex(sheet, tileIndex);
        const colors = uniqueColors(tile);
        if (colors < 4) {
          console.warn(`warn: ${biome} walk v${v} idx${tileIndex} only ${colors} colors`);
        }
        blitTile(atlas, w, v, row, tile);
      });
      blitTile(atlas, w, 4, row, extractTileByIndex(sheet, spec.blocked));
      blitTile(atlas, w, 5, row, extractTileByIndex(sheet, spec.shore));
    }
  });
  writePng("tiles/biomes.png", w, h, atlas);
}

function buildLazyPacks(sheet) {
  const packs = [
    ["tiles/biome-scrub.png", BIOME_TILES.scrub.walk[0]],
    ["tiles/biome-wetland.png", BIOME_TILES.wetland.walk[0]],
    ["tiles/biome-highland.png", BIOME_TILES.highland.walk[0]],
  ];
  for (const [path, tileIndex] of packs) {
    writePng(path, TILE, TILE, extractTileByIndex(sheet, tileIndex));
  }
}

function buildDecorAtlas(sheet) {
  const frameCount = DECOR_FRAMES.length;
  const w = frameCount * TILE;
  const atlas = new Uint8Array(w * TILE * 4);
  DECOR_FRAMES.forEach((tileIndex, i) => {
    blitTile(atlas, w, i, 0, extractTileByIndex(sheet, tileIndex));
  });
  writePng("tiles/decor.png", w, TILE, atlas);
}

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  if (flags.has("--help") || flags.has("-h")) {
    console.log(
      "Usage: node scripts/import-phase13.2-farm-art.mjs [--tiles-only|--decor-only|--all]",
    );
    process.exit(0);
  }
  const all = flags.has("--all") || flags.size === 0;
  return {
    tiles: all || flags.has("--tiles-only"),
    decor: all || flags.has("--decor-only"),
  };
}

function main() {
  const { tiles, decor } = parseArgs(process.argv);
  if (!tiles && !decor) {
    console.log("Nothing to do — pass --tiles-only, --decor-only, or --all");
    return;
  }
  const sheet = loadSheet();
  if (tiles) {
    buildBiomesAtlas(sheet);
    buildLazyPacks(sheet);
  }
  if (decor) {
    buildDecorAtlas(sheet);
  }
  console.log("import-phase13.2-farm-art: done");
}

main();
