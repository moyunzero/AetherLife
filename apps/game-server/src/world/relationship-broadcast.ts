import {
  COLYSEUS_SERVER_MESSAGES,
  findNpc,
  normalizeEdgeIds,
  type ColyseusMutualChatBubblePayload,
  type ColyseusRelationshipLinkedHintPayload,
  type ColyseusRelationshipSyncPayload,
} from "@aetherlife/shared";
import { syncColyseusFromMap } from "../colyseus/bridge.js";
import { getColyseusRoom } from "../colyseus/room-registry.js";
import type { GameRoomState } from "../colyseus/schema.js";
import { bumpStateVersion } from "../colyseus/version.js";
import { getOrCreate } from "../room/store.js";

const BUBBLE_MAX_CHARS = 20;
const BUBBLE_TTL_MS = 4000;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

/** D-API-01 / D-GRAPH-04: hint-only — never edge bodies on WS. */
export function broadcastRelationshipSync(
  mapRoomId: string,
  payload: ColyseusRelationshipSyncPayload,
): void {
  const room = getColyseusRoom(mapRoomId);
  if (!room) return;

  const hint: ColyseusRelationshipSyncPayload = {
    hasUpdate: payload.hasUpdate,
  };
  if (payload.latestSeq != null) {
    hint.latestSeq = payload.latestSeq;
  }

  for (const client of room.clients) {
    client.send(COLYSEUS_SERVER_MESSAGES.relationshipSync, hint);
  }
}

export function clampMutualBubbleText(text: string): string {
  const cleaned = String(text ?? "").replace(CONTROL_CHARS, "").trim();
  return cleaned.length <= BUBBLE_MAX_CHARS ? cleaned : cleaned.slice(0, BUBBLE_MAX_CHARS);
}

/** D-MUTUAL-02: one-shot bubble — not a Colyseus schema field. */
export function broadcastMutualChatBubble(
  mapRoomId: string,
  payload: ColyseusMutualChatBubblePayload,
): void {
  const room = getColyseusRoom(mapRoomId);
  if (!room) return;

  const text = clampMutualBubbleText(payload.text);
  if (!text || !payload.npcId || !payload.peerNpcId) return;

  const msg: ColyseusMutualChatBubblePayload = {
    npcId: payload.npcId,
    peerNpcId: payload.peerNpcId,
    text,
    expiresAt: payload.expiresAt,
  };

  for (const client of room.clients) {
    client.send(COLYSEUS_SERVER_MESSAGES.mutualChatBubble, msg);
  }
}

/** D-MUTUAL-04: LinkedEdge[] ids only — same client state CouncilRosterPanel consumes. */
export function broadcastLinkedEdgesHint(
  mapRoomId: string,
  payload: ColyseusRelationshipLinkedHintPayload,
): void {
  const room = getColyseusRoom(mapRoomId);
  if (!room) return;

  const linkedEdges = (payload.linkedEdges ?? [])
    .filter((e) => e?.npcAId && e?.npcBId && e.npcAId !== e.npcBId)
    .map((e) => {
      const { npcAId, npcBId } = normalizeEdgeIds(e.npcAId, e.npcBId);
      return { npcAId, npcBId };
    });

  const msg: ColyseusRelationshipLinkedHintPayload = { linkedEdges };
  for (const client of room.clients) {
    client.send(COLYSEUS_SERVER_MESSAGES.relationshipLinkedHint, msg);
  }
}

/**
 * Apply dual activity labels + broadcast one-shot bubble (D-MUTUAL-02).
 * Does not add Colyseus schema fields.
 */
export function presentNpcMutualChat(
  mapRoomId: string,
  input: {
    npcAId: string;
    npcBId: string;
    npcAReasonZh: string;
    npcBReasonZh: string;
    bubbleText: string;
  },
): ColyseusMutualChatBubblePayload | null {
  if (!input.npcAId || !input.npcBId || input.npcAId === input.npcBId) return null;

  const { state: map } = getOrCreate(mapRoomId);
  const npcA = findNpc(map, input.npcAId);
  const npcB = findNpc(map, input.npcBId);
  if (npcA) npcA.intentReasonZh = String(input.npcAReasonZh ?? "").trim().slice(0, 40);
  if (npcB) npcB.intentReasonZh = String(input.npcBReasonZh ?? "").trim().slice(0, 40);

  const colyseus = getColyseusRoom(mapRoomId);
  if (colyseus) {
    const state = colyseus.state as GameRoomState;
    syncColyseusFromMap(state, map);
    bumpStateVersion(state);
  }

  const bubble: ColyseusMutualChatBubblePayload = {
    npcId: input.npcAId,
    peerNpcId: input.npcBId,
    text: clampMutualBubbleText(input.bubbleText),
    expiresAt: Date.now() + BUBBLE_TTL_MS,
  };
  broadcastMutualChatBubble(mapRoomId, bubble);
  return bubble;
}
