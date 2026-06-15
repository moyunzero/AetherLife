import * as Phaser from "phaser";
import {
  ASSET_KEYS,
  CHAR_FRAME_H,
  characterFrameIndex,
  FACING_COUNT,
  IDLE_FRAMES,
  NPC_VARIANT_COUNT,
  npcFrameIndex,
  PALETTE_ROW_COUNT,
  TILE_PX,
  WALK_FRAMES,
} from "./assetManifest.js";
import {
  type CardinalFacing,
  cardinalFacingFromDelta,
  facingToIndex,
  schemaFacingToCardinal,
} from "./facing.js";
import { CELL_PX, MARKER_CY } from "./entityLayout.js";
import { theme } from "./theme.js";

const SPRITE_SCALE = CELL_PX / TILE_PX;
/** Feet anchor: cell center → south edge (gridToWorld origin). */
const SPRITE_FOOT_Y = MARKER_CY + CELL_PX / 2;
const SPRITE_TOP_Y = SPRITE_FOOT_Y - CHAR_FRAME_H * SPRITE_SCALE;

/** Nameplate baseline above sprite head (label origin 0.5, 1). */
export const SPRITE_NAMEPLATE_Y = SPRITE_TOP_Y + 10;

/** Chat cue beside nameplate (Stardew-style, tilted). */
export const SPRITE_CHAT_BUBBLE_X = 26;
export const SPRITE_CHAT_BUBBLE_Y = SPRITE_NAMEPLATE_Y - 10;
export const SPRITE_CHAT_BUBBLE_ANGLE = 30;
export const SPRITE_CHAT_BUBBLE_SCALE = 1.75;

const CHAT_BUBBLE_TWEEN_KEY = "chatBubbleTween";

const CARDINALS: CardinalFacing[] = ["down", "left", "right", "up"];

export type AnimatableEntity = {
  avatar?: Phaser.GameObjects.Sprite;
  bubble?: Phaser.GameObjects.Image;
  doorSprite?: Phaser.GameObjects.Image;
  paletteRow?: number;
  facingDir?: CardinalFacing;
  isNpc?: boolean;
};

export function animKey(
  kind: "walk" | "idle",
  facing: CardinalFacing,
  paletteRow: number,
  isNpc = false,
): string {
  const prefix = isNpc ? "npc" : "char";
  return `${prefix}-${kind}-${facing}-p${paletteRow}`;
}

/** Stardew-style sheets only draw right profile; mirror for left. */
export function applyFacingFlip(
  avatar: Phaser.GameObjects.Sprite | undefined,
  facing: CardinalFacing,
): void {
  if (!avatar) return;
  avatar.setFlipX(facing === "left");
}

export function registerCharacterAnims(scene: Phaser.Scene): void {
  if (scene.anims.exists("char-walk-down-p0")) return;
  const texture = ASSET_KEYS.spritesCharacters;
  for (let row = 0; row < PALETTE_ROW_COUNT; row += 1) {
    for (let fi = 0; fi < FACING_COUNT; fi += 1) {
      const facing = CARDINALS[fi]!;
      const base = characterFrameIndex(row, fi, 0);
      scene.anims.create({
        key: animKey("walk", facing, row, false),
        frames: scene.anims.generateFrameNumbers(texture, {
          start: base,
          end: base + WALK_FRAMES - 1,
        }),
        frameRate: 10,
        repeat: -1,
      });
      scene.anims.create({
        key: animKey("idle", facing, row, false),
        frames: scene.anims.generateFrameNumbers(texture, {
          start: base + WALK_FRAMES,
          end: base + WALK_FRAMES + IDLE_FRAMES - 1,
        }),
        frameRate: 4,
        repeat: -1,
      });
    }
  }
}

