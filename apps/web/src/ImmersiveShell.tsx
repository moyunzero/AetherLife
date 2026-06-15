import type { ReactNode } from "react";

type Props = {
  world: ReactNode;
  overlays?: ReactNode;
};

/** Full-viewport shell (Phase 19 / v2-A). World fills viewport; HUD overlays live inside world slot. */
export function ImmersiveShell({ world, overlays }: Props) {
  return (
    <div className="immersive-shell" data-testid="immersive-shell">
      {overlays ? (
        <div className="immersive-shell__overlays">{overlays}</div>
      ) : null}
      <div className="immersive-shell__world">{world}</div>
    </div>
  );
}
