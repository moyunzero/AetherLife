#!/usr/bin/env node
/**
 * Generate Stardew-inspired UI art via Agnes Image API — preview/batch only.
 * Does NOT touch apps/web or game integration. Output: tmp/agnes-test/
 *
 * Usage:
 *   node scripts/agnes-ui-assets.mjs --preview     # 6 style samples (default)
 *   node scripts/agnes-ui-assets.mjs --batch         # full manifest (after user OK)
 *   node scripts/agnes-ui-assets.mjs --list          # print manifest ids
 *
 * Requires: AGNES_API_KEY in root .env
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = resolve(root, "tmp/agnes-test");
const previewsDir = resolve(outRoot, "previews");
const batchDir = resolve(outRoot, "batch");

const AGNES_IMAGE_URL = "https://apihub.agnes-ai.com/v1/images/generations";
const MODEL = "agnes-image-2.1-flash";

/** Shared style lock — original art, Stardew *vibe* not copy */
const STYLE =
  "Original pixel art game UI texture for an indie pastoral life-sim, Stardew Valley inspired mood: warm wood, parchment cream, muted greens and browns, hand-crafted 16-bit cozy farmhouse aesthetic, soft ambient lighting, no text, no logos, no copyrighted Stardew assets, flat seamless game UI asset";

