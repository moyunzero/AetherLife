/**
 * D-ANN-03/04 — live gate for halfvec HNSW distance overfetch + forgetting-curve rerank.
 *
 * 1) EXPLAIN the distance ORDER BY path — expect Index Scan / hnsw / ANN plan node
 * 2) Compare top-k overlap vs exact weighted baseline on up to 5 fixture queries
 *
 * Exit 0 when EXPLAIN evidence present AND overlap ≥4/5.
 * Exit 1 on failure. Read-only (SELECT / EXPLAIN only).
 *
 * Env:
 *   MEMORY_RECALL_K           default 5
 *   MEMORY_K_OVERFETCH        override overfetch (else max(20, 4*k))
 *   MEMORY_RECALL_MIN_ROWS    min embeddings in a scope to use as fixture (default 8)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_QUERY_TARGET = 5;
const OVERLAP_PASS = 4;

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
 * @param {number} k
 * @param {Record<string, string>} env
 */
function resolveKOverfetch(k, env) {
  const raw = env.MEMORY_K_OVERFETCH;
  if (raw !== undefined && raw !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 1) return Math.min(200, Math.floor(n));
  }
  return Math.min(200, Math.max(20, 4 * k));
}

/**
 * @param {string} planText
 */
function planLooksLikeAnn(planText) {
  const lower = planText.toLowerCase();
  return (
    lower.includes("index scan") ||
    lower.includes("index only scan") ||
    lower.includes("bitmap index scan") ||
    lower.includes("hnsw") ||
    lower.includes("ann")
  );
}

/**
 * Recency knobs matching repository defaults / MEMORY_RECENCY_*.
 * @param {Record<string, string>} env
 */
function recencyCfg(env) {
  const s0 = Number(env.MEMORY_RECENCY_HALFLIFE_HOURS);
  const floor = Number(env.MEMORY_RECENCY_FLOOR);
  const sEpsilon = Number(env.MEMORY_RECENCY_S_EPSILON);
  return {
    s0: Number.isFinite(s0) && s0 > 0 ? s0 : 72,
    floor: Number.isFinite(floor) && floor >= 0 && floor <= 1 ? floor : 0.3,
    sEpsilon: Number.isFinite(sEpsilon) && sEpsilon > 0 ? sEpsilon : 1e-3,
  };
}

/**
 * Exact weighted ORDER BY (baseline — must NOT be used for ANN EXPLAIN).
 * @param {import("postgres").Sql} sql
 * @param {{ roomId: string; playerId: string; npcId: string; vectorLiteral: string; k: number; cfg: { s0: number; floor: number; sEpsilon: number } }} p
 */
async function exactTopK(sql, p) {
  const rows = await sql`
    SELECT id::text AS id
    FROM (
      SELECT
        id,
        (1 - (embedding <=> ${p.vectorLiteral}::vector))
          * (0.5 + COALESCE(importance, 5) / 20.0)
          * GREATEST(
              ${p.cfg.floor}::float8,
              EXP(
                - (EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0)
                  * LN(2)
                  / GREATEST(
                      ${p.cfg.sEpsilon}::float8,
                      ${p.cfg.s0}::float8 * COALESCE(importance, 0) / 5.0
                    )
              )
            ) AS score
      FROM npc_memories
      WHERE room_id = ${p.roomId}
        AND player_id = ${p.playerId}
        AND npc_id = ${p.npcId}
        AND summarized_at IS NULL
        AND embedding IS NOT NULL
      ORDER BY score DESC
      LIMIT ${p.k}
    ) t
  `;
  return rows.map((r) => String(r.id));
}

/**
 * Production path: halfvec distance overfetch + forgetting-curve rerank.
 * @param {import("postgres").Sql} sql
 * @param {{ roomId: string; playerId: string; npcId: string; vectorLiteral: string; k: number; kOverfetch: number; cfg: { s0: number; floor: number; sEpsilon: number } }} p
 */
