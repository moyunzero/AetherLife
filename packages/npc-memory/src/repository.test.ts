import { afterEach, describe, expect, it } from "vitest";
import {
  computeRecencyFactor,
  computeWeightedScore,
  resolveRecencyConfig,
} from "./repository.js";

describe("computeWeightedScore", () => {
  it("weights higher importance memories", () => {
    const low = computeWeightedScore(0.9, 1);
    const high = computeWeightedScore(0.9, 10);
    expect(high).toBeGreaterThan(low);
  });

  it("uses default factor at importance 5", () => {
    expect(computeWeightedScore(1, 5)).toBeCloseTo(0.75, 5);
  });

  it("two-arg form stays identical when ageHours omitted", () => {
    expect(computeWeightedScore(0.9, 1)).toBeCloseTo(0.9 * (0.5 + 1 / 20), 10);
    expect(computeWeightedScore(0.9, 10)).toBeCloseTo(0.9 * (0.5 + 10 / 20), 10);
    expect(computeWeightedScore(1, 0)).toBeCloseTo(0.75, 10); // importance||5 legacy
  });

  it("with ageHours applies cos × importanceFactor × recencyFactor", () => {
    const cos = 0.8;
    const importance = 5;
    const ageHours = 72;
    const recency = computeRecencyFactor(ageHours, importance);
    const expected = cos * (0.5 + importance / 20) * recency;
    expect(computeWeightedScore(cos, importance, ageHours)).toBeCloseTo(expected, 10);
  });
});

describe("computeRecencyFactor", () => {
  const cfg = { s0: 72, floor: 0.3, sEpsilon: 1e-3 };

  it("ageHours=0 → recencyFactor=1", () => {
    expect(computeRecencyFactor(0, 5, cfg)).toBeCloseTo(1, 10);
  });

  it("huge age converges to floor, never 0", () => {
    const r = computeRecencyFactor(1e9, 5, cfg);
    expect(r).toBeCloseTo(cfg.floor, 10);
    expect(r).toBeGreaterThan(0);
  });

  it("importance=0 uses ε clamp — no NaN/Infinity", () => {
    const r = computeRecencyFactor(10, 0, cfg);
    expect(Number.isFinite(r)).toBe(true);
    expect(Number.isNaN(r)).toBe(false);
    // S = ε → decays fast but still ≥ floor
    expect(r).toBeGreaterThanOrEqual(cfg.floor);
  });

  it("higher importance at same age → slower decay", () => {
    const age = 72;
    const low = computeRecencyFactor(age, 1, cfg);
    const high = computeRecencyFactor(age, 10, cfg);
    expect(high).toBeGreaterThan(low);
  });

  it("S = max(ε, S0 × importance/5)", () => {
    // At age = S, factor = max(floor, 0.5)
    const importance = 5;
    const S = Math.max(cfg.sEpsilon, cfg.s0 * (importance / 5));
    expect(S).toBe(72);
    expect(computeRecencyFactor(S, importance, cfg)).toBeCloseTo(0.5, 10);
  });
});

describe("resolveRecencyConfig", () => {
  const saved = {
    MEMORY_RECENCY_HALFLIFE_HOURS: process.env.MEMORY_RECENCY_HALFLIFE_HOURS,
    MEMORY_RECENCY_FLOOR: process.env.MEMORY_RECENCY_FLOOR,
    MEMORY_RECENCY_S_EPSILON: process.env.MEMORY_RECENCY_S_EPSILON,
  };

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("defaults to S0=72, floor=0.3, ε=1e-3", () => {
    delete process.env.MEMORY_RECENCY_HALFLIFE_HOURS;
    delete process.env.MEMORY_RECENCY_FLOOR;
    delete process.env.MEMORY_RECENCY_S_EPSILON;
    expect(resolveRecencyConfig()).toEqual({ s0: 72, floor: 0.3, sEpsilon: 1e-3 });
  });

  it("invalid env falls back to defaults", () => {
    process.env.MEMORY_RECENCY_HALFLIFE_HOURS = "nope";
    process.env.MEMORY_RECENCY_FLOOR = "-1";
    process.env.MEMORY_RECENCY_S_EPSILON = "0";
    expect(resolveRecencyConfig()).toEqual({ s0: 72, floor: 0.3, sEpsilon: 1e-3 });
  });

  it("reads valid env overrides", () => {
    process.env.MEMORY_RECENCY_HALFLIFE_HOURS = "48";
    process.env.MEMORY_RECENCY_FLOOR = "0.2";
    process.env.MEMORY_RECENCY_S_EPSILON = "0.01";
    expect(resolveRecencyConfig()).toEqual({ s0: 48, floor: 0.2, sEpsilon: 0.01 });
  });
});

describe("SQL ≡ TS forgetting-curve parity (D-DECAY-04)", () => {
  it("matches fixture inputs for the SQL age/S/floor expression", () => {
    const cfg = { s0: 72, floor: 0.3, sEpsilon: 1e-3 };
    const fixtures: Array<{ ageHours: number; importance: number; cos: number }> = [
      { ageHours: 0, importance: 5, cos: 1 },
      { ageHours: 24, importance: 1, cos: 0.9 },
      { ageHours: 72, importance: 10, cos: 0.7 },
      { ageHours: 1e6, importance: 0, cos: 0.5 },
    ];
    for (const { ageHours, importance, cos } of fixtures) {
      // Mirrors searchSimilar SQL: GREATEST(floor, exp(-age*ln2 / GREATEST(ε, S0*imp/5)))
      const S = Math.max(cfg.sEpsilon, cfg.s0 * (importance / 5));
      const sqlRecency = Math.max(cfg.floor, Math.exp((-ageHours * Math.LN2) / S));
      const sqlScore = cos * (0.5 + importance / 20) * sqlRecency;
      expect(sqlRecency).toBeCloseTo(computeRecencyFactor(ageHours, importance, cfg), 12);
      expect(sqlScore).toBeCloseTo(computeWeightedScore(cos, importance, ageHours, cfg), 12);
    }
  });
});
