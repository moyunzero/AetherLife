type NpcTab = {
  id: string;
  name: string;
};

type Props = {
  npcs: NpcTab[];
  activeNpcId: string;
  onSelect: (npcId: string) => void;
};

export function NpcTabBar({ npcs, activeNpcId, onSelect }: Props) {
  return (
    <div className="npc-tab-bar" role="tablist" aria-label="选择 NPC">
      {npcs.map((npc) => (
        <button
          key={npc.id}
          type="button"
          role="tab"
          aria-selected={npc.id === activeNpcId}
          className={`npc-tab${npc.id === activeNpcId ? " npc-tab--active" : ""}`}
          onClick={() => onSelect(npc.id)}
        >
          {npc.name}
        </button>
      ))}
    </div>
  );
}
