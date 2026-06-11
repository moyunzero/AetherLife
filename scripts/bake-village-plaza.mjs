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

/**
 * Create a flat array representing a width×height grid filled with zeros.
 *
 * @param {number} width - Number of columns in the grid.
 * @param {number} height - Number of rows in the grid.
 * @returns {number[]} An array of length width * height where every element is 0.
 */
function emptyCells(width, height) {
  return Array.from({ length: width * height }, () => 0);
}

/**
 * Generate a collision grid for the plaza: interior tiles open; perimeter tiles blocked except the west transition rows.
 * @param {number} width - Map width in tiles.
 * @param {number} height - Map height in tiles.
 * @returns {{width: number, height: number, cells: number[], source: string}} An object containing the grid dimensions, a flat array of cells where `1` indicates a blocked tile and `0` an open tile, and `source` set to `"generated-plaza"`.
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

/**
 * Open the eastmost column of the beginning-fields collision grid for the configured transition rows (陆桥).
 *
 * Reads the collision JSON at the given path, sets the east-edge cell (x = grid.width - 1) to 0 for each row in TRANSITION_ROWS, and writes the updated grid back with pretty formatting.
 *
 * @param {string} collisionPath - File system path to the collision JSON to modify; no action is taken if the file does not exist.
 */
function carveBeginningFieldsEastBridge(collisionPath) {
  if (!existsSync(collisionPath)) return;
  const grid = JSON.parse(readFileSync(collisionPath, "utf8"));
  for (const ly of TRANSITION_ROWS) {
    grid.cells[ly * grid.width + (grid.width - 1)] = 0;
  }
  writeFileSync(collisionPath, JSON.stringify(grid, null, 2));
}

/**
 * Builds a minimal Tiled-format map object containing a visible ground layer and a hidden collision layer.
 *
 * The collision layer is derived from `collisionCells`: values equal to `1` are converted to tile ID `2` (blocked),
 * and other values become `0` (empty).
 *
 * @param {number} width - Map width in tiles.
 * @param {number} height - Map height in tiles.
 * @param {number[]} collisionCells - Flat array of length `width * height` where `1` marks a blocked cell and `0` marks an open cell.
 * @returns {Object} A Tiled map JSON object with tileset metadata and two tile layers ("Ground" and "Collision"); the "Ground" layer is filled, and the "Collision" layer encodes blocked cells as tile ID `2`.
 */
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

/**
 * Generate plaza collision and a minimal Tiled map for village-plaza@v1, update the beginning-fields east-bridge collision, and write outputs to server and public directories.
 *
 * Creates the plaza collision grid, writes identical `collision.json` files for the game server and web public folders, builds and writes a Tiled-format `v1.json` map, applies the east-bridge carve to beginning-fields collision files (server and public), and logs the file paths and a blocked-cell summary.
 */
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
