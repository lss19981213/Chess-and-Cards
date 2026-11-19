# Chess & Cards — 给 AI / 开发者的仓库地图

修 bug 时**先读本文件 + [docs/GAME_MAP.md](docs/GAME_MAP.md)**，再打开具体源码。不要从 `styles.css` 全文盲搜开始。

## 30 秒架构

```text
apps/lobby-web          React 大厅 + 牌桌 UI（HTTP + WS）
apps/api-server         Fastify：账号/钱包/任务/GM/内部结算
services/room-server    WS 房间容器：插件发现、排水、热更
services/games/<pkg>    GamePlugin 权威规则（服务端）
packages/protocol       共享类型与消息
packages/game-sdk       GamePlugin 契约 / 牌引擎
packages/auth           JWT
tools/CcGmClient        .NET GM 桌面端
```

本地：`pnpm dev:api` / `dev:room` / `dev:web`  
运维：[docs/运维手册-发布与热更新.md](docs/运维手册-发布与热更新.md)

## 修某游戏 bug：固定打开顺序

1. **[docs/GAME_MAP.md](docs/GAME_MAP.md)** — 查 `gameId` → 插件 / 前端组件 / family / 别名  
2. **插件** `services/games/<pkg>/src/index.ts` — 规则、结算、机器人（权威）  
3. **前端组件** `apps/lobby-web/src/games/<X>.tsx`（或共用 `ShowdownTable` / `CardTable` / `BoardGame` / `CsMahjong`）  
4. **分发** `apps/lobby-web/src/components/Room.tsx` 的 `switch (room.gameId)`  
5. **样式** 先查 GAME_MAP 的 CSS 关键字，再在 `styles.css` / `theme.css` 顶部索引跳转  
6. **冒烟** `GAME_ID=<id> pnpm smoke:games`

## 别名（搜索杀手）

| 你可能搜的 | 真正 gameId | 前端组件 |
| --- | --- | --- |
| 扎金花 / 翻金花 / zhajinhua | `goldenflower` | `ShowdownTable.tsx` |
| 牛牛 / 斗牛 | `niuniu` | `Niuniu.tsx` |
| 21点 / 黑杰克 | `blackjack` | `Blackjack.tsx` |
| 梭哈 | `stud` | `ShowdownTable.tsx` |
| 长沙/四川/广东/国标/红中麻将 | `cs-mahjong` 等 5 个 | 同包 `@cc/game-cs-mahjong` + `CsMahjong.tsx` |

完整表见 GAME_MAP。

## 玩法家族（横改时一次读一族）

见 [docs/GAME_FAMILIES.md](docs/GAME_FAMILIES.md)。

- **live-bet**：推筒子/骰宝/百家乐/斗牛/21点 — 前后端五套近同构  
- **trick**：斗地主/跑得快 → `CardTable`  
- **showdown**：翻金花/梭哈 → `ShowdownTable`  
- **board**：五子棋单独；国际象棋/象棋 → `BoardGame`  
- **mahjong**：五变体一插件文件 + 一前端  
- **slots**：大厅 HTTP `POST /api/slots/spin`，不完全走房间插件 UI

## 前端 gameId 字典（已收敛）

展示名 / 默认分类 / 热度文案 / 底分文案 / 常驻集合：

→ `apps/lobby-web/src/game-registry.ts`  
配图仍在 `apps/lobby-web/src/assets.ts` 的 `GAME_ART`（registry 再导出）。

## 超大文件怎么读

| 文件 | 行数级 | 入口 |
| --- | ---: | --- |
| `apps/lobby-web/src/styles.css` | ~14k | 文件顶部「分区索引」 |
| `apps/lobby-web/src/theme.css` | ~8k | 文件顶部「分区索引」 |
| `services/games/cs-mahjong/src/index.ts` | ~2.4k | 文件顶部「变体目录」；插件类约 2429 行起 |
| `apps/api-server/src/routes/admin-internal.ts` | ~900 | 搜路由字符串 `/api/admin/` |
| `apps/api-server/src/repository/memory.ts` | ~1.3k | 按方法名搜业务 |
| `tools/CcGmClient/MainWindow.xaml.cs` | ~2k | 按 `Btn*_Click` / View 名 |

## 不要当成权威的东西

- `apps/api-server/src/game-catalog.ts`：`FALLBACK_GAMES` 是房间服挂了时的**残缺兜底**，不是完整目录。  
- 大厅分类运行时可被 GM 覆盖；默认 map 在 `game-registry` / `game-categories.ts`。

## 文档索引

| 文档 | 用途 |
| --- | --- |
| [docs/GAME_MAP.md](docs/GAME_MAP.md) | gameId 全表 |
| [docs/GAME_FAMILIES.md](docs/GAME_FAMILIES.md) | 家族与共用 UI |
| [docs/运维手册-发布与热更新.md](docs/运维手册-发布与热更新.md) | 发布 / 热更 |
| [docs/优化方案书-单游戏热更新.md](docs/优化方案书-单游戏热更新.md) | 热更设计 |
| [docs/1panel-deploy.md](docs/1panel-deploy.md) | 首次部署 |
| [AGENTS.md](AGENTS.md) | Cursor Agent 短指令 |
