import type { AttitudeBand } from "@aetherlife/shared";

export const ALL_ALLOWED_TOOLS = ["speak", "wait", "move", "interact", "transfer"] as const;
export type AllowedTool = (typeof ALL_ALLOWED_TOOLS)[number];

/** D-20: hostile band blocks move/interact/transfer at apply-actions. */
export function allowedToolsForBand(band: AttitudeBand): AllowedTool[] {
  if (band === "hostile") return ["speak", "wait"];
  return [...ALL_ALLOWED_TOOLS];
}

export function isActionBlockedByGate(actionType: string, band: AttitudeBand): boolean {
  return !allowedToolsForBand(band).includes(actionType as AllowedTool);
}

export type AttitudeGateResponse = {
  ok: false;
  error: "attitude_gate";
  code: "hostile_gate";
  band: AttitudeBand;
  actionType: string;
  applied: number;
};

export function attitudeGateResponse(
  band: AttitudeBand,
  actionType: string,
  applied: number,
): AttitudeGateResponse {
  return {
    ok: false,
    error: "attitude_gate",
    code: "hostile_gate",
    band,
    actionType,
    applied,
  };
}
