# 1Panel 环境快速部署与一键更新指南

本仓库已内置 **1Panel 原生 Docker Compose 编排**（`docker-compose.1panel.yml`）+ **国内高速构建 Dockerfile** + **一键滚动更新脚本**（`infra/1panel-update.sh`）+ **GitHub Actions 全自动推送部署**。

整套方案把 **前端大厅 + API 服务 + 游戏房服 + PostgreSQL + 内置 Nginx 反代** 打包为 1 组容器，对外仅暴露 **1 个端口（默认 `127.0.0.1:8090`）**，彻底告别手动拷文件、配多个 systemd 与多条 Nginx 片段。

---

## 一、首次部署（3 分钟搞定）

### 第 1 步：在服务器终端执行 1 条命令初始化并启动

在 1Panel 左侧点击 **「主机 -> 终端」**，粘贴执行：

```bash
curl -fsSL https://raw.githubusercontent.com/lss19981213/Chess-and-Cards/main/infra/1panel-update.sh | bash
```

> 若国内机器直连 GitHub 较慢，可使用高速镜像：
> ```bash
> curl -fsSL https://ghfast.top/https://raw.githubusercontent.com/lss19981213/Chess-and-Cards/main/infra/1panel-update.sh | bash
> ```
> （备用镜像：`https://ghproxy.net/...`）

脚本会自动完成：
1. 克隆仓库至 `/opt/1panel/apps/chess-and-cards`；
2. 自动生成安全随机 `.env`（含 `JWT_SECRET`、`INTERNAL_KEY`、`ADMIN_TOKEN`、数据库密码，**记得记下终端打印的 `ADMIN_TOKEN` 给 GM 客户端使用**）；
3. 利用国内 `npmmirror` 源自动构建前后端容器并启动；
4. 自动等待健康检查通过。

### 第 2 步：在 1Panel 面板配置域名 / HTTPS 反向代理

1. 打开 1Panel 左侧 **「网站 -> 网站 -> 创建网站 -> 反向代理」**：
   - **主域名**：填写你的域名（或服务器 IP）
   - **代理地址**：`http://127.0.0.1:8090`
2. 创建完成后，进入该网站的 **「配置 -> 反向代理」**（或 **配置文件**），确认已开启 WebSocket 支持（1Panel 默认反代规则已支持 `Upgrade` / `Connection` 头部，如需 HTTPS 直接在 **「HTTPS」** 页一键申请 Let's Encrypt 证书即可）。
3. 访问 `https://你的域名/lobby/`（或直接访问 `https://你的域名/`，会自动跳转到 `/lobby/`）即可开玩！
   - GM 运营中台直接填 `https://你的域名` + 刚刚生成的 `ADMIN_TOKEN` 即可直连。

---

## 二、后续每次更新代码：两种零烦恼方式（任选其一）

### 方式 A：1Panel 面板点一下「执行」按钮（推荐，15 秒完成更新）

1. 在 1Panel 左侧进入 **「计划任务 -> 创建计划任务」**：
   - **任务类型**：`Shell 脚本`
   - **任务名称**：`更新棋牌大厅`
   - **执行周期**：任意（如每月 1 日，**创建后点“禁用”自动定时，只保留手动触发即可**）
   - **脚本内容**：
     ```bash
     bash /opt/1panel/apps/chess-and-cards/infra/1panel-update.sh
     ```
2. 以后只要代码有新提交，登录 1Panel 在计划任务里点一下 **「执行」** 按钮：
   - 自动 `git pull` 最新代码
   - 利用 Docker 缓存 15~30 秒增量编译前后端
   - 自动滚动重启容器并做健康检查
   - 自动清理无用旧镜像，不占磁盘，**绝不覆盖 `.env` 和数据库数据**！

---

### 方式 B：终极懒人模式 — 每次 `git push` 全自动部署到 1Panel（0 手动操作）

仓库已内置工作流 `.github/workflows/deploy-1panel.yml`。只要在 GitHub 仓库的 **Settings -> Secrets and variables -> Actions** 中添加 3 个 Secret：

| Secret 名称 | 填写内容 |
| --- | --- |
| `DEPLOY_HOST` | 你的 1Panel 服务器公网 IP（如 `82.157.54.179`） |
| `DEPLOY_USER` | SSH 登录用户名（如 `root` 或 `ubuntu`） |
| `DEPLOY_SSH_KEY` | 服务器免密登录的 SSH 私钥全文 |

配置完成后，以后我这边每次帮你改完代码 `git push` 到 `main`，GitHub 就会**自动连上你的 1Panel 服务器拉代码、编译、重启、验活**，你连 1Panel 面板都不用打开，等半分钟刷新网页就是最新版本！

---

### 方式 C：单游戏热更新 / 按范围发布（SCOPE）

日常「只修一个游戏」「只发前端」等运维步骤、GM 面板操作、API 示例与排障，见独立手册：

**[运维手册-发布与热更新.md](./运维手册-发布与热更新.md)**

设计背景见 [优化方案书-单游戏热更新.md](./优化方案书-单游戏热更新.md)。

---

## 三、常用运维命令速查

```bash
cd /opt/1panel/apps/chess-and-cards

# 查看容器状态
docker compose -f docker-compose.1panel.yml ps

# 查看实时日志
docker compose -f docker-compose.1panel.yml logs -f api-server room-server

# 查看当前 GM 口令
grep ADMIN_TOKEN .env

# 备份 PostgreSQL 数据
docker exec cc-postgres pg_dump -U cc chess_cards > backup_$(date +%F).sql
```
