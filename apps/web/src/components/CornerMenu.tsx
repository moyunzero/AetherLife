import { useEffect, useRef, useState } from "react";
import type { AttitudeBand, PlayerPresence } from "@aetherlife/shared";
import { playerDisplayName } from "../lib/playerDisplayName.js";
import { readReducedMotion } from "./PhaserGame.js";
import { NpcAvatarStrip } from "./NpcAvatarStrip.js";

type NearbyNpc = { id: string; name: string };

type Props = {
  connected: boolean;
  colyseusError: string | null;
  roomFull: boolean;
  mapRoomId: string;
  players: PlayerPresence[];
  sessionId: string | null;
  onResetOpen: () => void;
  showSyncDebug?: boolean;
  showCollectiveDebug?: boolean;
  nearbyNpcs?: NearbyNpc[];
  activeNpcId?: string;
  onSelectNpc?: (npcId: string) => void;
  dialogueEngaged?: boolean;
  onEndDialogue?: () => void;
  activeBand?: AttitudeBand | null;
  thinkingNpcId?: string | null;
};

function connectionStatus(
  connected: boolean,
  colyseusError: string | null,
  roomFull: boolean,
): { label: string; tone: "ok" | "warn" | "err" } {
  if (roomFull) {
    return { label: "房间已满", tone: "warn" };
  }
  if (colyseusError) {
    return { label: colyseusError, tone: "err" };
  }
  if (connected) {
    return { label: "已连接", tone: "ok" };
  }
  return { label: "连接中…", tone: "warn" };
}

export function CornerMenu({
  connected,
  colyseusError,
  roomFull,
  mapRoomId,
  players,
  sessionId,
  onResetOpen,
  showSyncDebug = false,
  showCollectiveDebug = false,
  nearbyNpcs = [],
  activeNpcId = "",
  onSelectNpc,
  dialogueEngaged = false,
  onEndDialogue,
  activeBand = null,
  thinkingNpcId = null,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const status = connectionStatus(connected, colyseusError, roomFull);
  const reducedMotion = readReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  return (
    <div className="corner-menu" data-testid="corner-menu" ref={rootRef}>
      <button
        type="button"
        className="corner-menu__trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="系统菜单"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="corner-menu__icon" aria-hidden="true">
          ≡
        </span>
        <span
          className={`corner-menu__status-dot corner-menu__status-dot--${status.tone}`}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div className="corner-menu__panel" role="menu">
          <p className="corner-menu__section-label">以太人生</p>
          <button
            type="button"
            role="menuitem"
            className="corner-menu__item corner-menu__item--destructive"
            data-testid="reset-game-open"
            onClick={() => {
              setOpen(false);
              onResetOpen();
            }}
          >
            新游戏
          </button>
          <div className="corner-menu__meta" role="status">
            <span className="corner-menu__meta-label">连接</span>
            <span className={`corner-menu__meta-value corner-menu__meta-value--${status.tone}`}>
              {status.label}
            </span>
          </div>
          <div className="corner-menu__meta">
            <span className="corner-menu__meta-label">房间</span>
            <span className="corner-menu__meta-value">{mapRoomId}</span>
          </div>
          {connected && players.length > 0 ? (
            <div className="corner-menu__meta">
              <span className="corner-menu__meta-label">玩家</span>
              <span className="corner-menu__meta-value">
                {players
                  .slice(0, 4)
                  .map((p) => playerDisplayName(p.playerId, p.sessionId === sessionId))
                  .join("、")}
              </span>
            </div>
          ) : null}
          {nearbyNpcs.length > 0 && onSelectNpc ? (
            <div className="corner-menu__nearby" data-testid="corner-menu-nearby">
              <p className="corner-menu__section-label">附近的人</p>
              <NpcAvatarStrip
                npcs={nearbyNpcs}
                activeNpcId={activeNpcId}
                onSelect={(id) => {
                  onSelectNpc(id);
                  setOpen(false);
                }}
                activeBand={activeBand}
                thinkingNpcId={thinkingNpcId}
                reducedMotion={reducedMotion}
              />
            </div>
          ) : (
            <div
              className="npc-avatar-strip npc-avatar-strip--empty"
              role="tablist"
              aria-label="视口内 NPC"
              data-testid="npc-avatar-strip"
            />
          )}
          {dialogueEngaged && onEndDialogue ? (
            <button
              type="button"
              role="menuitem"
              className="corner-menu__item"
              data-testid="corner-menu-end-dialogue"
              onClick={() => {
                onEndDialogue();
                setOpen(false);
              }}
            >
              结束对话
            </button>
          ) : null}
          <div className="corner-menu__meta">
            <span className="corner-menu__meta-label">减少动效</span>
            <span className="corner-menu__meta-value">
              {reducedMotion ? "已开启（系统或 URL）" : "跟随系统"}
            </span>
          </div>
          {showSyncDebug ? (
            <p className="corner-menu__hint">同步调试已启用（syncDebug）</p>
          ) : null}
          {showCollectiveDebug ? (
            <p className="corner-menu__hint">集体调试已启用（collectiveDebug）</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
