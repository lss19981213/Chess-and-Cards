#!/usr/bin/env bash
# 服务器端部署/更新脚本（幂等）
# 大厅可部署在 /lobby/ 子路径，不占用独立端口，不覆盖同机已有站点
set -euo pipefail

APP_DIR=/opt/chess-and-cards
SNIPPET=/etc/nginx/snippets/lobby.conf

cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "缺少 $APP_DIR/.env，请先参考 infra/.env.example 创建" >&2
  exit 1
fi

# 载入部署变量（含可选的 NGINX_TARGET_CONF）
set -a
. ./.env
set +a

TARGET="${NGINX_TARGET_CONF:-}"

echo "==> 安装依赖"
pnpm install --frozen-lockfile

echo "==> 构建前端"
pnpm --filter @cc/lobby-web build

echo "==> 注册 systemd 服务"
sudo cp infra/cc-api.service /etc/systemd/system/cc-api.service
sudo cp infra/cc-room.service /etc/systemd/system/cc-room.service
sudo systemctl daemon-reload
sudo systemctl enable cc-api cc-room >/dev/null 2>&1 || true
sudo systemctl restart cc-api cc-room

echo "==> 配置 nginx 片段"
sudo mkdir -p /etc/nginx/snippets
sudo cp infra/nginx-lobby.conf "$SNIPPET"

if [ -z "$TARGET" ]; then
  echo "    未设置 NGINX_TARGET_CONF，跳过自动注入。"
  echo "    请手动在目标 server 块内加入：include /etc/nginx/snippets/lobby.conf;"
elif [ ! -f "$TARGET" ]; then
  echo "    目标配置不存在：$TARGET，跳过注入" >&2
elif sudo grep -q 'snippets/lobby.conf' "$TARGET"; then
  echo "    include 已存在，跳过"
else
  sudo cp "$TARGET" "${TARGET}.bak.$(date +%Y%m%d%H%M%S)"
  sudo sed -i '0,/server {/s|server {|server {\n  include /etc/nginx/snippets/lobby.conf;|' "$TARGET"
  echo "    已注入 include（原配置已备份）"
fi

sudo nginx -t
sudo systemctl reload nginx

echo "==> 部署完成"