export function registerNpcAnims(scene: Phaser.Scene): void {
  if (scene.anims.exists("npc-walk-down-p0")) return;
  const texture = ASSET_KEYS.spritesNpcs;
  for (let variant = 0; variant < NPC_VARIANT_COUNT; variant += 1) {
    for (let fi = 0; fi < FACING_COUNT; fi += 1) {
      const facing = CARDINALS[fi]!;
      const base = npcFrameIndex(variant, fi, 0);
      scene.anims.create({
        key: animKey("walk", facing, variant, true),
        frames: scene.anims.generateFrameNumbers(texture, {
          start: base,
          end: base + WALK_FRAMES - 1,
        }),
        frameRate: 10,
        repeat: -1,
      });
      scene.anims.create({
        key: animKey("idle", facing, variant, true),
        frames: scene.anims.generateFrameNumbers(texture, {
          start: base + WALK_FRAMES,
          end: base + WALK_FRAMES + IDLE_FRAMES - 1,
        }),
        frameRate: 4,
        repeat: -1,
      });
    }
  }
}

export function paletteRowForPlayerId(
  playerId: string | undefined,
  sessionId: string,
  selfSessionId: string,
): number {
  if (sessionId === selfSessionId) return 0;
  const seed = playerId?.trim() || sessionId;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return 1 + (Math.abs(h) % 3);
}

