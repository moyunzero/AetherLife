import { describe, expect, it, vi } from "vitest";
import {
  applyNameplateStyle,
  NAMEPLATE_FONT_SIZE,
  NAMEPLATE_NPC_COLOR,
  NAMEPLATE_PLAYER_COLOR,
  NAMEPLATE_STROKE_COLOR,
  NAMEPLATE_STROKE_WIDTH,
} from "./entityLabels.js";

function mockLabel() {
  return {
    setFontSize: vi.fn(),
    setFontStyle: vi.fn(),
    setColor: vi.fn(),
    setStroke: vi.fn(),
    setShadow: vi.fn(),
    setBackgroundColor: vi.fn(),
    setPadding: vi.fn(),
  };
}

describe("applyNameplateStyle", () => {
  it("applies frozen high-contrast player nameplate tokens", () => {
    const label = mockLabel();
    applyNameplateStyle(label as never, "player");
    expect(label.setFontSize).toHaveBeenCalledWith(NAMEPLATE_FONT_SIZE);
    expect(label.setColor).toHaveBeenCalledWith(NAMEPLATE_PLAYER_COLOR);
    expect(label.setStroke).toHaveBeenCalledWith(
      NAMEPLATE_STROKE_COLOR,
      NAMEPLATE_STROKE_WIDTH,
    );
    expect(label.setShadow).toHaveBeenCalledWith(0, 0, "#000000", 0, false, false);
    expect(label.setBackgroundColor).toHaveBeenCalledWith("");
    expect(label.setPadding).toHaveBeenCalledWith(0, 0, 0, 0);
  });

  it("applies NPC fill color", () => {
    const label = mockLabel();
    applyNameplateStyle(label as never, "npc");
    expect(label.setColor).toHaveBeenCalledWith(NAMEPLATE_NPC_COLOR);
  });
});
