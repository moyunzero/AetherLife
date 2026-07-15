import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { useShellDrawerState } from "./useShellDrawerState.js";

const HOOK_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "useShellDrawerState.ts"),
  "utf8",
);
const CHAT_SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../ChatPage.tsx"),
  "utf8",
);

describe("useShellDrawerState", () => {
  it("clears chronicle unread via openDrawer — no openChronicle shortcut", () => {
    expect(HOOK_SRC).not.toMatch(/\bopenChronicle\b/);
    expect(HOOK_SRC).toMatch(/if \(tab === "chronicle"\) \{\s*clearChronicleUnread\(\);/s);
    expect(CHAT_SRC).not.toMatch(/\bopenChronicle\b/);
    expect(CHAT_SRC).toMatch(/openDrawer\("chronicle"\)/);
  });

  it("exports openDrawer and does not export openChronicle", () => {
    expect(typeof useShellDrawerState).toBe("function");
    expect(HOOK_SRC).toMatch(/return \{\s*drawerOpen,/);
    expect(HOOK_SRC).toMatch(/openDrawer,/);
    expect(HOOK_SRC).not.toMatch(/openChronicle,/);
  });
});
