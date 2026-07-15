import type Phaser from "phaser";
import type { GameObject, NpcState } from "@aetherlife/shared";
import type { AnimatableEntity } from "./entitySprites.js";

export type PlayerSnap = {
  sessionId: string;
  playerId?: string;
  x: number;
  y: number;
  facing: string;
};

export type MapNpcView = Pick<NpcState, "id" | "name" | "x" | "y">;
export type MapObjectView = Pick<GameObject, "kind" | "x" | "y" | "state">;

export type DiscStyle = {
  fill: number;
  fillAlpha: number;
  stroke: number;
  strokeAlpha: number;
  labelColor?: string;
  radius?: number;
};

/** Top-down disc marker — canvas 2D game token, not HTML grid boxes. */
export type EntitySprite = AnimatableEntity & {
  container: Phaser.GameObjects.Container;
  body: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
  gridX: number;
  gridY: number;
  depthLayer: 0 | 1 | 2;
  targetGridX?: number;
  targetGridY?: number;
  bobTween?: Phaser.Tweens.Tween;
  pulseTween?: Phaser.Tweens.Tween;
  speakHaloTween?: Phaser.Tweens.Tween;
  nameplateAlpha?: number;
  nameplateTween?: Phaser.Tweens.Tween;
  nameplateWantShow?: boolean;
  activityLabel?: Phaser.GameObjects.Text;
  activityLabelAlpha?: number;
  activityLabelTween?: Phaser.Tweens.Tween;
  activityLabelWantShow?: boolean;
  intentLabel?: Phaser.GameObjects.Text;
  intentLabelAlpha?: number;
  intentLabelTween?: Phaser.Tweens.Tween;
  intentLabelWantShow?: boolean;
  moveTween?: Phaser.Tweens.Tween;
  /** While a step tween plays, queue the next ambient/schema dest (1 cell). */
  pendingGridX?: number;
  pendingGridY?: number;
  npcId?: string;
  playerSessionId?: string;
  spriteMode?: boolean;
};

export function facingFlipX(facing: string): boolean {
  return facing === "left" || facing === "west";
}

export function cellHasActor(
  x: number,
  y: number,
  players: PlayerSnap[],
  npcs: MapNpcView[],
): boolean {
  return (
    players.some((p) => p.x === x && p.y === y)
    || npcs.some((n) => n.x === x && n.y === y)
  );
}
