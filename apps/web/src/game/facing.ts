/** Cardinal facing for Stardew-style 4-way sprites (D-10). */
export type CardinalFacing = "down" | "up" | "left" | "right";

export const FACING_ORDER: CardinalFacing[] = ["down", "left", "right", "up"];

export function facingToIndex(facing: CardinalFacing): number {
  return FACING_ORDER.indexOf(facing);
}

/** Dominant-axis snap for diagonal steps — never blend diagonals in anim keys. */
export function cardinalFacingFromDelta(dx: number, dy: number): CardinalFacing {
  if (dx === 0 && dy === 0) return "down";
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? "right" : "left";
  }
  return dy > 0 ? "down" : "up";
}

export function snapDiagonalToCardinal(dx: number, dy: number): CardinalFacing {
  return cardinalFacingFromDelta(dx, dy);
}

export function schemaFacingToCardinal(facing: string): CardinalFacing {
  switch (facing) {
    case "up":
    case "north":
      return "up";
    case "left":
    case "west":
      return "left";
    case "right":
    case "east":
      return "right";
    default:
      return "down";
  }
}
