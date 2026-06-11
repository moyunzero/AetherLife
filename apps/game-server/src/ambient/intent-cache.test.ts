import { describe, expect, it, beforeEach } from "vitest";
import { parseAmbientIntent } from "@aetherlife/shared";
import {
  clearAllIntentsForTests,
  getIntent,
  isIntentExpired,
  setIntent,
} from "./intent-cache.js";

describe("AmbientIntentSchema", () => {
  it("accepts target intent", () => {
    const intent = parseAmbientIntent({
      target: { gx: 3, gy: 4 },
      reasonZh: "去河边",
      untilGameMinute: 600,
    });
    expect(intent).toMatchObject({ target: { gx: 3, gy: 4 } });
  });

  it("accepts zone intent", () => {
    const intent = parseAmbientIntent({
      zoneId: "home-yard",
      reasonZh: "闲逛",
      untilGameMinute: 720,
    });
    expect(intent).toMatchObject({ zoneId: "home-yard" });
  });
});

describe("intent-cache", () => {
  beforeEach(() => {
    clearAllIntentsForTests();
  });

  it("stores and retrieves intent per room/npc", () => {
    const intent = parseAmbientIntent({
      zoneId: "home-yard",
      reasonZh: "看看花",
      untilGameMinute: 500,
    });
    setIntent("room-a", "npc-1", {
      intent,
      trigger: "segment_change",
      gameMinute: 480,
    });
    const cached = getIntent("room-a", "npc-1");
    expect(cached?.intent.reasonZh).toBe("看看花");
  });

  it("expires when current minute passes untilGameMinute", () => {
    const intent = parseAmbientIntent({
      zoneId: "home-yard",
      reasonZh: "短暂",
      untilGameMinute: 500,
    });
    expect(isIntentExpired(intent, 499, 480)).toBe(false);
    expect(isIntentExpired(intent, 500, 480)).toBe(true);
  });
});