async function annTopK(sql, p) {
  // halfvec(2048) must be a SQL literal to match expression index (D-ANN-03).
  const rows = await sql`
    WITH candidates AS (
      SELECT
        id,
        text,
        importance,
        created_at,
        (embedding::halfvec(2048) <=> ${p.vectorLiteral}::halfvec(2048)) AS dist
      FROM npc_memories
      WHERE room_id = ${p.roomId}
        AND player_id = ${p.playerId}
        AND npc_id = ${p.npcId}
        AND summarized_at IS NULL
        AND embedding IS NOT NULL
      ORDER BY embedding::halfvec(2048) <=> ${p.vectorLiteral}::halfvec(2048) ASC
      LIMIT ${p.kOverfetch}
    )
    SELECT id::text AS id
    FROM (
      SELECT
        id,
        (1 - dist)
          * (0.5 + COALESCE(importance, 5) / 20.0)
          * GREATEST(
              ${p.cfg.floor}::float8,
              EXP(
                - (EXTRACT(EPOCH FROM (now() - created_at)) / 3600.0)
                  * LN(2)
                  / GREATEST(
                      ${p.cfg.sEpsilon}::float8,
                      ${p.cfg.s0}::float8 * COALESCE(importance, 0) / 5.0
                    )
              )
            ) AS score
      FROM candidates
      ORDER BY score DESC
      LIMIT ${p.k}
    ) t
  `;
  return rows.map((r) => String(r.id));
}

/**
 * EXPLAIN distance-only candidate query (inner path that must hit HNSW).
 * @param {import("postgres").Sql} sql
 * @param {{ roomId: string; playerId: string; npcId: string; vectorLiteral: string; kOverfetch: number }} p
 */
async function explainDistancePath(sql, p) {
  const rows = await sql`
    EXPLAIN
    SELECT id
    FROM npc_memories
    WHERE room_id = ${p.roomId}
      AND player_id = ${p.playerId}
      AND npc_id = ${p.npcId}
      AND summarized_at IS NULL
      AND embedding IS NOT NULL
    ORDER BY embedding::halfvec(2048) <=> ${p.vectorLiteral}::halfvec(2048) ASC
    LIMIT ${p.kOverfetch}
  `;
  return rows.map((r) => Object.values(r)[0]).join("\n");
}

/**
 * @param {string[]} a
 * @param {string[]} b
 * @param {number} k
 */
function recallAtK(a, b, k) {
  const setB = new Set(b);
  let hit = 0;
  for (const id of a) {
    if (setB.has(id)) hit += 1;
  }
  return hit / Math.max(k, 1);
}

