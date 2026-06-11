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

/**
 * Create and configure a player character sprite positioned at the sprite foot baseline.
 *
 * @param paletteRow - Palette row index used to select the character frame (0-based)
 * @returns The configured Phaser.GameObjects.Sprite positioned at SPRITE_FOOT_Y with origin (0.5, 1), scaled by SPRITE_SCALE, and oriented for the down-facing frame
 */
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

/**
 * Creates an NPC sprite positioned at the module sprite baseline, using the NPC's variant frame and tint.
 *
 * @param scene - The Phaser scene to add the sprite to.
 * @param npcId - Identifier used to deterministically select the NPC variant and default tint.
 * @param tintOverride - Optional color tint (hex number) to apply instead of the computed tint.
 * @returns The configured Phaser.GameObjects.Sprite for the NPC.
 */
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
  const bubble = scene.add.image(0, SPRITE_TOP_Y - 8, ASSET_KEYS.spritesUiSpeech);
  bubble.setOrigin(0.5, 1);
  bubble.setScale(0.75);
  bubble.setVisible(false);
  return bubble;
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
