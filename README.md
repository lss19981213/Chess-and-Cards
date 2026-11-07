# Chess & Cards — 可插拔棋牌娱乐大厅

一套「大厅 + 可插拔游戏」的平台骨架。新增一个棋牌游戏只需实现 `GamePlugin` 接口并注册，大厅与游戏服容器代码无需改动。

## 架构

```
大厅前端 (React)  ──HTTP──▶  大厅 API (Fastify)  ──▶  PostgreSQL / 内存降级
      │                          │
      └─────WebSocket────────────┴──▶  游戏服容器 (ws)  ──▶  游戏插件 (五子棋/斗地主/...)
```

- **服务端权威**：客户端只发意图，合法性校验与结算全部在服务端。
- **进程隔离**：每个游戏独立插件，可独立发版、独立扩容。
- **元数据驱动**：游戏列表入库，大厅动态渲染入口。
- **账务可信**：只追加账本 + 唯一幂等键，杜绝重复入账。

## 目录

```
packages/protocol    前后端共享协议与类型（唯一来源）
packages/game-sdk    GamePlugin 契约与基类
apps/api-server      大厅业务 API（登录 / 游戏列表 / 钱包）
apps/lobby-web       大厅前端
services/room-server WebSocket 游戏服容器
services/games/*     各游戏插件
infra                部署脚本与容器编排
```

## 快速开始

```bash
pnpm install
pnpm dev:api    # http://localhost:8080
pnpm dev:room   # ws://localhost:9000
pnpm dev:web    # http://localhost:5173
```

默认使用内存仓储，无需数据库即可跑通全流程。设置 `DATABASE_URL` 后自动切换 PostgreSQL。

## 新增一个游戏

1. 复制 `services/games/gomoku` 为新目录；
2. 实现 `GamePlugin`（至少 `meta` / `commands` / `onIntent` / `getSnapshot`）；
3. 在 `services/room-server/src/plugins.ts` 注册；
4. 重新构建并部署该游戏服。

## 合规提示

本平台面向**无赌注的休闲竞技**。禁止虚拟币提现、玩家间转让、平台抽水变现等任何形成资金闭环的设计。
正式上线需办理游戏版号、实名认证与防沉迷系统。
