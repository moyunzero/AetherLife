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
};

export function CollectiveBrowsePanel({
  activeNpcName,
  snapshot,
  loading,
  fetchError,
  detailsRef,
}: Props) {
  return (
    <details
      ref={detailsRef}
      className="collective-browse-panel"
      data-testid="collective-browse-panel"
    >
      <summary>
        {activeNpcName} · 小镇见闻
      </summary>
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
                  <li
                    key={event.id}
                    data-testid={`collective-event-${index}`}
                  >
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
    </details>
  );
}
