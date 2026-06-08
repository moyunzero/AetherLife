import { CHUNK_SIZE } from "@aetherlife/shared";

export type DecorKind = "bush" | "tree" | "fence" | "landmark" | "reeds";

export type DecorPlacement = {
  gx: number;
  gy: number;
  kind: DecorKind;
  /** 2×2 decor anchor is south-west cell. */
  size: 1 | 2;
  frame: number;
};

/** Deterministic home farm landmarks from world seed (D-16). */
export function homeDecorPlacements(worldSeed: number, chunkCx: number, chunkCy: number): DecorPlacement[] {
  if (chunkCx !== 0 || chunkCy !== 0) return [];
  const h = Math.imul(worldSeed, 0x9e3779b9) >>> 0;
  const pathRow = 6;
  const placements: DecorPlacement[] = [];

  // Homestead pen: horizontal fence on the dirt path row, gate gap toward the well.
  for (let x = 1; x < CHUNK_SIZE - 1; x += 1) {
    if (x === 4) continue;
    placements.push({ gx: x, gy: pathRow, kind: "fence", size: 1, frame: 7 });
  }

  // North pen boundary (AE-01 farm readability).
  for (let x = 2; x <= 6; x += 1) {
    placements.push({ gx: x, gy: 2, kind: "fence", size: 1, frame: 7 });
  }

  placements.push({ gx: 4, gy: 4, kind: "landmark", size: 1, frame: 8 });
  placements.push({ gx: 1, gy: 7, kind: "bush", size: 1, frame: 2 });
  placements.push({ gx: 7, gy: 1, kind: "bush", size: 1, frame: 2 });
  placements.push({
    gx: 5 + (h % 2),
    gy: 1,
    kind: "tree",
    size: 1,
    frame: 3,
  });

  return placements;
}

/** Procedural scatter on blocked cells per biome. */
export function decorForBlockedCell(
  gx: number,
  gy: number,
  biome: string,
  worldSeed: number,
): DecorPlacement | null {
  const hash = Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663) ^ worldSeed;
  const roll = (hash >>> 0) % 100;
  if (roll > 35) return null;

  if (biome === "wetland") {
    return { gx, gy, kind: "reeds", size: 1, frame: 9 };
  }
  if (biome === "highland") {
    return roll % 2 === 0 ? { gx, gy, kind: "bush", size: 1, frame: 2 } : null;
  }
  if (roll < 20) {
    return { gx, gy, kind: "tree", size: 1, frame: 3 };
  }
  return { gx, gy, kind: "bush", size: 1, frame: 2 };
}
