import type * as Phaser from "phaser";
import { applySceneHanLabelBase, SCENE_LABEL_FONT } from "./entityLabels.js";
import { activityFontPx } from "./entityLayout.js";
import {
  resolveActivityLabel,
  shouldShowActivity,
  truncateActivityLabel,
  type NpcAmbientUiState,
  type ShouldShowActivityParams,
} from "./activityLabelLogic.js";

export {
  resolveActivityLabel,
  shouldShowActivity,
  truncateActivityLabel,
  type NpcAmbientUiState,
  type ShouldShowActivityParams,
};

/** Match ProximityNameplate fade timing (frozen — do not change). */
const FADE_IN_MS = 150;
const FADE_OUT_MS = 100;

export const ACTIVITY_LABEL_FONT_SIZE_PX = activityFontPx();
export const ACTIVITY_LABEL_FONT_SIZE = `${ACTIVITY_LABEL_FONT_SIZE_PX}px`;
export const ACTIVITY_LABEL_COLOR = "#e6e8dc";

export { activityLabelY } from "./sceneLabelLayout.js";

export type ActivityTarget = {
  activityLabel: Phaser.GameObjects.Text;
  gx?: number;
  gy?: number;
  gridX?: number;
  gridY?: number;
  npcId: string;
  spriteMode?: boolean;
  activityLabelAlpha?: number;
  activityLabelTween?: Phaser.Tweens.Tween;
  activityLabelWantShow?: boolean;
};

function targetCell(t: ActivityTarget): { x: number; y: number } {
  const x = t.gx ?? t.gridX ?? 0;
  const y = t.gy ?? t.gridY ?? 0;
  return { x, y };
}

export function createActivityLabel(scene: Phaser.Scene, npcId: string): Phaser.GameObjects.Text {
  const label = scene.add.text(0, 0, "", {
    fontSize: ACTIVITY_LABEL_FONT_SIZE,
    fontFamily: SCENE_LABEL_FONT,
    fontStyle: "normal",
    color: ACTIVITY_LABEL_COLOR,
    align: "center",
  });
  applySceneHanLabelBase(label);
  label.setOrigin(0.5, 1);
  label.setScrollFactor(1);
  label.setAlpha(0);
  label.name = `npc-activity-${npcId}`;
  label.setData("testid", `npc-activity-${npcId}`);
  return label;
}

function readAlpha(t: ActivityTarget): number {
  return t.activityLabelAlpha ?? t.activityLabel.alpha;
}

function snapAlpha(t: ActivityTarget, alpha: number): void {
  t.activityLabel.setAlpha(alpha);
  t.activityLabelAlpha = alpha;
}

function tweenAlpha(
  scene: Phaser.Scene,
  target: ActivityTarget,
  to: number,
  duration: number,
): void {
  target.activityLabelTween?.stop();
  target.activityLabelTween = scene.tweens.add({
    targets: target.activityLabel,
    alpha: to,
    duration,
    onComplete: () => {
      snapAlpha(target, to);
      target.activityLabelTween = undefined;
    },
  });
}

/** Proximity activity lines (LIFE-02) — parallel to nameplates, same fade timing. */
export function updateActivityLabels(
  scene: Phaser.Scene,
  targets: ActivityTarget[],
  localCell: { x: number; y: number } | null,
  npcAmbientById: Record<string, import("./activityLabelLogic.js").NpcAmbientUiState>,
  thinkingNpcId: string | null,
  activeNpcId: string | null,
  speakBusyNpcId: string | null,
): string[] {
  const visibleNpcIds: string[] = [];

  for (const t of targets) {
    const { x: gx, y: gy } = targetCell(t);
    const ambient = npcAmbientById[t.npcId] ?? { activityKey: "idle" };
    const show =
      localCell != null
      && shouldShowActivity({
        gx,
        gy,
        localGx: localCell.x,
        localGy: localCell.y,
        npcId: t.npcId,
        ambient,
        thinkingNpcId,
        activeNpcId,
        speakBusyNpcId,
      });

    if (show) {
      const resolved = resolveActivityLabel({
        ambient,
        playerDistanceCells: Math.max(Math.abs(gx - localCell!.x), Math.abs(gy - localCell!.y)),
        npcId: t.npcId,
        thinkingNpcId,
        activeNpcId,
        speakBusyNpcId,
      });
      const copy = truncateActivityLabel(resolved ?? "");
      if (t.activityLabel.text !== copy) t.activityLabel.setText(copy);
      visibleNpcIds.push(t.npcId);
    }

    if (t.activityLabelWantShow !== show) {
      t.activityLabelWantShow = show;
      t.activityLabelTween?.stop();
      t.activityLabelTween = undefined;
      const current = readAlpha(t);
      if (show) {
        if (current < 0.95) tweenAlpha(scene, t, 1, FADE_IN_MS);
        else snapAlpha(t, 1);
      } else if (current > 0.05) {
        tweenAlpha(scene, t, 0, FADE_OUT_MS);
      } else {
        snapAlpha(t, 0);
      }
      continue;
    }

    if (t.activityLabelTween) continue;

    const current = readAlpha(t);
    if (show && current < 0.95) {
      tweenAlpha(scene, t, 1, FADE_IN_MS);
    } else if (!show && current > 0.05) {
      tweenAlpha(scene, t, 0, FADE_OUT_MS);
    }
  }

  return visibleNpcIds;
}
