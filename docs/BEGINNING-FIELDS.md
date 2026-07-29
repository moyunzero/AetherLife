# Beginning Fields — home Tiled 地图

Fan-tasy **Beginning Fields**（40×40 @ 16px Tiled → 游戏内 **32px/格**，16×2 整数缩放）由 `HomeMapBackground` 渲染。Plan A：home 区内 **仅 Tiled 层**，`RoomScene` 跳过程序化 floor/decor。

Web agent 摘要：[apps/web/AGENTS.md](../apps/web/AGENTS.md) · 回归 ISSUE-042 · Guardrails #63–#65、#106–#107 in [ISSUE-LOG.md](./ISSUE-LOG.md).

---

## 角色视觉（产品决策 · 2026-07）

| 决策 | 内容 |
|------|------|
| **显示格** | `CELL_PX = 32`（`gridLayout.ts`）；瓦片 16px 源图 ×2 |
| **角色身高** | `CHAR_DISPLAY_PX = 64`（占 **2 逻辑格**；脚底仍锚在格心南缘） |
| **全员 LPC** | **所有玩家** + **`npc-1`…`npc-12`** 使用烘焙 LPC 皮 `sprites/lpc-player-1.png` + `sprites/lpc-npc-{1…12}.png`（walk + idle）；**不再**用 `sprites/characters.png` 的 Stardew 四色 palette 区分玩家 |
| **资源管线** | 源图 `npc-asset/player-1.png` + `npc-asset/npc-{1…12}.png` → `pnpm assets:sync:lpc-npcs` → `public/assets/sprites/lpc-*.png` |
| **运行时** | `lpcNpc1Sheet.ts` + `entitySprites.ts`（`registerLpcNpcAnims` · `createLpcNpcSprite`）；`useSpriteEntities()` 门槛：`spritesLpcNpc1` + `spritesNpcs`（全部 `lpc-npc-*` 随 `CORE_AREA_ASSETS` 同批加载） |
| **铭牌** | 宋体（`Noto Serif SC`）、无描边/无底条、轻投影；名字/状态垂直堆叠见 `sceneLabelLayout.ts` |

**回归：** `pnpm --filter @aetherlife/web test` · `pnpm verify:phase13` · `pnpm verify:phase6:move-only`（改 `RoomScene` / 实体 sprite 时）

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
| `apps/web/src/game/HomeMapBackground.ts` | Object layer 手动 sprite；**Object Shadows** 归入 Phaser `Layer`（`MULTIPLY`）；**禁止** `createFromObjects` 替代 collection 路径 |

---

## Y-sort（depth）

统一用 `entityLayout.ts` 的 `ySortDepth` / `entityYSortDepth` / `tiledObjectYSortDepth`。

| 带 | depth | 说明 |
|----|-------|------|
| 瓦片层 | `MAP_TILE_DEPTH_BASE` 起按 Tiled 顺序递增 | Ground … Shadows … Water |
| **Object Shadows** | 插入 Tiled 图层序（Shadows 瓦片后、Water 前） | Phaser 4 `Layer`；`MULTIPLY` + α=0.25；**不参与** Y-sort |
| Object Layer 1 | `ENTITY_DEPTH_BASE` + Y-sort | `tiledObjectYSortDepth` |
| 玩家 / NPC | 同上 + `YSORT_LAYER` | `entityYSortDepth` |

- Tiled tile object（Object Layer 1）：**左下角** 锚点
- 玩家 / NPC：**格心 X + 格南缘 Y**（与 sprite 脚底一致）
- **Campfire 等 volume tileset**（`VOLUME_CLUSTER_TILESETS`）：相邻 tile object 共用**最南底边** sort Y，避免北侧火焰被 PLAYER 层盖住
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

**决策（2026-06-30 v3）：** 12 议员锚点分布于全图（西北 x=5 → 东南 x=33），避免同屏聚团与占格堵路。所有点须可走（collision=0），任意两点 Chebyshev ≥3。最初 `maxRadius: 0` 钉死锚点防 ambient 聚团。

**修订（Phase 26.2 · 2026-07-15 · A3）：** 全 12 议会席位统一 `maxRadius: 40`（zone 漫游为主；soft leash 仅防卡死/出界，半径大于最远锚点→角点 Chebyshev≈34）。`maxRadius===0` 仍表示钉死。决策 SSOT：`.planning/phases/26.2-world-alive-wander/26.2-CONTEXT.md`（D-19…D-25）。`shuffleCouncilSpawnAssignments(roomId)` 将 12 槽位随机映射到 npc-1…12。

**SSOT：** `apps/game-server/data/world/beginning-fields@v1/spawns.json` → `councilSpawns[]`（本地格 lx/ly，经 `getCouncilSpawnSlots` 转全局 gx/gy）；镜像 `packages/shared` `defaultBeginningFieldsBundle`（双 SSOT 须同步，见 `council-spawn-radius.test.ts`）。

| 槽序 | 锚点 (x,y) | facing | 区域标签 | maxRadius (26.2) |
|------|------------|--------|----------|------------------|
| 0 | 9, 21 | s | west-path | 40 |
| 1 | 9, 5 | s | woodland | 40 |
| 2 | 23, 11 | e | orchard | 40 |
| 3 | 31, 13 | w | plaza | 40 |
| 4 | 17, 13 | e | central | 40 |
| 5 | 33, 28 | n | pond | 40 |
| 6 | 20, 26 | s | pond | 40 |
| 7 | 16, 31 | n | shore | 40 |
| 8 | 27, 27 | w | pond | 40 |
| 9 | 29, 17 | s | plaza | 40 |
| 10 | 5, 9 | e | woodland | 40 |
| 11 | 17, 22 | s | west-central | 40 |

**约束：** 全点 collision 可走；与玩家默认 spawn (34,13) Chebyshev ≥3；任意两点 ≥3；x 跨度 ≥20、y 跨度 ≥20（见 `region-walkability.test.ts`）；`maxRadius` 全席 40（`===0` 仍钉死）。

---

## Ambient zones（NPC 日程选目标矩形）

双 SSOT：`apps/game-server/data/world/beginning-fields@v1/zones.json` ↔ `packages/shared` `defaultBeginningFieldsBundle`。

| localId | 中文 | 全局格范围 (含起不含终) | 用途 |
|---------|------|-------------------------|------|
| `home` | 起始田野（全图） | (0,0)–(39,39) | 白天 `wander` 主段：可在整张 home **可走格**闲逛 |
| `orchard` | 果园 | (18,6)–(29,15) | 劳作 / 晨读等短时 linger |
| `plaza` | 村口广场 | (28,8)–(39,19) | 社交 / POI（井） |
| `pond` | 池塘 | (22,22)–(35,33) | 钓鱼 / 休整 |

**调试可视化：** `http://localhost:5173/?gridDebug=1` 叠加着色 zone 框 + 标签；悬停格 HUD 显示所属 zone。

**日程约定：** 长漫游用 `…:home` + `wander`；人物定位用短 `stationary`/`poi` 绑 orchard/plaza/pond；睡觉用 `resting`。
