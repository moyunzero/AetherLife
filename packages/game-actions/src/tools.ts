import { zodToJsonSchema } from "zod-to-json-schema";
import { actionSchemasByType } from "./schemas.js";

export const ACTION_TYPES = ["move", "interact", "speak", "wait"] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

const DESCRIPTIONS: Record<ActionType, string> = {
  move: "Move the agent to grid coordinates x, y.",
  interact: "Interact with an object in the world by id.",
  speak: "Speak to a target NPC or player.",
  wait: "Wait for a duration in milliseconds before the next action.",
};

function normalizeParameters(raw: Record<string, unknown>): Record<string, unknown> {
  const schema =
    typeof raw === "object" && raw !== null && "type" in raw
      ? raw
      : { type: "object", properties: raw };

  if (schema.type !== "object") {
    return { type: "object", properties: {} };
  }

  return schema;
}

export function toOpenAIToolDefinitions() {
  return ACTION_TYPES.map((name) => {
    const schema = actionSchemasByType[name];
    const jsonSchema = zodToJsonSchema(schema, {
      name,
      $refStrategy: "none",
    }) as Record<string, unknown>;

    const { $schema: _schema, ...parameters } = jsonSchema;

    return {
      type: "function" as const,
      function: {
        name,
        description: DESCRIPTIONS[name],
        parameters: normalizeParameters(parameters),
      },
    };
  });
}
