import type { Request } from "express";
import { PLAYER_ID_HEADER, resolvePlayerId } from "@aetherlife/shared";

function playerIdFromBody(body: unknown): unknown {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const record = body as Record<string, unknown>;
    if ("playerId" in record) {
      return record.playerId;
    }
  }
  return body;
}

export function playerIdFromRequest(req: Request, body?: unknown): string {
  return resolvePlayerId(req.get(PLAYER_ID_HEADER), playerIdFromBody(body));
}
