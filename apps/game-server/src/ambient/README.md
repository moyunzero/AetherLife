# Ambient NPC 运行时参数

Phase 16 权威 ambient 逻辑：`schedule.ts`（日程）→ `tick.ts`（6s tick）→ `zone-wander.ts`（选目标格）→ `move.ts`（最多 1 格步进）。**tick 内禁止 LLM/HTTP**（LIFE-03）。

设计参考：动森 / 星露谷 —— 主 NPC 有日程，但在「干活」时段也会在工位附近小范围挪动，而不是整段站桩到换班。

---

## 时钟与 tick

| 参数 | 位置 | 默认值 | 含义 |
|------|------|--------|------|
| `AMBIENT_MS` | `colyseus/GameRoom.ts` | `6000` | Colyseus simulation interval（毫秒）。每 tick：`gameMinute += 1`，并对每名 eligible NPC 最多走 **1 格**。 |
| `gameMinute` | `GameRoomState` | 普通房间 `360`（06:00）；`verify-p16-*` 房间 `479` | 游戏内分钟 `[0, 1439]`，1440 = 24h。每 ambient tick +1 并 `% 1440`。HUD 时钟由此推导。 |
| 实机 ↔ 游戏时间 | — | 1 tick ≈ 6s 实机 | 约 **10 tick/分钟实机** → 5 分钟实机 ≈ 50 游戏分钟。 |

---

## 日程段（`ScheduleSegment`）

定义见 [`data/schedules/README.md`](../../data/schedules/README.md) 与 `data/schedules/schema.json`。

| 字段 | 含义 |
|------|------|
| `fromMinute` / `toMinute` | 半开区间 `[from, to)`；`to < from` 表示跨午夜（如 22:00→06:00）。 |
| `activityKey` | HUD / 铭牌活动文案（如 `reading`、`patrol`）。未知 key 加载时降为 `idle`。 |
| `zoneId` | 命名空间 zone，形如 `beginning-fields@v1:home`（全图）或 `…:orchard` / `plaza` / `pond`。 wander/linger 只在该矩形内选格（碰撞过滤）。 |
| `mobility` | 移动模式，见下表。 |

### `mobility` 与移动行为

走步资格（Phase **26.2 gap / 动森式**）：每人持有 **walking | pausing** 状态——到达目标后停 **2–8** tick，再抽新目标；走路期间每 tick 最多 1 格（不每分钟重抽目标）。`shouldStepThisTick` / `stepPercentForMobility` 仍导出供历史断言；主路径以 walk/pause 为准。**同 tick 可多名 NPC 移动**。仅 `resting` 经上游 `shouldSkipMovement` 完全跳过。

| 值 | 选目标策略 | 是否每 tick 都动 |
|----|------------|------------------|
| `wander` | 在 `zoneId` 内选可走格（避开占用格，偏好个人空间 ≥2）；社交段见下方 bias | walking 时每 tick 尝试步进；到达后 pausing 2–8 tick |
| `stationary` | **Linger**：当前位置 Chebyshev **≤ `LINGER_RADIUS`**；若在 zone 外则 **通勤到最近 zone 格** | 同上 + linger 本地 `LINGER_PAUSE_PERCENT` |
| `poi` | 优先走向区域内 **social POI**（若未占用）；否则同 linger / zone pick | 同上 |

### 完全不移动的 activity

`shouldSkipMovement(segment)` 为真时 **本 tick 不调用** `pickZoneTarget`：

| 条件 | 说明 |
|------|------|
| `activityKey === "resting"` | 睡觉段（如午夜–06:00） |

日程里的「发呆」请用 `wandering` + `wander`（26.2 gap：原 `idle` 段已并进 wander）。未知 `activityKey` 仍会 coerce 为标签 `idle`，但**不再**因此跳过移动。

---

## Linger  tunables（动森 / 星露谷式微动）

定义：`zone-wander.ts`

| 参数 | 导出 | 默认 | 含义 |
|------|------|------|------|
| `LINGER_RADIUS` | 是 | `2` | Chebyshev 距离（格）。`stationary` / `poi` 在 zone 内时，目标格必须在 NPC 当前位置 **≤ 此半径** 内。 |
| `LINGER_PAUSE_PERCENT` | 是 | `15` | linger 选目标时额外原地概率（%）。哈希键：`linger:{npcId}:{gameMinute}`。 |
| `PERSONAL_SPACE` | 是 | `2` | 选目标时优先与其他 NPC 至少此距离；**永不叠格**（有空闲格时排除占用/本 tick 已预约格）；擦肩路过允许。 |
| `MAX_RECENT` | 否 | `8` | 最近访问格 deque 长度，避免 linger/wander 在 2–3 格间来回抖。 |

Walk/pause（`tick.ts`）：

| 参数 | 默认 | 含义 |
|------|------|------|
| `WALK_TIMEOUT_TICKS` | `48` | 走路超时强制重抽目标（防卡死） |
| `ambientPauseTicks` | 2–8 | 到达后停顿时长（hash `ambient-pause:{npcId}:{gameMinute}`） |

---

## Wander 社交软 bias

| 参数 | 默认 | 含义 |
|------|------|------|
| `SOCIAL_BIAS_DISTANCE` | `3` | 玩家与 NPC Chebyshev ≤ 此值时，才可能触发社交 bias。 |
| `SOCIAL_BIAS_ACTIVITIES` | `socializing`, `patrol` | 仅这些 activity + `mobility === "wander"` 时，优先选 **与玩家相邻（距离 1）** 的可走格。 |

---

## NPC 分层

| 类型 | ID 模式 | 移动来源 |
|------|---------|----------|
| 主 NPC | `npc-1`…`npc-12`（议会 12 席） | `data/schedules/npc-*.json` + 可选 worker **intent cache** |
| 背景 NPC | `bg-villager-*` | 合成段 `backgroundWanderSegment`：恒 `mobility: wander`，`activityKey: wandering` |

主 NPC 在 `npcSpeakJobs` 中有 job 时 **整 tick 跳过**（对话优先）。

---

## Worker intent（Wave 2，非 tick 热路径）

| 概念 | 含义 |
|------|------|
| `intent-cache` | room 内 per-NPC 目标/zone + `reasonZh` + `untilGameMinute` |
| `target` intent | 直接走向 `(gx, gy)` |
| `zone` intent | 在指定 `zoneId` 内 wander（覆盖 schedule zone） |
| `join_vicinity` | speak 前后 NPC 朝玩家邻格靠拢（`tick.ts` `pickJoinVicinityTarget`），与 linger 独立 |

---

## 调参建议

| 诉求 | 调整 |
|------|------|
| 主 NPC 早上更像在干活而非巡逻 | 保持 `stationary` + 略减 `LINGER_RADIUS`（1–2） |
| 更「活人感」、少站桩 | 略增 `LINGER_RADIUS` 或略减 `LINGER_PAUSE_PERCENT` |
| 更快看到大范围 patrol | 改 schedule 边界或 dev 默认 `gameMinute`（仅影响新房间） |
| E2E 测 segment 切换 | `verify-p16-*` 房间已从 `479` 起算，便于 1–2 tick 内进 `patrol` |

---

## 验证

```bash
pnpm --filter @aetherlife/game-server test -- src/ambient/
pnpm agent:verify
# 实机：pnpm dev:stack → 06:00 进房，观察议会席在 reading/cooking 段内 linger 微动（B2 多 NPC 同 tick）
```
