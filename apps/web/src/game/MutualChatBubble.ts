import type * as Phaser from "phaser";
import {
  applySceneHanLabelBase,
  SCENE_LABEL_FONT_SANS,
} from "./entityLabels.js";
import { labelPx, LABEL_MIN_ACTIVITY_PX, LABEL_SCALE } from "./entityLayout.js";
import { chebyshevDistance } from "./ProximityNameplate.js";
import { nameLabelY } from "./sceneLabelLayout.js";
import type { SpriteProfile } from "./entitySprites.js";

/** D-MUTUAL-02 — clamp display length (server also clamps). */
export const MUTUAL_BUBBLE_MAX_CHARS = 20;

/** Visible hold before fade (mid of UI-SPEC 3–5s). */
export const MUTUAL_BUBBLE_HOLD_MS = 3500;

/** Fade-out tween duration when motion is allowed. */
export const MUTUAL_BUBBLE_FADE_MS = 400;

/** prefers-reduced-motion: hard-hide (no fade). */
export const MUTUAL_BUBBLE_REDUCED_HIDE_MS = 4000;

const PROXIMITY_CELLS = 2;
const CONTROL_CHARS = /[\x00-\x1f\x7f]/g;

export const MUTUAL_BUBBLE_FONT_SIZE_PX = Math.max(
  LABEL_MIN_ACTIVITY_PX,
  Math.round(12 * LABEL_SCALE),
);
export const MUTUAL_BUBBLE_FONT_SIZE = labelPx(12, LABEL_MIN_ACTIVITY_PX);
/** Match activity-label contrast (separate Text object — not frozen nameplate). */
export const MUTUAL_BUBBLE_COLOR = "#e6e8dc";
export const MUTUAL_BUBBLE_MAX_WIDTH_PX = Math.round(160 * LABEL_SCALE);

export type MutualChatBubblePayload = {
  npcId: string;
  peerNpcId: string;
  text: string;
  expiresAt: number;
};

export type MutualChatBubbleHost = {
  mutualChatBubble?: Phaser.GameObjects.Text;
  mutualChatBubbleTween?: Phaser.Tweens.Tween;
  mutualChatBubbleHideTimer?: Phaser.Time.TimerEvent;
  mutualChatBubbleUntil?: number;
  mutualChatBubbleWantShow?: boolean;
  gridX: number;
  gridY: number;
  npcId?: string;
  spriteMode?: boolean;
  spriteProfile?: SpriteProfile;
};

export function truncateMutualBubbleText(text: string): string {
  const cleaned = String(text ?? "").replace(CONTROL_CHARS, "").trim();
  if (cleaned.length <= MUTUAL_BUBBLE_MAX_CHARS) return cleaned;
  return cleaned.slice(0, MUTUAL_BUBBLE_MAX_CHARS);
}

export function mutualChatBubbleY(
  spriteMode: boolean | undefined,
  profile?: SpriteProfile,
): number {
  // Above nameplate baseline (Text origin 0.5,1).
  return nameLabelY(spriteMode, profile) - MUTUAL_BUBBLE_FONT_SIZE_PX - 2;
}

export function createMutualChatBubble(
  scene: Phaser.Scene,
  npcId: string,
): Phaser.GameObjects.Text {
  const label = scene.add.text(0, 0, "", {
    fontSize: MUTUAL_BUBBLE_FONT_SIZE,
    fontFamily: SCENE_LABEL_FONT_SANS,
    fontStyle: "normal",
    color: MUTUAL_BUBBLE_COLOR,
    align: "center",
    wordWrap: { width: MUTUAL_BUBBLE_MAX_WIDTH_PX, useAdvancedWrap: true },
  });
  applySceneHanLabelBase(label);
  label.setFontFamily(SCENE_LABEL_FONT_SANS);
  label.setOrigin(0.5, 1);
  label.setScrollFactor(1);
  label.setAlpha(0);
  label.setVisible(false);
  label.name = `npc-mutual-bubble-${npcId}`;
  label.setData("testid", `npc-mutual-bubble-${npcId}`);
  return label;
}

function clearBubbleTimers(host: MutualChatBubbleHost): void {
  host.mutualChatBubbleTween?.stop();
  host.mutualChatBubbleTween = undefined;
  host.mutualChatBubbleHideTimer?.remove(false);
  host.mutualChatBubbleHideTimer = undefined;
}

