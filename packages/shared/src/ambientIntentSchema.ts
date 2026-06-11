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

/**
 * Validate and produce a normalized ambient intent object from arbitrary input.
 *
 * @param input - The value to validate as an ambient intent
 * @returns The validated `AmbientIntent`
 * @throws ZodError if `input` does not conform to the ambient intent schema
 */
export function parseAmbientIntent(input: unknown): AmbientIntent {
  return AmbientIntentSchema.parse(input);
}

/**
 * Validates a value against the AmbientIntent schema without throwing on failure.
 *
 * @param input - Value to validate as an ambient intent
 * @returns `{ success: true, data: AmbientIntent }` when validation succeeds, `{ success: false, error: ZodError }` when validation fails
 */
export function safeParseAmbientIntent(input: unknown) {
  return AmbientIntentSchema.safeParse(input);
}

/**
 * Checks whether an AmbientIntent represents a target-based intent (contains a `target` property).
 *
 * @param intent - The ambient intent to inspect
 * @returns `true` if `intent` has a `target` property, `false` otherwise.
 */
export function isTargetIntent(intent: AmbientIntent): intent is AmbientIntentTarget {
  return "target" in intent;
}

/**
 * Determines whether an ambient intent targets a zone.
 *
 * @returns `true` if `intent` is a zone intent (contains `zoneId`), `false` otherwise.
 */
export function isZoneIntent(intent: AmbientIntent): intent is AmbientIntentZone {
  return "zoneId" in intent;
}
