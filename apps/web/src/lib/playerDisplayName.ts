import { isValidPlayerId } from "@aetherlife/shared";

/** Short label for multiplayer sprites (Phase 8 UI-SPEC). */
export function playerDisplayName(playerId: string | undefined, isSelf: boolean): string {
  if (isSelf) return "你";
  if (!playerId || !isValidPlayerId(playerId)) return "客";
  return `旅人·${playerId.slice(-4)}`;
}
