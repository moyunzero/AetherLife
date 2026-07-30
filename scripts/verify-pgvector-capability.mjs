/**
 * Read-only probe: pgvector extension version + halfvec cast support.
 * D-ANN-02 — run BEFORE any HNSW / halfvec index DDL (migration 0013).
 *
 * Exit 0 = verdict=PASS (ext >= 0.7.0 and halfvec cast works)
 * Exit 1 = missing config, connection error, or verdict=FAIL
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIN_VERSION = "0.7.0";

/** @param {string} path */
function loadEnv(path) {
  if (!existsSync(path)) {
    console.error("Missing .env — copy .env.example and fill DATABASE_URL.");
    process.exit(1);
  }

  /** @type {Record<string, string>} */
  const env = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return env;
}

/**
 * Compare dotted semver-like strings (e.g. 0.7.0, 0.8.0).
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a < b, 0 if equal, positive if a > b
 */
function compareSemver(a, b) {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/**
 * @param {string} databaseUrl
 * @returns {Promise<{ pgvector: string; halfvec: string; verdict: "PASS" | "FAIL" }>}
 */
async function probe(databaseUrl) {
  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 15,
    prepare: false,
  });

  try {
    const extRows = await sql`
      SELECT extversion FROM pg_extension WHERE extname = 'vector'
    `;
    const pgvector = extRows[0]?.extversion != null ? String(extRows[0].extversion) : "missing";

    let halfvec = "unavailable";
    if (pgvector !== "missing") {
      try {
        await sql`SELECT '[1,2]'::halfvec(2)`;
        halfvec = "ok";
      } catch {
        halfvec = "unavailable";
      }
    }

    const versionOk = pgvector !== "missing" && compareSemver(pgvector, MIN_VERSION) >= 0;
    const halfvecOk = halfvec === "ok";
    const verdict = versionOk && halfvecOk ? "PASS" : "FAIL";

    return { pgvector, halfvec, verdict };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const env = loadEnv(resolve(root, ".env"));
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Missing DATABASE_URL in .env");
    process.exit(1);
  }

  const placeholders = [
    "[password]",
    "[project-ref]",
    "[region]",
    "127.0.0.1:5432",
    "aether:aether@127.0.0.1",
  ];
  for (const token of placeholders) {
    if (databaseUrl.includes(token)) {
      console.error("DATABASE_URL still uses a placeholder — configure Supabase in .env");
      process.exit(1);
    }
  }

  const { pgvector, halfvec, verdict } = await probe(databaseUrl);
  console.log(`pgvector=${pgvector} halfvec=${halfvec} verdict=${verdict}`);

  if (verdict === "FAIL") {
    console.error(
      "pgvector halfvec probe FAIL — defer migration 0013 / plan 29-04; write 0014 only.",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`verify:pgvector failed: ${message}`);
  process.exit(1);
});
