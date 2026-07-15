# NPC  persona 日程（`npc-1.json` … `npc-3.json`）

JSON Schema：[`schema.json`](./schema.json)

加载：`apps/game-server/src/ambient/schedule.ts`（进程启动时读入，最多 **48** 段 / NPC）。

---

## 文件顶层

| 字段 | 类型 | 含义 |
|------|------|------|
| `npcId` | `"npc-1"` \| `"npc-2"` \| `"npc-3"` | 与 Colyseus `map.npcs[].id` 一致 |
| `persona` | string | 人格标签（worker / 文案用），如 `scholar`、`farmer`、`chef` |
| `segments` | array | 按游戏日划分的活动段，见下 |

---

## `segments[]` 每一段

| 字段 | 类型 | 含义 |
|------|------|------|
| `fromMinute` | 0–1439 | 段开始（含）。`360` = 06:00 |
| `toMinute` | 0–1439 | 段结束（**不含**）。`480` = 08:00 |
| `activityKey` | enum | 活动 ID → 中文 HUD 由 `@aetherlife/shared` `npcActivity` 映射 |
| `zoneId` | string | `{regionId}:{localZoneId}`，如 `beginning-fields@v1:home`（全图闲逛）或 `…:orchard` / `plaza` / `pond` |
| `mobility` | `"wander"` \| `"stationary"` \| `"poi"` | 本段内如何选移动目标（见下） |

### 时间示例

| fromMinute | 时钟 |
|------------|------|
| 0 | 00:00 |
| 360 | 06:00 |
| 480 | 08:00 |
| 720 | 12:00 |
| 1080 | 18:00 |
| 1200 | 20:00 |

跨午夜：`fromMinute: 1200, toMinute: 360` → 20:00 到次日 06:00。

---

## `activityKey` 一览

| Key | 典型场景 |
|-----|----------|
| `resting` | 睡觉 — **不移动**（`shouldSkipMovement`） |
| `idle` | 无日程 / 非法 key 降级标签；**不再**跳过移动（日程发呆请用 `wandering` + `wander`） |
| `reading` | 晨读、学习 |
| `tending_crops` | 农田劳作 |
| `watering` | 浇水 |
| `chopping_wood` | 伐木 |
| `cooking` | 烹饪 |
| `fishing` | 钓鱼 |
| `patrol` | 区域巡逻（常配 `wander`） |
| `socializing` | 社交（常配 `wander` 或 `poi`） |
| `wandering` | 闲逛（原 idle 段并进此项） |
| `unknown` | Schema 占位；运行时应被 `validateActivityKey` 转为 `idle` |

---

## `mobility` 与运行时（与 schedule 解耦的引擎行为）

引擎实现：[`src/ambient/zone-wander.ts`](../../src/ambient/zone-wander.ts)、[`src/ambient/README.md`](../../src/ambient/README.md)。

| mobility | 设计意图 | 运行时行为 |
|----------|----------|------------|
| `wander` | 在本 zone 内走动、巡逻 | 在 zone 矩形内随机选可走格；玩家靠近时社交 activity 可 bias 到玩家邻格 |
| `stationary` | **人在工位干活**（动森/星露谷） | **Linger 微 wander**：默认半径 **2 格**，约 **70%** tick 会尝试挪一步，**30%** tick 原地停 |
| `poi` | 去固定兴趣点（井、广场） | 优先 path 到 social POI；到达或不可达时 fallback 为与 `stationary` 相同的 linger |

**历史变更（Phase 16 UAT 后）：** 旧版 `stationary` = 完全不动；现改为 linger，避免晨间长段「三个主 NPC 站桩、只有背景村民在动」。

---

## `zoneId` 命名

格式：`{regionId}:{localId}`

- `regionId`：如 `beginning-fields@v1`（含版本，便于换图）
- `localId`：registry 内 zone，如 `home`（全图）、`orchard`、`pond`、`plaza`

zone 矩形来自 `apps/game-server/data/world/.../zones.json`（经 WorldRegistry 加载；与 `packages/shared` `defaultBeginningFieldsBundle` 双 SSOT）。

动森风格：白天主段用 `mobility: wander` + `zoneId: …:home` 逛整张可走区；短时 `stationary`/`poi` 绑定人物专属场点（果园/广场/池塘）。

---

## 编辑 checklist

1. 改 JSON 后跑 `pnpm --filter @aetherlife/game-server test -- src/ambient/schedule.test.ts`
2. 段边界不要重叠（同一分钟只应命中一段）
3. `resting` 才完全不移动；发呆请用 `wandering` + `wander`
4. 新 activity 需同步 `@aetherlife/shared` `NPC_ACTIVITY_KEYS` 与 `schema.json` enum
5. 改 zones 须同步 `zones.json` 与 `defaultBeginningFieldsBundle`
