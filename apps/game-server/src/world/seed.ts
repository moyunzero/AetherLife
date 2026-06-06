/** Parse WORLD_SEED env; default 42 (matches .env.example + verify:phase10). */
export function worldSeedFromEnv(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.WORLD_SEED;
  if (raw === undefined || raw === "") return 42;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 42;
}
