import { z } from "zod";

const intentBase = {
  reasonZh: z.string().max(32),
  untilGameMinute: z.number().int().min(0).max(1439),
  joinVicinity: z.boolean().optional(),
};

export const AmbientIntentTargetSchema = z
  .object({
    target: z
      .object({
        gx: z.number().int(),
        gy: z.number().int(),
      })
      .strict(),
    ...intentBase,
  })
  .strict();

export const AmbientIntentZoneSchema = z
  .object({
    zoneId: z.string().min(1),
    ...intentBase,
  })
  .strict();

export const AmbientIntentSchema = z.union([AmbientIntentTargetSchema, AmbientIntentZoneSchema]);

export type AmbientIntent = z.infer<typeof AmbientIntentSchema>;
export type AmbientIntentTarget = z.infer<typeof AmbientIntentTargetSchema>;
export type AmbientIntentZone = z.infer<typeof AmbientIntentZoneSchema>;

export function parseAmbientIntent(input: unknown): AmbientIntent {
  return AmbientIntentSchema.parse(input);
}

export function safeParseAmbientIntent(input: unknown) {
  return AmbientIntentSchema.safeParse(input);
}

export function isTargetIntent(intent: AmbientIntent): intent is AmbientIntentTarget {
  return "target" in intent;
}

export function isZoneIntent(intent: AmbientIntent): intent is AmbientIntentZone {
  return "zoneId" in intent;
}
