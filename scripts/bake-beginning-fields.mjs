#!/usr/bin/env node
/**
 * Bake assets/one-city/BeginningFields.json for Phaser (inline external TSX + copy PNGs).
 *
 * Atlas TSX → manifest kind "spritesheet" (ISSUE-042 / Guardrail #63).
 * Collection-of-images → kind "image".
 *
 * Usage:
 *   node scripts/bake-beginning-fields.mjs
 *   FANTASY_TILESET_ROOT="/path/to/The Fan-tasy Tileset (Free)" node scripts/bake-beginning-fields.mjs
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mapSourcePath = resolve(root, "assets/one-city/BeginningFields.json");
const mapOutName = "BeginningFields.json";
const outDir = resolve(root, "apps/web/public/assets/one-city");
const tilesetOutDir = join(outDir, "tilesets");
const manifestTsPath = resolve(
  root,
  "apps/web/src/game/oneCityTilesetManifest.ts",
);
/** @type {object[]} */
const tilesetManifest = [];

const fantasyRoot =
  process.env.FANTASY_TILESET_ROOT ??
  resolve(process.env.HOME ?? "", "Downloads/The Fan-tasy Tileset (Free)");
const tiledTilesetsDir = join(fantasyRoot, "Tiled/Tilesets");

/** @param {string} xml */
function attr(xml, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(xml);
  return m?.[1] ?? "";
}

/** @param {string} attrs */
function parseImageAttrs(attrs) {
  const source = /source="([^"]+)"/.exec(attrs)?.[1];
  const width = Number(/width="(\d+)"/.exec(attrs)?.[1] ?? 0);
  const height = Number(/height="(\d+)"/.exec(attrs)?.[1] ?? 0);
  if (!source || width <= 0 || height <= 0) return null;
  return { source, width, height };
}

/** @param {string} tsxPath */
function parseTsx(tsxPath) {
  const xml = readFileSync(tsxPath, "utf8");
  const open = xml.match(/<tileset[\s\S]*?>/)?.[0] ?? "";
  const name = attr(open, "name");
  const tilewidth = Number(attr(open, "tilewidth") || 16);
  const tileheight = Number(attr(open, "tileheight") || 16);
  const tilecount = Number(attr(open, "tilecount") || 0);
  const columns = Number(attr(open, "columns") || 0);

  /** @type {{ id: number, width: number, height: number, source: string }[]} */
  const collectionTiles = [];
  const tileRe = /<tile id="(\d+)">\s*<image\s([^>]+?)\/?>/g;
  let m;
  while ((m = tileRe.exec(xml)) !== null) {
    const img = parseImageAttrs(m[2]);
    if (!img) continue;
    collectionTiles.push({
      id: Number(m[1]),
      width: img.width,
      height: img.height,
      source: img.source,
    });
  }

  const firstTileIdx = xml.indexOf('<tile id="');
  const beforeTiles = firstTileIdx === -1 ? xml : xml.slice(0, firstTileIdx);
  const atlasMatch = beforeTiles.match(
    /<image source="([^"]+)" width="(\d+)" height="(\d+)"/,
  );

  return {
    name,
    tilewidth,
    tileheight,
    tilecount,
    columns,
    atlas: atlasMatch
      ? {
          source: atlasMatch[1],
          width: Number(atlasMatch[2]),
          height: Number(atlasMatch[3]),
        }
      : null,
    collectionTiles,
    animationTiles: parseAtlasTileAnimations(xml),
  };
}

/** @param {string} xml */
function parseAtlasTileAnimations(xml) {
  /** @type {{ id: number, animation: { tileid: number, duration: number }[] }[]} */
  const tiles = [];
  const tileBlockRe = /<tile id="(\d+)">([\s\S]*?)<\/tile>/g;
  let m;
  while ((m = tileBlockRe.exec(xml)) !== null) {
    if (!m[2].includes("<animation>")) continue;
    /** @type {{ tileid: number, duration: number }[]} */
    const animation = [];
    const frameRe = /<frame tileid="(\d+)" duration="(\d+)"\s*\/?>/g;
    let fm;
    while ((fm = frameRe.exec(m[2])) !== null) {
      animation.push({ tileid: Number(fm[1]), duration: Number(fm[2]) });
    }
    if (animation.length > 0) {
      tiles.push({ id: Number(m[1]), animation });
    }
  }
  return tiles;
}

/** @type {Map<string, string>} dest basename -> absolute src */
const copiedImages = new Map();

/**
 * @param {string} srcAbs
 * @param {string} preferredName
 */
function registerCollectionImage(key, relativePath) {
  tilesetManifest.push({
    kind: "image",
    key,
    url: `/assets/one-city/${relativePath}`,
  });
}

function registerAtlasSpritesheet(key, relativePath, frameWidth, frameHeight) {
  tilesetManifest.push({
    kind: "spritesheet",
    key,
    url: `/assets/one-city/${relativePath}`,
    frameWidth,
    frameHeight,
  });
}

