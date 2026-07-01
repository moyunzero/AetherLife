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
import { CELL_PX, CHAR_DISPLAY_PX, LABEL_SCALE, MARKER_CY, labelOffset } from "./entityLayout.js";
import {
  LPC_NPC1_IDLE_FRAMES,
  LPC_NPC1_SCALE,
  LPC_NPC1_STEPS_PER_CYCLE,
  LPC_NPC1_WALK_FRAMES,
  LPC_NPC1_IDLE_FRAME_RATE,
  lpcNpc1AnimKey,
  lpcNpc1FrameIndex,
  lpcNpc1NameplateY,
  lpcNpc1WalkStepAnimKey,
  lpcNpc1WalkStepFrameRate,
  lpcNpc1WalkStepRange,
  spriteProfileForNpc,
  type LpcNpc1SpriteProfile,
} from "./lpcNpc1Sheet.js";
import { theme } from "./theme.js";

const TILE_SCALE = CELL_PX / TILE_PX;
/** Stardew 16×32 frames → CHAR_DISPLAY_PX tall (2 cells). */
const CHAR_SPRITE_SCALE = CHAR_DISPLAY_PX / CHAR_FRAME_H;
/** Feet anchor: cell center → south edge (gridToWorld origin). */
const SPRITE_FOOT_Y = MARKER_CY + CELL_PX / 2;
const SPRITE_TOP_Y = SPRITE_FOOT_Y - CHAR_FRAME_H * CHAR_SPRITE_SCALE;

/** Nameplate baseline — just above sprite head (label origin 0.5, 1). */
export const SPRITE_NAMEPLATE_Y = SPRITE_TOP_Y + labelOffset(5);

export function spriteNameplateY(profile: SpriteProfile = "stardew"): number {
  if (profile === "lpc-npc-1") return lpcNpc1NameplateY(SPRITE_FOOT_Y);
  return SPRITE_NAMEPLATE_Y;
}

export { spriteProfileForNpc };

/** Chat cue beside nameplate (Stardew-style, tilted) — scales with CELL_PX. */
const CHAT_BUBBLE_BASE_SCALE = 1.75;

export function spriteChatBubbleX(): number {
  return labelOffset(26);
}

export function spriteChatBubbleY(profile: SpriteProfile = "stardew"): number {
  return spriteNameplateY(profile) - labelOffset(10);
}

export const SPRITE_CHAT_BUBBLE_ANGLE = 30;
export const SPRITE_CHAT_BUBBLE_SCALE = CHAT_BUBBLE_BASE_SCALE * LABEL_SCALE;

const CHAT_BUBBLE_TWEEN_KEY = "chatBubbleTween";
const CHAT_BUBBLE_BASE_Y_KEY = "chatBubbleBaseY";

const CARDINALS: CardinalFacing[] = ["down", "left", "right", "up"];

export type SpriteProfile = LpcNpc1SpriteProfile | "stardew";

