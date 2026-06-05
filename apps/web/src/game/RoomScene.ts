import * as Phaser from "phaser";
import {
  buildMoveGrid,
  createDefaultRoom,
  findGridPath,
  type GameObject,
  type GridCell,
  type NpcState,
  type RoomState,
} from "@aetherlife/shared";
import {
  MARKER_CY,
  MARKER_LABEL_MAX_WIDTH,
  MARKER_LABEL_Y,
  MARKER_RADIUS,
  MARKER_STROKE,
} from "./entityLayout.js";
import { CELL_PX, gridToWorld, worldSize, worldToGrid } from "./gridLayout.js";
import { isStaticFloorBlocked } from "./floorBlocked.js";
import {
  ENTITY_LABEL_COLOR,
  ENTITY_LABEL_FONT,
  ENTITY_LABEL_FONT_SIZE,
  npcDisplayName,
  THINKING_PULSE_MS,
} from "./entityLabels.js";
import { playerDisplayName } from "../lib/playerDisplayName.js";
import { theme } from "./theme.js";

const STEP_MS = 140;
const DEFAULT_REMOTE_INTERP_MS = 130;
const SCENE_KEY = "Room";

type PlayerSnap = {
  sessionId: string;
  playerId?: string;
  x: number;
  y: number;
  facing: string;
};

type MapNpcView = Pick<NpcState, "id" | "name" | "x" | "y">;
type MapObjectView = Pick<GameObject, "kind" | "x" | "y" | "state">;

/** Playwright / UAT: inspect NPC snap vs tween after reset. */
export type AetherlifeNpcDebug = {
  animateNpcMoves: boolean;
  npcs: { id: string; x: number; y: number }[];
  sprites: {
    id: string;
    gridX: number;
    gridY: number;
    targetX: number;
    targetY: number;
    tweening: boolean;
  }[];
};

/** Top-down disc marker — canvas 2D game token, not HTML grid boxes. */
type DiscStyle = {
  fill: number;
  fillAlpha: number;
  stroke: number;
  strokeAlpha: number;
  labelColor?: string;
  radius?: number;
};

type EntitySprite = {
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
  moveTween?: Phaser.Tweens.Tween;
};

function facingFlipX(facing: string): boolean {
  return facing === "left" || facing === "west";
}

