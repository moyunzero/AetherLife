import { describe, expect, it } from "vitest";
import {
  collectiveFeedbackMessage,
  collectiveKindLabelZh,
  resolveCollectiveInitiatorPlayerId,
  shouldShowCollectiveFeedbackBanner,
} from "./collectiveInitiator.js";

describe("resolveCollectiveInitiatorPlayerId", () => {
  it("returns playerIds[0] for rude/help/contradict", () => {
    expect(
      resolveCollectiveInitiatorPlayerId({ kind: "rude", playerIds: ["p-a"] }),
    ).toBe("p-a");
    expect(
      resolveCollectiveInitiatorPlayerId({ kind: "help", playerIds: ["p-b"] }),
    ).toBe("p-b");
    expect(
      resolveCollectiveInitiatorPlayerId({
        kind: "contradict",
        playerIds: ["init", "other"],
      }),
    ).toBe("init");
  });

  it("returns playerIds[1] for compete/collaborate", () => {
    expect(
      resolveCollectiveInitiatorPlayerId({
        kind: "compete_object",
        playerIds: ["prev", "initiator"],
      }),
    ).toBe("initiator");
    expect(
      resolveCollectiveInitiatorPlayerId({
        kind: "collaborate",
        playerIds: ["prev", "initiator"],
      }),
    ).toBe("initiator");
  });

  it("returns null when playerIds missing", () => {
    expect(resolveCollectiveInitiatorPlayerId({ kind: "rude" })).toBeNull();
    expect(resolveCollectiveInitiatorPlayerId({ kind: "rude", playerIds: [] })).toBeNull();
  });
});

describe("collectiveKindLabelZh", () => {
  it("maps known kinds", () => {
    expect(collectiveKindLabelZh("rude")).toBe("冒犯");
    expect(collectiveKindLabelZh("help")).toBe("互助");
    expect(collectiveKindLabelZh("speak")).toBe("对话");
    expect(collectiveKindLabelZh("compete_object")).toBe("见闻");
  });
});

describe("collectiveFeedbackMessage", () => {
  it("returns copy for rude/help only", () => {
    expect(collectiveFeedbackMessage("rude")).toContain("议论");
    expect(collectiveFeedbackMessage("help")).toContain("善意");
    expect(collectiveFeedbackMessage("speak")).toBeNull();
  });
});

describe("shouldShowCollectiveFeedbackBanner", () => {
  const now = Date.parse("2026-06-08T12:00:30.000Z");

  it("shows for initiator within 30s on rude/help", () => {
    expect(
      shouldShowCollectiveFeedbackBanner(
        {
          kind: "rude",
          playerIds: ["me"],
          createdAt: "2026-06-08T12:00:10.000Z",
        },
        "me",
        now,
      ),
    ).toBe(true);
  });

  it("hides for non-initiator", () => {
    expect(
      shouldShowCollectiveFeedbackBanner(
        {
          kind: "rude",
          playerIds: ["other"],
          createdAt: "2026-06-08T12:00:10.000Z",
        },
        "me",
        now,
      ),
    ).toBe(false);
  });

  it("hides after 30s", () => {
    expect(
      shouldShowCollectiveFeedbackBanner(
        {
          kind: "help",
          playerIds: ["me"],
          createdAt: "2026-06-08T11:59:00.000Z",
        },
        "me",
        now,
      ),
    ).toBe(false);
  });
});
