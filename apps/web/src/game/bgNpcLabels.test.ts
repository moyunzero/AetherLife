import { describe, expect, it } from "vitest";
import {
  applyBgActivityStyle,
  applyBgNameplateStyle,
  BG_ACTIVITY_FONT_SIZE,
  BG_NAMEPLATE_FONT_SIZE,
  BG_NPC_NAMEPLATE_TESTID,
} from "./bgNpcLabels.js";

function mockLabel() {
  const data = new Map<string, unknown>();
  const style: Record<string, unknown> = {};
  return {
    style,
    setFontSize(size: string) {
      style.fontSize = size;
    },
    setFontStyle(weight: string) {
      style.fontStyle = weight;
    },
    setColor(color: string) {
      style.color = color;
    },
    setStroke(color: string, width: number) {
      style.stroke = color;
      style.strokeThickness = width;
    },
    setShadow() {},
    setBackgroundColor() {},
    setPadding() {},
    setData(key: string, value: unknown) {
      data.set(key, value);
    },
    getData(key: string) {
      return data.get(key);
    },
  };
}

describe("bgNpcLabels", () => {
  it("applies muted nameplate typography per LIFE-EXT-UI-06", () => {
    const label = mockLabel();
    applyBgNameplateStyle(label as never);
    expect(label.style.fontSize).toBe(BG_NAMEPLATE_FONT_SIZE);
    expect(label.style.fontStyle).toBe("600");
    expect(label.style.color).toBe("#c8c0a8");
    expect(label.style.strokeThickness).toBe(4);
    expect(label.getData("testid")).toBe(BG_NPC_NAMEPLATE_TESTID);
  });

  it("applies muted activity typography", () => {
    const label = mockLabel();
    applyBgActivityStyle(label as never);
    expect(label.style.fontSize).toBe(BG_ACTIVITY_FONT_SIZE);
    expect(label.style.fontStyle).toBe("500");
    expect(label.style.color).toBe("#9aa890");
    expect(label.style.strokeThickness).toBe(2);
  });
});
