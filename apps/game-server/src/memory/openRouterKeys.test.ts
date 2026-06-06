import { afterEach, describe, expect, it, vi } from "vitest";
import { openRouterKeys } from "./openRouterKeys.js";
import { scoreImportanceWithKeys } from "./importance.js";

describe("openRouterKeys", () => {
  afterEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY_2;
    delete process.env.OPENROUTER_API_KEYS;
  });

  it("dedupes primary and secondary keys", () => {
    process.env.OPENROUTER_API_KEY = "key-a";
    process.env.OPENROUTER_API_KEY_2 = "key-b";
    expect(openRouterKeys()).toEqual(["key-a", "key-b"]);
  });
});

describe("scoreImportanceWithKeys OpenRouter failover", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rotates to second key on 429", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
      if (auth.includes("key-a")) {
        return new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
        });
      }
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"importance":9}' } }],
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      scoreImportanceWithKeys(
        "player: hello",
        ["key-a", "key-b"],
        "https://openrouter.ai/api/v1",
        "openrouter/free",
      ),
    ).resolves.toBe(9);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
