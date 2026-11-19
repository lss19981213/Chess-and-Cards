# GAME_MAP — gameId → 源码路径

权威规则在 **插件包**；大厅展示名默认以插件 `meta.name` / 前端 `game-registry` 为准。

**冒烟**：`GAME_ID=<gameId或中文别名> pnpm smoke:games`（PowerShell 先 `$env:GAME_ID='...'`）

## 全表

| gameId | 中文 / 别名 | 插件包目录 | 服务端入口 | 前端组件 | Room.tsx | family | CSS 提示（styles.css） |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `tuizhuanzi` | 推筒子 | `services/games/tuizhuanzi` | `src/index.ts` | `games/Tuizhuanzi.tsx` | `tuizhuanzi` | live-bet | `推筒子` ~1370、~5775；下注类 ~2625 |
| `dice` | 骰宝 | `services/games/dice` | `src/index.ts` | `games/Dice.tsx` | `dice` | live-bet | `骰宝` ~5062；下注类 ~2625 |
| `baccarat` | 百家乐 | `services/games/baccarat` | `src/index.ts` | `games/Baccarat.tsx` | `baccarat` | live-bet | `百家乐` ~4793 |
| `blackjack` | 21点 / 黑杰克 | `services/games/blackjack` | `src/index.ts` | `games/Blackjack.tsx` | `blackjack` | live-bet | `21 点` ~6410；theme 也有「21点与牛牛」 |
| `niuniu` | 斗牛 / 牛牛 | `services/games/niuniu` | `src/index.ts` | `games/Niuniu.tsx` | `niuniu` | live-bet | 大号展台 ~14640；theme「牛牛专用」 |
| `doudizhu` | 斗地主 | `services/games/doudizhu` | `src/index.ts` | **共用** `games/CardTable.tsx` | `doudizhu` | trick | 扑克大牌面 ~14464；斗地主出牌 ~14618 |
| `paodekuai` | 跑得快 | `services/games/paodekuai` | `src/index.ts` | **共用** `CardTable.tsx` | `paodekuai` | trick | 同上 |
| `texas` | 德州扑克 / 德州 | `services/games/texas` | `src/index.ts` | `games/Texas.tsx` | `texas` | texas | `德州` ~1512、~4935、~5807 |
| `stud` | 梭哈 | `services/games/stud` | `src/index.ts` | **共用** `ShowdownTable.tsx` | `stud` | showdown | `梭哈 / 翻金花` ~6329 |
| `goldenflower` | 翻金花 / 扎金花（**无 zhajinhua**） | `services/games/goldenflower` | `src/index.ts` | **共用** `ShowdownTable.tsx` | `goldenflower` | showdown | 同上 |
| `cs-mahjong` | 长沙麻将 | `services/games/cs-mahjong` | `CsMahjongPlugin` ~2429 | **共用** `CsMahjong.tsx` | `cs-mahjong` | mahjong | 搜 mahjong / 麻将 class；规则在插件 |
| `sc-mahjong` | 四川血战 | 同上包 | `ScMahjongPlugin` ~2463 | `CsMahjong.tsx` | `sc-mahjong` | mahjong | 同上 |
| `gd-mahjong` | 广东推倒胡 | 同上包 | `GdMahjongPlugin` ~2497 | `CsMahjong.tsx` | `gd-mahjong` | mahjong | 同上 |
| `guobiao-mahjong` | 国标麻将 | 同上包 | `GuobiaoMahjongPlugin` ~2531 | `CsMahjong.tsx` | `guobiao-mahjong` | mahjong | 同上 |
| `hz-mahjong` | 红中麻将 | 同上包 | `HzMahjongPlugin` ~2565 | `CsMahjong.tsx` | `hz-mahjong` | mahjong | 同上 |
| `gomoku` | 五子棋 | `services/games/gomoku` | `src/index.ts` | `games/Gomoku.tsx` | `gomoku` | board | `五子棋` ~712、~5847 |
| `xiangqi` | 中国象棋 | `services/games/xiangqi` | `src/index.ts` | **共用** `BoardGame.tsx` | `xiangqi` | board | `国际象棋 / 中国象棋` ~6192 |
| `chess` | 国际象棋 | `services/games/chess` | `src/index.ts` | **共用** `BoardGame.tsx` | `chess` | board | 同上 |
| `slots` | 疯狂老虎机 | `services/games/slots`（房间插件）+ API `slots-engine` | 大厅 `LuxurySlotsModal` / `Slots.tsx` | `slots` | slots | 搜 slots；摇奖权威多在 API |

前端路径均相对 `apps/lobby-web/src/`。

## 横切（改结算 / 进房 / 钱包时）

| 关注点 | 路径 |
| --- | --- |
| 房间生命周期 | `services/room-server/src/room.ts` |
| WS / HTTP 入口 | `services/room-server/src/index.ts` |
| 插件发现 / 热更 | `services/room-server/src/plugins.ts` |
| 结算 outbox | `services/room-server/src/settlement.ts` |
| 内部入账 | `apps/api-server/src/routes/admin-internal.ts` → `/internal/settle` |
| 前端进房状态机 | `apps/lobby-web/src/App.tsx` |
| 标题/分类字典 | `apps/lobby-web/src/game-registry.ts` |
| 配图 | `apps/lobby-web/src/assets.ts` → `GAME_ART` |
| 音效 | `apps/lobby-web/src/audio.ts` |

## 包名 ↔ 多 gameId

| npm 包 | 导出的 gameId |
| --- | --- |
| `@cc/game-cs-mahjong` | `cs-mahjong`, `sc-mahjong`, `gd-mahjong`, `guobiao-mahjong`, `hz-mahjong` |
| 其余 `@cc/game-<短名>` | 通常 1:1 |

热更麻将任一族：`bash infra/1panel-game-update.sh @cc/game-cs-mahjong`（同包连带）。
