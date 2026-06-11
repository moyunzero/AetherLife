import type * as Phaser from "phaser";
import { ENTITY_LABEL_FONT } from "./entityLabels.js";
import { MARKER_LABEL_Y } from "./entityLayout.js";
import { SPRITE_NAMEPLATE_Y } from "./entitySprites.js";
import { truncateIntentLabel, type NpcAmbientUiState } from "./activityLabelLogic.js";

const FADE_IN_MS = 150;
const FADE_OUT_MS = 100;

export const INTENT_LABEL_FONT_SIZE = "8px";
export const INTENT_LABEL_COLOR = "#c8c4b8";
export const INTENT_LABEL_STROKE_COLOR = "#000000";
export const INTENT_LABEL_STROKE_WIDTH = 3;
export const INTENT_LABEL_Y_OFFSET = 27;

export type IntentProgressContext = {
  dwellMs: number;
  isFirstProximityThisSegment: boolean;
  joinVicinityActive: boolean;
  npcMovedSinceLastFrame: boolean;
};

export type IntentLabelTarget = {
  intentLabel: Phaser.GameObjects.Text;
  gx?: number;
  gy?: number;
  gridX?: number;
  gridY?: number;
  npcId: string;
  spriteMode?: boolean;
  intentLabelAlpha?: number;
  intentLabelTween?: Phaser.Tweens.Tween;
  intentLabelWantShow?: boolean;
};

/**
 * Compute the vertical position for an intent label based on rendering mode.
 *
 * @param spriteMode - If `true`, compute position for a sprite nameplate; if `false` or `undefined`, compute for a marker label
 * @returns The y-coordinate (in pixels) where the intent label should be placed
 */
export function intentLabelY(spriteMode: boolean | undefined): number {
  const base = spriteMode ? SPRITE_NAMEPLATE_Y : MARKER_LABEL_Y;
  return base + INTENT_LABEL_Y_OFFSET;
}

/**
 * Create and configure a Phaser Text object used as an NPC intent label.
 *
 * The returned Text is centered horizontally over its anchor, placed for UI scrolling,
 * initialized hidden (alpha = 0), and named/annotated using the provided `npcId`.
 *
 * @param scene - The Phaser scene to which the label will be added.
 * @param npcId - The NPC identifier used to set the label's `name` and `testid` data.
 * @returns The configured `Phaser.GameObjects.Text` instance for the NPC's intent label.
 */
export function createIntentLabel(scene: Phaser.Scene, npcId: string): Phaser.GameObjects.Text {
  const label = scene.add.text(0, 0, "", {
    fontSize: INTENT_LABEL_FONT_SIZE,
    fontFamily: ENTITY_LABEL_FONT,
    fontStyle: "600",
    color: INTENT_LABEL_COLOR,
    align: "center",
    stroke: INTENT_LABEL_STROKE_COLOR,
    strokeThickness: INTENT_LABEL_STROKE_WIDTH,
  });
  label.setOrigin(0.5, 1);
  label.setScrollFactor(1);
  label.setAlpha(0);
  label.name = `npc-intent-${npcId}`;
  label.setData("testid", `npc-intent-${npcId}`);
  return label;
}

/**
 * Get the current alpha for an intent label, preferring a cached value when present.
 *
 * @param t - The intent label target which may store a cached `intentLabelAlpha` and contains the `intentLabel` GameObject
 * @returns The alpha value (0 to 1) from `t.intentLabelAlpha` if defined, otherwise `t.intentLabel.alpha`
 */
function readAlpha(t: IntentLabelTarget): number {
  return t.intentLabelAlpha ?? t.intentLabel.alpha;
}

/**
 * Immediately sets the intent label's alpha and caches the value on the target.
 *
 * @param t - The intent label target whose label alpha will be updated
 * @param alpha - Alpha value to apply to the label (0 = fully transparent, 1 = fully opaque)
 */
function snapAlpha(t: IntentLabelTarget, alpha: number): void {
  t.intentLabel.setAlpha(alpha);
  t.intentLabelAlpha = alpha;
}

/**
 * Animates an intent label's alpha to a specified value and tracks the tween on the target.
 *
 * Stops any existing tween on the target, starts a new alpha tween in the given scene, and on completion
 * snaps/caches the final alpha value and clears the stored tween reference.
 *
 * @param scene - The Phaser scene used to create the tween.
 * @param target - The intent label target whose `intentLabel` alpha will be animated; the created tween is stored on `target.intentLabelTween`.
 * @param to - The target alpha value to animate to (typically between 0 and 1).
 * @param duration - Animation duration in milliseconds.
 */
function tweenAlpha(
  scene: Phaser.Scene,
  target: IntentLabelTarget,
  to: number,
  duration: number,
): void {
  target.intentLabelTween?.stop();
  target.intentLabelTween = scene.tweens.add({
    targets: target.intentLabel,
    alpha: to,
    duration,
    onComplete: () => {
      snapAlpha(target, to);
      target.intentLabelTween = undefined;
    },
  });
}

export { truncateIntentLabel };

/**
 * Ensures intent labels for the provided targets remain hidden and synchronizes their alpha/tween state.
 *
 * Updates each target's UI state (including `intentLabelWantShow`, stopping/clearing any active tween, and
 * initiating or snapping alpha tweens as needed) so labels end up hidden.
 *
 * @param scene - The Phaser scene used to create or manage tweens.
 * @param targets - Array of intent label targets whose label visibility and tween state will be synchronized.
 * @returns An empty string array (always `[]`).
 */
export function updateIntentLabels(
  scene: Phaser.Scene,
  targets: IntentLabelTarget[],
  _localCell: { x: number; y: number } | null,
  _npcAmbientById: Record<string, NpcAmbientUiState>,
  _thinkingNpcId: string | null,
  _activeNpcId: string | null,
  _speakBusyNpcId: string | null,
  _progressByNpcId: Record<string, IntentProgressContext>,
): string[] {
  for (const t of targets) {
    const show = false;

    if (t.intentLabelWantShow !== show) {
      t.intentLabelWantShow = show;
      t.intentLabelTween?.stop();
      t.intentLabelTween = undefined;
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

    if (t.intentLabelTween) continue;

    const current = readAlpha(t);
    if (show && current < 0.95) {
      tweenAlpha(scene, t, 1, FADE_IN_MS);
    } else if (!show && current > 0.05) {
      tweenAlpha(scene, t, 0, FADE_OUT_MS);
    }
  }

  return [];
}
