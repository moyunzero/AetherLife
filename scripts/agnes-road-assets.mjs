#!/usr/bin/env node
/**
 * Generate Stardew-inspired **road/path tile** art via Agnes Image API.
 * Preview/experiment only — output tmp/agnes-test/roads/, NOT game integration.
 *
 * Usage:
 *   node scripts/agnes-road-assets.mjs           # all road variants
 *   node scripts/agnes-road-assets.mjs --list
 *   node scripts/agnes-road-assets.mjs --only dirt-warm,cobble-village
 *   node scripts/agnes-road-assets.mjs --supplement   # curves, water, plowed edges only
 *
 * Requires: AGNES_API_KEY in root .env
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = resolve(root, "tmp/agnes-test/roads");

const AGNES_IMAGE_URL = "https://apihub.agnes-ai.com/v1/images/generations";
const MODEL = "agnes-image-2.1-flash";

/**
 * Stardew-aligned terrain cues (wiki + autotile refs):
 * - 16×16 top-down tiles; craftable farm paths use neighbor autotile (straight/outer corner/inner corner/T/end)
 * - Warm tan packed-earth paths (~#C4A675), bright pastoral grass (~#6DB856), plowed soil with horizontal furrows (~#9B5523/#B87333)
 * - Organic soft irregular grass↔dirt edges (scattered grass pixels), not hard geometric borders
 * - Water shore: muddy wet green-brown strip then teal-blue water; curved bays use smooth quarter-circle edges
 */
/** Models draw visible grid/separator lines when prompts mention grid, atlas, 4x4, sprite sheet. */
const ANTI_GRID =
  "ABSOLUTELY NO sprite sheet, NO atlas layout, NO visible grid lines, NO separator lines, NO tile borders, NO white or black dividers, NO checkerboard frame, NO gray-white transparency checker pattern, NO empty margin, image fully opaque terrain to all four edges, NO 4x4 or 5x5 layout drawing";

const STYLE_BASE =
  "Top-down 16-bit pixel art, Stardew Valley farm path aesthetic (original art, not copying official sprites), warm tan craftable dirt paths, bright pastoral green grass, reddish-brown plowed soil with horizontal hoe furrows, calm teal farm pond water, organic soft irregular transition edges, limited ~16-color palette, crisp pixel art";

const NO_UI =
  "CRITICAL: no text no letters no words no numbers no signs no buildings no characters no items, terrain only";

/** Homogeneous fill — one seamless tileable texture (no multi-cell sheet). */
const seamless = (detail) =>
  `Seamless top-down 16-bit pixel art ground texture for a cozy farming game. ${detail}. The WHOLE image is ONLY this surface material — no grass, no water, no ponds, no plowed fields, no trees, no map layout, no paths on grass. One continuous repeating pattern from edge to edge. ${ANTI_GRID}. ${NO_UI}`;

/** Connected map crop — autotile variants as one organic landscape (not a sheet). */
const scene = (detail) =>
  `${STYLE_BASE}. ${detail}. ${ANTI_GRID}. One single connected top-down farm map fragment like a Stardew gameplay screenshot crop, terrain extends to all four image edges, all path shapes flow naturally in one landscape, NOT a sprite sheet NOT an atlas NOT multiple separated cells. ${NO_UI}`;

