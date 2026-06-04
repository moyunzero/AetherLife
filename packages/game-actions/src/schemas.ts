import { z } from "zod";

export const moveActionSchema = z
  .object({
    type: z.literal("move"),
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

export const interactActionSchema = z
  .object({
    type: z.literal("interact"),
    objectId: z.string().min(1),
  })
  .strict();

export const speakActionSchema = z
  .object({
    type: z.literal("speak"),
    targetId: z.string().min(1),
    content: z.string().min(1).max(2000),
  })
  .strict();

export const waitActionSchema = z
  .object({
    type: z.literal("wait"),
    durationMs: z.number().int().min(1).max(600_000),
  })
  .strict();

export const transferActionSchema = z
  .object({
    type: z.literal("transfer"),
    itemId: z.string().min(1),
    toNpcId: z.string().min(1),
  })
  .strict();

export const GameActionSchema = z.discriminatedUnion("type", [
  moveActionSchema,
  interactActionSchema,
  speakActionSchema,
  waitActionSchema,
  transferActionSchema,
]);

export type GameAction = z.infer<typeof GameActionSchema>;

export const actionSchemasByType = {
  move: moveActionSchema,
  interact: interactActionSchema,
  speak: speakActionSchema,
  wait: waitActionSchema,
  transfer: transferActionSchema,
} as const;
