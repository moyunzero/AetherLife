#!/usr/bin/env node
/**
 * GSD cross-AI review via OpenAI-compatible providers (Agnes, NVIDIA NIM).
 *
 * Complements native /gsd-review (which does not register agnes/nvidia slugs).
 * Expects prompt at /tmp/gsd-review-prompt-{phase}.md from a prior /gsd-review run,
 * or pass --prompt-file.
 *
 * Usage:
 *   pnpm gsd:review:providers -- --phase 20
 *   pnpm gsd:review:providers -- --phase 20 --provider agnes --merge
 *   pnpm gsd:review:providers -- --probe
 */

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defaultOutputPath,
  defaultPromptPath,
  loadOpenAiProviders,
  phaseNumberFromDir,
  resolvePhaseDir,
  resolveProviderRuntime,
} from "./lib/gsd-review-providers-config.mjs";
import {
  probeOpenAiProvider,
  readPromptFile,
  runOpenAiReview,
} from "./lib/gsd-openai-review.mjs";
import { mergeProviderReviews } from "./lib/gsd-review-merge.mjs";

function usage() {
  console.error(`Usage:
  node scripts/gsd-review-providers.mjs --phase <N> [--provider agnes|nvidia|all] [--prompt-file PATH] [--merge] [--probe]

Examples:
  pnpm gsd:review:providers -- --phase 20 --merge
  pnpm gsd:review:providers -- --phase 20 --provider nvidia
  pnpm gsd:review:providers -- --probe`);
  process.exit(1);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = { provider: "all", merge: false, probe: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--phase" && argv[i + 1]) {
      out.phase = argv[++i];
    } else if (a === "--provider" && argv[i + 1]) {
      out.provider = argv[++i];
    } else if (a === "--prompt-file" && argv[i + 1]) {
      out.promptFile = argv[++i];
    } else if (a === "--merge") {
      out.merge = true;
    } else if (a === "--probe") {
      out.probe = true;
    } else if (a === "--help" || a === "-h") {
      usage();
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const allProviders = loadOpenAiProviders();

if (args.probe) {
  let failed = 0;
  for (const spec of Object.values(allProviders)) {
    const { apiKey, model } = resolveProviderRuntime(spec);
    process.stdout.write(`◆ ${spec.label} (${model})… `);
    if (!apiKey) {
      console.log(`SKIP — missing ${spec.apiKeyEnv}`);
      failed++;
      continue;
    }
    const res = await probeOpenAiProvider({
      baseUrl: spec.baseUrl,
      apiKey,
      model,
      timeoutMs: 60_000,
    });
    if (res.ok) {
      console.log(`OK ${res.latencyMs}ms`);
    } else {
      console.log(`FAIL — ${res.error}`);
      failed++;
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

if (!args.phase) usage();

const phaseDir = resolvePhaseDir(String(args.phase));
const phaseNum = phaseNumberFromDir(phaseDir);
const phaseCompact = String(phaseNum).replace(/\./g, "");

const promptFile =
  (typeof args.promptFile === "string" && args.promptFile) ||
  defaultPromptPath(phaseCompact);

if (!existsSync(promptFile)) {
  console.error(
    `Missing review prompt: ${promptFile}\n` +
      `Run /gsd-review ${phaseNum} first (builds /tmp/gsd-review-prompt-*.md), or pass --prompt-file.`,
  );
  process.exit(1);
}

const prompt = readPromptFile(promptFile);
const selectedSlugs =
  args.provider === "all"
    ? Object.keys(allProviders)
    : String(args.provider)
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

/** @type {Array<{ slug: string, label: string, model: string, ok: boolean, content?: string, error?: string, latencyMs?: number }>} */
const results = [];

for (const slug of selectedSlugs) {
  const spec = allProviders[slug];
  if (!spec) {
    console.error(`Unknown provider "${slug}". Known: ${Object.keys(allProviders).join(", ")}`);
    process.exit(1);
  }

  const { apiKey, model } = resolveProviderRuntime(spec);
  const outPath = defaultOutputPath(slug, phaseCompact);

  process.stdout.write(`◆ ${spec.label} (${model})… `);

  if (!apiKey) {
    const err = `missing ${spec.apiKeyEnv}`;
    console.log(`FAIL — ${err}`);
    writeFileSync(outPath, `**Status:** FAILED — ${err}\n`, "utf8");
    results.push({ slug, label: spec.label, model, ok: false, error: err });
    continue;
  }

  const res = await runOpenAiReview({
    baseUrl: spec.baseUrl,
    apiKey,
    model,
    prompt,
    timeoutMs: spec.timeoutMs,
    maxTokens: spec.maxTokens,
  });

  if (res.ok) {
    writeFileSync(outPath, res.content + "\n", "utf8");
    console.log(`OK ${res.latencyMs}ms → ${outPath}`);
    results.push({
      slug,
      label: spec.label,
      model: res.modelReturned ?? model,
      ok: true,
      content: res.content,
      latencyMs: res.latencyMs,
    });
  } else {
    const errLine = `${res.error ?? "failed"}${res.status ? ` (HTTP ${res.status})` : ""}`;
    writeFileSync(outPath, `**Status:** FAILED — ${errLine}\n`, "utf8");
    console.log(`FAIL — ${errLine}`);
    results.push({
      slug,
      label: spec.label,
      model,
      ok: false,
      error: errLine,
      latencyMs: res.latencyMs,
    });
  }
}

if (args.merge) {
  const reviewsFile = `${String(phaseNum).replace(".", "-")}-REVIEWS.md`;
  const reviewsPath = resolve(phaseDir, reviewsFile);
  mergeProviderReviews(reviewsPath, results);
  console.log(`Merged → ${reviewsPath}`);
}

const okCount = results.filter((r) => r.ok).length;
process.exit(okCount === 0 ? 1 : 0);