function snapHidden(host: MutualChatBubbleHost): void {
  const bubble = host.mutualChatBubble;
  if (!bubble) return;
  bubble.setAlpha(0);
  bubble.setVisible(false);
  bubble.setText("");
  host.mutualChatBubbleUntil = undefined;
  host.mutualChatBubbleWantShow = false;
}

/**
 * Show a one-shot mutual-chat line on an NPC Text bubble.
 * Hold 3–5s then fade; reduced-motion → hard-hide ~4s (UI-SPEC).
 */
export function showMutualChatBubble(
  scene: Phaser.Scene,
  host: MutualChatBubbleHost,
  text: string,
  opts: { reducedMotion: boolean; expiresAt?: number; nowMs?: number } = {
    reducedMotion: false,
  },
): void {
  const bubble = host.mutualChatBubble;
  if (!bubble) return;

  const copy = truncateMutualBubbleText(text);
  if (!copy) {
    hideMutualChatBubble(scene, host);
    return;
  }

  const now = opts.nowMs ?? Date.now();
  const holdMs = opts.reducedMotion ? MUTUAL_BUBBLE_REDUCED_HIDE_MS : MUTUAL_BUBBLE_HOLD_MS;
  const untilFromTtl =
    opts.expiresAt != null && opts.expiresAt > now ? opts.expiresAt : now + holdMs;
  const until = Math.min(untilFromTtl, now + (opts.reducedMotion ? MUTUAL_BUBBLE_REDUCED_HIDE_MS : 5000));

  clearBubbleTimers(host);
  bubble.setText(copy);
  bubble.y = mutualChatBubbleY(host.spriteMode === true, host.spriteProfile);
  bubble.setVisible(true);
  bubble.setAlpha(1);
  host.mutualChatBubbleUntil = until;
  host.mutualChatBubbleWantShow = true;

  const delay = Math.max(0, until - now);
  if (opts.reducedMotion) {
    host.mutualChatBubbleHideTimer = scene.time.delayedCall(delay, () => {
      snapHidden(host);
      host.mutualChatBubbleHideTimer = undefined;
    });
    return;
  }

  host.mutualChatBubbleHideTimer = scene.time.delayedCall(delay, () => {
    host.mutualChatBubbleHideTimer = undefined;
    host.mutualChatBubbleTween?.stop();
    host.mutualChatBubbleTween = scene.tweens.add({
      targets: bubble,
      alpha: 0,
      duration: MUTUAL_BUBBLE_FADE_MS,
      ease: "Cubic.easeIn",
      onComplete: () => {
        snapHidden(host);
        host.mutualChatBubbleTween = undefined;
      },
    });
  });
}

export function hideMutualChatBubble(
  _scene: Phaser.Scene,
  host: MutualChatBubbleHost,
): void {
  clearBubbleTimers(host);
  snapHidden(host);
}

/** Player Chebyshev ≤2 — same proximity band as activity / nameplates. */
export function shouldShowMutualChatBubble(
  gx: number,
  gy: number,
  localGx: number,
  localGy: number,
): boolean {
  return chebyshevDistance(gx, gy, localGx, localGy) <= PROXIMITY_CELLS;
}

/**
 * Apply proximity gate while a bubble is live (walk out → hide; walk in before expiry → show).
 */
export function updateMutualChatBubbleVisibility(
  host: MutualChatBubbleHost,
  localCell: { x: number; y: number } | null,
  nowMs = Date.now(),
): void {
  const bubble = host.mutualChatBubble;
  if (!bubble || host.mutualChatBubbleUntil == null) return;

  if (nowMs >= host.mutualChatBubbleUntil) {
    // Timer/tween owns hide; keep alpha if fade in progress.
    return;
  }

  const inRange =
    localCell != null
    && shouldShowMutualChatBubble(host.gridX, host.gridY, localCell.x, localCell.y);

  if (!inRange) {
    if (bubble.visible && bubble.alpha > 0) {
      bubble.setAlpha(0);
      bubble.setVisible(false);
    }
    host.mutualChatBubbleWantShow = false;
    return;
  }

  if (!bubble.visible || bubble.alpha < 0.95) {
    bubble.setVisible(true);
    bubble.setAlpha(1);
  }
  host.mutualChatBubbleWantShow = true;
}
