import type { AttitudeBand } from "@aetherlife/shared";
import { AttitudeBandChip } from "./AttitudeBandChip.js";

type NpcTab = {
  id: string;
  name: string;
};

type Props = {
  npcs: NpcTab[];
  activeNpcId: string;
  onSelect: (npcId: string) => void;
  activeBand?: AttitudeBand | null;
};

export function NpcTabBar({ npcs, activeNpcId, onSelect, activeBand }: Props) {
  return (
    <div className="npc-tab-bar" role="tablist" aria-label="选择 NPC">
      {npcs.map((npc) => {
        const isActive = npc.id === activeNpcId;
        return (
          <button
            key={npc.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`npc-tab${isActive ? " npc-tab--active" : ""}`}
            onPointerDown={() => onSelect(npc.id)}
          >
            <span className="npc-tab__label">{npc.name}</span>
            {isActive && activeBand ? (
              <AttitudeBandChip band={activeBand} npcName={npc.name} />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