/** @type {Array<{ id: string; biome: string; size: string; prompt: string; notes: string }>} */
const ROADS = [
  {
    id: "dirt-warm-homestead",
    biome: "home",
    size: "1024x1024",
    prompt: seamless(
      "Warm brown packed-earth homestead dirt footpath, subtle pebbles, craftable farm path surface",
    ),
    notes: "Home 土路主纹理 — 可裁 16×16",
  },
  {
    id: "dirt-grass-edge-transitions",
    biome: "home",
    size: "1024x1024",
    prompt: scene(
      "Small farm area showing dirt path meeting grass: straight edges, outer corners, inner corners, T-junction, organic grass-to-dirt blends",
    ),
    notes: "土路与草地过渡（直/角/T）",
  },
  {
    id: "cobble-village-light",
    biome: "home",
    size: "1024x1024",
    prompt: seamless(
      "Light gray-beige cobblestone village road surface, worn rounded stones, small grass tufts in cracks, pastoral town path",
    ),
    notes: "村镇浅色鹅卵石路",
  },
  {
    id: "cobble-village-worn",
    biome: "home",
    size: "1024x1024",
    prompt: seamless(
      "Darker worn cobblestone road surface, muddy gaps between stones, weathered village alley",
    ),
    notes: "旧石路 / 巷弄",
  },
  {
    id: "wood-plank-walkway",
    biome: "home",
    size: "1024x1024",
    prompt: seamless(
      "Wooden plank walkway surface, warm oak boards with grain, farm porch deck path",
    ),
    notes: "木板步道（农舍/码头感）",
  },
  {
    id: "gravel-country-trail",
    biome: "meadow",
    size: "1024x1024",
    prompt: seamless(
      "Gravel country trail surface, tan and gray small stones on compacted soil, meadow hiking path",
    ),
    notes: "野外碎石小径 — meadow",
  },
  {
    id: "leaf-covered-trail",
    biome: "scrub",
    size: "1024x1024",
    prompt: seamless(
      "Dry leaf-covered dirt trail surface, autumn brown and olive tones, scattered fallen leaves",
    ),
    notes: "落叶土路 — scrub",
  },
  {
    id: "mud-wetland-trail",
    biome: "wetland",
    size: "1024x1024",
    prompt: seamless(
      "Muddy wetland trail surface, dark brown mud with shallow puddle sheen, soft blue-green mud tones",
    ),
    notes: "泥路/岸径 — wetland",
  },
  {
    id: "stone-paver-garden",
    biome: "home",
    size: "1024x1024",
    prompt: seamless(
      "Formal garden stone paver path surface, square cut flagstones with moss in gaps, flagstone brick pattern on ground only",
    ),
    notes: "花园石板路",
  },
  {
    id: "highland-gravel-rocky",
    biome: "highland",
    size: "1024x1024",
    prompt: seamless(
      "Rocky highland gravel path surface, gray-brown crushed rock on hard soil, sparse alpine trail",
    ),
    notes: "高地碎石路 — highland",
  },
  {
    id: "crossroads-junction-set",
    biome: "home",
    size: "1024x1024",
    prompt: scene(
      "Farm dirt path network in one map: crossroads center, T intersections, straight horizontal and vertical segments, path end caps on grass",
    ),
    notes: "十字路口 / T 字 / 直道 / 端头",
  },
  {
    id: "bridge-wood-planks",
    biome: "wetland",
    size: "1024x512",
    prompt: scene(
      "Short wooden bridge over teal farm pond water, horizontal oak plank deck, rope or rail hints at sides, water visible left and right",
    ),
    notes: "木桥面板（湿地过渡用）",
  },
];

/** Supplement: curves, water shore, plowed field edges — Stardew autotile variants */
const ROADS_SUPPLEMENT = [
  {
    id: "path-curve-bends-dedicated",
    biome: "home",
    size: "1024x1024",
    preview: true,
    prompt: scene(
      "Farm map fragment with curved tan dirt paths only: quarter-circle outer corners, inner corners, S-curve bends, U-turn caps on green grass, no straight long roads",
    ),
    notes: "弯道专用 — 外角/内角/S弯/端帽",
  },
  {
    id: "path-curve-inner-outer-corners",
    biome: "home",
    size: "1024x1024",
    preview: true,
    prompt: scene(
      "Farm map showing path corner variety: inner corners where grass wraps concave into path, outer convex rounded bends, diagonal curved connectors, narrow tan path on grass",
    ),
    notes: "弯道 — 内角/外角/对角弯",
  },
  {
    id: "path-water-shore-straight",
    biome: "wetland",
    size: "1024x1024",
    preview: true,
    prompt: scene(
      "Farm pond with straight shorelines: grass and tan dirt path meeting calm teal water, wet muddy dark green-brown shore strip, north south east west straight edges",
    ),
    notes: "与水面交界 — 直线岸",
  },
  {
    id: "path-water-shore-curved",
    biome: "wetland",
    size: "1024x1024",
    preview: true,
    prompt: scene(
      "Farm pond with curved bays and peninsulas: grass and tan path meeting teal water, organic muddy shore blend, inner and outer water corners",
    ),
    notes: "与水面交界 — 弯道/湾角",
  },
  {
    id: "path-water-dirt-shore-combo",
    biome: "wetland",
    size: "1024x1024",
    preview: true,
    prompt: scene(
      "Small wetland map: tan dirt footpath ending at water, grass-to-water shore, dirt-to-water shore, optional wet reeds at edge",
    ),
    notes: "土路/草地 → 水面 组合过渡",
  },
  {
    id: "path-plowed-field-straight",
    biome: "home",
    size: "1024x1024",
    preview: true,
    prompt: scene(
      "Farm field edges: reddish-brown hoed soil with horizontal furrows meeting tan dirt path and bright green grass, straight boundaries north south east west",
    ),
    notes: "与 plowed field 交界 — 直线",
  },
  {
    id: "path-plowed-field-curved",
    biome: "home",
    size: "1024x1024",
    preview: true,
    prompt: scene(
      "Curved farm field boundaries: rounded corners where tilled soil meets grass or dirt path, visible hoe furrows on plowed side",
    ),
    notes: "与 plowed field 交界 — 弯道",
  },
  {
    id: "path-plowed-dirt-grass-triple",
    biome: "home",
    size: "1024x1024",
    preview: true,
    prompt: scene(
      "Farm corner where plowed tilled soil, tan dirt path, and green grass meet: straight and corner triple-terrain transitions, furrows only on plowed soil",
    ),
    notes: "耕地 + 土路 + 草地 三向过渡",
  },
];

