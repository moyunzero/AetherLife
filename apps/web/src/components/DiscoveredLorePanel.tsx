import type { DiscoveredLoreRow } from "../hooks/useChunkLore.js";

type Props = {
  rows: DiscoveredLoreRow[];
  embedded?: boolean;
};

function DiscoveredLoreBody({ rows }: Pick<Props, "rows">) {
  if (rows.length === 0) {
    return (
      <p className="discovered-lore-panel__empty" data-testid="discovered-lore-empty">
        尚未发现新土地
      </p>
    );
  }

  return (
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
  );
}

export function DiscoveredLorePanel({ rows, embedded = false }: Props) {
  if (embedded) {
    return (
      <div
        className="discovered-lore-panel discovered-lore-panel--embedded"
        data-testid="discovered-lore-panel"
      >
        <h3 className="discovered-lore-panel__title">已发现</h3>
        <DiscoveredLoreBody rows={rows} />
      </div>
    );
  }

  return (
    <section className="discovered-lore-panel" data-testid="discovered-lore-panel">
      <h3 className="discovered-lore-panel__title">已发现</h3>
      <DiscoveredLoreBody rows={rows} />
    </section>
  );
}
