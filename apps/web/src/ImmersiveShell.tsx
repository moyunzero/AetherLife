import type { ReactNode } from "react";

type Props = {
  world: ReactNode;
  bottomHud?: ReactNode;
  overlays?: ReactNode;
};

/** Full-viewport shell root (Phase 19). Slots: world (flex 1), bottomHud, fixed overlays. */
export function ImmersiveShell({ world, bottomHud, overlays }: Props) {
  return (
    <div className="immersive-shell" data-testid="immersive-shell">
      {overlays ? (
        <div className="immersive-shell__overlays">{overlays}</div>
      ) : null}
      <div className="immersive-shell__world">{world}</div>
      {bottomHud ? (
        <div className="immersive-shell__bottom-hud">{bottomHud}</div>
      ) : null}
    </div>
  );
}
