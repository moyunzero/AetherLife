#!/usr/bin/env node
/**
 * Crop + compress Phase 13 UI frame PNGs (requires ffmpeg + pngquant).
 * Run: node scripts/optimize-phase13-ui-frame.mjs
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = path.join(root, "apps/web/public/assets/ui");
const src = path.join(uiDir, "game-viewport-frame-top.png");
const topOut = path.join(uiDir, "game-viewport-frame-top.png");
const tileOut = path.join(uiDir, "game-viewport-frame-tile.png");
const tmpTop = path.join(uiDir, ".frame-top.tmp.png");
const tmpTile = path.join(uiDir, ".frame-tile.tmp.png");

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

function requireBin(name) {
  try {
    execSync(`command -v ${name}`, { stdio: "ignore" });
  } catch {
    console.error(`Missing ${name}. Install ffmpeg + pngquant (e.g. brew install ffmpeg pngquant).`);
    process.exit(1);
  }
}

if (!existsSync(src)) {
  console.error(`Source not found: ${src}`);
  process.exit(1);
}

requireBin("ffmpeg");
requireBin("pngquant");
mkdirSync(uiDir, { recursive: true });

console.log("optimize-phase13-ui-frame: crop top strip 576×96");
run(
  `ffmpeg -y -hide_banner -loglevel error -i "${src}" -vf "crop=576:96:(iw-576)/2:0" -frames:v 1 "${tmpTop}"`,
);

console.log("optimize-phase13-ui-frame: crop tileable wood 128×128");
run(
  `ffmpeg -y -hide_banner -loglevel error -i "${src}" -vf "crop=128:128:640:400" -frames:v 1 "${tmpTile}"`,
);

console.log("optimize-phase13-ui-frame: pngquant");
run(`pngquant --quality=50-82 --strip --force "${tmpTop}" -o "${topOut}"`);
run(`pngquant --quality=50-82 --strip --force "${tmpTile}" -o "${tileOut}"`);

for (const f of [tmpTop, tmpTile]) {
  if (existsSync(f)) unlinkSync(f);
}

const topKb = (statSync(topOut).size / 1024).toFixed(1);
const tileKb = (statSync(tileOut).size / 1024).toFixed(1);
console.log(`optimize-phase13-ui-frame OK  top=${topKb}KB  tile=${tileKb}KB`);
