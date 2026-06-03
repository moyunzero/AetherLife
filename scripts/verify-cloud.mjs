import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createClient } from "redis";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} path */
function loadEnv(path) {
  if (!existsSync(path)) {
    console.error("Missing .env — copy .env.example and fill Supabase + Upstash URLs.");
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

/** @param {string} name @param {string | undefined} value */
function assertConfiguredUrl(name, value) {
  if (!value) {
    console.error(`Missing ${name} in .env`);
    process.exit(1);
  }

  const placeholders = [
    "[password]",
    "[project-ref]",
    "[region]",
    "[endpoint]",
    "127.0.0.1:5432",
    "aether:aether@127.0.0.1",
  ];
  for (const token of placeholders) {
    if (value.includes(token)) {
      console.error(`${name} still uses a placeholder — configure Supabase/Upstash in .env`);
      process.exit(1);
    }
  }
}

async function verifyPostgres(databaseUrl) {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 15 });
  try {
    const rows = await sql`SELECT 1 AS ok`;
    if (rows[0]?.ok !== 1) {
      throw new Error("unexpected SELECT result");
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

/** @param {string} redisUrl */
async function verifyRedis(redisUrl) {
  const client = createClient({ url: redisUrl });
  client.on("error", (err) => {
    throw err;
  });
  await client.connect();
  try {
    const pong = await client.ping();
    if (pong !== "PONG") {
      throw new Error("Redis PING failed");
    }
  } finally {
    await client.quit();
  }
}

async function main() {
  const env = loadEnv(resolve(root, ".env"));
  const databaseUrl = env.DATABASE_URL;
  const redisUrl = env.REDIS_URL;

  assertConfiguredUrl("DATABASE_URL", databaseUrl);
  assertConfiguredUrl("REDIS_URL", redisUrl);

  await verifyPostgres(databaseUrl);
  await verifyRedis(redisUrl);

  console.log("verify:cloud OK — Postgres and Redis reachable");
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`verify:cloud failed: ${message}`);
  process.exit(1);
});
