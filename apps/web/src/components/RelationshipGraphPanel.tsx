import {
  COUNCIL_NPC_IDS,
  getPersona,
  type RelationshipBand,
} from "@aetherlife/shared";
import type { RelationshipRenderEdge } from "../hooks/useNpcRelationships.js";

export type RelationshipGraphMode = "ego" | "full";

type Props = {
  edges: RelationshipRenderEdge[];
  loading: boolean;
  error: string | null;
  activeNpcId: string;
  lastRosterNpcId: string;
  graphMode: RelationshipGraphMode;
  centerNpcId: string;
  onModeChange: (mode: RelationshipGraphMode) => void;
  onCenterChange: (npcId: string) => void;
  staleHint?: boolean;
};

const VIEW_SIZE = 320;
const CENTER = VIEW_SIZE / 2;
const EGO_RING = 96;
const FULL_RING = 128;

/** D-DRAWER-03: default graph center priority. */
export function resolveDefaultCenterNpcId(
  activeNpcId: string | undefined,
  lastRosterNpcId: string | undefined,
): string {
  if (activeNpcId && activeNpcId.length > 0) return activeNpcId;
  if (lastRosterNpcId && lastRosterNpcId.length > 0) return lastRosterNpcId;
  return "npc-1";
}

export function toggleRelationshipGraphMode(
  mode: RelationshipGraphMode,
): RelationshipGraphMode {
  return mode === "ego" ? "full" : "ego";
}

export function relationshipGraphToggleCopy(mode: RelationshipGraphMode): string {
  return mode === "ego" ? "查看全图" : "以某人为中心";
}

export function graphNodeLabel(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed.length <= 4) return trimmed;
  return `${trimmed.slice(0, 4)}…`;
}

export function relationshipBandStroke(band: RelationshipBand): {
  color: string;
  width: number;
} {
  switch (band) {
    case "hostile":
      return { color: "#b54a4a", width: 3 };
    case "cool":
      return { color: "#a89060", width: 2 };
    case "neutral":
      return { color: "var(--shell-muted, #7a6f5c)", width: 1 };
    case "warm":
      return { color: "#7a9a6e", width: 2 };
    case "close":
      return { color: "var(--shell-accent, #c9a227)", width: 3 };
  }
}

function seatIndex(npcId: string): number {
  const idx = (COUNCIL_NPC_IDS as readonly string[]).indexOf(npcId);
  return idx >= 0 ? idx : 0;
}

