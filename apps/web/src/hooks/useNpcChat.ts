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
import {
  attitudeGateHintCopy,
  clearInFlightRefsForDrain,
  createNpcJobRegistry,
  clearNpcJob,
  collectThinkingNpcIds,
  dequeueNpcSpeak,
  discardQueuedSpeakMatching,
  enqueueNpcSpeak,
  isNpcSpeakInFlight,
  isTrackedSpeakJob,
  npcSpeakQueueDepth,
  pendingJobNpcIds,
  registerNpcJob,
  registryToRecord,
  resolveNpcForJob,
  type AttitudeGateCue,
  type ChatMessage,
  type ChatStatus,
  type NpcJobRegistry,
  type NpcSpeakQueue,
  type ParsedIntent,
  type RoomNpc,
  type RoomStateShape,
  type UseNpcChatOptions,
} from "./npcChat/index.js";

export type {
  AttitudeGateCue,
  ChatMessage,
  ChatStatus,
  NpcJobRegistry,
  NpcSpeakQueue,
  ParsedIntent,
  RoomNpc,
  RoomStateShape,
  UseNpcChatOptions,
};
export {
  clearInFlightRefsForDrain,
  clearNpcJob,
  collectThinkingNpcIds,
  createNpcJobRegistry,
  dequeueNpcSpeak,
  discardQueuedSpeakMatching,
  enqueueNpcSpeak,
  isNpcSpeakInFlight,
  isTrackedSpeakJob,
  npcSpeakQueueDepth,
  pendingJobNpcIds,
  registerNpcJob,
  registryToRecord,
  resolveNpcForJob,
};

