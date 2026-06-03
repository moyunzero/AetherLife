import type { ZodError } from "zod";
import { GameActionSchema, type GameAction } from "./schemas.js";

export function parseGameAction(input: unknown): GameAction {
  return GameActionSchema.parse(input);
}

export function safeParseGameAction(
  input: unknown,
):
  | { success: true; data: GameAction }
  | { success: false; error: ZodError } {
  const result = GameActionSchema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}
