import {
  COUNCIL_NPC_IDS,
  getPersona,
  relationshipKindLabelZh,
  type LinkedEdge,
  type PersonalTimelineEntry,
} from "@aetherlife/shared";

type Props = {
  /** D-UI-03: reserved for Phase 27 biography sub-tab — not rendered in Phase 23. */
  biographyEntries?: PersonalTimelineEntry[];
  linkedEdges?: LinkedEdge[];
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

/** D-UI-03: biography sub-tab slot — reserved, not rendered in Phase 23. */
function CouncilBiographySlot(_props: { entries: PersonalTimelineEntry[] }) {
  return null;
}

export function CouncilRosterPanel({ biographyEntries, linkedEdges = [] }: Props = {}) {
  return (
    <div
      className="council-roster-panel council-roster-panel--embedded"
      data-testid="council-roster-panel"
    >
      <h3 className="council-roster-panel__title">星际议会</h3>
      <ul className="council-roster-panel__list">
        {COUNCIL_NPC_IDS.map((npcId) => {
          const persona = getPersona(npcId);
          const backstory = persona.backstoryFull ?? persona.backstory;
          return (
            <li
              key={npcId}
              className="council-roster-panel__row"
              data-testid="council-roster-row"
            >
              <details className="council-roster-panel__details">
                <summary className="council-roster-panel__summary">
                  <span className="council-roster-panel__name">{persona.displayName}</span>
                  <span className="council-roster-panel__meta">
                    {persona.originPlane} · {persona.faction} · {persona.mbti} ·{" "}
                    {persona.zodiacSign}
                  </span>
                  <p className="council-roster-panel__personality council-roster-panel__personality--teaser">
                    {persona.personality}
                  </p>
                </summary>
                <div className="council-roster-panel__expand">
                  {biographyEntries ? (
                    <CouncilBiographySlot entries={biographyEntries} />
                  ) : null}
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
                                <span className="council-roster-panel__relationship-hint-dot" aria-hidden />
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
