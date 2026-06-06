import type { GameObject, NpcState } from "@aetherlife/shared";
import type { PlayerSnapshot } from "../hooks/useColyseusRoom.js";
import { useGridMovementKeys } from "../hooks/useGridMovementKeys.js";
import { npcDisplayName } from "../game/entityLabels.js";

export type MapNpcView = Pick<NpcState, "id" | "name" | "x" | "y">;
export type MapObjectView = Pick<GameObject, "kind" | "x" | "y" | "state">;

type Props = {
  connected: boolean;
  players: PlayerSnapshot[];
  sessionId: string | null;
  width?: number;
  height?: number;
  mapNpcs?: MapNpcView[];
  mapObjects?: MapObjectView[];
  animating?: boolean;
  moveHint?: string | null;
  onMove: (dx: number, dy: number) => void;
  onMoveTo: (x: number, y: number) => void;
  fallbackMode?: boolean;
};

const GRID = 8;

export function MovementPanel({
  connected,
  players,
  sessionId,
  width = GRID,
  height = GRID,
  mapNpcs = [],
  mapObjects = [],
  animating = false,
  moveHint = null,
  onMove,
  onMoveTo,
  fallbackMode = false,
}: Props) {
  const movementDisabled = !connected || animating;

  useGridMovementKeys({
    enabled: !movementDisabled,
    onMove,
  });

  const npcAt = (x: number, y: number) => mapNpcs.find((n) => n.x === x && n.y === y);
  const closedDoorAt = (x: number, y: number) =>
    mapObjects.find((o) => o.kind === "door" && o.state === "closed" && o.x === x && o.y === y);

  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const occupants = players.filter((p) => p.x === x && p.y === y);
      const isSelf = occupants.some((p) => p.sessionId === sessionId);
      const npc = npcAt(x, y);
      const door = closedDoorAt(x, y);
      let label = "";
      let cellClass = "movement-cell";
      if (isSelf) {
        label = "你";
        cellClass += " movement-cell--self";
      } else if (occupants.length) {
        label = "客";
        cellClass += " movement-cell--occupied";
      } else if (npc) {
        label = npcDisplayName(npc.name);
        cellClass += " movement-cell--npc";
      } else if (door) {
        label = "门";
        cellClass += " movement-cell--door";
      }

      const titleParts: string[] = [`${x},${y}`];
      if (npc) titleParts.push(`${npc.name}（不可通过）`);
      if (door) titleParts.push("关闭的门（不可通过）");
      if (occupants.length) {
        titleParts.push(occupants.map((p) => p.sessionId.slice(0, 6)).join(", "));
      }

      cells.push(
        <button
          key={`${x}-${y}`}
          type="button"
          className={cellClass}
          disabled={movementDisabled}
          data-testid={`cell-${x}-${y}`}
          onClick={() => {
            if (document.activeElement instanceof HTMLElement) {
              document.activeElement.blur();
            }
            onMoveTo(x, y);
          }}
          title={titleParts.join(" · ")}
        >
          {label}
        </button>,
      );
    }
  }

  return (
    <section
      className="movement-panel"
      data-testid="movement-panel"
      onPointerDownCapture={() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.closest(".composer")) {
          active.blur();
        }
      }}
    >
      <h2 className="movement-panel__title">
        {fallbackMode ? "移动（回退模式 · WASD / 点击格子）" : "移动（WASD / 点击格子）"}
      </h2>
      {!connected ? (
        <p className="movement-panel__hint">正在连接 Colyseus…</p>
      ) : (
        <>
          {moveHint ? (
            <p className="movement-panel__hint movement-panel__hint--warn" role="status">
              {moveHint}
            </p>
          ) : null}
          {animating ? (
            <p className="movement-panel__hint">移动中…</p>
          ) : (
            <ul className="movement-legend" aria-label="地图图例">
              {mapNpcs.map((npc) => (
                <li key={npc.id}>
                  <span className="movement-legend__badge movement-legend__badge--npc">
                    {npcDisplayName(npc.name)}
                  </span>
                  {npc.name} ({npc.x},{npc.y})
                </li>
              ))}
              {mapObjects
                .filter((o) => o.kind === "door" && o.state === "closed")
                .map((o) => (
                  <li key={`door-${o.x}-${o.y}`}>
                    <span className="movement-legend__badge movement-legend__badge--door">门</span>
                    关闭的门 ({o.x},{o.y})
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
      <div
        className="movement-grid"
        style={{ gridTemplateColumns: `repeat(${width}, 2rem)` }}
      >
        {cells}
      </div>
    </section>
  );
}
