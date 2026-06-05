import type { Request } from "express";
import { PLAYER_ID_HEADER, resolvePlayerId } from "@aetherlife/shared";

export function playerIdFromRequest(req: Request, body?: unknown): string {
  return resolvePlayerId(req.get(PLAYER_ID_HEADER), body);
}