const apiBase = import.meta.env.VITE_GAME_SERVER_URL || "/api";
const chatBase = import.meta.env.VITE_AI_GATEWAY_URL || "/v1";
const DEFAULT_NPC_ID = "npc-1";
export function useNpcChat(
  colyseusRoom: Room | null,
  mapRoomId = "default",
  options: UseNpcChatOptions = {},
) {
  const onCollectiveUpdatedRef = useRef(options.onCollectiveUpdated);
  onCollectiveUpdatedRef.current = options.onCollectiveUpdated;
  const fetchAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      fetchAbortRef.current?.abort();
    };
  }, []);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const [roomState, setRoomState] = useState<RoomStateShape | null>(null);
  const [memoryCounts, setMemoryCounts] = useState<Record<string, number>>({});
  const [activeNpcId, setActiveNpcId] = useState(DEFAULT_NPC_ID);
  const [jobId, setJobId] = useState<string | null>(null);
  const npcJobRegistryRef = useRef(createNpcJobRegistry());
  const [pendingJobsByNpc, setPendingJobsByNpc] = useState<Record<string, string>>({});
  const sendingNpcIdRef = useRef<string | null>(null);
  const activeNpcIdRef = useRef(activeNpcId);
  activeNpcIdRef.current = activeNpcId;
  const [error, setError] = useState<string | null>(null);
  const [lastParsedIntent, setLastParsedIntent] = useState<ParsedIntent>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [speakBusyNpcId, setSpeakBusyNpcId] = useState<string | null>(null);
  const [sendingNpcId, setSendingNpcId] = useState<string | null>(null);
  const [attitudeGateCue, setAttitudeGateCue] = useState<AttitudeGateCue | null>(null);
  const [streamingByNpc, setStreamingByNpc] = useState<Record<string, string>>({});
  const [speakQueueDepthByNpc, setSpeakQueueDepthByNpc] = useState<Record<string, number>>({});
  const partialSeenByJobRef = useRef(new Map<string, boolean>());
  const stateVersionRef = useRef(0);
  const speakBusyNpcIdRef = useRef<string | null>(null);
  speakBusyNpcIdRef.current = speakBusyNpcId;
  const speakQueuesRef = useRef<NpcSpeakQueue>(new Map());
  const inFlightTextRef = useRef<Map<string, string>>(new Map());
  const activeTurnPlayerTextRef = useRef<Map<string, string>>(new Map());
  const dispatchSpeakRef = useRef<
    ((text: string, npcId: string, opts?: { skipPlayerBubble?: boolean }) => Promise<void>) | null
  >(null);
  const drainSpeakQueueRef = useRef<((npcId: string) => void) | null>(null);

  const syncPendingJobsState = useCallback(() => {
    setPendingJobsByNpc(registryToRecord(npcJobRegistryRef.current));
  }, []);

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
      pendingJobNpcIds: pendingJobNpcIds(npcJobRegistryRef.current),
    });
  }, []);

  const anySpeakInFlight = useCallback(() => {
    return (
      npcJobRegistryRef.current.byNpc.size > 0 || sendingNpcIdRef.current !== null
    );
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
    if (sendingNpcIdRef.current === npcId) sendingNpcIdRef.current = null;
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
    fetchAbortRef.current?.abort();
    const abort = new AbortController();
    fetchAbortRef.current = abort;
    while (true) {
      if (abort.signal.aborted) return false;
      try {
        const res = await fetch(url, { headers: playerApiHeaders(), signal: abort.signal });
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
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return false;
        /* game-server may still be starting (vite proxy ECONNREFUSED) */
      }
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 400));
    }
  }, [mapRoomId]);

  useEffect(() => {
    const room = colyseusRoom;
    if (!room) return;

    const onSpeakAck = (data: { jobId?: string; npcId?: string }) => {
      if (typeof data?.jobId !== "string") return;
      const npcId =
        typeof data.npcId === "string"
          ? data.npcId
          : sendingNpcIdRef.current ?? undefined;
      if (!npcId) return;
      registerNpcJob(npcJobRegistryRef.current, npcId, data.jobId);
      syncPendingJobsState();
      if (activeNpcIdRef.current === npcId) {
        setJobId(data.jobId);
      }
      if (sendingNpcIdRef.current === npcId) {
        setSendingNpcId(null);
        sendingNpcIdRef.current = null;
      }
      setSpeakBusyNpcId(null);
      speakBusyNpcIdRef.current = null;
      recordSpeakLatencyMark("speak_ack", { jobId: data.jobId, npcId });
      const turnText = inFlightTextRef.current.get(npcId) ?? "";
      activeTurnPlayerTextRef.current.set(npcId, turnText);
      inFlightTextRef.current.delete(npcId);
      setStatus("thinking");
    };
    const onThinking = (data: { jobId?: string }) => {
      if (typeof data.jobId === "string" && !isTrackedSpeakJob(npcJobRegistryRef.current, data.jobId)) {
        return;
      }
      setStatus("thinking");
    };
    const onSpeakPartial = (data: ColyseusSpeakPartialPayload & { jobId?: string }) => {
      const replyNpcId =
        (typeof data.npcId === "string" ? data.npcId : undefined) ??
        resolveNpcForJob(npcJobRegistryRef.current, data.jobId);
      if (!replyNpcId) return;
      if (data?.jobId && !isTrackedSpeakJob(npcJobRegistryRef.current, data.jobId)) {
        return;
      }
      const text = typeof data.text === "string" ? data.text : "";
      if (!text.trim()) return;
      const jobKey = data.jobId ?? npcJobRegistryRef.current.byNpc.get(replyNpcId) ?? replyNpcId;
      if (!partialSeenByJobRef.current.get(jobKey)) {
        partialSeenByJobRef.current.set(jobKey, true);
        recordSpeakLatencyMark("speak_partial", {
          jobId: data.jobId,
          npcId: replyNpcId,
          textLen: text.length,
        });
      }
      setStreamingByNpc((prev) => ({
        ...prev,
        [replyNpcId]: sanitizeNpcReplyText(text),
      }));
    };
    const onDone = (data: ColyseusNpcJobDonePayload & { jobId?: string }) => {
      const replyNpcIdFromPayload =
        typeof data.npcId === "string" ? data.npcId : undefined;
      const replyNpcIdFromJob = resolveNpcForJob(npcJobRegistryRef.current, data?.jobId);
      // Fast-lane race: worker may emit done before speakAck registers the job.
      if (
        typeof data?.jobId === "string" &&
        !isTrackedSpeakJob(npcJobRegistryRef.current, data.jobId) &&
        replyNpcIdFromPayload
      ) {
        registerNpcJob(npcJobRegistryRef.current, replyNpcIdFromPayload, data.jobId);
        syncPendingJobsState();
        if (activeNpcIdRef.current === replyNpcIdFromPayload) {
          setJobId(data.jobId);
        }
      }
      if (typeof data?.jobId === "string" && !isTrackedSpeakJob(npcJobRegistryRef.current, data.jobId)) {
        return;
      }
      const replyNpcId = replyNpcIdFromPayload ?? replyNpcIdFromJob ?? activeNpcIdRef.current;
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
      if (typeof data.jobId === "string") {
        partialSeenByJobRef.current.delete(data.jobId);
      }
      setStreamingByNpc((prev) => {
        if (!replyNpcId || !(replyNpcId in prev)) return prev;
        const next = { ...prev };
        delete next[replyNpcId];
        return next;
      });
      if (shouldRefetchCollectiveOnJobDone(data.collectiveUpdated)) {
        onCollectiveUpdatedRef.current?.();
      }
      if (typeof data.jobId === "string") {
        clearNpcJob(npcJobRegistryRef.current, data.jobId);
      }
      syncPendingJobsState();
      if (activeNpcIdRef.current === replyNpcId) {
        setJobId(null);
      }
      setStatus(anySpeakInFlight() ? "thinking" : "idle");
      setSpeakBusyNpcId(null);
      speakBusyNpcIdRef.current = null;
      if (sendingNpcIdRef.current === replyNpcId) {
        setSendingNpcId(null);
        sendingNpcIdRef.current = null;
      }
      const completedPlayerText = activeTurnPlayerTextRef.current.get(replyNpcId) ?? "";
      activeTurnPlayerTextRef.current.delete(replyNpcId);
      const dedupedQueued = discardQueuedSpeakMatching(
        speakQueuesRef.current,
        replyNpcId,
        completedPlayerText,
      );
      if (dedupedQueued > 0) syncQueueDepth(replyNpcId);
      void refetchState(data.state ? { memoryOnly: true } : undefined);
      queueMicrotask(() => drainSpeakQueueRef.current?.(replyNpcId));
    };
    const onError = (data: { jobId?: string; message?: string; npcId?: string }) => {
      const npcId =
        (typeof data.npcId === "string" ? data.npcId : undefined) ??
        resolveNpcForJob(npcJobRegistryRef.current, data.jobId) ??
        sendingNpcIdRef.current;
      if (data?.jobId && !isTrackedSpeakJob(npcJobRegistryRef.current, data.jobId)) {
        return;
      }
      if (npcId) {
        setStreamingByNpc((prev) => {
          if (!(npcId in prev)) return prev;
          const next = { ...prev };
          delete next[npcId];
          return next;
        });
      }
      if (typeof data.jobId === "string") {
        partialSeenByJobRef.current.delete(data.jobId);
        clearNpcJob(npcJobRegistryRef.current, data.jobId);
        syncPendingJobsState();
      }
      setError(data.message ?? "NPC 回合出错");
      setStatus(anySpeakInFlight() ? "thinking" : "error");
      clearSendingState(npcId);
      if (activeNpcIdRef.current === npcId) {
        setJobId(null);
      }
      if (npcId) {
        queueMicrotask(() => drainSpeakQueueRef.current?.(npcId));
      }
    };
    const onSpeakBusy = (data: ColyseusSpeakBusyPayload) => {
      const busyNpc = typeof data.npcId === "string" ? data.npcId : sendingNpcIdRef.current;
      if (!busyNpc) return;
      const inflight = inFlightTextRef.current.get(busyNpc);
      const hasPendingJob = npcJobRegistryRef.current.byNpc.has(busyNpc);
      // Duplicate client send while our job is already in flight — drop, keep waiting for onDone.
      if (hasPendingJob) {
        inFlightTextRef.current.delete(busyNpc);
        setSendingNpcId((prev) => (prev === busyNpc ? null : prev));
        if (sendingNpcIdRef.current === busyNpc) sendingNpcIdRef.current = null;
        return;
      }
      if (sendingNpcIdRef.current === busyNpc && inflight) {
        inFlightTextRef.current.delete(busyNpc);
        setSendingNpcId((prev) => (prev === busyNpc ? null : prev));
        if (sendingNpcIdRef.current === busyNpc) sendingNpcIdRef.current = null;
        return;
      }
      if (inflight) {
        inFlightTextRef.current.delete(busyNpc);
        enqueueSpeak(busyNpc, inflight, { showPlayerBubble: false });
        setSendingNpcId((prev) => (prev === busyNpc ? null : prev));
        if (sendingNpcIdRef.current === busyNpc) {
          sendingNpcIdRef.current = null;
        }
      } else {
        clearSendingState(busyNpc);
      }
      setSpeakBusyNpcId(busyNpc);
      setStatus("idle");
      const jobIdForNpc = npcJobRegistryRef.current.byNpc.get(busyNpc);
      if (jobIdForNpc) {
        clearNpcJob(npcJobRegistryRef.current, jobIdForNpc);
        syncPendingJobsState();
      }
      if (activeNpcIdRef.current === busyNpc) {
        setJobId(null);
      }
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
  }, [colyseusRoom, refetchState, clearSendingState, releaseNpcBusy, enqueueSpeak, syncQueueDepth, syncPendingJobsState, anySpeakInFlight]);

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
          pendingJobNpcIds: pendingJobNpcIds(npcJobRegistryRef.current),
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
      setStatus("thinking");
      setStreamingByNpc((prev) => {
        if (!(npcId in prev)) return prev;
        const next = { ...prev };
        delete next[npcId];
        return next;
      });
      const jobKey = npcJobRegistryRef.current.byNpc.get(npcId);
      if (jobKey) partialSeenByJobRef.current.delete(jobKey);

      recordSpeakLatencyMark("dispatch_start", { npcId, textLen: trimmed.length });
      if (typeof window !== "undefined") {
        window.__speakLatencyT0 = performance.now();
      }

      const clientStub = previewCasualSpeakStub(trimmed);
      if (clientStub) {
        setStreamingByNpc((prev) => ({
          ...prev,
          [npcId]: sanitizeNpcReplyText(clientStub),
        }));
        if (!partialSeenByJobRef.current.get(`client:${npcId}`)) {
          partialSeenByJobRef.current.set(`client:${npcId}`, true);
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
          signal: fetchAbortRef.current?.signal,
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
      }
    },
    [colyseusRoom, mapRoomId, clearSendingState],
  );

  dispatchSpeakRef.current = dispatchSpeak;

  const resetGame = useCallback(async (): Promise<RoomState | null> => {
    fetchAbortRef.current?.abort();
    const abort = new AbortController();
    fetchAbortRef.current = abort;
    try {
      const res = await fetch(`${apiBase}/rooms/${mapRoomId}/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...playerApiHeaders(),
        },
        signal: abort.signal,
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
      setSendingNpcId(null);
      speakBusyNpcIdRef.current = null;
      sendingNpcIdRef.current = null;
      npcJobRegistryRef.current = createNpcJobRegistry();
      setPendingJobsByNpc({});
      stateVersionRef.current = 0;
      setLastParsedIntent(null);
      setParseError(null);
      setAttitudeGateCue(null);
      speakQueuesRef.current = new Map();
      setSpeakQueueDepthByNpc({});
      inFlightTextRef.current = new Map();
      activeTurnPlayerTextRef.current = new Map();
      setStreamingByNpc({});
      partialSeenByJobRef.current = new Map();
      return body.state as RoomState;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return null;
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
          pendingJobNpcIds: pendingJobNpcIds(npcJobRegistryRef.current),
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
  const thinkingNpcIds = (() => {
    const ids = new Set(Object.keys(pendingJobsByNpc));
    if (sendingNpcId) ids.add(sendingNpcId);
    return [...ids];
  })();
  const activeNpcInFlight = isNpcSpeakInFlight({
    npcId: activeNpcId,
    speakBusyNpcId,
    sendingNpcId,
    pendingJobNpcIds: Object.keys(pendingJobsByNpc),
  });
  const thinkingNpcId = activeNpcInFlight ? activeNpcId : null;
  const streamingReply = streamingByNpc[activeNpcId] ?? null;
  const activeJobId = pendingJobsByNpc[activeNpcId] ?? null;

  return {
    messages,
    status,
    roomState,
    memoryCounts,
    activeNpcId,
    setActiveNpcId,
    jobId: activeJobId ?? jobId,
    error,
    lastParsedIntent,
    parseError,
    thinkingNpcId,
    thinkingNpcIds,
    speakBusyNpcId,
    sendingNpcId,
    speakQueueDepth,
    speakQueueBusy:
      speakBusyNpcId === activeNpcId ||
      speakQueueDepth > 0 ||
      activeNpcInFlight,
    composerBusyForActiveNpc: activeNpcInFlight,
    attitudeGateCue,
    clearAttitudeGateCue: () => setAttitudeGateCue(null),
    attitudeGateHintCopy,
    streamingReply,
    sendMessage,
    resetGame,
    refetchState,
  };
}
