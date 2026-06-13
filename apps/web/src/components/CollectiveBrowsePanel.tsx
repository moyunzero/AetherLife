import type { RefObject } from "react";
import type { CollectiveAttitudeSnapshot } from "../hooks/useCollectiveAttitude.js";
import { AttitudeBandChip } from "./AttitudeBandChip.js";
import { collectiveKindLabelZh } from "../lib/collectiveInitiator.js";

type Props = {
  activeNpcName: string;
  snapshot: CollectiveAttitudeSnapshot | null;
  loading?: boolean;
  fetchError?: boolean;
  detailsRef?: RefObject<HTMLDetailsElement>;
  /** Drawer tab: render body only without collapsible details wrapper */
  embedded?: boolean;
};

function CollectiveBrowseBody({
  activeNpcName,
  snapshot,
  loading,
  fetchError,
}: Pick<Props, "activeNpcName" | "snapshot" | "loading" | "fetchError">) {
  return (
    <div className="collective-browse-panel__body">
      {loading ? <p className="collective-browse-panel__hint">加载中…</p> : null}
      {!loading && fetchError ? (
        <p className="collective-browse-panel__hint">暂时无法加载小镇见闻</p>
      ) : null}
      {!loading && !fetchError && snapshot ? (
        <>
          <div className="collective-browse-panel__band">
            <AttitudeBandChip band={snapshot.band} npcName={activeNpcName} />
          </div>
          {snapshot.recentEvents.length === 0 ? (
            <p className="collective-browse-panel__hint">暂无集体记忆事件</p>
          ) : (
            <ul
              className="collective-browse-panel__events"
              data-testid="collective-recent-events"
            >
              {snapshot.recentEvents.map((event, index) => (
                <li key={event.id} data-testid={`collective-event-${index}`}>
                  {collectiveKindLabelZh(event.kind)} · {event.summary}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
      {!loading && !fetchError && !snapshot ? (
        <p className="collective-browse-panel__hint">暂无集体记忆事件</p>
      ) : null}
    </div>
  );
}

export function CollectiveBrowsePanel({
  activeNpcName,
  snapshot,
  loading,
  fetchError,
  detailsRef,
  embedded = false,
}: Props) {
  if (embedded) {
    return (
      <div
        className="collective-browse-panel collective-browse-panel--embedded"
        data-testid="collective-browse-panel"
      >
        <h3 className="collective-browse-panel__title">
          {activeNpcName} · 小镇见闻
        </h3>
        <CollectiveBrowseBody
          activeNpcName={activeNpcName}
          snapshot={snapshot}
          loading={loading}
          fetchError={fetchError}
        />
      </div>
    );
  }

  return (
    <details
      ref={detailsRef}
      className="collective-browse-panel"
      data-testid="collective-browse-panel"
    >
      <summary>{activeNpcName} · 小镇见闻</summary>
      <CollectiveBrowseBody
        activeNpcName={activeNpcName}
        snapshot={snapshot}
        loading={loading}
        fetchError={fetchError}
      />
    </details>
  );
}
