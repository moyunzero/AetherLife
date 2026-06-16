/**
 * Merge OpenAI-provider review sections into {phase}-REVIEWS.md (GSD format).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { phaseNumberFromDir } from "./gsd-review-providers-config.mjs";

/**
 * @param {string} reviewsPath
 * @param {Array<{ slug: string, label: string, model: string, ok: boolean, content?: string, error?: string, latencyMs?: number }>} results
 */
export function mergeProviderReviews(reviewsPath, results) {
  const phaseSlug = basename(resolve(reviewsPath, ".."));
  const phaseNum = phaseNumberFromDir(phaseSlug);
  const paddedPrefix = phaseNum.includes(".")
    ? phaseNum.replace(".", "-")
    : String(phaseNum).padStart(2, "0");

  let body = existsSync(reviewsPath)
    ? readFileSync(reviewsPath, "utf8")
    : buildEmptyReviewsSkeleton(phaseNum, phaseSlug);

  for (const r of results) {
    body = upsertReviewSection(body, r);
  }

  body = updateFrontmatterReviewers(body, results);

  writeFileSync(reviewsPath, body, "utf8");
  return reviewsPath;
}

/** @param {string} phaseNum @param {string} phaseSlug */
function buildEmptyReviewsSkeleton(phaseNum, phaseSlug) {
  return `---
phase: ${phaseNum}
reviewers: []
reviewed_at: ${new Date().toISOString()}
plans_reviewed: []
note: "OpenAI provider reviews merged by scripts/gsd-review-providers.mjs"
---

# Cross-AI Plan Review — Phase ${phaseNum}: ${phaseSlug.replace(/^\d+-/, "").replace(/-/g, " ")}

`;
}

/**
 * @param {string} md
 * @param {{ slug: string, label: string, model: string, ok: boolean, content?: string, error?: string, latencyMs?: number }} r
 */
function upsertReviewSection(md, r) {
  const heading = `## ${r.label} Review`;
  const block = formatSection(r);

  const sectionRe = new RegExp(
    `## ${escapeRegExp(r.label)} Review[\\s\\S]*?(?=\\n---\\n\\n## |\\n## Consensus Summary|$)`,
    "m",
  );
  if (sectionRe.test(md)) {
    return md.replace(sectionRe, block.trimEnd() + "\n\n");
  }

  const consensusIdx = md.indexOf("\n## Consensus Summary");
  if (consensusIdx !== -1) {
    return (
      md.slice(0, consensusIdx) +
      `\n---\n\n${block}\n` +
      md.slice(consensusIdx)
    );
  }

  return `${md.trimEnd()}\n\n---\n\n${block}\n`;
}

/** @param {string} s */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @param {{ slug: string, label: string, model: string, ok: boolean, content?: string, error?: string, latencyMs?: number }} r */
function formatSection(r) {
  const ts = new Date().toISOString();
  if (!r.ok) {
    return `## ${r.label} Review

**Status:** FAILED (${ts}) — ${r.model}${r.latencyMs != null ? ` · ${r.latencyMs}ms` : ""}

${r.error ?? "unknown error"}
`;
  }

  return `## ${r.label} Review (${r.model}${r.latencyMs != null ? ` · ${r.latencyMs}ms` : ""})

**Status:** OK (${ts})

${r.content ?? ""}
`;
}

/**
 * @param {string} md
 * @param {Array<{ slug: string, ok: boolean }>} results
 */
function updateFrontmatterReviewers(md, results) {
  if (!md.startsWith("---")) return md;

  const end = md.indexOf("\n---", 3);
  if (end === -1) return md;

  let fm = md.slice(0, end + 4);
  const rest = md.slice(end + 4);

  const okSlugs = results.filter((r) => r.ok).map((r) => r.slug);
  const failed = results.filter((r) => !r.ok);

  if (/^reviewers:/m.test(fm)) {
    const existing = fm.match(/^reviewers:\s*\[(.*)\]/m);
    /** @type {string[]} */
    let slugs = [];
    if (existing?.[1]) {
      slugs = existing[1]
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    }
    for (const s of okSlugs) {
      if (!slugs.includes(s)) slugs.push(s);
    }
    fm = fm.replace(/^reviewers:.*$/m, `reviewers: [${slugs.join(", ")}]`);
  }

  if (failed.length > 0) {
    const failLines = failed
      .map((f) => `  ${f.slug}: "OpenAI provider review failed — see section"`)
      .join("\n");
    if (/^reviewers_failed:/m.test(fm)) {
      // append-only under existing block is fragile; skip deep merge
    } else {
      fm = fm.replace(
        /\n---$/,
        `\nreviewers_failed:\n${failLines}\n---`,
      );
    }
  }

  fm = fm.replace(
    /^reviewed_at:.*$/m,
    `reviewed_at: ${new Date().toISOString()}`,
  );

  return fm + rest;
}
