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

export function NpcAvatarStrip({
  npcs,
  activeNpcId,
  onSelect,
  activeBand,
  thinkingNpcId = null,
  reducedMotion = false,
}: Props) {
  if (npcs.length === 0) return null;

  return (
    <div
      className={`npc-avatar-strip${reducedMotion ? " npc-avatar-strip--reduced-motion" : ""}`}
      role="tablist"
      aria-label="视口内 NPC"
      data-testid="npc-avatar-strip"
    >
      {npcs.map((npc) => {
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
            id={`npc-avatar-${npc.id}`}
            aria-controls={`npc-panel-${npc.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            className={className}
            onPointerDown={() => onSelect(npc.id)}
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
