import { describe, expect, it, vi } from "vitest";
import {
  applyNameplateStyle,
  NAMEPLATE_FONT_SIZE,
  NAMEPLATE_NPC_COLOR,
  NAMEPLATE_PLAYER_COLOR,
  SCENE_LABEL_FONT,
} from "./entityLabels.js";

function mockLabel() {
  return {
    setFontFamily: vi.fn(),
    setFontSize: vi.fn(),
    setFontStyle: vi.fn(),
    setColor: vi.fn(),
    setStroke: vi.fn(),
    setShadow: vi.fn(),
    setBackgroundColor: vi.fn(),
    setPadding: vi.fn(),
    setWordWrapWidth: vi.fn(),
  };
}

describe("applyNameplateStyle", () => {
  it("applies Songti nameplate without stroke or backdrop", () => {
    const label = mockLabel();
    applyNameplateStyle(label as never, "player");
    expect(label.setFontFamily).toHaveBeenCalledWith(SCENE_LABEL_FONT);
    expect(label.setFontSize).toHaveBeenCalledWith(NAMEPLATE_FONT_SIZE);
    expect(label.setColor).toHaveBeenCalledWith(NAMEPLATE_PLAYER_COLOR);
    expect(label.setStroke).toHaveBeenCalledWith("#000000", 0);
    expect(label.setBackgroundColor).toHaveBeenCalledWith("");
    expect(label.setPadding).toHaveBeenCalledWith(0, 0, 0, 0);
    expect(label.setShadow).toHaveBeenCalledWith(1, 1, "rgba(0,0,0,0.45)", 1, false, false);
  });

  it("applies NPC fill color", () => {
    const label = mockLabel();
    applyNameplateStyle(label as never, "npc");
    expect(label.setColor).toHaveBeenCalledWith(NAMEPLATE_NPC_COLOR);
  });
});
