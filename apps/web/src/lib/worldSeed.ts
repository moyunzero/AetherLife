/** Injected from root `.env` `WORLD_SEED` via vite.config `define`. */
declare const __AETHERLIFE_WORLD_SEED__: number;

const DEFAULT_WORLD_SEED = 42;

/** Client procedural terrain fallback — must match game-server `WORLD_SEED`. */
export function clientWorldSeed(): number {
  if (typeof __AETHERLIFE_WORLD_SEED__ === "number" && Number.isFinite(__AETHERLIFE_WORLD_SEED__)) {
    return __AETHERLIFE_WORLD_SEED__;
  }
  return DEFAULT_WORLD_SEED;
}
