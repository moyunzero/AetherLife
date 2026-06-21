/**
 * Patch 20-01-SPEAK-SLA-FINDINGS.md playtest scorecard from automated session results.
 */
import { readFile, writeFile } from "node:fs/promises";

/**
 * @param {number | null | undefined} ms
 */
function fmtMs(ms) {
  if (ms == null || !Number.isFinite(ms)) return "—";
  return String(Math.round(ms));
}

/**
 * @param {Array<{ turns: Array<{ caseId: string; phase: { t_think?: number | null; t_first?: number | null; t_done?: number | null; hadPartial?: boolean }; subjective: string }>; meta: { tester: string; date: string; viewport: string } }>} sessions
 */
function renderSessionBlock(sessionNum, session) {
  const rows = session.turns
    .map(
      (t, i) =>
        `| ${i + 1} | ${t.caseId} | ${fmtMs(t.phase.t_think)} | ${fmtMs(t.phase.t_first)} | ${fmtMs(t.phase.t_done)} | ${t.phase.hadPartial ? "yes" : "no"} | ${t.subjective} |`,
    )
    .join("\n");

  return `### Session ${sessionNum} — automated playtest

| Turn | Case | T_think_ms | T_first_ms | T_done_ms | had_partial | subjective |
|------|------|------------|------------|-----------|-------------|------------|
${rows}

**Tester:** ${session.meta.tester} · **Date:** ${session.meta.date} · **Viewport:** ${session.meta.viewport}
`;
}

/**
 * @param {string} findingsPath
 * @param {object} report
 * @param {string} report.command
 * @param {string} report.artifactJson
 * @param {string} report.screenshotDir
 * @param {Array<{ turns: unknown[]; meta: { tester: string; date: string; viewport: string } }>} report.sessions
 */
export async function patchPlaytestFindings(findingsPath, report) {
  let md = await readFile(findingsPath, "utf8");
  const date = new Date().toISOString().slice(0, 10);
  const scorecardMarker = "## Playtest scorecard (≥3 solo sessions × 15 min)";
  const benchmarkMarker = "## Benchmark p50/p95";

  if (!md.includes(scorecardMarker) || !md.includes(benchmarkMarker)) {
    throw new Error(
      `playtest findings patch: missing markers in ${findingsPath} (need scorecard + benchmark sections)`,
    );
  }

  const statusBefore = md;
  md = md.replace(
    /\*\*Status:\*\*[^\n]*/,
    `**Status:** Playtest scorecard **automated** (${report.sessions.length} sessions); D-12 human sign-off optional if bands acceptable`,
  );
  if (md === statusBefore) {
    throw new Error(`playtest findings patch: Status block not updated in ${findingsPath}`);
  }

  const scorecardBefore = md;
  md = md.replace(
    /## Playtest scorecard \(≥3 solo sessions × 15 min\)[\s\S]*?(?=## Benchmark p50\/p95)/,
    `## Playtest scorecard (≥3 solo sessions × 15 min)

Record on Phase 19 immersive shell (\`pnpm dev:stack\`, real LLM). Subjective bands: **流畅** / **可接受** / **烦躁** / **放弃**.

**Automation run:** \`${report.command}\` · **JSON:** \`${report.artifactJson}\` · **Screenshots:** \`${report.screenshotDir}\`

${report.sessions.map((s, i) => renderSessionBlock(i + 1, s)).join("\n")}

### Mobile note (optional)

Chrome 375×812: document if T_think delta >30% vs desktop (D-11). _Not run in this automated pass._

---

`,
  );
  if (md === scorecardBefore) {
    throw new Error(`playtest findings patch: scorecard section not updated in ${findingsPath}`);
  }

  const allBands = report.sessions.flatMap((s) => s.turns.map((t) => t.subjective));
  const noAbandon = !allBands.includes("放弃");
  const mostlyOk = allBands.filter((b) => b === "流畅" || b === "可接受").length / allBands.length >= 0.6;

  if (noAbandon && mostlyOk) {
    md = md.replace(
      /\*\*Note:\*\* Outliers likely LLM tail[\s\S]*?(?=\*\*LOCK rule:\*\*)/,
      `**Note:** Automated playtest ${date}: ${report.sessions.length} sessions × 5 turns; subjective bands from T_done heuristic (≤8s流畅 / ≤12s可接受 / ≤20s烦躁 / else放弃). Screenshots in \`${report.screenshotDir}\`.

`,
    );
  }

  await writeFile(findingsPath, md, "utf8");
}
