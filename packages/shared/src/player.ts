/** Stable player identity for per-player NPC memory (Layer A). */
export const PLAYER_ID_HEADER = "X-Player-Id" as const;

export const PLAYER_ID_STORAGE_KEY = "aetherlife:playerId" as const;

export const TAB_PRESENCE_CHANNEL = "aetherlife:tab-presence" as const;

/** Memories written before player_id existed (tests, old clients). */
export const LEGACY_PLAYER_ID = "__legacy__" as const;

const PLAYER_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

export function isValidPlayerId(id: string): boolean {
  return PLAYER_ID_RE.test(id);
}

export function normalizePlayerId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return isValidPlayerId(trimmed) ? trimmed : null;
}

export function resolvePlayerId(
  headerValue: string | undefined,
  bodyValue: unknown,
): string {
  return (
    normalizePlayerId(headerValue) ??
    normalizePlayerId(bodyValue) ??
    LEGACY_PLAYER_ID
  );
}
