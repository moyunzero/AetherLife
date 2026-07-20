import {
  COUNCIL_NPC_IDS,
  getPersona,
  relationshipKindLabelZh,
  type LinkedEdge,
  type PersonalTimelineEntry,
} from "@aetherlife/shared";
import { CouncilBiographySlot } from "./CouncilBiographySlot.js";

type Props = {
  linkedEdges?: LinkedEdge[];
  entriesByNpcId?: Record<string, PersonalTimelineEntry[]>;
  hasUpdateByNpcId?: Record<string, boolean>;
  loadingNpcId?: string | null;
  errorByNpcId?: Record<string, string>;
  onOpenBiography?: (npcId: string) => void;
};

function isLinkedRelationship(
  npcId: string,
  targetId: string,
  linkedEdges: LinkedEdge[],
): boolean {
  return linkedEdges.some(
    (edge) =>
      (edge.npcAId === npcId && edge.npcBId === targetId) ||
      (edge.npcBId === npcId && edge.npcAId === targetId),
  );
}

/** D-UI-01: biography lives inside roster — no top-level Drawer tab. */
export function CouncilRosterPanel({
  linkedEdges = [],
  entriesByNpcId = {},
  hasUpdateByNpcId = {},
  loadingNpcId = null,
  errorByNpcId = {},
  onOpenBiography,
}: Props = {}) {
  return (
    <div
      className="council-roster-panel council-roster-panel--embedded"
      data-testid="council-roster-panel"
    >
      <h3 className="council-roster-panel__title">星际议会</h3>
      <p className="council-roster-panel__nav-hint" data-testid="council-roster-nav-hint">
        12 名议员分布在村内土径各处，走近即可对话。
      </p>
      <ul className="council-roster-panel__list">
        {COUNCIL_NPC_IDS.map((npcId) => {
          const persona = getPersona(npcId);
          const backstory = persona.backstoryFull ?? persona.backstory;
          const hasUpdate = hasUpdateByNpcId[npcId] === true;
          const biographyEntries = entriesByNpcId[npcId] ?? [];
          return (
            <li
              key={npcId}
              className="council-roster-panel__row"
              data-testid="council-roster-row"
            >
              <details
                className="council-roster-panel__details"
                onToggle={(e) => {
                  const el = e.currentTarget;
                  if (el.open) {
                    onOpenBiography?.(npcId);
                  }
                }}
              >
                <summary className="council-roster-panel__summary">
                  <span className="council-roster-panel__name">{persona.displayName}</span>
                  {hasUpdate ? (
                    <span
                      className="council-roster-panel__biography-hint"
                      data-testid="council-roster-biography-hint"
                    >
                      <span
                        className="council-roster-panel__relationship-hint-dot"
                        aria-hidden
                      />
                      近况有更新
                    </span>
                  ) : null}
                  <span className="council-roster-panel__meta">
                    {persona.originPlane} · {persona.faction} · {persona.mbti} ·{" "}
                    {persona.zodiacSign}
                  </span>
                  <p className="council-roster-panel__personality council-roster-panel__personality--teaser">
                    {persona.personality}
                  </p>
                </summary>
                <div className="council-roster-panel__expand">
                  <div className="council-roster-panel__subview">
                    <CouncilBiographySlot
                      entries={biographyEntries}
                      loading={loadingNpcId === npcId}
                      error={errorByNpcId[npcId] ?? null}
                    />
                  </div>
                  <section className="council-roster-panel__section">
                    <h4 className="council-roster-panel__section-title">性格</h4>
                    <p className="council-roster-panel__personality-full">{persona.personality}</p>
                  </section>
                  <section className="council-roster-panel__section">
                    <h4 className="council-roster-panel__section-title">生平</h4>
                    <p className="council-roster-panel__backstory">{backstory}</p>
                  </section>
                  {persona.appearance ? (
                    <section className="council-roster-panel__section">
                      <h4 className="council-roster-panel__section-title">外貌</h4>
                      <p className="council-roster-panel__appearance">{persona.appearance}</p>
                    </section>
                  ) : null}
                  <section className="council-roster-panel__section">
                    <h4 className="council-roster-panel__section-title">关系</h4>
                    <ul className="council-roster-panel__relationships">
                      {[...persona.relationships]
                        .sort((a, b) => {
                          const aChanged = isLinkedRelationship(npcId, a.targetId, linkedEdges);
                          const bChanged = isLinkedRelationship(npcId, b.targetId, linkedEdges);
                          return Number(bChanged) - Number(aChanged);
                        })
                        .map((rel) => {
                          const changed = isLinkedRelationship(npcId, rel.targetId, linkedEdges);
                          return (
                            <li
                              key={rel.targetId}
                              className={`council-roster-panel__relationship${
                                changed ? " council-roster-panel__relationship--changed" : ""
                              }`}
                            >
                              <div className="council-roster-panel__relationship-head">
                                <span className="council-roster-panel__relationship-name">
                                  {getPersona(rel.targetId).displayName}
                                </span>
                                <span className="council-roster-panel__relationship-kind">
                                  {relationshipKindLabelZh(rel.kind)}
                                </span>
                                {changed ? (
                                  <span
                                    className="council-roster-panel__relationship-hint"
                                    data-testid="council-roster-relationship-hint"
                                  >
                                    <span
                                      className="council-roster-panel__relationship-hint-dot"
                                      aria-hidden
                                    />
                                    近期有变
                                  </span>
                                ) : null}
                              </div>
                              <p className="council-roster-panel__relationship-summary">
                                {rel.summary}
                              </p>
                            </li>
                          );
                        })}
                    </ul>
                  </section>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