export type AnimatableEntity = {
  avatar?: Phaser.GameObjects.Sprite;
  bubble?: Phaser.GameObjects.Image;
  doorSprite?: Phaser.GameObjects.Image;
  paletteRow?: number;
  facingDir?: CardinalFacing;
  isNpc?: boolean;
  spriteProfile?: SpriteProfile;
  /** LPC plan A: which 3-frame walk segment (0–2) plays on the next step. */
  lpcWalkPhase?: number;
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

/** Stardew-style sheets only draw right profile; mirror for left. LPC has native left frames. */
export function applyFacingFlip(
  avatar: Phaser.GameObjects.Sprite | undefined,
  facing: CardinalFacing,
  profile: SpriteProfile = "stardew",
): void {
  if (!avatar) return;
  if (profile === "lpc-npc-1") {
    avatar.setFlipX(false);
    return;
  }
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

export function registerLpcNpc1Anims(scene: Phaser.Scene): void {
  if (scene.anims.exists("lpc1-walk-down-s0")) return;
  const texture = ASSET_KEYS.spritesLpcNpc1;
  const stepRate = lpcNpc1WalkStepFrameRate();
  for (let fi = 0; fi < FACING_COUNT; fi += 1) {
    const facing = CARDINALS[fi]!;
    for (let phase = 0; phase < LPC_NPC1_STEPS_PER_CYCLE; phase += 1) {
      const range = lpcNpc1WalkStepRange(phase);
      const frameStart = lpcNpc1FrameIndex(facing, "walk", range.start);
      const frameEnd = lpcNpc1FrameIndex(facing, "walk", range.end);
      scene.anims.create({
        key: lpcNpc1WalkStepAnimKey(facing, phase),
        frames: scene.anims.generateFrameNumbers(texture, {
          start: frameStart,
          end: frameEnd,
        }),
        frameRate: stepRate,
        repeat: 0,
      });
    }
    const idleBase = lpcNpc1FrameIndex(facing, "idle", 0);
    scene.anims.create({
      key: lpcNpc1AnimKey("idle", facing),
      frames: scene.anims.generateFrameNumbers(texture, {
        start: idleBase,
        end: idleBase + LPC_NPC1_IDLE_FRAMES - 1,
      }),
      frameRate: LPC_NPC1_IDLE_FRAME_RATE,
      repeat: -1,
    });
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

export function createLpcNpc1Sprite(scene: Phaser.Scene): Phaser.GameObjects.Sprite {
  const frame = lpcNpc1FrameIndex("down", "idle", 0);
  const sprite = scene.add.sprite(0, SPRITE_FOOT_Y, ASSET_KEYS.spritesLpcNpc1, frame);
  sprite.setOrigin(0.5, 1);
  sprite.setScale(LPC_NPC1_SCALE);
  return sprite;
}

export function createPlayerSprite(
  scene: Phaser.Scene,
  _paletteRow: number,
): Phaser.GameObjects.Sprite {
  return createLpcNpc1Sprite(scene);
}

export function createNpcSprite(
  scene: Phaser.Scene,
  npcId: string,
  tintOverride?: number,
): Phaser.GameObjects.Sprite {
  if (npcId === "npc-1") {
    return createLpcNpc1Sprite(scene);
  }
  const variant = npcVariantForId(npcId);
  const frame = npcFrameIndex(variant, facingToIndex("down"), WALK_FRAMES);
  const sprite = scene.add.sprite(0, SPRITE_FOOT_Y, ASSET_KEYS.spritesNpcs, frame);
  sprite.setOrigin(0.5, 1);
  sprite.setScale(CHAR_SPRITE_SCALE);
  applyFacingFlip(sprite, "down");
  sprite.setTint(tintOverride ?? npcTintForId(npcId));
  return sprite;
}

export function createSpeechBubble(
  scene: Phaser.Scene,
  profile: SpriteProfile = "stardew",
): Phaser.GameObjects.Image {
  const baseY = spriteChatBubbleY(profile);
  const bubble = scene.add.image(
    spriteChatBubbleX(),
    baseY,
    ASSET_KEYS.spritesUiSpeech,
  );
  bubble.setOrigin(0, 0.5);
  bubble.setScale(SPRITE_CHAT_BUBBLE_SCALE);
  bubble.setAngle(SPRITE_CHAT_BUBBLE_ANGLE);
  bubble.setVisible(false);
  bubble.setData(CHAT_BUBBLE_BASE_Y_KEY, baseY);
  return bubble;
}

function chatBubbleBaseY(bubble: Phaser.GameObjects.Image): number {
  return (bubble.getData(CHAT_BUBBLE_BASE_Y_KEY) as number | undefined) ?? spriteChatBubbleY();
}

function stopChatBubbleBob(bubble: Phaser.GameObjects.Image): void {
  const tween = bubble.getData(CHAT_BUBBLE_TWEEN_KEY) as Phaser.Tweens.Tween | undefined;
  if (tween) {
    tween.stop();
    tween.destroy();
    bubble.setData(CHAT_BUBBLE_TWEEN_KEY, undefined);
  }
  bubble.y = chatBubbleBaseY(bubble);
  bubble.setAngle(SPRITE_CHAT_BUBBLE_ANGLE);
}

function startChatBubbleBob(bubble: Phaser.GameObjects.Image, registry: Phaser.Data.DataManager): void {
  if (bubble.getData(CHAT_BUBBLE_TWEEN_KEY)) return;
  if (registry.get("reducedMotion")) return;
  const scene = bubble.scene;
  if (!scene?.tweens) return;
  const baseY = chatBubbleBaseY(bubble);
  const tween = scene.tweens.add({
    targets: bubble,
    y: baseY - labelOffset(5),
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
  sprite.setScale(TILE_SCALE);
  return sprite;
}

function playLpcWalkAnim(ent: AnimatableEntity, facing: CardinalFacing): void {
  if (!ent.avatar) return;
  if (ent.facingDir !== facing) {
    ent.lpcWalkPhase = 0;
  }
  const phase = ent.lpcWalkPhase ?? 0;
  ent.lpcWalkPhase = (phase + 1) % LPC_NPC1_STEPS_PER_CYCLE;
  ent.facingDir = facing;
  applyFacingFlip(ent.avatar, facing, "lpc-npc-1");
  ent.avatar.play(lpcNpc1WalkStepAnimKey(facing, phase), false);
}

export function playWalkAnim(ent: AnimatableEntity, facing: CardinalFacing): void {
  if (!ent.avatar) return;
  const profile = ent.spriteProfile ?? "stardew";
  if (profile === "lpc-npc-1") {
    playLpcWalkAnim(ent, facing);
    return;
  }
  ent.facingDir = facing;
  applyFacingFlip(ent.avatar, facing, profile);
  const row = ent.paletteRow ?? 0;
  ent.avatar.play(animKey("walk", facing, row, ent.isNpc === true), true);
}

export function playIdleAnim(ent: AnimatableEntity, facing?: CardinalFacing): void {
  if (!ent.avatar) return;
  const dir = facing ?? ent.facingDir ?? "down";
  const profile = ent.spriteProfile ?? "stardew";
  if (profile === "lpc-npc-1") {
    ent.lpcWalkPhase = 0;
  }
  ent.facingDir = dir;
  applyFacingFlip(ent.avatar, dir, profile);
  if (profile === "lpc-npc-1") {
    ent.avatar.play(lpcNpc1AnimKey("idle", dir), true);
    return;
  }
  const row = ent.paletteRow ?? 0;
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
