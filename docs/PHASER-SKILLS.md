# Phaser 4 skills — index & routing

Engine: **Phaser 4** (not v3). Canonical path: `.cursor/skills/<name>/SKILL.md` (28 skills).

**Agent gate:** [`.cursor/rules/phaser-skills.mdc`](../.cursor/rules/phaser-skills.mdc) — before Write/Edit on `apps/web/src/game/**` or `PhaserGame.tsx`:

1. **Read** the matching skill(s) below.
2. **Check latest Phaser 4 official docs** (context7 MCP or docs.phaser.io) for APIs you touch — skills are project conventions, not a docs substitute.

**Does not replace:** [MOVEMENT-ARCHITECTURE.md](./MOVEMENT-ARCHITECTURE.md) · [apps/web/AGENTS.md](../apps/web/AGENTS.md) · root [AGENTS.md](../AGENTS.md).

---

## Skill index

| Skill | 作用 | 典型场景 |
|-------|------|----------|
| [game-setup-and-config](../.cursor/skills/game-setup-and-config/SKILL.md) | `Phaser.Game` / `GameConfig` | `PhaserGame` boot |
| [scenes](../.cursor/skills/scenes/SKILL.md) | Scene 生命周期 | `RoomScene` |
| [loading-assets](../.cursor/skills/loading-assets/SKILL.md) | Loader / preload | 纹理、tilemap |
| [sprites-and-images](../.cursor/skills/sprites-and-images/SKILL.md) | Sprite / Image | 玩家/NPC 标记 |
| [game-object-components](../.cursor/skills/game-object-components/SKILL.md) | Depth, Tint, Mask | `setDepth` |
| [groups-and-containers](../.cursor/skills/groups-and-containers/SKILL.md) | Group / Container | 实体分组 |
| [animations](../.cursor/skills/animations/SKILL.md) | AnimationManager | 行走帧 |
| [tweens](../.cursor/skills/tweens/SKILL.md) | 缓动 / chain | 网格移动 tween |
| [input-keyboard-mouse-touch](../.cursor/skills/input-keyboard-mouse-touch/SKILL.md) | 键盘 / 指针 | WASD、点击 |
| [cameras](../.cursor/skills/cameras/SKILL.md) | 滚动 / 跟随 | 相机跟随玩家 |
| [tilemaps](../.cursor/skills/tilemaps/SKILL.md) | Tiled JSON | 瓦片层 |
| [graphics-and-shapes](../.cursor/skills/graphics-and-shapes/SKILL.md) | Graphics | 调试 overlay |
| [text-and-bitmaptext](../.cursor/skills/text-and-bitmaptext/SKILL.md) | Text | 场景内标签 |
| [geometry-and-math](../.cursor/skills/geometry-and-math/SKILL.md) | Vector2 / 相交 | 格子数学 |
| [curves-and-paths](../.cursor/skills/curves-and-paths/SKILL.md) | Path | 非网格路径 |
| [data-manager](../.cursor/skills/data-manager/SKILL.md) | registry | React ↔ Phaser |
| [events-system](../.cursor/skills/events-system/SKILL.md) | EventEmitter | `off()` 清理 |
| [time-and-timers](../.cursor/skills/time-and-timers/SKILL.md) | delayedCall | 定时 tick |
| [scale-and-responsive](../.cursor/skills/scale-and-responsive/SKILL.md) | ScaleManager | canvas 缩放 |
| [filters-and-postfx](../.cursor/skills/filters-and-postfx/SKILL.md) | v4 Filters | 后期 |
| [render-textures](../.cursor/skills/render-textures/SKILL.md) | RenderTexture | 离屏合成 |
| [particles](../.cursor/skills/particles/SKILL.md) | ParticleEmitter | 特效 |
| [audio-and-sound](../.cursor/skills/audio-and-sound/SKILL.md) | SoundManager | BGM（Phase 9 暂缓） |
| [physics-arcade](../.cursor/skills/physics-arcade/SKILL.md) | Arcade | 慎用 |
| [physics-matter](../.cursor/skills/physics-matter/SKILL.md) | Matter.js | 默认不用 |
| [actions-and-utilities](../.cursor/skills/actions-and-utilities/SKILL.md) | Phaser.Actions | 批量排列 |
| [v4-new-features](../.cursor/skills/v4-new-features/SKILL.md) | v4 新 API | RenderNodes |
| [v3-to-v4-migration](../.cursor/skills/v3-to-v4-migration/SKILL.md) | 迁移清单 | 粘贴 v3 代码时 |

---

## Task routing（本仓库）

| 任务 | 先读 |
|------|------|
| `RoomScene` / 输入 / 移动 | `scenes` + `input-keyboard-mouse-touch` + `tweens` + MOVEMENT-ARCHITECTURE |
| 实体渲染 / 深度 | `sprites-and-images` + `game-object-components` + `cameras` |
| React ↔ Phaser | `data-manager` + `events-system` + apps/web AGENTS |
| Phaser boot / canvas | `game-setup-and-config` + `scale-and-responsive` |
| 资源 / 纹理键 | `loading-assets` + `sprites-and-images` |
| 粘贴 Phaser 3 代码 | `v3-to-v4-migration` + `v4-new-features` |
| Beginning Fields 地图 | `loading-assets` + `tilemaps` + [BEGINNING-FIELDS.md](./BEGINNING-FIELDS.md) |
