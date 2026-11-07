# Chess & Cards — 可插拔棋牌娱乐大厅

一套「大厅 + 可插拔游戏」的技术示范工程。新增一个棋牌游戏只需实现 `GamePlugin` 接口并注册，大厅与游戏服容器代码无需改动。

> **本项目仅用于技术学习、架构研究与教学演示**，不提供、也不构成任何形式的赌博服务。详见文末[免责声明](#免责声明)。

## 架构

```
大厅前端 (React)  ──HTTP──▶  大厅 API (Fastify)  ──▶  PostgreSQL
      │                          │
      └─────WebSocket────────────┴──▶  游戏服容器 (ws)  ──▶  游戏插件 (五子棋/斗地主/...)
```

- **服务端权威**：客户端只发意图，合法性校验与结算全部在服务端。
- **进程隔离**：每个游戏独立插件，可独立发版、独立扩容。
- **元数据驱动**：游戏列表由游戏服上报，大厅动态渲染入口。
- **账务可信**：只追加账本 + 唯一幂等键，杜绝重复入账。

## 目录

```
packages/protocol    前后端共享协议与类型（唯一来源）
packages/game-sdk    GamePlugin 契约与基类
packages/auth        JWT 签发与校验
apps/api-server      大厅业务 API（登录 / 游戏列表 / 钱包 / 账本）
apps/lobby-web       大厅前端（默认部署在 /lobby/ 子路径）
services/room-server WebSocket 游戏服容器（房间生命周期 / 断线重连 / 结算上报）
services/games/*     各游戏插件，五子棋为参考实现
infra                部署脚本、systemd 单元、nginx 片段
scripts              e2e 冒烟测试与运维小工具
```

## 本地开发

```bash
pnpm install
pnpm dev:api     # http://localhost:8080
pnpm dev:room    # ws://localhost:9000
pnpm dev:web     # http://localhost:5173/lobby/
```

未配置 `DATABASE_URL` 时使用内存仓储，无需数据库即可跑通全流程；配置后自动切换 PostgreSQL。

端到端冒烟测试（需先启动 api 与 room）：

```bash
pnpm e2e

# 指向任意已部署环境
API_BASE=https://example.com/lobby \
WS_BASE=wss://example.com/lobby/ws \
pnpm e2e
```

## 部署

目标环境：Ubuntu 20.04+ / Node 20+ / PostgreSQL 14+ / nginx。

### 首次初始化（只需一次）

```bash
bash infra/setup-server.sh <数据库密码>   # swap / pnpm / PostgreSQL / 应用目录
cp infra/.env.example .env               # 填写随机密钥与 DATABASE_URL
bash infra/deploy.sh
```

### 日常更新

```bash
git archive --format=tar.gz -o deploy.tar.gz HEAD
# 上传并解压到目标目录后：
bash infra/deploy.sh
```

`deploy.sh` 会依次完成：安装依赖 → 构建前端 → 重启 systemd 服务 → 刷新 nginx 片段，全程幂等。

### 与同机其他站点共存

若目标机器的 80 端口已被其他站点占用，无需抢占端口。`infra/nginx-lobby.conf` 是一段可 `include` 到任意 `server` 块中的片段：

| 路径 | 去向 |
| --- | --- |
| `/lobby/` | 前端静态资源 (`apps/lobby-web/dist`) |
| `/lobby/api/` | 大厅 API `127.0.0.1:8080` |
| `/lobby/ws` | 游戏服 WebSocket `127.0.0.1:9000` |

`deploy.sh` 会自动备份被修改的站点配置为 `.bak.<时间戳>`。若需独立域名或独立端口，把该片段拆成完整 `server` 块即可。

### 服务管理

```bash
sudo systemctl status cc-api cc-room
sudo journalctl -u cc-room -f
```

## 新增一个游戏

1. 复制 `services/games/gomoku` 为新目录；
2. 实现 `GamePlugin`（至少 `meta` / `commands` / `onIntent` / `getSnapshot`）；
3. 在 `services/room-server/src/plugins.ts` 注册一行；
4. 前端在 `apps/lobby-web/src/games/` 增加对应渲染组件，并在 `Room.tsx` 中分发；
5. 重新构建部署。

容器会校验插件 `apiVersion`，不兼容时拒绝加载，避免协议漂移。

## 安全建议

- `.env` 已被 `.gitignore` 排除，**不要**把真实密钥、数据库密码、服务器地址提交进仓库或写进文档。
- `JWT_SECRET`、`INTERNAL_KEY` 必须使用随机值，禁止复用 `.env.example` 中的占位符。
- 建议服务器仅允许 SSH 密钥登录，关闭密码登录；数据库账号限制来源为本地回环。
- 对外暴露前配置 HTTPS，WebSocket 随之走 `wss://`。
- 定期轮换密钥；发现泄漏立即更换并强制所有会话重新登录。

## 合规提示

本平台面向**无赌注的休闲竞技**。以下红线属于硬性要求，不是可选项：

- 禁止任何形成资金闭环的设计：虚拟币提现、玩家间转让、平台抽水变现、兑换实物或等价物。
- 虚拟积分仅用于记分，无任何货币价值，不可购买、不可兑换。
- 正式对外运营需依法办理游戏出版物号（版号）、ICP 备案、实名认证与防沉迷系统。
- 未成年人保护、内容审核、数据合规等义务由运营方自行承担。

---

## 免责声明

1. 本项目为**开源技术示范工程**，仅用于学习、研究与技术交流，作者未将其作为商业产品运营。
2. 本项目**不包含**任何充值、提现、兑换、抽水等资金功能，不具备、也不应被用于构建赌博服务。
3. 任何人将本项目用于商业运营或对外提供服务，须自行确保符合所在地法律法规（包括但不限于游戏版号、备案、支付与反洗钱要求），并独立承担全部法律责任。
4. 作者不对使用者基于本项目的部署、运营、修改及由此产生的任何直接或间接损失承担责任。
5. 如本项目内容无意中侵犯了您的权益，请联系作者删除。

## License

MIT
