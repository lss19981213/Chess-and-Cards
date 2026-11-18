# syntax=docker/dockerfile:1.7
# 多阶段构建：一次构建同时产出后端运行镜像 (runtime) 与前端 Nginx 静态镜像 (web)

FROM node:22-alpine AS base
WORKDIR /app
# 启用 pnpm 并配置国内高速镜像源（构建快 3-5 倍）
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN npm config set registry "${NPM_REGISTRY}" \
 && npm install -g pnpm@10 \
 && pnpm config set registry "${NPM_REGISTRY}"

# ---------- 1. 仅复制 lockfile 与各包 manifest，最大化利用 Docker 依赖缓存 ----------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/auth/package.json packages/auth/
COPY packages/game-sdk/package.json packages/game-sdk/
COPY packages/protocol/package.json packages/protocol/
COPY apps/api-server/package.json apps/api-server/
COPY apps/lobby-web/package.json apps/lobby-web/
COPY services/room-server/package.json services/room-server/
COPY services/games/baccarat/package.json services/games/baccarat/
COPY services/games/blackjack/package.json services/games/blackjack/
COPY services/games/chess/package.json services/games/chess/
COPY services/games/cs-mahjong/package.json services/games/cs-mahjong/
COPY services/games/dice/package.json services/games/dice/
COPY services/games/doudizhu/package.json services/games/doudizhu/
COPY services/games/goldenflower/package.json services/games/goldenflower/
COPY services/games/gomoku/package.json services/games/gomoku/
COPY services/games/niuniu/package.json services/games/niuniu/
COPY services/games/paodekuai/package.json services/games/paodekuai/
COPY services/games/slots/package.json services/games/slots/
COPY services/games/stud/package.json services/games/stud/
COPY services/games/texas/package.json services/games/texas/
COPY services/games/tuizhuanzi/package.json services/games/tuizhuanzi/
COPY services/games/xiangqi/package.json services/games/xiangqi/

RUN pnpm install --frozen-lockfile

# ---------- 2. 构建前端大厅 (@cc/lobby-web) ----------
FROM deps AS web-builder
COPY packages ./packages
COPY apps/lobby-web ./apps/lobby-web
RUN pnpm --filter @cc/lobby-web build

# ---------- 3. 后端服务运行镜像 (api-server & room-server 共用) ----------
FROM deps AS runtime
ENV NODE_ENV=production
COPY packages ./packages
COPY apps/api-server ./apps/api-server
COPY services ./services
EXPOSE 8080 9000
CMD ["pnpm", "--filter", "@cc/api-server", "start"]

# ---------- 4. 前端 + 内置反代入口镜像 (1Panel 网站只需反代这一个端口) ----------
FROM nginx:1.27-alpine AS web
COPY infra/nginx-docker.conf /etc/nginx/conf.d/default.conf
COPY --from=web-builder /app/apps/lobby-web/dist /usr/share/nginx/html/lobby
EXPOSE 80
