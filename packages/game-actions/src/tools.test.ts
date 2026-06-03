import { describe, expect, it } from "vitest";
import { ACTION_TYPES, toOpenAIToolDefinitions } from "./tools.js";

describe("toOpenAIToolDefinitions", () => {
  it("returns exactly four OpenAI-compatible tools", () => {
    const tools = toOpenAIToolDefinitions();
    expect(tools).toHaveLength(4);

    for (const tool of tools) {
      expect(tool.type).toBe("function");
      expect(ACTION_TYPES).toContain(tool.function.name);
      expect(typeof tool.function.description).toBe("string");
      expect(tool.function.parameters.type).toBe("object");
    }

    expect(tools.map((t) => t.function.name)).toEqual([...ACTION_TYPES]);
  });
});
