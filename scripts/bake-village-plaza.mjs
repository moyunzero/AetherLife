/**
 * Bake village-plaza@v1 collision + minimal Tiled map (Wave 4).
 * Outputs game-server data + web public collision + maps/village-plaza/v1.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAP_W = 20;
const MAP_H = 40;
const TRANSITION_ROWS = [18, 19, 20, 21, 22];

/** @param {number} width @param {number} height */
function emptyCells(width, height) {
  return Array.from({ length: width * height }, () => 0);
}

/**
 * Plaza collision: open interior; perimeter blocked except west transition strip (陆桥).
 * @param {number} width
 * @param {number} height
 */
function bakePlazaCollision(width, height) {
  const cells = emptyCells(width, height);
  for (let ly = 0; ly < height; ly += 1) {
    for (let lx = 0; lx < width; lx += 1) {
      const edge =
        ly === 0 ||
        ly === height - 1 ||
        lx === width - 1 ||
        (lx === 0 && !TRANSITION_ROWS.includes(ly));
      if (edge) cells[ly * width + lx] = 1;
    }
  }
  return { width, height, cells, source: "generated-plaza" };
}

/** Carve beginning-fields east edge (x=39) for 陆桥 rows. */
function carveBeginningFieldsEastBridge(collisionPath) {
  if (!existsSync(collisionPath)) return;
  const grid = JSON.parse(readFileSync(collisionPath, "utf8"));
  for (const ly of TRANSITION_ROWS) {
    grid.cells[ly * grid.width + (grid.width - 1)] = 0;
  }
  writeFileSync(collisionPath, JSON.stringify(grid, null, 2));
}

/** @param {number} width @param {number} height @param {number[]} collisionCells */
function buildTiledMap(width, height, collisionCells) {
  const ground = Array.from({ length: width * height }, () => 1);
  const collision = collisionCells.map((c) => (c === 1 ? 2 : 0));
  return {
    compressionlevel: -1,
    height,
    width,
    infinite: false,
    orientation: "orthogonal",
    renderorder: "right-down",
    tiledversion: "1.11.0",
    tileheight: 16,
    tilewidth: 16,
    type: "map",
    version: "1.10",
    tilesets: [
      {
        columns: 2,
        firstgid: 1,
        image: "plaza-tiles.png",
        imageheight: 16,
        imagewidth: 32,
        margin: 0,
        name: "plaza-tiles",
        spacing: 0,
        tilecount: 2,
        tilewidth: 16,
        tileheight: 16,
      },
    ],
    layers: [
      {
        data: ground,
        height,
        id: 1,
        name: "Ground",
        opacity: 1,
        type: "tilelayer",
        visible: true,
        width,
        x: 0,
        y: 0,
      },
      {
        data: collision,
        height,
        id: 2,
        name: "Collision",
        opacity: 1,
        type: "tilelayer",
        visible: false,
        width,
        x: 0,
        y: 0,
      },
    ],
  };
}

function main() {
  const collision = bakePlazaCollision(MAP_W, MAP_H);
  const serverDir = join(root, "apps/game-server/data/world/village-plaza@v1");
  const publicCollisionDir = join(root, "apps/web/public/world/village-plaza");
  const mapOut = join(root, "apps/web/public/maps/village-plaza/v1.json");
  const bfCollision = join(
    root,
    "apps/game-server/data/world/beginning-fields@v1/collision.json",
  );
  const bfPublicCollision = join(
    root,
    "apps/web/public/world/beginning-fields/collision.json",
  );

  mkdirSync(serverDir, { recursive: true });
  mkdirSync(publicCollisionDir, { recursive: true });
  mkdirSync(dirname(mapOut), { recursive: true });

  writeFileSync(join(serverDir, "collision.json"), JSON.stringify(collision, null, 2));
  writeFileSync(join(publicCollisionDir, "collision.json"), JSON.stringify(collision, null, 2));
  writeFileSync(mapOut, JSON.stringify(buildTiledMap(MAP_W, MAP_H, collision.cells), null, 2));

  carveBeginningFieldsEastBridge(bfCollision);
  carveBeginningFieldsEastBridge(bfPublicCollision);

  const blocked = collision.cells.filter((c) => c === 1).length;
  console.log(`Wrote ${join(serverDir, "collision.json")} (${blocked} blocked, source=${collision.source})`);
  console.log(`Wrote ${mapOut}`);
  console.log(`Carved BF east 陆桥 rows ${TRANSITION_ROWS.join(",")} in beginning-fields collision`);
}

main();
