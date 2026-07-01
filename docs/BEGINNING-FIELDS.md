# Beginning Fields — home Tiled 地图

Fan-tasy **Beginning Fields**（40×40 @ 16px → 游戏内 48px/grid）由 `HomeMapBackground` 渲染。Plan A：home 区内 **仅 Tiled 层**，`RoomScene` 跳过程序化 floor/decor。

Web agent 摘要：[apps/web/AGENTS.md](../apps/web/AGENTS.md) · 回归 ISSUE-042 · Guardrails #63–#65 in [ISSUE-LOG.md](./ISSUE-LOG.md).

---

## RoomScene 模块（Phase 18）

相机 / 地板 / 输入 / NPC 步进 / 实体同步：

| 模块 | 职责 |
|------|------|
| `roomSceneCamera.ts` | 相机跟随、视口 |
| `roomSceneFloor.ts` | 地板层 |
| `roomSceneInput.ts` | WASD / 点击输入 |
| `roomSceneNpcMotion.ts` | NPC 步进表现 |
| `roomSceneSync.ts` | `syncRoomEntities` + `roomSync` registry 键 |
| `roomSceneTypes.ts` | 共享类型 |
| `RoomScene.ts` | lifecycle + entity factory |

---

## 关键路径与约束

| 路径 | 约束 |
|------|------|
| `scripts/bake-beginning-fields.mjs` | 烘焙 TSX → `public/assets/one-city/` + `oneCityTilesetManifest.ts` |
| `apps/web/src/game/oneCityTilesetManifest.ts` | **自动生成**；atlas = `spritesheet`，collection PNG = `image` |
| `apps/web/src/game/areaLoader.ts` | `queueHomeMapAssets` → `queueAsset`（禁止 atlas 用 `loader.image`） |
| `apps/web/src/game/HomeMapBackground.ts` | Object layer 手动 sprite；**禁止** `createFromObjects` 替代 collection 路径 |

---

## Y-sort（depth）

统一用 `entityLayout.ts` 的 `ySortDepth` / `entityYSortDepth` / `tiledObjectYSortDepth`。

- Tiled tile object：**左下角** 锚点
- 玩家 / NPC：**格心 X + 格南缘 Y**（与 sprite 脚底一致）
- 高大物件（树冠）：将来走 Tiled **Overhead** 层 + `YSORT_OVERHEAD_DEPTH`，不单点 Y-sort

---

## 改地图工作流

**改地图后必跑：**

```bash
# repo root; FANTASY_TILESET_ROOT 指向 Fan-tasy 包根
node scripts/bake-beginning-fields.mjs
```

### 在 Tiled 里加碰撞

home 区走烘焙 **Collision** 层 → `collision.json`（服务端 `region-walkability` + 客户端 `regionCollision.ts`）。NPC / 门 / 其他玩家仍单独挡格。

1. 用 Tiled 打开 Fan-tasy 源图 `Beginning Fields.tmx`（或 `assets/one-city/BeginningFields.json`）。
2. 维护 **Tile Layer** 名称 **`Collision`**（`visible: false` 即可，不渲染）。
3. 在不可走格子上刷 collision marker tile；**空白格 = 可走**。图层 **40×40**，**1 Tiled 格 = 1 游戏格**。
4. 保存 → 同步 `assets/one-city/BeginningFields.json` → `node scripts/bake-beginning-fields.mjs`（输出 `collision.json` 到 game-server + web public）。

Fan-tasy TSX 内自带的 tile `<objectgroup>` 碰撞、Object 层矩形等 **当前烘焙/游戏均不读取**；除非以后扩展 bake，否则改 TSX 碰撞不会进游戏。

---

## 常见故障（ISSUE-042）

atlas 整图加载 → object `setTexture(key, frame)` 无效 → 重复 tile / 无 animation。

**回归：** 实机 home Campfire 单组 2×2 + 动画。

**Skills：** `loading-assets`（spritesheet vs image）、`tilemaps`（tile layer vs object layer）、`sprites-and-images`（frame index）。

---

## 议会 12 席出生点（Phase 26 · 村内多点分散）

**决策（2026-06-30 v3）：** 12 议员锚点分布于全图（西北 x=5 → 东南 x=33），避免同屏聚团与占格堵路。所有点须可走（collision=0），任意两点 Chebyshev ≥3，`maxRadius: 0` 锁定锚点防止 ambient 聚团。`shuffleCouncilSpawnAssignments(roomId)` 将 12 槽位随机映射到 npc-1…12。

**SSOT：** `apps/game-server/data/world/beginning-fields@v1/spawns.json` → `councilSpawns[]`（本地格 lx/ly，经 `getCouncilSpawnSlots` 转全局 gx/gy）。

| 槽序 | 锚点 (x,y) | facing | 区域 |
|------|------------|--------|------|
| 0 | 9, 21 | s | 西侧偏南 |
| 1 | 9, 5 | s | 西北林地 |
| 2 | 23, 11 | e | 中北 |
| 3 | 31, 13 | w | 东北 |
| 4 | 17, 13 | e | 中部 |
| 5 | 33, 28 | n | 东南岸 |
| 6 | 20, 26 | s | 中南 |
| 7 | 16, 31 | n | 西南岸 |
| 8 | 27, 27 | w | 东南路径 |
| 9 | 29, 17 | s | 东侧 |
| 10 | 5, 9 | e | 西北角 |
| 11 | 17, 22 | s | 中西 |

**约束：** 全点 collision 可走；与玩家默认 spawn (34,13) Chebyshev ≥3；任意两点 ≥3；x 跨度 ≥20、y 跨度 ≥20（见 `region-walkability.test.ts`）；`maxRadius: 0`。