function copyTileImage(srcAbs, preferredName) {
  if (!existsSync(srcAbs)) {
    throw new Error(`Missing image: ${srcAbs}`);
  }
  let destName = preferredName.replace(/[^\w.-]+/g, "_");
  if (copiedImages.has(destName)) {
    const prev = copiedImages.get(destName);
    if (prev === srcAbs) return `tilesets/${destName}`;
    destName = `${basename(preferredName, ".png")}_${basename(srcAbs)}`.replace(
      /[^\w.-]+/g,
      "_",
    );
  }
  copiedImages.set(destName, srcAbs);
  const destAbs = join(tilesetOutDir, destName);
  copyFileSync(srcAbs, destAbs);
  return `tilesets/${destName}`;
}

/**
 * @param {string} tsxFileName
 * @param {number} firstgid
 */
function bakeTileset(tsxFileName, firstgid) {
  const tsxPath = join(tiledTilesetsDir, tsxFileName);
  if (!existsSync(tsxPath)) {
    throw new Error(`Missing TSX: ${tsxPath}`);
  }
  const parsed = parseTsx(tsxPath);
  const base = {
    firstgid,
    name: parsed.name,
    tilewidth: parsed.tilewidth,
    tileheight: parsed.tileheight,
    tilecount: parsed.tilecount,
    columns: parsed.columns,
    margin: 0,
    spacing: 0,
  };

  if (parsed.collectionTiles.length > 0) {
    const tiles = parsed.collectionTiles.map((t) => {
      const srcAbs = resolve(tsxPath, "..", t.source);
      const imgName = `${parsed.name}_${t.id}_${basename(t.source)}`;
      const image = copyTileImage(srcAbs, imgName);
      registerCollectionImage(image, image);
      return {
        id: t.id,
        image,
        imagewidth: t.width,
        imageheight: t.height,
      };
    });
    return { ...base, tiles };
  }

  if (!parsed.atlas) {
    throw new Error(`TSX has no atlas or collection tiles: ${tsxPath}`);
  }
  const srcAbs = resolve(tsxPath, "..", parsed.atlas.source);
  const image = copyTileImage(srcAbs, `${parsed.name}.png`);
  registerAtlasSpritesheet(parsed.name, image, parsed.tilewidth, parsed.tileheight);

  /** @type {Record<string, unknown>} */
  const baked = {
    ...base,
    image,
    imagewidth: parsed.atlas.width,
    imageheight: parsed.atlas.height,
  };

  if (parsed.animationTiles.length > 0) {
    baked.tiles = parsed.animationTiles;
  }

  return baked;
}

/**
 * Flatten Tiled group layers; merge group opacity into children.
 * @param {object[]} layers
 * @param {number} parentOpacity
 */
function flattenLayers(layers, parentOpacity = 1) {
  /** @type {object[]} */
  const out = [];
  for (const layer of layers) {
    if (layer.type === "group") {
      const groupOpacity = (layer.opacity ?? 1) * parentOpacity;
      out.push(...flattenLayers(layer.layers ?? [], groupOpacity));
      continue;
    }
    out.push({
      ...layer,
      opacity: (layer.opacity ?? 1) * parentOpacity,
    });
  }
  return out;
}

function main() {
  if (!existsSync(mapSourcePath)) {
    throw new Error(`Map JSON not found: ${mapSourcePath}`);
  }
  if (!existsSync(tiledTilesetsDir)) {
    throw new Error(
      `Fan-tasy tilesets dir not found: ${tiledTilesetsDir}\nSet FANTASY_TILESET_ROOT to the extracted pack root.`,
    );
  }

  mkdirSync(tilesetOutDir, { recursive: true });

  const map = JSON.parse(readFileSync(mapSourcePath, "utf8"));
  /** @type {object[]} */
  const embeddedTilesets = [];
  for (const ref of map.tilesets) {
    if (!ref.source) continue;
    const tsxName = basename(ref.source.replace(/\\/g, "/"));
    embeddedTilesets.push(bakeTileset(tsxName, ref.firstgid));
  }

  const baked = {
    compressionlevel: map.compressionlevel,
    height: map.height,
    width: map.width,
    infinite: map.infinite,
    layers: flattenLayers(map.layers),
    nextlayerid: map.nextlayerid,
    nextobjectid: map.nextobjectid,
    orientation: map.orientation,
    renderorder: map.renderorder,
    tiledversion: map.tiledversion,
    tileheight: map.tileheight,
    tilewidth: map.tilewidth,
    tilesets: embeddedTilesets,
    type: map.type,
    version: map.version,
  };

  const outJson = join(outDir, mapOutName);
  writeFileSync(outJson, JSON.stringify(baked, null, 2));
  console.log(`Wrote ${outJson}`);

  const manifestBody = `/** Auto-generated by scripts/bake-beginning-fields.mjs — do not edit. */
import type { AssetSheetDef } from "./assetManifest.js";

export const ONE_CITY_TILESET_IMAGES: AssetSheetDef[] = ${JSON.stringify(tilesetManifest, null, 2)};
`;
  writeFileSync(manifestTsPath, manifestBody);
  console.log(`Wrote ${manifestTsPath} (${tilesetManifest.length} textures)`);

  console.log(`Copied ${copiedImages.size} tileset images to ${tilesetOutDir}`);
}

main();
