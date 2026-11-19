# 玩法家族 — 横改时读哪些文件

同类玩法共享 UI / 阶段模型。改「倒计时、撤注、路单、出牌条」时，**按家族扫**，不要只改一款漏其它。

## live-bet（百人下注）

| gameId | 插件 | 前端 |
| --- | --- | --- |
| tuizhuanzi | `games/tuizhuanzi` | `Tuizhuanzi.tsx` |
| dice | `games/dice` | `Dice.tsx` |
| baccarat | `games/baccarat` | `Baccarat.tsx` |
| niuniu | `games/niuniu` | `Niuniu.tsx` |
| blackjack | `games/blackjack` | `Blackjack.tsx` |

共同点：`phase` 时间轴、`bet`/`clear`、平台常驻房、`persistent`、倒计时与路单。  
共享下注限额：`packages/game-sdk/src/betting.ts`。

## trick（出牌压制）

| gameId | 插件 | 前端 |
| --- | --- | --- |
| doudizhu | `games/doudizhu` | **CardTable.tsx** |
| paodekuai | `games/paodekuai` | **CardTable.tsx** |

差异在插件牌型与首出规则；UI 共用。

## showdown（摊牌比大小）

| gameId | 插件 | 前端 |
| --- | --- | --- |
| goldenflower | `games/goldenflower` | **ShowdownTable.tsx** |
| stud | `games/stud` | **ShowdownTable.tsx** |

## texas

单独：`games/texas` + `Texas.tsx`（底池 / 街 / 边池逻辑特殊）。

## board

| gameId | 插件 | 前端 |
| --- | --- | --- |
| gomoku | `games/gomoku` | `Gomoku.tsx` |
| chess | `games/chess` | **BoardGame.tsx** (`variant=chess`) |
| xiangqi | `games/xiangqi` | **BoardGame.tsx** (`variant=xiangqi`) |

## mahjong

五变体：**一个**服务端文件 `services/games/cs-mahjong/src/index.ts` + **一个**前端 `CsMahjong.tsx`。  
改某变体：先跳到文件顶部目录 → 对应 `*MahjongPlugin` 类。

## slots

大厅顶栏入口；摇奖服务端权威偏 API `slots-engine`；另有 `@cc/game-slots` 插件。改赔率/配置先看 API 与 GM「老虎机经营」。
