import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "@colyseus/sdk";
import {
  COLYSEUS_CLIENT_MESSAGES,
  COLYSEUS_SERVER_MESSAGES,
  previewCasualSpeakStub,
  sanitizeNpcReplyText,
  type ColyseusNpcJobDonePayload,
  type ColyseusSpeakBusyPayload,
  type ColyseusSpeakPartialPayload,
  type ColyseusSpeakIdlePayload,
  type RoomState,
  type StatePatchPayload,
} from "@aetherlife/shared";
import { shouldRefetchCollectiveOnJobDone } from "./useCollectiveAttitude.js";
import { applyStatePatch } from "../lib/applyStatePatch.js";
import { clearLastGridPos, getOrCreatePlayerId, playerApiHeaders } from "../lib/playerSession.js";
import { recordSpeakLatencyMark } from "../lib/speakLatencyTrace.js";

export type ChatMessage = {
  id: string;
  role: "player" | "npc" | "error";
  text: string;
  npcId?: string;
  npcName?: string;
  /** PLAY-03: worker-sourced memory citation from speak done payload. */
  memoryQuote?: string;
};

export type ChatStatus = "idle" | "thinking" | "error";

export type RoomNpc = {
  id: string;
  name: string;
};

export type RoomStateShape = RoomState;

export type ParsedIntent = Record<string, unknown> | null;

export type AttitudeGateCue = {
  gateKind: string;
  npcName: string;
};

function attitudeGateHintCopy(npcName: string, gateKind?: string): string {
  switch (gateKind) {
    case "transfer":
      return `${npcName}拒绝配合这个请求。`;
    case "interact":
    case "generic":
      return `${npcName}现在不愿意帮忙。`;
    case "move":
    default:
      return `${npcName}似乎不愿协助你移动。`;
  }
}

const apiBase = import.meta.env.VITE_GAME_SERVER_URL || "/api";
const chatBase = import.meta.env.VITE_AI_GATEWAY_URL || "/v1";
const DEFAULT_NPC_ID = "npc-1";

/** Per-NPC pending speak texts — server `speakBusy` retry only (Phase 12.2 FIFO).
 * Option A UX: `sendMessage` does not enqueue while in-flight; composer is disabled instead. */
export type NpcSpeakQueue = Map<string, string[]>;

export function enqueueNpcSpeak(queues: NpcSpeakQueue, npcId: string, text: string): number {
  const q = queues.get(npcId) ?? [];
  q.push(text);
  queues.set(npcId, q);
  return q.length;
}

export function dequeueNpcSpeak(queues: NpcSpeakQueue, npcId: string): string | undefined {
  const q = queues.get(npcId);
  if (!q?.length) return undefined;
  const next = q.shift()!;
  if (q.length === 0) queues.delete(npcId);
  else queues.set(npcId, q);
  return next;
}

/** Drop queued speaks identical to a turn that just finished (duplicate speakBusy retry). */
export function discardQueuedSpeakMatching(
  queues: NpcSpeakQueue,
  npcId: string,
  text: string,
): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  const q = queues.get(npcId);
  if (!q?.length) return 0;
  const kept = q.filter((item) => item.trim() !== normalized);
  const removed = q.length - kept.length;
  if (kept.length === 0) queues.delete(npcId);
  else queues.set(npcId, kept);
  return removed;
}

export function npcSpeakQueueDepth(queues: NpcSpeakQueue, npcId: string): number {
  return queues.get(npcId)?.length ?? 0;
}

export function isNpcSpeakInFlight(params: {
  npcId: string;
  speakBusyNpcId: string | null;
  sendingNpcId: string | null;
  thinkingNpcId: string | null;
}): boolean {
  const { npcId, speakBusyNpcId, sendingNpcId, thinkingNpcId } = params;
  return speakBusyNpcId === npcId || sendingNpcId === npcId || thinkingNpcId === npcId;
}

/** Sync in-flight refs before queueMicrotask drain — setState lags; refs still block drain. */
export function clearInFlightRefsForDrain(
  refs: {
    thinkingNpcId: { current: string | null };
    speakBusyNpcId: { current: string | null };
    sendingNpcId: { current: string | null };
  },
  npcId: string,
): void {
  if (refs.thinkingNpcId.current === npcId) refs.thinkingNpcId.current = null;
  if (refs.speakBusyNpcId.current === npcId) refs.speakBusyNpcId.current = null;
  if (refs.sendingNpcId.current === npcId) refs.sendingNpcId.current = null;
}

