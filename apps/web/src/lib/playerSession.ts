import {
  HOME_SPAWN_CONFIG_VERSION,
  PLAYER_ID_STORAGE_KEY,
  TAB_PRESENCE_CHANNEL,
  isValidPlayerId,
} from "@aetherlife/shared";

const TAB_ID_KEY = "aetherlife:tabId";

/** Max global grid index accepted for session restore (outside home uses same coords). */
const MAX_GRID_RESTORE = 512;

export function lastGridPosKey(roomId: string): string {
  return `aetherlife:lastGridPos:${roomId}`;
}

export function clearLastGridPos(roomId: string): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(lastGridPosKey(roomId));
}

export function readLastGridPos(
  roomId: string,
): { x: number; y: number } | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(lastGridPosKey(roomId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { x?: number; y?: number; v?: number };
    const { x, y, v } = parsed;
    if (v !== HOME_SPAWN_CONFIG_VERSION) return null;
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= MAX_GRID_RESTORE ||
      y >= MAX_GRID_RESTORE
    ) {
      return null;
    }
    return { x, y };
  } catch {
    /* ignore */
  }
  return null;
}

export function writeLastGridPos(
  roomId: string,
  x: number,
  y: number,
): void {
  if (typeof sessionStorage === "undefined") return;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return;
  if (x >= MAX_GRID_RESTORE || y >= MAX_GRID_RESTORE) return;
  sessionStorage.setItem(
    lastGridPosKey(roomId),
    JSON.stringify({ x, y, v: HOME_SPAWN_CONFIG_VERSION }),
  );
}

export function getOrCreatePlayerId(): string {
  if (typeof localStorage === "undefined") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 32);
  }
  const existing = localStorage.getItem(PLAYER_ID_STORAGE_KEY);
  if (existing && isValidPlayerId(existing)) return existing;
  const id = crypto.randomUUID().replace(/-/g, "");
  localStorage.setItem(PLAYER_ID_STORAGE_KEY, id);
  return id;
}

export function playerApiHeaders(): HeadersInit {
  return { "X-Player-Id": getOrCreatePlayerId() };
}

export function getTabId(): string {
  if (typeof sessionStorage === "undefined") {
    return crypto.randomUUID();
  }
  let id = sessionStorage.getItem(TAB_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(TAB_ID_KEY, id);
  }
  return id;
}

/** Broadcast presence; calls onDuplicate when another tab uses the same player id. */
export function subscribeTabPresence(onDuplicate: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};

  const playerId = getOrCreatePlayerId();
  const tabId = getTabId();
  const bc = new BroadcastChannel(TAB_PRESENCE_CHANNEL);

  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; tabId?: string; playerId?: string };
    if (
      data?.type === "presence" &&
      data.playerId === playerId &&
      data.tabId &&
      data.tabId !== tabId
    ) {
      onDuplicate();
    }
  };

  bc.addEventListener("message", onMessage);
  bc.postMessage({ type: "presence", tabId, playerId });

  return () => {
    bc.removeEventListener("message", onMessage);
    bc.close();
  };
}
