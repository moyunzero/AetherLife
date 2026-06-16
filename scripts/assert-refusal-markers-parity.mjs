/**
 * Compare JS REFUSAL_MARKERS (e2e-memory-helpers) vs Python recall_merge._REFUSAL_MARKERS.
 * Exit 1 on mismatch — run in CI / before verify:phase20.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { REFUSAL_MARKERS } from "./lib/e2e-memory-helpers.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pyPath = resolve(root, "workers/agent-worker/src/graph/recall_merge.py");

function parsePythonRefusalMarkers(source) {
  const match = source.match(/_REFUSAL_MARKERS\s*=\s*\(([^)]*)\)/s);
  if (!match) {
    throw new Error(`could not parse _REFUSAL_MARKERS from ${pyPath}`);
  }
  const inner = match[1];
  const markers = [];
  for (const m of inner.matchAll(/"([^"]+)"/g)) {
    markers.push(m[1]);
  }
  if (!markers.length) {
    throw new Error("_REFUSAL_MARKERS tuple empty or unparseable");
  }
  return markers;
}

function sortedKey(list) {
  return [...list].sort().join("|");
}

const pySource = readFileSync(pyPath, "utf8");
const pyMarkers = parsePythonRefusalMarkers(pySource);
const jsMarkers = [...REFUSAL_MARKERS];

if (sortedKey(pyMarkers) !== sortedKey(jsMarkers)) {
  console.error("REFUSAL_MARKERS parity FAILED");
  console.error("Python:", pyMarkers);
  console.error("JS:    ", jsMarkers);
  process.exit(1);
}

console.log(`assert-refusal-markers-parity OK (${jsMarkers.length} markers)`);