export function npcVariantForId(npcId: string): number {
  let h = 0;
  for (let i = 0; i < npcId.length; i += 1) {
    h = (Math.imul(31, h) + npcId.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % NPC_VARIANT_COUNT;
}

export function npcTintForId(npcId: string): number {
  let h = 0;
  for (let i = 0; i < npcId.length; i += 1) {
    h = (Math.imul(31, h) + npcId.charCodeAt(i)) | 0;
  }
  const shift = Math.abs(h) % 24;
  return Phaser.Display.Color.GetColor(
    Math.min(255, ((theme.npcTint >> 16) & 0xff) + shift - 12),
    Math.min(255, ((theme.npcTint >> 8) & 0xff) + (shift % 8)),
    Math.min(255, (theme.npcTint & 0xff) + (shift % 6)),
  );
}

export function createPlayerSprite(
  scene: Phaser.Scene,
  paletteRow: number,
): Phaser.GameObjects.Sprite {
  const frame = characterFrameIndex(paletteRow, facingToIndex("down"), WALK_FRAMES);
  const sprite = scene.add.sprite(0, SPRITE_FOOT_Y, ASSET_KEYS.spritesCharacters, frame);
  sprite.setOrigin(0.5, 1);
  sprite.setScale(SPRITE_SCALE);
  applyFacingFlip(sprite, "down");
  return sprite;
}

export function createNpcSprite(
  scene: Phaser.Scene,
  npcId: string,
  tintOverride?: number,
): Phaser.GameObjects.Sprite {
  const variant = npcVariantForId(npcId);
  const frame = npcFrameIndex(variant, facingToIndex("down"), WALK_FRAMES);
  const sprite = scene.add.sprite(0, SPRITE_FOOT_Y, ASSET_KEYS.spritesNpcs, frame);
  sprite.setOrigin(0.5, 1);
  sprite.setScale(SPRITE_SCALE);
  applyFacingFlip(sprite, "down");
  sprite.setTint(tintOverride ?? npcTintForId(npcId));
  return sprite;
}

export function createSpeechBubble(scene: Phaser.Scene): Phaser.GameObjects.Image {
  const bubble = scene.add.image(
    SPRITE_CHAT_BUBBLE_X,
    SPRITE_CHAT_BUBBLE_Y,
    ASSET_KEYS.spritesUiSpeech,
  );
  bubble.setOrigin(0, 0.5);
  bubble.setScale(SPRITE_CHAT_BUBBLE_SCALE);
  bubble.setAngle(SPRITE_CHAT_BUBBLE_ANGLE);
  bubble.setVisible(false);
  return bubble;
}

function stopChatBubbleBob(bubble: Phaser.GameObjects.Image): void {
  const tween = bubble.getData(CHAT_BUBBLE_TWEEN_KEY) as Phaser.Tweens.Tween | undefined;
  if (tween) {
    tween.stop();
    tween.destroy();
    bubble.setData(CHAT_BUBBLE_TWEEN_KEY, undefined);
  }
  bubble.y = SPRITE_CHAT_BUBBLE_Y;
  bubble.setAngle(SPRITE_CHAT_BUBBLE_ANGLE);
}

function startChatBubbleBob(bubble: Phaser.GameObjects.Image, registry: Phaser.Data.DataManager): void {
  if (bubble.getData(CHAT_BUBBLE_TWEEN_KEY)) return;
  if (registry.get("reducedMotion")) return;
  const scene = bubble.scene;
  if (!scene?.tweens) return;
  const tween = scene.tweens.add({
    targets: bubble,
    y: SPRITE_CHAT_BUBBLE_Y - 5,
    angle: SPRITE_CHAT_BUBBLE_ANGLE + 4,
    duration: 550,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut",
  });
  bubble.setData(CHAT_BUBBLE_TWEEN_KEY, tween);
}

export function createDoorSprite(scene: Phaser.Scene, closed: boolean): Phaser.GameObjects.Image {
  const frame = closed ? 0 : 1;
  const sprite = scene.add.image(0, SPRITE_FOOT_Y - 4, ASSET_KEYS.tilesDecor, frame);
  sprite.setOrigin(0.5, 1);
  sprite.setScale(SPRITE_SCALE);
  return sprite;
}

export function playWalkAnim(ent: AnimatableEntity, facing: CardinalFacing): void {
  if (!ent.avatar) return;
  ent.facingDir = facing;
  const row = ent.paletteRow ?? 0;
  applyFacingFlip(ent.avatar, facing);
  ent.avatar.play(animKey("walk", facing, row, ent.isNpc === true), true);
}

export function playIdleAnim(ent: AnimatableEntity, facing?: CardinalFacing): void {
  if (!ent.avatar) return;
  const dir = facing ?? ent.facingDir ?? "down";
  ent.facingDir = dir;
  const row = ent.paletteRow ?? 0;
  applyFacingFlip(ent.avatar, dir);
  ent.avatar.play(animKey("idle", dir, row, ent.isNpc === true), true);
}

export function applyStepAnimation(
  ent: AnimatableEntity,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): void {
  if (!ent.avatar) return;
  playWalkAnim(ent, cardinalFacingFromDelta(toX - fromX, toY - fromY));
}

export function applyStepEndAnimation(ent: AnimatableEntity, continuing: boolean): void {
  if (!ent.avatar || continuing) return;
  playIdleAnim(ent);
}

export function applyFacingFromSchema(ent: AnimatableEntity, facing: string): void {
  if (!ent.avatar) return;
  playIdleAnim(ent, schemaFacingToCardinal(facing));
}

export function setThinkingBubble(ent: AnimatableEntity, visible: boolean): void {
  ent.bubble?.setVisible(visible);
}

function npcIsThinking(
  npcId: string,
  thinkingNpcId: string | null | undefined,
  thinkingNpcIds: string[] | undefined,
): boolean {
  if (thinkingNpcId === npcId) return true;
  return (thinkingNpcIds ?? []).includes(npcId);
}

/** Thinking bubble wins over hover cue; both use sprites/ui-speech (expression_chat). */
export function refreshNpcChatBubbles(
  npcSprites: Map<string, { npcId?: string; bubble?: Phaser.GameObjects.Image }>,
  registry: Phaser.Data.DataManager,
): void {
  const thinkingNpcId = registry.get("thinkingNpcId") as string | null | undefined;
  const thinkingNpcIds = registry.get("thinkingNpcIds") as string[] | undefined;
  const hoveredNpcId = registry.get("hoveredNpcId") as string | null | undefined;
  for (const [npcId, ent] of npcSprites) {
    if (!ent.npcId || !ent.bubble) continue;
    const thinking = npcIsThinking(npcId, thinkingNpcId, thinkingNpcIds);
    const hovered = hoveredNpcId === npcId;
    const show = thinking || hovered;
    ent.bubble.setVisible(show);
    if (show) {
      startChatBubbleBob(ent.bubble, registry);
    } else {
      stopChatBubbleBob(ent.bubble);
    }
  }
}