/** @type {Array<{ id: string; category: string; size: string; preview: boolean; prompt: string; notes?: string }>} */
const MANIFEST = [
  {
    id: "panel-surface-dark-wood",
    category: "shell",
    size: "1024x1024",
    preview: true,
    prompt: `${STYLE}. Dark walnut wood panel surface texture, subtle grain, archival lamplight mood, for chat sidebar background, tileable seamless pattern`,
    notes: "React panels #1a1814 / wood overlay",
  },
  {
    id: "viewport-frame-top-strip",
    category: "shell",
    size: "1024x256",
    preview: true,
    prompt: `${STYLE}. Horizontal wooden game viewport top bar strip, carved pixel border, warm oak, decorative nails, pastoral life-sim window chrome, wide banner aspect ratio`,
    notes: "Crop to ~576×96 like game-viewport-frame-top",
  },
  {
    id: "composer-parchment-tile",
    category: "shell",
    size: "1024x1024",
    preview: true,
    prompt: `${STYLE}. Seamless tileable aged parchment paper texture with faint fiber, cream beige, for chat composer input area, subtle worn edges when tiled`,
    notes: "Seamless tile for composer background",
  },
  {
    id: "button-accent-gold",
    category: "controls",
    size: "512x512",
    preview: true,
    prompt: `${STYLE}. Single golden amber pixel art UI button, rounded corners, warm highlight #c9a227 accent, wood bevel, idle state, centered on transparent or dark bg, send/action button`,
    notes: "Primary CTA — 发送",
  },
  {
    id: "tab-npc-chrome",
    category: "controls",
    size: "1024x512",
    preview: true,
    prompt: `${STYLE}. NPC conversation tab bar UI strip showing active tab (gold accent) and inactive tabs (muted wood), horizontal pixel art tabs, life-sim dialogue panel`,
    notes: "Active NPC tab + inactive tabs reference",
  },
  {
    id: "hud-coord-pill",
    category: "hud",
    size: "512x256",
    preview: true,
    prompt: `${STYLE}. Small rounded HUD pill badge background, dark wood with gold trim, for coordinate/explore readout overlay, minimal pixel UI chip`,
    notes: "Explore strip mono coords",
  },
  {
    id: "viewport-frame-tile-wood",
    category: "shell",
    size: "1024x1024",
    preview: false,
    prompt: `${STYLE}. Seamless tileable warm oak wood plank texture, pixel art, for repeating viewport border fill`,
  },
  {
    id: "panel-surface-elevated",
    category: "shell",
    size: "1024x1024",
    preview: false,
    prompt: `${STYLE}. Slightly lighter elevated wood panel surface, subtle bevel, for memory panel / secondary surfaces`,
  },
  {
    id: "button-secondary-wood",
    category: "controls",
    size: "512x512",
    preview: false,
    prompt: `${STYLE}. Secondary pixel art wood button, neutral brown, idle state, cancel/back style`,
  },
  {
    id: "button-destructive-red",
    category: "controls",
    size: "512x512",
    preview: false,
    prompt: `${STYLE}. Destructive pixel art button, muted red #b54a4a, reset confirm dialog, wood frame`,
  },
  {
    id: "input-field-bg",
    category: "controls",
    size: "1024x256",
    preview: false,
    prompt: `${STYLE}. Text input field background strip, inset parchment with dark wood border, pixel art, empty no placeholder text`,
  },
  {
    id: "divider-wood-horizontal",
    category: "shell",
    size: "1024x128",
    preview: false,
    prompt: `${STYLE}. Horizontal wooden divider rule, pixel art ornamental line, seamless width`,
  },
  {
    id: "dialog-box-frame-9slice",
    category: "dialog",
    size: "1024x1024",
    preview: false,
    prompt: `${STYLE}. RPG dialogue box frame reference with corners and edges visible, parchment center, wood border, 9-slice layout guide, speech bubble panel for NPC chat`,
  },
  {
    id: "chat-bubble-npc",
    category: "dialog",
    size: "512x512",
    preview: false,
    prompt: `${STYLE}. NPC speech bubble tail pointing down, parchment pixel art, small cozy life-sim chat bubble`,
  },
  {
    id: "chat-bubble-player",
    category: "dialog",
    size: "512x512",
    preview: false,
    prompt: `${STYLE}. Player speech bubble tail pointing down, slightly warmer cream tone, pixel art life-sim`,
  },
  {
    id: "icon-sheet-memory-chat-settings-map",
    category: "icons",
    size: "1024x1024",
    preview: false,
    prompt: `${STYLE}. Sprite sheet grid of 4 pixel art icons: open book memory, speech bubble chat, gear settings, folded map, 2x2 layout, consistent 64px icon style, transparent background between icons`,
  },
  {
    id: "icon-inventory-slot",
    category: "icons",
    size: "512x512",
    preview: false,
    prompt: `${STYLE}. Empty inventory slot frame, wooden square with dark inset, pixel art, Stardew-like item grid cell`,
  },
  {
    id: "icon-heart-energy-stats",
    category: "icons",
    size: "1024x512",
    preview: false,
    prompt: `${STYLE}. Three small pixel icons in a row: heart life, lightning energy, star friendship, pastoral life-sim HUD stats`,
  },
  {
    id: "scroll-track-thumb",
    category: "controls",
    size: "256x1024",
    preview: false,
    prompt: `${STYLE}. Vertical scrollbar track and thumb pixel art, wood track with gold thumb, narrow UI element`,
  },
  {
    id: "loading-bar-bg-fill",
    category: "boot",
    size: "1024x256",
    preview: false,
    prompt: `${STYLE}. Game loading progress bar, empty wood trough background and filled green-gold progress segment, pixel art boot screen element`,
  },
  {
    id: "thinking-bubble-dots",
    category: "world-overlay",
    size: "256x256",
    preview: false,
    prompt: `${STYLE}. Small pixel art thinking indicator three dots in cloud bubble, for NPC above-head sprite, transparent background`,
  },
];

/** @param {string} path */
function loadEnv(path) {
  if (!existsSync(path)) {
    console.error("Missing .env — set AGNES_API_KEY");
    process.exit(1);
  }
  /** @type {Record<string, string>} */
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[trimmed.slice(0, eq).trim()] = value;
  }
  return env;
}

