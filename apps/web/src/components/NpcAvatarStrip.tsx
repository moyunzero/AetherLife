import type { KeyboardEvent } from "react";
import type { AttitudeBand } from "@aetherlife/shared";
import { AttitudeBandChip } from "./AttitudeBandChip.js";

type NpcChip = {
  id: string;
  name: string;
};

type Props = {
  npcs: NpcChip[];
  activeNpcId: string;
  onSelect: (npcId: string) => void;
  activeBand?: AttitudeBand | null;
  thinkingNpcId?: string | null;
  reducedMotion?: boolean;
};

const DIALOGUE_OVERLAY_PANEL_ID = "dialogue-overlay";

function npcAvatarTabId(npcId: string): string {
  return `npc-avatar-${npcId}`;
}

function focusNpcAvatarTab(npcId: string): void {
  document.getElementById(npcAvatarTabId(npcId))?.focus();
}

function handleChipKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  npcs: NpcChip[],
  onSelect: (npcId: string) => void,
): void {
  const { key } = event;
  if (key === "Enter" || key === " ") {
    event.preventDefault();
    onSelect(npcs[index].id);
    return;
  }
  if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") {
    return;
  }
  event.preventDefault();
  let nextIndex = index;
  if (key === "ArrowLeft") {
    nextIndex = (index - 1 + npcs.length) % npcs.length;
  } else if (key === "ArrowRight") {
    nextIndex = (index + 1) % npcs.length;
  } else if (key === "Home") {
    nextIndex = 0;
  } else {
    nextIndex = npcs.length - 1;
  }
  const nextId = npcs[nextIndex].id;
  onSelect(nextId);
  focusNpcAvatarTab(nextId);
}

export function NpcAvatarStrip({
  npcs,
  activeNpcId,
  onSelect,
  activeBand,
  thinkingNpcId = null,
  reducedMotion = false,
}: Props) {
  if (npcs.length === 0) {
    return (
      <div
        className={`npc-avatar-strip npc-avatar-strip--empty${reducedMotion ? " npc-avatar-strip--reduced-motion" : ""}`}
        role="tablist"
        aria-label="视口内 NPC"
        data-testid="npc-avatar-strip"
      />
    );
  }

  return (
    <div
      className={`npc-avatar-strip${reducedMotion ? " npc-avatar-strip--reduced-motion" : ""}`}
      role="tablist"
      aria-label="视口内 NPC"
      data-testid="npc-avatar-strip"
    >
      {npcs.map((npc, index) => {
        const isActive = npc.id === activeNpcId;
        const isThinking = thinkingNpcId === npc.id;
        const className = [
          "npc-avatar-strip__chip",
          isActive ? "npc-avatar-strip__chip--active" : "",
          isThinking ? "npc-avatar-strip__chip--thinking" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={npc.id}
            type="button"
            role="tab"
            id={npcAvatarTabId(npc.id)}
            aria-controls={DIALOGUE_OVERLAY_PANEL_ID}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={className}
            onClick={() => onSelect(npc.id)}
            onKeyDown={(event) => handleChipKeyDown(event, index, npcs, onSelect)}
          >
            <span className="npc-avatar-strip__label">{npc.name}</span>
            {isActive && activeBand ? (
              <AttitudeBandChip band={activeBand} npcName={npc.name} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
