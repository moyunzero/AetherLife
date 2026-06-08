import type * as Phaser from "phaser";

const FADE_IN_MS = 150;
const FADE_OUT_MS = 100;
const PROXIMITY_CELLS = 2;

export type NameplateTarget = {
  label: Phaser.GameObjects.Text;
  gx?: number;
  gy?: number;
  gridX?: number;
  gridY?: number;
  npcId?: string;
  playerSessionId?: string;
  nameplateAlpha?: number;
  nameplateTween?: Phaser.Tweens.Tween;
  /** Last desired visibility — avoids restarting fade tweens every frame. */
  nameplateWantShow?: boolean;
};

function targetCell(t: NameplateTarget): { x: number; y: number } {
  const x = t.gx ?? t.gridX ?? 0;
  const y = t.gy ?? t.gridY ?? 0;
  return { x, y };
}

export function truncateNameplate(name: string): string {
  if (name.length <= 8) return name;
  return `${name.slice(0, 7)}…`;
}

export function chebyshevDistance(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

export function shouldShowNameplate(
  gx: number,
  gy: number,
  localGx: number,
  localGy: number,
  npcId: string | undefined,
  _activeNpcId: string | null,
  thinkingNpcId: string | null,
): boolean {
  if (npcId && npcId === thinkingNpcId) return true;
  return chebyshevDistance(gx, gy, localGx, localGy) <= PROXIMITY_CELLS;
}

function readLabelAlpha(t: NameplateTarget): number {
  return t.nameplateAlpha ?? t.label.alpha;
}

function snapLabelAlpha(t: NameplateTarget, alpha: number): void {
  t.label.setAlpha(alpha);
  t.nameplateAlpha = alpha;
}

function tweenAlpha(
  scene: Phaser.Scene,
  target: NameplateTarget,
  to: number,
  duration: number,
): void {
  target.nameplateTween?.stop();
  target.nameplateTween = scene.tweens.add({
    targets: target.label,
    alpha: to,
    duration,
    onComplete: () => {
      snapLabelAlpha(target, to);
      target.nameplateTween = undefined;
    },
  });
}

/** Proximity + speak-target nameplates (D-12, VIS-04). */
export function updateNameplates(
  scene: Phaser.Scene,
  targets: NameplateTarget[],
  localCell: { x: number; y: number } | null,
  activeNpcId: string | null,
  thinkingNpcId: string | null,
): void {
  for (const t of targets) {
    const { x: gx, y: gy } = targetCell(t);
    const show =
      localCell != null
      && shouldShowNameplate(
        gx,
        gy,
        localCell.x,
        localCell.y,
        t.npcId,
        activeNpcId,
        thinkingNpcId,
      );

    if (t.nameplateWantShow !== show) {
      t.nameplateWantShow = show;
      t.nameplateTween?.stop();
      t.nameplateTween = undefined;
      const current = readLabelAlpha(t);
      if (show) {
        if (current < 0.95) tweenAlpha(scene, t, 1, FADE_IN_MS);
        else snapLabelAlpha(t, 1);
      } else if (current > 0.05) {
        tweenAlpha(scene, t, 0, FADE_OUT_MS);
      } else {
        snapLabelAlpha(t, 0);
      }
      continue;
    }

    if (t.nameplateTween) continue;

    const current = readLabelAlpha(t);
    if (show && current < 0.95) {
      tweenAlpha(scene, t, 1, FADE_IN_MS);
    } else if (!show && current > 0.05) {
      tweenAlpha(scene, t, 0, FADE_OUT_MS);
    }
  }
}
