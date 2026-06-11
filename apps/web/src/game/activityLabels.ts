import type * as Phaser from "phaser";
import { ENTITY_LABEL_FONT } from "./entityLabels.js";
import { MARKER_LABEL_Y } from "./entityLayout.js";
import { SPRITE_NAMEPLATE_Y } from "./entitySprites.js";
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

export const ACTIVITY_LABEL_FONT_SIZE = "10px";
export const ACTIVITY_LABEL_COLOR = "#b8c4a8";
export const ACTIVITY_LABEL_STROKE_COLOR = "#000000";
export const ACTIVITY_LABEL_STROKE_WIDTH = 3;
export const ACTIVITY_LABEL_Y_OFFSET = 14;

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

export function activityLabelY(spriteMode: boolean | undefined): number {
  const base = spriteMode ? SPRITE_NAMEPLATE_Y : MARKER_LABEL_Y;
  return base + ACTIVITY_LABEL_Y_OFFSET;
}

/**
 * Create and configure a Phaser Text object to serve as an NPC activity label.
 *
 * The label is positioned at (0,0), styled with the activity label font and stroke,
 * anchored at its bottom center, set to not scroll with the camera, and starts fully transparent.
 *
 * @param scene - The Phaser scene to create the label in.
 * @param npcId - The NPC identifier used to set the label's name and `testid` data.
 * @returns The configured `Phaser.GameObjects.Text` instance for the NPC activity label.
 */
export function createActivityLabel(scene: Phaser.Scene, npcId: string): Phaser.GameObjects.Text {
  const label = scene.add.text(0, 0, "", {
    fontSize: ACTIVITY_LABEL_FONT_SIZE,
    fontFamily: ENTITY_LABEL_FONT,
    fontStyle: "600",
    color: ACTIVITY_LABEL_COLOR,
    align: "center",
    stroke: ACTIVITY_LABEL_STROKE_COLOR,
    strokeThickness: ACTIVITY_LABEL_STROKE_WIDTH,
  });
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

/**
 * Update proximity activity labels for a set of targets and animate their fade in/out.
 *
 * The function evaluates whether each target's activity label should be shown based on the local player cell,
 * per-NPC ambient state, and the IDs of NPCs that are thinking, active, or speaking; it updates label text,
 * starts or stops alpha tweens, and returns the list of NPC IDs whose labels are visible after the update.
 *
 * @param scene - The Phaser scene used to create/drive tweens.
 * @param targets - Array of activity label targets to update.
 * @param localCell - The player's current grid cell, or `null` if unknown (labels are hidden when `null`).
 * @param npcAmbientById - Mapping from NPC ID to its ambient UI state used to resolve activity text and visibility.
 * @param thinkingNpcId - NPC ID currently considered "thinking", which can affect label resolution/visibility.
 * @param activeNpcId - NPC ID currently active (e.g., engaged), which can affect label resolution/visibility.
 * @param speakBusyNpcId - NPC ID currently speaking/busy, which can affect label resolution/visibility.
 * @returns An array of `npcId` values for targets whose activity labels are currently shown. 
 */
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