function cellHasActor(
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

export class RoomScene extends Phaser.Scene {
  private floorGfx!: Phaser.GameObjects.Graphics;
  private pathGfx!: Phaser.GameObjects.Graphics;
  private flashGfx!: Phaser.GameObjects.Graphics;
  private playerSprites = new Map<string, EntitySprite>();
  private npcSprites = new Map<string, EntitySprite>();
  private doorSprites = new Map<string, EntitySprite>();
  private zoomBase = 1;
  private zoomMin = 0.5;
  private zoomMax = 2;
  private pinchStartDist = 0;
  private pinchStartZoom = 1;
  private pathTarget: { x: number; y: number } | null = null;
  private flashTween: Phaser.Tweens.Tween | null = null;
  private vignetteGfx!: Phaser.GameObjects.Graphics;
  private npcResetEpoch = -1;

  constructor() {
    super({ key: SCENE_KEY });
  }

  create(): void {
    this.floorGfx = this.add.graphics();
    this.pathGfx = this.add.graphics();
    this.flashGfx = this.add.graphics();
    this.vignetteGfx = this.add.graphics();
    this.vignetteGfx.setDepth(50);
    this.cameras.main.setBackgroundColor(theme.bgDeep);

    this.drawFloor();
    this.drawVignette();
    this.fitCamera();
    this.setupInput();

    this.registry.events.on("changedata", this.onRegistryChange, this);
    this.events.on("shutdown", () => {
      this.registry.events.off("changedata", this.onRegistryChange, this);
    });

    this.syncEntities();
  }

  private onRegistryChange(parent: Phaser.Data.DataManager, key: string): void {
    if (key === "roomSync") this.syncEntities();
  }

  private getGridW(): number {
    return (this.registry.get("gridW") as number) ?? 8;
  }

  private getGridH(): number {
    return (this.registry.get("gridH") as number) ?? 8;
  }

  private getMoveMap(): RoomState {
    const map = this.registry.get("moveMap") as RoomState | undefined;
    return map ?? createDefaultRoom();
  }

  private movementDisabled(): boolean {
    const connected = this.registry.get("connected") as boolean;
    const animating = this.registry.get("animating") as boolean;
    return !connected || animating;
  }

  private drawVignette(): void {
    const { w, h } = worldSize(this.getGridW(), this.getGridH());
    const edge = Math.min(28, Math.floor(Math.min(w, h) * 0.12));
    this.vignetteGfx.clear();
    this.vignetteGfx.fillStyle(theme.bgDeep, 0.38);
    this.vignetteGfx.fillRect(0, 0, w, edge);
    this.vignetteGfx.fillRect(0, h - edge, w, edge);
    this.vignetteGfx.fillRect(0, 0, edge, h);
    this.vignetteGfx.fillRect(w - edge, 0, edge, h);
  }

  private drawFloor(): void {
    const map = this.getMoveMap();
    const w = this.getGridW();
    const h = this.getGridH();
    this.floorGfx.clear();
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const blocked = isStaticFloorBlocked(map, x, y);
        this.floorGfx.fillStyle(blocked ? theme.floorBlocked : theme.floorWalkable, 1);
        this.floorGfx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
        this.floorGfx.lineStyle(1, theme.gridLine, 1);
        this.floorGfx.strokeRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
      }
    }
  }

  private fitCamera(): void {
    const { w, h } = worldSize(this.getGridW(), this.getGridH());
    const cam = this.cameras.main;
    const zx = cam.width / w;
    const zy = cam.height / h;
    const z = Math.min(zx, zy) * 0.92;
    this.zoomBase = z;
    this.zoomMin = z * 0.55;
    this.zoomMax = z * 1.85;
    cam.setZoom(z);
    cam.centerOn(w / 2, h / 2);
  }

  private setupInput(): void {
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.movementDisabled()) return;
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      const { x, y } = worldToGrid(world.x, world.y);
      const w = this.getGridW();
      const h = this.getGridH();
      if (x < 0 || y < 0 || x >= w || y >= h) return;

      const map = this.getMoveMap();
      if (isStaticFloorBlocked(map, x, y)) {
        this.flashCell(x, y);
        return;
      }

      const onMoveTo = this.registry.get("onMoveTo") as ((tx: number, ty: number) => void) | undefined;
      onMoveTo?.(x, y);
      this.pathTarget = { x, y };
      this.drawPathPreview(x, y);
    });

    this.input.on(
      "wheel",
      (
        _pointer: Phaser.Input.Pointer,
        _gameObjects: unknown,
        _deltaX: number,
        deltaY: number,
      ) => {
        const cam = this.cameras.main;
        const next = Phaser.Math.Clamp(cam.zoom - deltaY * 0.001, this.zoomMin, this.zoomMax);
        cam.setZoom(next);
      },
    );

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
        this.pinchStartDist = Phaser.Math.Distance.Between(
          this.input.pointer1.x,
          this.input.pointer1.y,
          this.input.pointer2.x,
          this.input.pointer2.y,
        );
        this.pinchStartZoom = this.cameras.main.zoom;
      }
    });

    this.input.on("pointermove", () => {
      if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) return;
      if (this.pinchStartDist <= 0) return;
      const dist = Phaser.Math.Distance.Between(
        this.input.pointer1.x,
        this.input.pointer1.y,
        this.input.pointer2.x,
        this.input.pointer2.y,
      );
      const ratio = dist / this.pinchStartDist;
      const next = Phaser.Math.Clamp(this.pinchStartZoom * ratio, this.zoomMin, this.zoomMax);
      this.cameras.main.setZoom(next);
    });

    this.input.on("pointerup", () => {
      this.pinchStartDist = 0;
    });
  }

  private flashCell(x: number, y: number): void {
    this.flashGfx.clear();
    this.flashGfx.fillStyle(theme.destructive, 0.55);
    this.flashGfx.fillRect(x * CELL_PX, y * CELL_PX, CELL_PX, CELL_PX);
    this.flashTween?.stop();
    this.flashTween = this.tweens.add({
      targets: this.flashGfx,
      alpha: { from: 1, to: 0 },
      duration: 200,
      onComplete: () => {
        this.flashGfx.clear();
        this.flashGfx.setAlpha(1);
      },
    });
  }

  private drawPathPreview(targetX: number, targetY: number): void {
    const reduced = this.registry.get("reducedMotion") as boolean;
    if (reduced) {
      this.pathGfx.clear();
      return;
    }

    const sessionId = this.registry.get("sessionId") as string | null;
    const players = (this.registry.get("players") as PlayerSnap[]) ?? [];
    const self = players.find((p) => p.sessionId === sessionId);
    if (!self) {
      this.pathGfx.clear();
      return;
    }

    const map = this.getMoveMap();
    const others = players
      .filter((p) => p.sessionId !== sessionId)
      .map((p) => ({ x: p.x, y: p.y }));
    const grid = buildMoveGrid(map, others);
    const path = findGridPath(self.x, self.y, targetX, targetY, grid);
    this.pathGfx.clear();
    if (!path || path.length < 2) return;

    this.pathGfx.lineStyle(3, theme.accentDim, 0.4);
    const first = path[0]!;
    let prev = gridToWorld(first.x, first.y);
    for (let i = 1; i < path.length; i += 1) {
      const cell = path[i]!;
      const next = gridToWorld(cell.x, cell.y);
      this.pathGfx.beginPath();
      this.pathGfx.moveTo(prev.wx, prev.wy);
      this.pathGfx.lineTo(next.wx, next.wy);
      this.pathGfx.strokePath();
      prev = next;
    }
  }

  private clearPath(): void {
    this.pathGfx.clear();
    this.pathTarget = null;
  }

  syncEntities(): void {
    const map = this.getMoveMap();
    if (map) {
      this.drawFloor();
      this.drawVignette();
    }

    const connected = this.registry.get("connected") as boolean;
    const players = (this.registry.get("players") as PlayerSnap[]) ?? [];
    const sessionId = this.registry.get("sessionId") as string | null;
    const mapNpcs = (this.registry.get("mapNpcs") as MapNpcView[]) ?? [];
    const mapObjects = (this.registry.get("mapObjects") as MapObjectView[]) ?? [];
    const thinkingNpcId = this.registry.get("thinkingNpcId") as string | null;
    const animating = this.registry.get("animating") as boolean;
    const reduced = this.registry.get("reducedMotion") as boolean;

    if (!animating && this.pathTarget) {
      this.clearPath();
    }

    const remoteInterpMs =
      (this.registry.get("remoteInterpMs") as number) ?? DEFAULT_REMOTE_INTERP_MS;

    const seenPlayers = new Set<string>();
    for (const p of players) {
      seenPlayers.add(p.sessionId);
      const isSelf = p.sessionId === sessionId;
      const label = playerDisplayName(p.playerId, isSelf);
      const playerColor = isSelf ? theme.accent : theme.playerOther;
      let ent = this.playerSprites.get(p.sessionId);
      if (!ent) {
        ent = this.createDiscMarker(label, p.x, p.y, {
          fill: theme.bgDeep,
          fillAlpha: 0,
          stroke: playerColor,
          strokeAlpha: 1,
          labelColor: isSelf ? "#c9a227" : undefined,
        }, 2);
        this.playerSprites.set(p.sessionId, ent);
      }
      const stepMs = isSelf ? STEP_MS : remoteInterpMs;
      this.tweenEntityTo(ent, p.x, p.y, stepMs);
      ent.body.setFillStyle(theme.bgDeep, 0);
      ent.body.setStrokeStyle(MARKER_STROKE, playerColor, connected ? 1 : 0.35);
      ent.ring.setStrokeStyle(MARKER_STROKE, playerColor, connected ? 0.45 : 0.15);
      ent.label.setText(label);
      ent.label.setColor(isSelf ? "#c9a227" : ENTITY_LABEL_COLOR);
      ent.container.setScale(facingFlipX(p.facing) ? -1 : 1, 1);
    }
    for (const [id, ent] of this.playerSprites) {
      if (!seenPlayers.has(id)) {
        ent.container.destroy();
        this.playerSprites.delete(id);
      }
    }

    const resetEpoch = (this.registry.get("npcResetEpoch") as number) ?? 0;
    if (resetEpoch !== this.npcResetEpoch) {
      this.npcResetEpoch = resetEpoch;
      for (const ent of this.npcSprites.values()) {
        this.stopEntityMotion(ent);
        ent.container.destroy();
      }
      this.npcSprites.clear();
    }

    const seenNpcs = new Set<string>();
    const animateNpcMoves = this.registry.get("npcAnimateMoves") === true;
    for (const npc of mapNpcs) {
      seenNpcs.add(npc.id);
      let ent = this.npcSprites.get(npc.id);
      if (!ent) {
        ent = this.createDiscMarker(npcDisplayName(npc.name), npc.x, npc.y, {
          fill: theme.npcTint,
          fillAlpha: 0.85,
          stroke: theme.npcTint,
          strokeAlpha: 1,
          labelColor: "#c9a227",
        }, 1);
        this.npcSprites.set(npc.id, ent);
      }
      if (animateNpcMoves) {
        this.tweenNpcTo(ent, npc.x, npc.y, npc.id);
      } else {
        this.snapNpcTo(ent, npc.x, npc.y);
      }
      ent.label.setText(npcDisplayName(npc.name));
      ent.body.setFillStyle(theme.npcTint, connected ? 0.85 : 0.35);
      ent.ring.setStrokeStyle(MARKER_STROKE, theme.npcTint, connected ? 0.5 : 0.2);

      if (!ent.moveTween?.isPlaying()) {
        this.startNpcBob(ent, ent.gridX, ent.gridY, reduced, thinkingNpcId === npc.id);
      }
      if (thinkingNpcId === npc.id && !reduced) {
        ent.pulseTween?.stop();
        ent.pulseTween = this.tweens.add({
          targets: [ent.body, ent.ring],
          alpha: { from: 1, to: 0.45 },
          duration: THINKING_PULSE_MS,
          yoyo: true,
          repeat: -1,
          onUpdate: () => {
            ent!.body.setFillStyle(theme.accent, ent!.body.alpha);
          },
        });
      }
    }
    for (const [id, ent] of this.npcSprites) {
      if (!seenNpcs.has(id)) {
        this.stopEntityMotion(ent);
        ent.container.destroy();
        this.npcSprites.delete(id);
      }
    }

    const seenDoors = new Set<string>();
    for (const obj of mapObjects) {
      if (obj.kind !== "door") continue;
      const key = `door-${obj.x}-${obj.y}`;
      seenDoors.add(key);

      if (cellHasActor(obj.x, obj.y, players, mapNpcs)) {
        const hidden = this.doorSprites.get(key);
        if (hidden) {
          hidden.container.destroy();
          this.doorSprites.delete(key);
        }
        continue;
      }

      const strokeColor = obj.state === "closed" ? theme.doorClosed : theme.doorOpen;
      let ent = this.doorSprites.get(key);
      if (!ent) {
        ent = this.createDiscMarker("门", obj.x, obj.y, {
          fill: theme.doorFill,
          fillAlpha: 0.9,
          stroke: strokeColor,
          strokeAlpha: 1,
          radius: MARKER_RADIUS - 2,
        }, 0);
        this.doorSprites.set(key, ent);
      }
      ent.container.setVisible(true);
      this.tweenEntityTo(ent, obj.x, obj.y, STEP_MS);
      ent.body.setFillStyle(theme.doorFill, connected ? 0.9 : 0.35);
      ent.body.setStrokeStyle(MARKER_STROKE, strokeColor, connected ? 1 : 0.35);
      ent.ring.setStrokeStyle(1, strokeColor, connected ? 0.45 : 0.15);
      ent.label.setText("门");
    }
    for (const [id, ent] of this.doorSprites) {
      if (!seenDoors.has(id)) {
        ent.container.destroy();
        this.doorSprites.delete(id);
      }
    }

    if (import.meta.env.DEV && typeof window !== "undefined") {
      const w = window as Window & {
        __aetherlife_npcDebug?: () => AetherlifeNpcDebug;
      };
      w.__aetherlife_npcDebug = () => ({
        animateNpcMoves,
        npcs: mapNpcs.map((n) => ({ id: n.id, x: n.x, y: n.y })),
        sprites: [...this.npcSprites.entries()].map(([id, ent]) => ({
          id,
          gridX: ent.gridX,
          gridY: ent.gridY,
          targetX: ent.targetGridX ?? ent.gridX,
          targetY: ent.targetGridY ?? ent.gridY,
          tweening: Boolean(ent.moveTween?.isPlaying()),
        })),
      });
    }
  }

  private entityDepth(gx: number, gy: number, layer: 0 | 1 | 2 = 1): number {
    return 10 + gy * 10 + gx + layer;
  }

  /** Top-down disc + label — Phaser canvas markers, not MovementPanel grid boxes. */
  private createDiscMarker(
    label: string,
    gx: number,
    gy: number,
    style: DiscStyle,
    layer: 0 | 1 | 2 = 1,
  ): EntitySprite {
    const { wx, wy } = gridToWorld(gx, gy);
    const container = this.add.container(wx, wy);
    container.setDepth(this.entityDepth(gx, gy, layer));

    const r = style.radius ?? MARKER_RADIUS;
    const body = this.add.circle(0, MARKER_CY, r, style.fill, style.fillAlpha);
    body.setStrokeStyle(MARKER_STROKE, style.stroke, style.strokeAlpha);

    const ring = this.add.circle(0, MARKER_CY, r + 5, 0, 0);
    ring.setStrokeStyle(1, style.stroke, style.strokeAlpha * 0.45);
    ring.setFillStyle(0, 0);

    const text = this.add.text(0, MARKER_LABEL_Y, label, {
      fontSize: ENTITY_LABEL_FONT_SIZE,
      fontFamily: ENTITY_LABEL_FONT,
      color: style.labelColor ?? ENTITY_LABEL_COLOR,
      align: "center",
      wordWrap: { width: MARKER_LABEL_MAX_WIDTH, useAdvancedWrap: true },
    });
    text.setOrigin(0.5, 1);
    container.add([ring, body, text]);
    return {
      container,
      body,
      ring,
      label: text,
      gridX: gx,
      gridY: gy,
      depthLayer: layer,
    };
  }

  private stopEntityMotion(ent: EntitySprite): void {
    ent.bobTween?.stop();
    ent.bobTween = undefined;
    ent.pulseTween?.stop();
    ent.pulseTween = undefined;
    ent.moveTween?.stop();
    ent.moveTween = undefined;
    this.tweens.killTweensOf(ent.container);
  }

  private snapEntityToGrid(ent: EntitySprite, gx: number, gy: number): void {
    const scaleX = ent.container.scaleX;
    const scaleY = ent.container.scaleY;
    ent.gridX = gx;
    ent.gridY = gy;
    const { wx, wy } = gridToWorld(gx, gy);
    ent.container.setPosition(wx, wy);
    ent.container.setScale(scaleX, scaleY);
    ent.container.setDepth(this.entityDepth(gx, gy, ent.depthLayer));
  }

  private tweenEntityTo(ent: EntitySprite, gx: number, gy: number, duration: number): void {
    if (ent.gridX === gx && ent.gridY === gy) {
      this.stopEntityMotion(ent);
      this.snapEntityToGrid(ent, gx, gy);
      return;
    }

    this.stopEntityMotion(ent);
    this.tweenEntityOneStep(ent, gx, gy, duration);
  }

  /** BFS path for NPC visual walk — exclude self so goal cell is reachable. */
  private pathForNpcMove(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    npcId: string,
  ): GridCell[] | null {
    const map = this.getMoveMap();
    const players = (this.registry.get("players") as PlayerSnap[]) ?? [];
    const others = players.map((p) => ({ x: p.x, y: p.y }));
    const grid = buildMoveGrid(map, others, { excludeNpcId: npcId });
    return findGridPath(fromX, fromY, toX, toY, grid);
  }

  /** Load / reset: snap NPC to persisted grid (Stardew-style, no walk-in on refresh). */
  private snapNpcTo(ent: EntitySprite, gx: number, gy: number): void {
    ent.targetGridX = gx;
    ent.targetGridY = gy;
    this.stopEntityMotion(ent);
    this.snapEntityToGrid(ent, gx, gy);
  }

  /** NPC moves step-by-step (~140ms/cell), matching player sendMoveTo animation. */
  private tweenNpcTo(ent: EntitySprite, gx: number, gy: number, npcId: string): void {
    if (ent.gridX === gx && ent.gridY === gy) {
      ent.targetGridX = gx;
      ent.targetGridY = gy;
      this.stopEntityMotion(ent);
      this.snapEntityToGrid(ent, gx, gy);
      return;
    }

    if (
      ent.targetGridX === gx &&
      ent.targetGridY === gy &&
      ent.moveTween?.isPlaying()
    ) {
      return;
    }

    const reduced = this.registry.get("reducedMotion") as boolean;
    const path = this.pathForNpcMove(ent.gridX, ent.gridY, gx, gy, npcId);

    this.stopEntityMotion(ent);
    ent.targetGridX = gx;
    ent.targetGridY = gy;
    this.snapEntityToGrid(ent, ent.gridX, ent.gridY);

    if (reduced) {
      this.snapEntityToGrid(ent, gx, gy);
      return;
    }

    if (!path || path.length <= 1) {
      this.tweenEntityOneStep(ent, gx, gy, STEP_MS);
      return;
    }

    let stepIndex = 1;
    const walkNext = (): void => {
      if (stepIndex >= path.length) {
        ent.moveTween = undefined;
        return;
      }
      const cell = path[stepIndex]!;
      stepIndex += 1;
      ent.gridX = cell.x;
      ent.gridY = cell.y;
      const { wx, wy } = gridToWorld(cell.x, cell.y);
      ent.moveTween = this.tweens.add({
        targets: ent.container,
        x: wx,
        y: wy,
        duration: STEP_MS,
        ease: "Linear",
        onComplete: () => {
          if (stepIndex < path.length) {
            walkNext();
          } else {
            ent.moveTween = undefined;
          }
        },
      });
    };
    walkNext();
  }

  private tweenEntityOneStep(
    ent: EntitySprite,
    gx: number,
    gy: number,
    duration: number,
  ): void {
    const reduced = this.registry.get("reducedMotion") as boolean;
    ent.gridX = gx;
    ent.gridY = gy;
    ent.container.setDepth(this.entityDepth(gx, gy, ent.depthLayer));
    const { wx, wy } = gridToWorld(gx, gy);
    if (reduced) {
      ent.container.setPosition(wx, wy);
      return;
    }
    ent.moveTween = this.tweens.add({
      targets: ent.container,
      x: wx,
      y: wy,
      duration,
      ease: "Linear",
      onComplete: () => {
        ent.moveTween = undefined;
      },
    });
  }

  private startNpcBob(
    ent: EntitySprite,
    _gx: number,
    _gy: number,
    reduced: boolean,
    thinking: boolean,
  ): void {
    if (reduced || thinking) return;
    ent.label.y = MARKER_LABEL_Y;
    ent.bobTween = this.tweens.add({
      targets: ent.label,
      y: MARKER_LABEL_Y - 2,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }
}

export const ROOM_SCENE_KEY = SCENE_KEY;