const ALL_ROADS = [...ROADS, ...ROADS_SUPPLEMENT];

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
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

/**
 * @param {{ apiKey: string; item: typeof ROADS[0] }} opts
 */
async function generateOne({ apiKey, item }) {
  const res = await fetch(AGNES_IMAGE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: item.prompt,
      size: item.size,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Agnes ${res.status}: ${err.slice(0, 300)}`);
  }

  const json = await res.json();
  const imageUrl = json?.data?.[0]?.url;
  if (!imageUrl) throw new Error("No image URL in response");

  mkdirSync(outRoot, { recursive: true });
  const pngPath = resolve(outRoot, `${item.id}.png`);
  const metaPath = resolve(outRoot, `${item.id}.json`);

  await downloadUrl(imageUrl, pngPath);
  writeFileSync(
    metaPath,
    JSON.stringify(
      {
        id: item.id,
        biome: item.biome,
        size: item.size,
        model: MODEL,
        prompt: item.prompt,
        notes: item.notes,
        sourceUrl: imageUrl,
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  return pngPath;
}

function writeRoadManifest() {
  const row = (r) => `| \`${r.id}\` | ${r.biome} | ${r.notes} |`;
  const lines = [
    "# Agnes Road / Path Tile Manifest",
    "",
    "> Stardew-inspired pastoral paths · **no text** · `tmp/agnes-test/roads/` only",
    "> Target: **16×16** autotile slices (straight / outer corner / inner corner / T / end / curve / shore / plowed edge)",
    "",
    "## Stardew style reference (prompt lock)",
    "",
    "- Craftable farm paths: warm tan packed earth, neighbor-based autotile ([Floors and Paths](https://stardewvalleywiki.com/Modding:Floors_and_Paths) ConnectType Path/Default)",
    "- Grass: bright pastoral green, organic soft irregular edges",
    "- Plowed field: reddish-brown tilled soil + horizontal hoe furrows",
    "- Water shore: muddy wet strip → calm teal pond/farm water",
    "- **Prompt v3:** base = `seamless()` 无缝平铺；过渡 = `scene()` 连续地图片段 — 禁止 grid/atlas/sprite sheet 字样",
    "",
    "### Base roads",
    "",
    "| ID | Biome | Notes |",
    "|----|-------|-------|",
    ...ROADS.map(row),
    "",
    "### Supplement — curves, water, plowed",
    "",
    "| ID | Biome | Notes |",
    "|----|-------|-------|",
    ...ROADS_SUPPLEMENT.map(row),
    "",
    "## Regenerate",
    "",
    "```bash",
    "pnpm art:agnes:roads              # all base",
    "pnpm art:agnes:roads:supplement   # curves + water + plowed only",
    "node scripts/agnes-road-assets.mjs --only path-curve-bends-dedicated",
    "```",
    "",
  ];
  writeFileSync(resolve(root, "tmp/agnes-test/ROADS-MANIFEST.md"), lines.join("\n"));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--list")) {
    console.log("=== base ===");
    for (const r of ROADS) console.log(`${r.id} (${r.biome}) — ${r.notes}`);
    console.log("\n=== supplement ===");
    for (const r of ROADS_SUPPLEMENT) console.log(`${r.id} (${r.biome}) — ${r.notes}`);
    return;
  }

  writeRoadManifest();

  const supplement = args.includes("--supplement");
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const onlyIds = onlyArg
    ? onlyArg
        .slice("--only=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  let items = supplement ? ROADS_SUPPLEMENT : ROADS;
  if (onlyIds?.length) {
    items = ALL_ROADS.filter((r) => onlyIds.includes(r.id));
    if (items.length === 0) {
      console.error(`No matching road ids. Run --list`);
      process.exit(1);
    }
  }

  const env = loadEnv(resolve(root, ".env"));
  const apiKey = env.AGNES_API_KEY?.trim();
  if (!apiKey) {
    console.error("AGNES_API_KEY missing in .env");
    process.exit(1);
  }

  console.log(`agnes-road-assets: generating ${items.length} road sets → ${outRoot}`);

  /** @type {Array<{ id: string; ok: boolean; path?: string; error?: string }>} */
  const results = [];

  for (const item of items) {
    process.stdout.write(`  ${item.id}… `);
    try {
      const pngPath = await generateOne({ apiKey, item });
      results.push({ id: item.id, ok: true, path: pngPath });
      console.log("OK");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ id: item.id, ok: false, error: msg });
      console.log(`FAIL — ${msg.slice(0, 100)}`);
    }
  }

  writeFileSync(
    resolve(outRoot, "_run-summary.json"),
    JSON.stringify({ results, at: new Date().toISOString() }, null, 2),
  );

  const ok = results.filter((r) => r.ok).length;
  console.log(`\nDone: ${ok}/${results.length} OK → ${outRoot}`);
  console.log(`Manifest: ${resolve(root, "tmp/agnes-test/ROADS-MANIFEST.md")}`);
  if (ok < results.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
