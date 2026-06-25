import type { DiscoveredLoreRow } from "../hooks/useChunkLore.js";

type Props = {
  rows: DiscoveredLoreRow[];
};

export function DiscoveredLorePanel({ rows }: Props) {
  return (
    <div
      className="discovered-lore-panel discovered-lore-panel--embedded"
      data-testid="discovered-lore-panel"
    >
      <h3 className="discovered-lore-panel__title">已发现</h3>
      {rows.length === 0 ? (
        <p className="discovered-lore-panel__empty" data-testid="discovered-lore-empty">
          尚未发现新土地
        </p>
      ) : (
        <ul className="discovered-lore-panel__list">
          {rows.map((row) => (
            <li
              key={row.nameZh}
              className="discovered-lore-panel__row"
              data-testid="discovered-lore-row"
            >
              <p className="discovered-lore-panel__name">{row.nameZh}</p>
              <p className="discovered-lore-panel__hook">{row.storyHook}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
