import type * as Phaser from "phaser";
import { applySceneHanLabelBase, SCENE_LABEL_FONT } from "./entityLabels.js";
import { intentFontPx } from "./entityLayout.js";
import { truncateIntentLabel, type NpcAmbientUiState } from "./activityLabelLogic.js";

const FADE_IN_MS = 150;
const FADE_OUT_MS = 100;

export const INTENT_LABEL_FONT_SIZE_PX = intentFontPx();
export const INTENT_LABEL_FONT_SIZE = `${INTENT_LABEL_FONT_SIZE_PX}px`;
export const INTENT_LABEL_COLOR = "#d8d4c8";

export { intentLabelY } from "./sceneLabelLayout.js";

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

export function createIntentLabel(scene: Phaser.Scene, npcId: string): Phaser.GameObjects.Text {
  const label = scene.add.text(0, 0, "", {
    fontSize: INTENT_LABEL_FONT_SIZE,
    fontFamily: SCENE_LABEL_FONT,
    fontStyle: "normal",
    color: INTENT_LABEL_COLOR,
    align: "center",
  });
  applySceneHanLabelBase(label);
  label.setOrigin(0.5, 1);
  label.setScrollFactor(1);
  label.setAlpha(0);
  label.name = `npc-intent-${npcId}`;
  label.setData("testid", `npc-intent-${npcId}`);
  return label;
}

function readAlpha(t: IntentLabelTarget): number {
  return t.intentLabelAlpha ?? t.intentLabel.alpha;
}

function snapAlpha(t: IntentLabelTarget, alpha: number): void {
  t.intentLabel.setAlpha(alpha);
  t.intentLabelAlpha = alpha;
}

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

/** Keeps intent label nodes hidden — L2 reasonZh is data-only (D-intent-ui-ship-without-subline). */
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