async function main() {
  const env = loadEnv(resolve(root, ".env"));
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("Missing DATABASE_URL in .env");
    process.exit(1);
  }

  const k = Math.max(1, Number(env.MEMORY_RECALL_K) || 5);
  const kOverfetch = resolveKOverfetch(k, env);
  const minRows = Math.max(k, Number(env.MEMORY_RECALL_MIN_ROWS) || 8);
  const cfg = recencyCfg(env);

  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 15,
    prepare: false,
  });

  try {
    const indexRows = await sql`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'npc_memories'
        AND indexname = 'npc_memories_embedding_halfvec_hnsw'
    `;
    if (indexRows.length === 0) {
      console.error(
        "Index npc_memories_embedding_halfvec_hnsw missing — apply migration 0013 or document deferred.",
      );
      process.exit(1);
    }

    const scopes = await sql`
      SELECT room_id, player_id, npc_id, COUNT(*)::int AS n
      FROM npc_memories
      WHERE summarized_at IS NULL
        AND embedding IS NOT NULL
      GROUP BY room_id, player_id, npc_id
      HAVING COUNT(*) >= ${minRows}
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `;

    if (scopes.length === 0) {
      console.error(
        `No scope with ≥${minRows} embedded unsummarized memories — seed fixture data then re-run.`,
      );
      process.exit(1);
    }

    // Build up to 5 fixture queries: prefer distinct scopes; fill from richest scope seeds.
    /** @type {Array<{ roomId: string; playerId: string; npcId: string; vectorLiteral: string }>} */
    const fixtures = [];
    for (const scope of scopes) {
      if (fixtures.length >= FIXTURE_QUERY_TARGET) break;
      const qEmb = await sql`
        SELECT embedding::text AS emb
        FROM npc_memories
        WHERE room_id = ${scope.room_id}
          AND player_id = ${scope.player_id}
          AND npc_id = ${scope.npc_id}
          AND embedding IS NOT NULL
          AND summarized_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `;
      const qVec = String(qEmb[0]?.emb ?? "");
      if (!qVec.startsWith("[")) continue;
      fixtures.push({
        roomId: String(scope.room_id),
        playerId: String(scope.player_id),
        npcId: String(scope.npc_id),
        vectorLiteral: qVec,
      });
    }

    // If fewer than 5 scopes, sample additional query vectors from the richest scope.
    if (fixtures.length < FIXTURE_QUERY_TARGET) {
      const rich = scopes[0];
      const seeds = await sql`
        SELECT embedding::text AS emb
        FROM npc_memories
        WHERE room_id = ${rich.room_id}
          AND player_id = ${rich.player_id}
          AND npc_id = ${rich.npc_id}
          AND embedding IS NOT NULL
          AND summarized_at IS NULL
        ORDER BY created_at DESC
        LIMIT ${FIXTURE_QUERY_TARGET}
      `;
      for (const row of seeds) {
        if (fixtures.length >= FIXTURE_QUERY_TARGET) break;
        const qVec = String(row.emb ?? "");
        if (!qVec.startsWith("[")) continue;
        // Skip duplicate first vector already added from this scope
        if (fixtures.some((f) => f.vectorLiteral === qVec)) continue;
        fixtures.push({
          roomId: String(rich.room_id),
          playerId: String(rich.player_id),
          npcId: String(rich.npc_id),
          vectorLiteral: qVec,
        });
      }
    }

    if (fixtures.length === 0) {
      console.error("Could not build fixture query embeddings");
      process.exit(1);
    }

    const explainFixture = fixtures[0];
    const planText = await explainDistancePath(sql, {
      roomId: explainFixture.roomId,
      playerId: explainFixture.playerId,
      npcId: explainFixture.npcId,
      vectorLiteral: explainFixture.vectorLiteral,
      kOverfetch,
    });

    console.log("--- EXPLAIN (distance ORDER BY halfvec) ---");
    console.log(planText);
    console.log("--- end EXPLAIN ---");

    const annPlanOk = planLooksLikeAnn(planText);
    console.log(`explain_ann=${annPlanOk ? "PASS" : "FAIL"}`);

    let passCount = 0;
    const results = [];

    for (const fixture of fixtures.slice(0, FIXTURE_QUERY_TARGET)) {
      const params = {
        roomId: fixture.roomId,
        playerId: fixture.playerId,
        npcId: fixture.npcId,
        vectorLiteral: fixture.vectorLiteral,
        k,
        kOverfetch,
        cfg,
      };

      const exact = await exactTopK(sql, params);
      const ann = await annTopK(sql, params);
      const recall = recallAtK(exact, ann, k);
      const ok = recall >= OVERLAP_PASS / FIXTURE_QUERY_TARGET;
      if (ok) passCount += 1;
      results.push({
        roomId: params.roomId,
        playerId: params.playerId,
        npcId: params.npcId,
        recall: recall.toFixed(3),
        ok,
        exact: exact.length,
        ann: ann.length,
      });
    }

    const queryN = results.length;
    console.log(`k=${k} k_overfetch=${kOverfetch} queries=${queryN}`);
    for (const r of results) {
      console.log(
        `  scope room=${r.roomId} player=${r.playerId} npc=${r.npcId} recall@${k}=${r.recall} ${r.ok ? "PASS" : "FAIL"}`,
      );
    }
    console.log(`overlap=${passCount}/${FIXTURE_QUERY_TARGET}`);

    if (!annPlanOk) {
      console.error("EXPLAIN did not show Index Scan / HNSW / ANN plan — D-ANN-03 FAIL");
      process.exit(1);
    }
    if (queryN < FIXTURE_QUERY_TARGET) {
      console.error(
        `Only ${queryN}/${FIXTURE_QUERY_TARGET} fixture queries — seed more embeddings then re-run`,
      );
      process.exit(1);
    }
    if (passCount < OVERLAP_PASS) {
      console.error(
        `Recall overlap ${passCount}/${FIXTURE_QUERY_TARGET} < ${OVERLAP_PASS}/${FIXTURE_QUERY_TARGET} — D-ANN-04 FAIL (tune MEMORY_K_OVERFETCH once)`,
      );
      process.exit(1);
    }

    console.log("verdict=PASS");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`verify:memory-recall failed: ${message}`);
  process.exit(1);
});