function polarPosition(
  index: number,
  total: number,
  cx: number,
  cy: number,
  radius: number,
): { x: number; y: number } {
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

function findEdge(
  edges: RelationshipRenderEdge[],
  a: string,
  b: string,
): RelationshipRenderEdge | undefined {
  return edges.find(
    (edge) =>
      (edge.npcAId === a && edge.npcBId === b) ||
      (edge.npcAId === b && edge.npcBId === a),
  );
}

function neighborsOf(centerId: string, edges: RelationshipRenderEdge[]): string[] {
  const ids = new Set<string>();
  for (const edge of edges) {
    if (edge.npcAId === centerId) ids.add(edge.npcBId);
    if (edge.npcBId === centerId) ids.add(edge.npcAId);
  }
  return [...ids].sort(
    (a, b) => seatIndex(a) - seatIndex(b),
  );
}

type NodeLayout = {
  npcId: string;
  x: number;
  y: number;
  isCenter?: boolean;
};

function layoutNodes(
  mode: RelationshipGraphMode,
  centerNpcId: string,
  edges: RelationshipRenderEdge[],
): NodeLayout[] {
  if (mode === "full") {
    return COUNCIL_NPC_IDS.map((npcId, index) => ({
      npcId,
      ...polarPosition(index, COUNCIL_NPC_IDS.length, CENTER, CENTER, FULL_RING),
      isCenter: npcId === centerNpcId,
    }));
  }

  const neighborIds = neighborsOf(centerNpcId, edges);
  const nodes: NodeLayout[] = [
    { npcId: centerNpcId, x: CENTER, y: CENTER, isCenter: true },
  ];
  neighborIds.forEach((npcId, index) => {
    nodes.push({
      npcId,
      ...polarPosition(index, Math.max(neighborIds.length, 1), CENTER, CENTER, EGO_RING),
    });
  });
  return nodes;
}

function edgesToDraw(
  mode: RelationshipGraphMode,
  centerNpcId: string,
  edges: RelationshipRenderEdge[],
): RelationshipRenderEdge[] {
  if (mode === "full") return edges;
  return edges.filter(
    (edge) => edge.npcAId === centerNpcId || edge.npcBId === centerNpcId,
  );
}

export function RelationshipGraphPanel({
  edges,
  loading,
  error,
  graphMode,
  centerNpcId,
  onModeChange,
  onCenterChange,
  staleHint = false,
}: Props) {
  const centerName = getPersona(centerNpcId).displayName;
  const nodes = layoutNodes(graphMode, centerNpcId, edges);
  const nodeById = Object.fromEntries(nodes.map((node) => [node.npcId, node]));
  const visibleEdges = edgesToDraw(graphMode, centerNpcId, edges);
  const showEmpty = !loading && !error && edges.length === 0;

  return (
    <div
      className="relationship-graph-panel"
      data-testid="relationship-graph-panel"
    >
      <header className="relationship-graph-panel__header">
        <h3 className="relationship-graph-panel__title">关系网</h3>
        {graphMode === "ego" ? (
          <p className="relationship-graph-panel__subtitle">
            以「{centerName}」为中心
          </p>
        ) : null}
      </header>

      <div className="relationship-graph-panel__toolbar">
        <button
          type="button"
          className={`relationship-graph-panel__mode-toggle${
            graphMode === "full"
              ? " relationship-graph-panel__mode-toggle--active"
              : ""
          }`}
          data-testid="relationship-graph-mode-toggle"
          onClick={() => onModeChange(toggleRelationshipGraphMode(graphMode))}
        >
          {relationshipGraphToggleCopy(graphMode)}
        </button>
        {staleHint ? (
          <p className="relationship-graph-panel__stale-hint">关系有更新</p>
        ) : null}
      </div>

      {loading ? (
        <p
          className="relationship-graph-panel__loading"
          data-testid="relationship-graph-loading"
        >
          载入中…
        </p>
      ) : null}

      {error ? (
        <p
          className="relationship-graph-panel__error"
          data-testid="relationship-graph-error"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {showEmpty ? (
        <div className="relationship-graph-panel__empty">
          <h4 className="relationship-graph-panel__empty-title">尚无关系网</h4>
          <p className="relationship-graph-panel__empty-body">
            加入房间并等待议员落位后，打开此页可查看档位关系。
          </p>
        </div>
      ) : null}

      {!loading && !error && edges.length > 0 ? (
        <div
          className="relationship-graph-panel__canvas-wrap"
          data-testid={
            graphMode === "full" ? "relationship-graph-mode-full" : undefined
          }
        >
          <svg
            className="relationship-graph-panel__svg"
            viewBox={`0 0 ${VIEW_SIZE} ${VIEW_SIZE}`}
            role="img"
            aria-label="议员关系简图"
          >
            {visibleEdges.map((edge) => {
              const a = nodeById[edge.npcAId];
              const b = nodeById[edge.npcBId];
              if (!a || !b) return null;
              const stroke = relationshipBandStroke(edge.band);
              return (
                <line
                  key={`${edge.npcAId}:${edge.npcBId}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={stroke.color}
                  strokeWidth={stroke.width}
                  className="relationship-graph-panel__edge"
                />
              );
            })}
            {nodes.map((node) => {
              const persona = getPersona(node.npcId);
              const label = graphNodeLabel(persona.displayName);
              const connectedEdge =
                graphMode === "ego" && !node.isCenter
                  ? findEdge(edges, centerNpcId, node.npcId)
                  : undefined;
              const bandLabel = connectedEdge?.bandLabelZh ?? "";
              return (
                <g key={node.npcId} className="relationship-graph-panel__node-group">
                  <circle
                    cx={node.x}
                    cy={node.y}
                    r={16}
                    className={`relationship-graph-panel__node${
                      node.isCenter
                        ? " relationship-graph-panel__node--center"
                        : ""
                    }`}
                  />
                  <foreignObject
                    x={node.x - 16}
                    y={node.y - 16}
                    width={32}
                    height={32}
                  >
                    <button
                      type="button"
                      className="relationship-graph-panel__node-btn"
                      aria-label={`${persona.displayName}${bandLabel ? `，${bandLabel}` : ""}`}
                      onClick={() => {
                        if (graphMode === "ego") {
                          onCenterChange(node.npcId);
                        }
                      }}
                    >
                      <span className="relationship-graph-panel__node-label">{label}</span>
                    </button>
                  </foreignObject>
                </g>
              );
            })}
          </svg>

          <ul className="relationship-graph-panel__edge-list" aria-label="关系档位">
            {visibleEdges.map((edge) => (
              <li
                key={`chip:${edge.npcAId}:${edge.npcBId}`}
                className="relationship-graph-panel__edge-row"
              >
                <span className="relationship-graph-panel__edge-names">
                  {getPersona(edge.npcAId).displayName} —{" "}
                  {getPersona(edge.npcBId).displayName}
                </span>
                <span
                  className={`relationship-graph-panel__band-chip relationship-graph-panel__band-chip--${edge.band}`}
                  data-testid="relationship-graph-band-chip"
                  data-band={edge.band}
                >
                  {edge.bandLabelZh}
                </span>
                <span className="relationship-graph-panel__kind-label">
                  {edge.kindLabelZh}
                </span>
                {edge.currentStatus.slice(0, 2).map((status) => (
                  <span
                    key={status}
                    className="relationship-graph-panel__status-chip"
                  >
                    {status}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