/** @param {string} url @param {string} dest */
async function downloadUrl(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

/**
 * @param {{ apiKey: string; item: typeof MANIFEST[0]; destDir: string }} opts
 */
async function generateOne({ apiKey, item, destDir }) {
  const body = {
    model: MODEL,
    prompt: item.prompt,
    size: item.size,
  };

  const res = await fetch(AGNES_IMAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Agnes ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json();
  const imageUrl = json?.data?.[0]?.url;
  if (!imageUrl) throw new Error("No image URL in response");

  mkdirSync(destDir, { recursive: true });
  const pngPath = resolve(destDir, `${item.id}.png`);
  const metaPath = resolve(destDir, `${item.id}.json`);

  await downloadUrl(imageUrl, pngPath);
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        id: item.id,
        category: item.category,
        size: item.size,
        model: MODEL,
        prompt: item.prompt,
        notes: item.notes ?? null,
        sourceUrl: imageUrl,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  return pngPath;
}

function writeManifestDoc() {
  const lines = [
    "# Agnes UI Asset Manifest — AetherLife",
    "",
    "> **Stardew-inspired pastoral UI** — original generated art, not game-integrated.",
    "> Preview: `pnpm art:agnes:preview` · Full batch: `pnpm art:agnes:batch` (after design OK)",
    "",
    "## Style contract",
    "",
    "- Mood: warm wood + parchment, muted pastoral, archival lamplight shell (#0f0e0c / #c9a227 accent)",
    "- Reference: [13-UI-SPEC.md](../.planning/phases/13-phaser-world-visuals/13-UI-SPEC.md) — **inspired by** Stardew, no copyright copy",
    "- Post-process (manual): crop, pngquant, 9-slice — not automated in this script",
    "",
    "## Preview set (6)",
    "",
    "| ID | Category | Size | Purpose |",
    "|----|----------|------|---------|",
  ];

  for (const item of MANIFEST.filter((x) => x.preview)) {
    lines.push(`| \`${item.id}\` | ${item.category} | ${item.size} | ${item.notes ?? "—"} |`);
  }

  lines.push("", "## Full batch (after approval)", "", "| ID | Category | Preview | Notes |", "|----|----------|---------|-------|");

  for (const item of MANIFEST.filter((x) => !x.preview)) {
    lines.push(`| \`${item.id}\` | ${item.category} | — | ${item.notes ?? item.prompt.slice(0, 60) + "…"} |`);
  }

  lines.push("", "## Categories", "", "- **shell** — panels, viewport frame, dividers", "- **controls** — buttons, tabs, inputs, scroll", "- **hud** — coord pill, stats", "- **dialog** — speech boxes, bubbles", "- **icons** — memory, chat, inventory slots", "- **boot** — loading bar", "- **world-overlay** — NPC thinking bubble", "");

  writeFileSync(resolve(outRoot, "ASSET-MANIFEST.md"), lines.join("\n"));
}

async function main() {
  const args = process.argv.slice(2);
  const listOnly = args.includes("--list");
  const batch = args.includes("--batch");
  const preview = args.includes("--preview") || (!batch && !listOnly);

  writeManifestDoc();

  if (listOnly) {
    for (const item of MANIFEST) {
      console.log(`${item.preview ? "[preview]" : "[batch]  "} ${item.id} (${item.category})`);
    }
    console.log(`\nManifest: ${resolve(outRoot, "ASSET-MANIFEST.md")}`);
    return;
  }

  const env = loadEnv(resolve(root, ".env"));
  const apiKey = env.AGNES_API_KEY?.trim();
  if (!apiKey) {
    console.error("AGNES_API_KEY missing in .env");
    process.exit(1);
  }

  const items = batch ? MANIFEST : MANIFEST.filter((x) => x.preview);
  const destDir = batch ? batchDir : previewsDir;
  mkdirSync(destDir, { recursive: true });

  console.log(`agnes-ui-assets: mode=${batch ? "batch" : "preview"} count=${items.length} → ${destDir}`);

  /** @type {Array<{ id: string; ok: boolean; path?: string; error?: string }>} */
  const results = [];

  for (const item of items) {
    process.stdout.write(`  generating ${item.id}… `);
    try {
      const pngPath = await generateOne({ apiKey, item, destDir });
      results.push({ id: item.id, ok: true, path: pngPath });
      console.log("OK");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: item.id, ok: false, error: msg });
      console.log(`FAIL — ${msg.slice(0, 120)}`);
    }
  }

  const summaryPath = resolve(destDir, "_run-summary.json");
  writeFileSync(
    summaryPath,
    JSON.stringify({ mode: batch ? "batch" : "preview", results, at: new Date().toISOString() }, null, 2),
  );

  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  console.log(`\nDone: ${ok} OK, ${fail} failed`);
  console.log(`Output: ${destDir}`);
  console.log(`Manifest: ${resolve(outRoot, "ASSET-MANIFEST.md")}`);

  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