export type UseNpcChatOptions = {
  onCollectiveUpdated?: () => void;
};

export function useNpcChat(
  colyseusRoom: Room | null,
  mapRoomId = "default",
  options: UseNpcChatOptions = {},
) {
  const onCollectiveUpdatedRef = useRef(options.onCollectiveUpdated);
  onCollectiveUpdatedRef.current = options.onCollectiveUpdated;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [roomState, setRoomState] = useState<RoomStateShape | null>(null);
  const [memoryCounts, setMemoryCounts] = useState<Record<string, number>>({});
  const [activeNpcId, setActiveNpcId] = useState(DEFAULT_NPC_ID);
  const [jobId, setJobId] = useState<string | null>(null);
  const pendingJobIdRef = useRef<string | null>(null);
  const sendingNpcIdRef = useRef<string | null>(null);
  const activeNpcIdRef = useRef(activeNpcId);
  activeNpcIdRef.current = activeNpcId;
  const [error, setError] = useState<string | null>(null);
  const [lastParsedIntent, setLastParsedIntent] = useState<ParsedIntent>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [speakBusyNpcId, setSpeakBusyNpcId] = useState<string | null>(null);
  const [thinkingNpcId, setThinkingNpcId] = useState<string | null>(null);
  const [sendingNpcId, setSendingNpcId] = useState<string | null>(null);
  const [attitudeGateCue, setAttitudeGateCue] = useState<AttitudeGateCue | null>(null);
  const [streamingReply, setStreamingReply] = useState<string | null>(null);
  const [speakQueueDepthByNpc, setSpeakQueueDepthByNpc] = useState<Record<string, number>>({});
  const partialSeenRef = useRef(false);
  const stateVersionRef = useRef(0);
  const thinkingNpcIdRef = useRef<string | null>(null);
  thinkingNpcIdRef.current = thinkingNpcId;
  const speakBusyNpcIdRef = useRef<string | null>(null);
  speakBusyNpcIdRef.current = speakBusyNpcId;
  const speakQueuesRef = useRef<NpcSpeakQueue>(new Map());
  const inFlightTextRef = useRef<Map<string, string>>(new Map());
  const activeTurnPlayerTextRef = useRef<Map<string, string>>(new Map());
  const dispatchSpeakRef = useRef<
    ((text: string, npcId: string, opts?: { skipPlayerBubble?: boolean }) => Promise<void>) | null
  >(null);
  const drainSpeakQueueRef = useRef<((npcId: string) => void) | null>(null);

  const syncQueueDepth = useCallback((npcId: string) => {
    const depth = npcSpeakQueueDepth(speakQueuesRef.current, npcId);
    setSpeakQueueDepthByNpc((prev) => ({ ...prev, [npcId]: depth }));
  }, []);

  const enqueueSpeak = useCallback(
    (npcId: string, text: string, opts?: { showPlayerBubble?: boolean }) => {
      enqueueNpcSpeak(speakQueuesRef.current, npcId, text);
      syncQueueDepth(npcId);
      if (opts?.showPlayerBubble !== false) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "player", text },
        ]);
      }
    },
    [syncQueueDepth],
  );

  const isNpcInFlightNow = useCallback((npcId: string) => {
    return isNpcSpeakInFlight({
      npcId,
      speakBusyNpcId: speakBusyNpcIdRef.current,
      sendingNpcId: sendingNpcIdRef.current,
      thinkingNpcId: thinkingNpcIdRef.current,
    });
  }, []);

  const drainSpeakQueue = useCallback(
    (npcId: string) => {
      if (isNpcInFlightNow(npcId)) return;
      const next = dequeueNpcSpeak(speakQueuesRef.current, npcId);
      syncQueueDepth(npcId);
      if (!next) return;
      void dispatchSpeakRef.current?.(next, npcId, { skipPlayerBubble: true });
    },
    [isNpcInFlightNow, syncQueueDepth],
  );

  drainSpeakQueueRef.current = drainSpeakQueue;

  const clearSendingState = useCallback((npcId: string | null) => {
    if (!npcId) return;
    setSendingNpcId((prev) => (prev === npcId ? null : prev));
    setThinkingNpcId((prev) => (prev === npcId ? null : prev));
    clearInFlightRefsForDrain(
      {
        thinkingNpcId: thinkingNpcIdRef,
        speakBusyNpcId: speakBusyNpcIdRef,
        sendingNpcId: sendingNpcIdRef,
      },
      npcId,
    );
  }, []);

  const releaseNpcBusy = useCallback((npcId: string) => {
    setSpeakBusyNpcId((prev) => (prev === npcId ? null : prev));
    if (speakBusyNpcIdRef.current === npcId) {
      speakBusyNpcIdRef.current = null;
    }
  }, []);

  const refetchState = useCallback(async (opts?: { retryUntilMs?: number; memoryOnly?: boolean }) => {
    const url = `${apiBase}/rooms/${mapRoomId}/state`;
    const deadline = Date.now() + (opts?.retryUntilMs ?? 0);
    while (true) {
      try {
        const res = await fetch(url, { headers: playerApiHeaders() });
        if (res.ok) {
          const body = await res.json();
          if (opts?.memoryOnly) {
            setMemoryCounts(body.memoryCounts ?? {});
          } else {
            setRoomState(body.state);
            setMemoryCounts(body.memoryCounts ?? {});
          }
          return true;
        }
      } catch {
        /* game-server may still be starting (vite proxy ECONNREFUSED) */
      }
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 400));
    }
  }, [mapRoomId]);

  useEffect(() => {
    const room = colyseusRoom;
    if (!room) return;

    const matchesJob = (eventJobId: unknown) => {
      const pending = pendingJobIdRef.current;
      if (!pending) return false;
      return typeof eventJobId === "string" && eventJobId === pending;
    };

    const onSpeakAck = (data: { jobId?: string }) => {
      if (typeof data?.jobId !== "string") return;
      const npcId = sendingNpcIdRef.current ?? thinkingNpcIdRef.current;
      pendingJobIdRef.current = data.jobId;
      setJobId(data.jobId);
      setSendingNpcId(null);
      sendingNpcIdRef.current = null;
      setSpeakBusyNpcId(null);
      recordSpeakLatencyMark("speak_ack", { jobId: data.jobId, npcId });
      if (npcId) {
        const turnText = inFlightTextRef.current.get(npcId) ?? "";
        activeTurnPlayerTextRef.current.set(npcId, turnText);
        inFlightTextRef.current.delete(npcId);
        thinkingNpcIdRef.current = npcId;
        speakBusyNpcIdRef.current = null;
        setThinkingNpcId(npcId);
        setStatus("thinking");
      }
    };
    const onThinking = (data: { jobId?: string }) => {
      if (!pendingJobIdRef.current) return;
      if (typeof data.jobId === "string" && data.jobId !== pendingJobIdRef.current) return;
      setStatus("thinking");
    };
    const onSpeakPartial = (data: ColyseusSpeakPartialPayload & { jobId?: string }) => {
      if (data?.jobId && pendingJobIdRef.current && data.jobId !== pendingJobIdRef.current) {
        return;
      }
      const text = typeof data.text === "string" ? data.text : "";
      if (!text.trim()) return;
      const replyNpcId =
        typeof data.npcId === "string" ? data.npcId : thinkingNpcIdRef.current;
      if (!replyNpcId || replyNpcId !== activeNpcIdRef.current) return;
      if (!partialSeenRef.current) {
        partialSeenRef.current = true;
        recordSpeakLatencyMark("speak_partial", {
          jobId: data.jobId ?? pendingJobIdRef.current,
          npcId: replyNpcId,
          textLen: text.length,
        });
      }
      setStreamingReply(sanitizeNpcReplyText(text));
    };
    const onDone = (data: ColyseusNpcJobDonePayload & { jobId?: string }) => {
      // Fast-lane race: worker may emit done before speakAck sets pendingJobIdRef.
      if (
        typeof data?.jobId === "string" &&
        !pendingJobIdRef.current &&
        thinkingNpcIdRef.current
      ) {
        pendingJobIdRef.current = data.jobId;
        setJobId(data.jobId);
      }
      const matched = matchesJob(data?.jobId);
      if (!matched) return;
      const replyNpcId =
        typeof data.npcId === "string" ? data.npcId : activeNpcIdRef.current;
      const npcName = typeof data.npcName === "string" ? data.npcName : "";
      if (data.gateRejected) {
        setAttitudeGateCue({
          gateKind: typeof data.gateKind === "string" ? data.gateKind : "move",
          npcName,
        });
      }
      const doneReply = sanitizeNpcReplyText(data.reply ?? "");
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "npc",
          text: doneReply,
          npcId: replyNpcId,
          npcName: typeof data.npcName === "string" ? data.npcName : undefined,
          memoryQuote:
            typeof data.memoryQuote === "string" && data.memoryQuote.trim()
              ? data.memoryQuote.trim()
              : undefined,
        },
      ]);
      if (data.state) setRoomState(data.state);
      const st = data.state as { npcs?: { id: string; x: number; y: number }[] } | undefined;
      const stNpc = st?.npcs?.find((n) => n.id === replyNpcId);
      recordSpeakLatencyMark("done", {
        jobId: data.jobId,
        npcId: replyNpcId,
        llmCallSummary: data.llmCallSummary,
        toolNames: (data.toolCalls ?? []).map((t) => t?.name).filter(Boolean),
        npcPos: stNpc ? { x: stNpc.x, y: stNpc.y } : null,
        speakIntent: data.speakIntent,
        phaseTimingMs: data.phaseTimingMs,
      });
      setStreamingReply(null);
      partialSeenRef.current = false;
      if (shouldRefetchCollectiveOnJobDone(data.collectiveUpdated)) {
        onCollectiveUpdatedRef.current?.();
      }
      setStatus("idle");
      setThinkingNpcId(null);
      setSpeakBusyNpcId(null);
      setSendingNpcId(null);
      pendingJobIdRef.current = null;
      const completedPlayerText = activeTurnPlayerTextRef.current.get(replyNpcId) ?? "";
      activeTurnPlayerTextRef.current.delete(replyNpcId);
      const dedupedQueued = discardQueuedSpeakMatching(
        speakQueuesRef.current,
        replyNpcId,
        completedPlayerText,
      );
      if (dedupedQueued > 0) syncQueueDepth(replyNpcId);
      clearInFlightRefsForDrain(
        {
          thinkingNpcId: thinkingNpcIdRef,
          speakBusyNpcId: speakBusyNpcIdRef,
          sendingNpcId: sendingNpcIdRef,
        },
        replyNpcId,
      );
      void refetchState(data.state ? { memoryOnly: true } : undefined);
      queueMicrotask(() => drainSpeakQueueRef.current?.(replyNpcId));
    };
    const onError = (data: { jobId?: string; message?: string }) => {
      if (data?.jobId && !matchesJob(data.jobId)) return;
      setStreamingReply(null);
      partialSeenRef.current = false;
      setError(data.message ?? "NPC 回合出错");
      setStatus("error");
      const npcId = sendingNpcIdRef.current ?? thinkingNpcIdRef.current;
      clearSendingState(npcId);
      pendingJobIdRef.current = null;
      if (npcId) {
        queueMicrotask(() => drainSpeakQueueRef.current?.(npcId));
      }
    };
    const onSpeakBusy = (data: ColyseusSpeakBusyPayload) => {
      const busyNpc = typeof data.npcId === "string" ? data.npcId : sendingNpcIdRef.current;
      if (!busyNpc) return;
      const inflight = inFlightTextRef.current.get(busyNpc);
      // Duplicate client send while our job is already in flight — drop, keep waiting for onDone.
      if (pendingJobIdRef.current && thinkingNpcIdRef.current === busyNpc) {
        inFlightTextRef.current.delete(busyNpc);
        setSendingNpcId((prev) => (prev === busyNpc ? null : prev));
        if (sendingNpcIdRef.current === busyNpc) sendingNpcIdRef.current = null;
        return;
      }
      if (thinkingNpcIdRef.current === busyNpc && inflight) {
        inFlightTextRef.current.delete(busyNpc);
        setSendingNpcId((prev) => (prev === busyNpc ? null : prev));
        if (sendingNpcIdRef.current === busyNpc) sendingNpcIdRef.current = null;
        return;
      }
      if (inflight) {
        inFlightTextRef.current.delete(busyNpc);
        enqueueSpeak(busyNpc, inflight, { showPlayerBubble: false });
        // Clear sending so composerSpeakBusyOtherPlayer → banner / status (not "正在思考…")
        setSendingNpcId((prev) => (prev === busyNpc ? null : prev));
        if (sendingNpcIdRef.current === busyNpc) {
          sendingNpcIdRef.current = null;
        }
      } else {
        clearSendingState(busyNpc);
      }
      setSpeakBusyNpcId(busyNpc);
      setStatus("idle");
      pendingJobIdRef.current = null;
      setJobId(null);
    };
    const onSpeakIdle = (data: ColyseusSpeakIdlePayload) => {
      if (typeof data.npcId === "string") {
        releaseNpcBusy(data.npcId);
        queueMicrotask(() => drainSpeakQueueRef.current?.(data.npcId));
      }
    };
    const onPatch = (data: StatePatchPayload & { jobId?: string }) => {
      const version = data.stateVersion;
      if (typeof version === "number" && version > stateVersionRef.current) {
        stateVersionRef.current = version;
        setRoomState((prev) => {
          if (!prev) return prev;
          return applyStatePatch(prev, data.delta);
        });
      }
      // Do not release speak busy / drain here — patch can arrive mid-turn.
      // speakIdle + done/error handle queue drain with job-id guards.
    };

    const offSpeakAck = room.onMessage("speakAck", onSpeakAck);
    const offThinking = room.onMessage(COLYSEUS_SERVER_MESSAGES.thinking, onThinking);
    const offSpeakPartial = room.onMessage(COLYSEUS_SERVER_MESSAGES.speakPartial, onSpeakPartial);
    const offDone = room.onMessage(COLYSEUS_SERVER_MESSAGES.done, onDone);
    const offError = room.onMessage(COLYSEUS_SERVER_MESSAGES.error, onError);
    const offSpeakBusy = room.onMessage(COLYSEUS_SERVER_MESSAGES.speakBusy, onSpeakBusy);
    const offSpeakIdle = room.onMessage(COLYSEUS_SERVER_MESSAGES.speakIdle, onSpeakIdle);
    const offPatch = room.onMessage(COLYSEUS_SERVER_MESSAGES.patch, onPatch);

    return () => {
      offSpeakAck();
      offThinking();
      offSpeakPartial();
      offDone();
      offError();
      offSpeakBusy();
      offSpeakIdle();
      offPatch();
    };
  }, [colyseusRoom, refetchState, clearSendingState, releaseNpcBusy, enqueueSpeak, syncQueueDepth]);

  const dispatchSpeak = useCallback(
    async (text: string, npcId: string, opts?: { skipPlayerBubble?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const room = colyseusRoom;
      if (!room) {
        setError("未连接游戏房间");
        setStatus("error");
        return;
      }
      if (
        !opts?.skipPlayerBubble &&
        isNpcSpeakInFlight({
          npcId,
          speakBusyNpcId: speakBusyNpcIdRef.current,
          sendingNpcId: sendingNpcIdRef.current,
          thinkingNpcId: thinkingNpcIdRef.current,
        })
      ) {
        return;
      }

      setError(null);
      setParseError(null);
      if (!opts?.skipPlayerBubble) {
        setMessages((prev) => [
          ...prev,
          { id: crypto.randomUUID(), role: "player", text: trimmed },
        ]);
      }
      inFlightTextRef.current.set(npcId, trimmed);
      setSendingNpcId(npcId);
      sendingNpcIdRef.current = npcId;
      thinkingNpcIdRef.current = npcId;
      setThinkingNpcId(npcId);
      setStatus("thinking");
      const keepPendingJob =
        thinkingNpcIdRef.current === npcId && Boolean(pendingJobIdRef.current);
      if (!keepPendingJob) {
        pendingJobIdRef.current = null;
        setJobId(null);
      }
      setStreamingReply(null);
      partialSeenRef.current = false;

      recordSpeakLatencyMark("dispatch_start", { npcId, textLen: trimmed.length });
      if (typeof window !== "undefined") {
        window.__speakLatencyT0 = performance.now();
      }

      const clientStub = previewCasualSpeakStub(trimmed);
      if (clientStub && npcId === activeNpcIdRef.current) {
        setStreamingReply(sanitizeNpcReplyText(clientStub));
        if (!partialSeenRef.current) {
          partialSeenRef.current = true;
          recordSpeakLatencyMark("speak_partial", {
            source: "client_mirror",
            npcId,
            textLen: clientStub.length,
          });
        }
      }

      try {
        room.send(COLYSEUS_CLIENT_MESSAGES.speak, {
          text: trimmed,
          npcId,
          playerId: getOrCreatePlayerId(),
        });
        recordSpeakLatencyMark("speak_sent", { npcId });

        void fetch(`${chatBase}/rooms/${mapRoomId}/nl/parse`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, npcId }),
        })
          .then(async (parseRes) => {
            const parseBody = await parseRes.json().catch(() => ({}));
            recordSpeakLatencyMark("nl_parse_end", { ok: parseRes.ok });
            if (parseRes.ok) {
              setLastParsedIntent(
                parseBody.parsedIntent && typeof parseBody.parsedIntent === "object"
                  ? (parseBody.parsedIntent as ParsedIntent)
                  : null,
              );
              setParseError(typeof parseBody.parseError === "string" ? parseBody.parseError : null);
            }
          })
          .catch(() => {
            recordSpeakLatencyMark("nl_parse_end", { ok: false, error: true });
          });
      } catch {
        setError("无法联系游戏服务器");
        setStatus("error");
        inFlightTextRef.current.delete(npcId);
        clearSendingState(npcId);
        pendingJobIdRef.current = null;
      }
    },
    [colyseusRoom, mapRoomId, clearSendingState],
  );

  dispatchSpeakRef.current = dispatchSpeak;

  const resetGame = useCallback(async (): Promise<RoomState | null> => {
    try {
      const res = await fetch(`${apiBase}/rooms/${mapRoomId}/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...playerApiHeaders(),
        },
      });
      if (!res.ok) {
        setError("重置房间失败");
        setStatus("error");
        return null;
      }
      const body = await res.json();
      clearLastGridPos(mapRoomId);
      setMessages([]);
      setRoomState(body.state);
      setMemoryCounts(body.memoryCounts ?? {});
      setActiveNpcId(DEFAULT_NPC_ID);
      setStatus("idle");
      setError(null);
      setJobId(null);
      setSpeakBusyNpcId(null);
      setThinkingNpcId(null);
      setSendingNpcId(null);
      thinkingNpcIdRef.current = null;
      speakBusyNpcIdRef.current = null;
      sendingNpcIdRef.current = null;
      pendingJobIdRef.current = null;
      stateVersionRef.current = 0;
      setLastParsedIntent(null);
      setParseError(null);
      setAttitudeGateCue(null);
      speakQueuesRef.current = new Map();
      setSpeakQueueDepthByNpc({});
      inFlightTextRef.current = new Map();
      activeTurnPlayerTextRef.current = new Map();
      setStreamingReply(null);
      partialSeenRef.current = false;
      return body.state as RoomState;
    } catch {
      setError("重置房间失败");
      setStatus("error");
      return null;
    }
  }, [mapRoomId]);

  const sendMessage = useCallback(
    async (text: string, npcId: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (!colyseusRoom) {
        setError("未连接游戏房间");
        setStatus("error");
        return;
      }
      if (
        isNpcSpeakInFlight({
          npcId,
          speakBusyNpcId: speakBusyNpcIdRef.current,
          sendingNpcId: sendingNpcIdRef.current,
          thinkingNpcId: thinkingNpcIdRef.current,
        })
      ) {
        // Option A: no client-side "type while thinking" queue — composer stays disabled.
        return;
      }
      await dispatchSpeak(trimmed, npcId);
    },
    [colyseusRoom, dispatchSpeak],
  );

  const speakQueueDepth = speakQueueDepthByNpc[activeNpcId] ?? 0;

  return {
    messages,
    status,
    roomState,
    memoryCounts,
    activeNpcId,
    setActiveNpcId,
    jobId,
    error,
    lastParsedIntent,
    parseError,
    thinkingNpcId,
    speakBusyNpcId,
    sendingNpcId,
    speakQueueDepth,
    speakQueueBusy:
      speakBusyNpcId === activeNpcId ||
      speakQueueDepth > 0 ||
      (status === "thinking" && thinkingNpcId === activeNpcId),
    composerBusyForActiveNpc:
      sendingNpcId === activeNpcId ||
      (status === "thinking" && thinkingNpcId === activeNpcId) ||
      speakBusyNpcId === activeNpcId,
    attitudeGateCue,
    clearAttitudeGateCue: () => setAttitudeGateCue(null),
    attitudeGateHintCopy,
    streamingReply,
    sendMessage,
    resetGame,
    refetchState,
  };
}
