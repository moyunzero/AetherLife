import { bandLabelZh, createDefaultRoom, isBackgroundNpc, type RoomState } from "@aetherlife/shared";
import {
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { useColyseusRoom } from "./hooks/useColyseusRoom.js";
import { useNpcChat } from "./hooks/useNpcChat.js";
import { MovementPanel } from "./components/MovementPanel.js";
import { PhaserGame, probePhaserBoot } from "./components/PhaserGame.js";
import { MessageList } from "./components/MessageList.js";
import { CollectiveAttitudeOverlay } from "./components/CollectiveAttitudeOverlay.js";
import { CollectiveBrowsePanel } from "./components/CollectiveBrowsePanel.js";
import { CollectiveDebugPanel } from "./components/CollectiveDebugPanel.js";
import { CollectiveFeedbackBanner } from "./components/CollectiveFeedbackBanner.js";
import { NpcTabBar } from "./components/NpcTabBar.js";
import { useCollectiveAttitude } from "./hooks/useCollectiveAttitude.js";
import { RoomStatePanel } from "./components/RoomStatePanel.js";
import { NpcMemoryPanel } from "./components/NpcMemoryPanel.js";
import { SyncMetricsOverlay } from "./components/SyncMetricsOverlay.js";
import { getMapRoomId } from "./lib/mapRoomId.js";
import {
  resolveCollectiveInitiatorPlayerId,
  shouldShowCollectiveFeedbackBanner,
} from "./lib/collectiveInitiator.js";
import { getOrCreatePlayerId } from "./lib/playerSession.js";
import { playerRequestsMove } from "./lib/playerMoveIntent.js";
import { subscribeTabPresence } from "./lib/playerSession.js";
import { playerDisplayName } from "./lib/playerDisplayName.js";

/** Merge HTTP room snapshot into moveMap; Colyseus grid wins over stale HTTP npc coords. */
function mergeRoomStateIntoMoveMap(
  roomState: RoomState,
  _prev: RoomState,
  grids: Record<string, { x: number; y: number }>,
): RoomState {
  const npcs = roomState.npcs.map((npc) => {
    const coly = grids[npc.id];
    if (coly) {
      return { ...npc, x: coly.x, y: coly.y };
    }
    return npc;
  });
  return { ...roomState, npcs };
}

export function ChatPage() {
  const mapRoomId = getMapRoomId();
  const [duplicateTab, setDuplicateTab] = useState(false);
  const [moveMap, setMoveMap] = useState<RoomState>(() => createDefaultRoom());
  const {
    room,
    connected,
    players,
    sessionId,
    error: colyseusError,
    roomFull,
    animating,
    moveHint,
    sendMove,
    sendMoveTo,
    syncMetrics,
    remoteInterpMs,
    loadedChunks,
    loreForChunk,
    consumeDiscoverToast,
    loreToastQueue,
    motionBridgeRef,
    movementSyncRef,
    gameClock,
    npcActivityById,
    npcAmbientById,
    mainNpcGridById,
    bgNpcGridById,
  } = useColyseusRoom(mapRoomId, moveMap);
  const discoverToast = loreToastQueue[0] ?? null;
  const dismissDiscoverToast = useCallback(() => {
    consumeDiscoverToast();
  }, [consumeDiscoverToast]);
  const onCollectiveUpdatedRef = useRef<(() => void) | null>(null);
  const {
    messages,
    error,
    roomState,
    activeNpcId,
    setActiveNpcId,
    sendMessage,
    resetGame,
    refetchState,
    lastParsedIntent,
    parseError,
    speakBusyNpcId,
    thinkingNpcId,
    thinkingNpcIds,
    sendingNpcId,
    composerBusyForActiveNpc,
    attitudeGateCue,
    clearAttitudeGateCue,
    attitudeGateHintCopy,
    streamingReply,
  } = useNpcChat(room, mapRoomId, {
    onCollectiveUpdated: () => onCollectiveUpdatedRef.current?.(),
  });
  const [draft, setDraft] = useState("");
  const [stateUpdated, setStateUpdated] = useState(false);
  const [npcMoveHint, setNpcMoveHint] = useState<string | null>(null);
  /** After first roomState sync, NPC live moves may animate; load/reset always snap. */
  const [npcWorldLive, setNpcWorldLive] = useState(false);
  const prevNpcPosRef = useRef(new Map<string, { x: number; y: number }>());
  /** True while POST /reset in flight — blocks enabling npcWorldLive on stale roomState. */
  const awaitingResetRef = useRef(false);
  /** First load only; reset re-enables live via performResetGame, not this effect. */
  const initialNpcLiveDoneRef = useRef(false);
  const [npcResetEpoch, setNpcResetEpoch] = useState(0);
  const forcePhaserFallback =
    import.meta.env.VITE_PHASER_FORCE_FALLBACK === "1" ||
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("phaserFallback") === "1");
  const [bootPending, setBootPending] = useState(!forcePhaserFallback);
  const [phaserOk, setPhaserOk] = useState(false);
  const [bootOk, setBootOk] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const collectiveBrowseDetailsRef = useRef<HTMLDetailsElement>(null);
  const playerId = useMemo(() => getOrCreatePlayerId(), []);
  const showSyncDebug =
    import.meta.env.DEV ||
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("syncDebug") === "1");
  const showCollectiveDebug =
    import.meta.env.DEV ||
    (typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("collectiveDebug") === "1");
  const [attitudeGateHint, setAttitudeGateHint] = useState<string | null>(null);
  const { snapshot: collectiveSnapshot, loading: collectiveLoading, invalidateCollective, refetchCollective } =
    useCollectiveAttitude(mapRoomId, activeNpcId);
  onCollectiveUpdatedRef.current = refetchCollective;

  const latestCollectiveEvent = collectiveSnapshot?.recentEvents[0];
  const collectiveFeedbackKind =
    latestCollectiveEvent &&
    shouldShowCollectiveFeedbackBanner(latestCollectiveEvent, playerId) &&
    (latestCollectiveEvent.kind === "rude" || latestCollectiveEvent.kind === "help")
      ? latestCollectiveEvent.kind
      : null;

  useEffect(() => {
    const event = collectiveSnapshot?.recentEvents[0];
    if (!event || (event.kind !== "rude" && event.kind !== "help")) return;
    if (resolveCollectiveInitiatorPlayerId(event) !== playerId) return;
    const key = `collective-auto-open:${mapRoomId}:${activeNpcId}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    const details = collectiveBrowseDetailsRef.current;
    if (details) details.open = true;
  }, [collectiveSnapshot?.recentEvents, mapRoomId, activeNpcId, playerId]);

  useEffect(() => {
    if (forcePhaserFallback) {
      setBootPending(false);
      return;
    }
    let cancelled = false;
    void probePhaserBoot().then((ok) => {
      if (cancelled) return;
      setPhaserOk(ok);
      setBootOk(ok);
      setBootPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [forcePhaserFallback]);

  const selectNpc = useCallback(
    (npcId: string) => {
      composerRef.current?.blur();
      setActiveNpcId(npcId);
    },
    [setActiveNpcId],
  );

  const displayNpcs = useMemo(() => {
    const meta = roomState?.npcs ?? moveMap.npcs;
    return meta.map((npc) => {
      const live = moveMap.npcs.find((n) => n.id === npc.id);
      if (!live) return npc;
      return {
        ...npc,
        x: live.x,
        y: live.y,
        facing: live.facing ?? npc.facing,
      };
    });
  }, [roomState, moveMap]);

  const npcs = useMemo(
    () =>
      displayNpcs
        .filter((npc) => !isBackgroundNpc(npc))
        .map((npc) => ({
          id: npc.id,
          name: npc.name,
        })),
    [displayNpcs],
  );

  const activeNpcName =
    npcs.find((npc) => npc.id === activeNpcId)?.name ?? "NPC";

  useEffect(() => {
    void refetchState({ retryUntilMs: 15_000 });
  }, [refetchState]);

  /** Ambient tick updates npc*X/Y on Colyseus schema — merge into moveMap for Phaser tweens. */
  useEffect(() => {
    const grids = { ...mainNpcGridById, ...bgNpcGridById };
    if (Object.keys(grids).length === 0) return;
    setMoveMap((prev) => {
      let changed = false;
      const npcs = prev.npcs.map((npc) => {
        const g = grids[npc.id];
        if (!g || (npc.x === g.x && npc.y === g.y)) return npc;
        changed = true;
        return { ...npc, x: g.x, y: g.y };
      });
      return changed ? { ...prev, npcs } : prev;
    });
  }, [mainNpcGridById, bgNpcGridById]);

  useEffect(() => subscribeTabPresence(() => setDuplicateTab(true)), []);

  useEffect(() => {
    if (!roomState) return;
    const moves: string[] = [];
    if (npcWorldLive) {
      for (const npc of roomState.npcs) {
        const prev = prevNpcPosRef.current.get(npc.id);
        if (prev && (prev.x !== npc.x || prev.y !== npc.y)) {
          moves.push(`${npc.name} 移动到 (${npc.x}, ${npc.y})`);
        }
      }
    }
    for (const npc of roomState.npcs) {
      prevNpcPosRef.current.set(npc.id, { x: npc.x, y: npc.y });
    }
    if (moves.length > 0) setNpcMoveHint(moves.join("；"));
    setMoveMap((prev) => {
      if (!npcWorldLive) return roomState;
      const grids = { ...mainNpcGridById, ...bgNpcGridById };
      return mergeRoomStateIntoMoveMap(roomState, prev, grids);
    });

    if (npcWorldLive) return;
    if (awaitingResetRef.current) return;
    if (initialNpcLiveDoneRef.current) return;

    const id = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        initialNpcLiveDoneRef.current = true;
        setNpcWorldLive(true);
      }),
    );
    return () => cancelAnimationFrame(id);
  }, [roomState, npcWorldLive, mainNpcGridById, bgNpcGridById]);

  const performResetGame = useCallback(async () => {
    prevNpcPosRef.current.clear();
    setNpcMoveHint(null);
    awaitingResetRef.current = true;
    flushSync(() => setNpcWorldLive(false));
    const nextState = await resetGame();
    awaitingResetRef.current = false;
    if (!nextState) return;
    invalidateCollective();
    flushSync(() => {
      setMoveMap(nextState);
      setNpcResetEpoch((n) => n + 1);
    });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => setNpcWorldLive(true)),
    );
  }, [resetGame, invalidateCollective]);

  useEffect(() => {
    if (!npcMoveHint) return;
    const t = window.setTimeout(() => setNpcMoveHint(null), 3000);
    return () => window.clearTimeout(t);
  }, [npcMoveHint]);

  useEffect(() => {
    if (!attitudeGateCue) return;
    const name = attitudeGateCue.npcName || activeNpcName;
    setAttitudeGateHint(attitudeGateHintCopy(name, attitudeGateCue.gateKind));
    clearAttitudeGateCue();
  }, [attitudeGateCue, activeNpcName, clearAttitudeGateCue, attitudeGateHintCopy]);

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (
      last?.role === "npc" &&
      last.npcId === activeNpcId &&
      last.text.includes("当前关系较紧张")
    ) {
      setAttitudeGateHint(attitudeGateHintCopy(activeNpcName, "move"));
      return;
    }
    if (collectiveSnapshot?.band !== "hostile" || messages.length < 2) return;
    if (last?.role !== "npc" || last.npcId !== activeNpcId) return;
    const prev = messages[messages.length - 2];
    if (prev?.role !== "player" || !playerRequestsMove(prev.text)) return;
    setAttitudeGateHint(attitudeGateHintCopy(activeNpcName, "move"));
  }, [
    messages,
    activeNpcId,
    activeNpcName,
    collectiveSnapshot?.band,
    attitudeGateHintCopy,
  ]);

  useEffect(() => {
    if (!attitudeGateHint) return;
    const t = window.setTimeout(() => setAttitudeGateHint(null), 3000);
    return () => window.clearTimeout(t);
  }, [attitudeGateHint]);

  const sceneHint = moveHint ?? npcMoveHint;
  const collectiveAttitudeLine =
    showCollectiveDebug && collectiveSnapshot
      ? `${activeNpcName} ${bandLabelZh(collectiveSnapshot.band)} eff=${collectiveSnapshot.effectiveScore}`
      : null;

  useEffect(() => {
    if (roomState) setStateUpdated(true);
  }, [roomState]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (composerBusyForActiveNpc) return;
    const text = draft;
    if (!text.trim()) return;
    setDraft("");
    await sendMessage(text, activeNpcId);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (composerBusyForActiveNpc || !draft.trim()) return;
      const text = draft;
      setDraft("");
      void sendMessage(text, activeNpcId);
    }
  };

  const composerPlaceholder = composerBusyForActiveNpc
    ? `请等待${activeNpcName}回复…`
    : `你想让${activeNpcName}做什么？`;

  const composerSpeakBusyOtherPlayer =
    speakBusyNpcId === activeNpcId &&
    thinkingNpcId !== activeNpcId &&
    sendingNpcId !== activeNpcId;

  const sceneMapNpcs = displayNpcs;
  const sceneMapObjects = roomState?.objects ?? moveMap.objects;

  return (
    <div className="chat-page">
      <header className="chat-header">
        <h1 className="chat-header__title">以太人生</h1>
        <button
          type="button"
          className="btn btn--destructive"
          data-testid="reset-game-open"
          onClick={() => setResetConfirmOpen(true)}
        >
          新游戏
        </button>
      </header>

      {resetConfirmOpen ? (
        <div
          className="reset-confirm-backdrop"
          role="presentation"
          onClick={() => setResetConfirmOpen(false)}
        >
          <div
            className="reset-confirm-dialog"
            role="alertdialog"
            aria-labelledby="reset-confirm-title"
            aria-describedby="reset-confirm-desc"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="reset-confirm-title" className="reset-confirm-dialog__title">
              开始新游戏？
            </h2>
            <p id="reset-confirm-desc" className="reset-confirm-dialog__desc">
              将重置房间状态，并清空本浏览器中你与所有 NPC 的对话记忆（其他玩家不受影响）。
            </p>
            <div className="reset-confirm-dialog__actions">
              <button
                type="button"
                className="btn"
                onClick={() => setResetConfirmOpen(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn--destructive"
                data-testid="reset-confirm-start"
                onClick={() => {
                  setResetConfirmOpen(false);
                  void performResetGame();
                }}
              >
                确认开始
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {npcs.length > 0 ? (
        <NpcTabBar
          npcs={npcs}
          activeNpcId={activeNpcId}
          onSelect={selectNpc}
          activeBand={collectiveSnapshot?.band ?? null}
        />
      ) : null}

      <main className="chat-main">
        {roomFull ? (
          <div className="error-banner error-banner--warn" data-testid="banner-room-full">
            房间已满（最多 4 人同时在线），请关闭其他标签页或稍后再试。
          </div>
        ) : null}
        {colyseusError && !roomFull ? <div className="error-banner">{colyseusError}</div> : null}
        {composerSpeakBusyOtherPlayer ? (
          <div className="error-banner error-banner--warn" data-testid="banner-speak-queue">
            该 NPC 正在响应其他玩家的指令，请稍候再试。
          </div>
        ) : null}
        {duplicateTab ? (
          <div className="error-banner error-banner--info">
            检测到另一个标签页也在使用同一存档。同时游玩可能导致记忆与对话不同步，建议只保留一个标签页。
          </div>
        ) : null}
        {error ? <div className="error-banner">{error}</div> : null}
        {bootPending ? (
          <section className="room-scene-panel" data-testid="room-scene">
            <h2 className="room-scene-panel__title">房间</h2>
            <p className="room-scene-panel__subtitle">地球Online 像素世界 · 最多 4 人同房间 · WASD 或点格移动</p>
            <p className="room-scene-panel__hint" data-testid="phaser-boot-loading">
              地图加载中…
            </p>
          </section>
        ) : !phaserOk ? (
          <>
            <p className="room-scene-panel__hint" data-testid="phaser-fallback-banner">
              当前设备无法启用 2D 地图视图，已切换为网格地图。请更新浏览器或启用硬件加速后刷新。
            </p>
            <MovementPanel
              connected={connected}
              players={players}
              sessionId={sessionId}
              width={moveMap.width}
              height={moveMap.height}
              mapNpcs={sceneMapNpcs}
              mapObjects={sceneMapObjects}
              animating={animating}
              moveHint={sceneHint}
              onMove={sendMove}
              onMoveTo={(x, y) => void sendMoveTo(x, y)}
              fallbackMode
            />
          </>
        ) : (
          <PhaserGame
            bootOk={bootOk}
            connected={connected}
            players={players}
            sessionId={sessionId}
            width={moveMap.width}
            height={moveMap.height}
            moveMap={moveMap}
            mapNpcs={sceneMapNpcs}
            mapObjects={sceneMapObjects}
            animating={animating}
            moveHint={sceneHint}
            thinkingNpcId={thinkingNpcId}
            thinkingNpcIds={thinkingNpcIds}
            activeNpcId={activeNpcId}
            npcAnimateMoves={npcWorldLive}
            npcResetEpoch={npcResetEpoch}
            remoteInterpMs={remoteInterpMs}
            loadedChunks={loadedChunks}
            loreForChunk={loreForChunk}
            discoverToast={discoverToast}
            onDismissDiscoverToast={dismissDiscoverToast}
            motionBridgeRef={motionBridgeRef}
            movementSyncRef={movementSyncRef}
            collectiveAttitudeLine={collectiveAttitudeLine}
            gameClock={gameClock}
            npcActivityById={npcActivityById}
            npcAmbientById={npcAmbientById}
            speakBusyNpcId={speakBusyNpcId}
            onBootFailed={() => {
              setPhaserOk(false);
              setBootOk(false);
            }}
          />
        )}
        <div
          role="tabpanel"
          id={`npc-panel-${activeNpcId}`}
          aria-labelledby={`npc-tab-${activeNpcId}`}
        >
          <MessageList
            messages={messages}
            thinkingNpcId={thinkingNpcId}
            activeNpcId={activeNpcId}
            thinkingNpcName={activeNpcName}
            streamingReply={streamingReply}
          />
        </div>
        <CollectiveBrowsePanel
          activeNpcName={activeNpcName}
          snapshot={collectiveSnapshot}
          loading={collectiveLoading}
          detailsRef={collectiveBrowseDetailsRef}
        />
        {roomState ? (
          <RoomStatePanel
            state={roomState}
            activeNpcId={activeNpcId}
            updated={stateUpdated}
          />
        ) : null}
        <NpcMemoryPanel
          roomId={mapRoomId}
          activeNpcId={activeNpcId}
          activeNpcName={activeNpcName}
          lastParsedIntent={lastParsedIntent}
          parseError={parseError}
        />
      </main>

      <form className="composer" onSubmit={onSubmit}>
        {collectiveFeedbackKind ? (
          <CollectiveFeedbackBanner kind={collectiveFeedbackKind} />
        ) : null}
        {attitudeGateHint ? (
          <p
            className="attitude-gate-hint"
            data-testid="attitude-gate-hint"
            role="status"
          >
            {attitudeGateHint}
          </p>
        ) : null}
        {composerBusyForActiveNpc ? (
          <p
            className="composer__speak-status"
            data-testid="composer-speak-status"
            role="status"
          >
            {composerSpeakBusyOtherPlayer
              ? "该 NPC 正在响应其他玩家的指令，请稍候再试。"
              : `${activeNpcName} 正在思考…`}
          </p>
        ) : null}
        <div className="composer__shell">
          <div className="composer__inner">
            <textarea
              ref={composerRef}
              className="composer__input"
              rows={2}
              placeholder={composerPlaceholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={roomFull || composerBusyForActiveNpc}
              aria-busy={composerBusyForActiveNpc}
            />
            <button
              type="submit"
              className="btn btn--primary composer__submit"
              disabled={roomFull || composerBusyForActiveNpc || !draft.trim()}
            >
              发送指令
            </button>
          </div>
        </div>
      </form>

      {connected && players.length > 0 ? (
        <div className="room-player-strip" data-testid="player-strip">
          {players.slice(0, 4).map((p) => (
            <span key={p.sessionId} className="room-player-strip__name">
              {playerDisplayName(p.playerId, p.sessionId === sessionId)}
            </span>
          ))}
        </div>
      ) : null}

      {showSyncDebug ? <SyncMetricsOverlay metrics={syncMetrics} /> : null}
      {showCollectiveDebug ? (
        <>
          <CollectiveAttitudeOverlay
            snapshot={collectiveSnapshot}
            npcName={activeNpcName}
            showDebug={showCollectiveDebug}
          />
          <CollectiveDebugPanel
            snapshot={collectiveSnapshot}
            activeNpcName={activeNpcName}
            loading={collectiveLoading}
          />
        </>
      ) : null}
    </div>
  );
}
