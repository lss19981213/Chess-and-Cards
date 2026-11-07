#!/usr/bin/env bash
# 服务器端部署/更新脚本（幂等）
# 用法: bash deploy.sh
set -euo pipefail

APP_DIR=/opt/chess-and-cards
cd "$APP_DIR"

if [ ! -f .env ]; then
  echo "缺少 $APP_DIR/.env，请先参考 infra/.env.example 创建" >&2
  exit 1
fi

echo "==> 安装依赖"
pnpm install --frozen-lockfile

echo "==> 构建前端"
pnpm --filter @cc/lobby-web build

echo "==> 注册 systemd 服务"
sudo cp infra/cc-api.service /etc/systemd/system/cc-api.service
sudo cp infra/cc-room.service /etc/systemd/system/cc-room.service
sudo systemctl daemon-reload
sudo systemctl enable cc-api cc-room >/dev/null 2>&1
sudo systemctl restart cc-api cc-room

echo "==> 配置 nginx"
sudo cp infra/nginx.conf /etc/nginx/sites-available/chess-and-cards
sudo ln -sf /etc/nginx/sites-available/chess-and-cards /etc/nginx/sites-enabled/chess-and-cards
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

echo "==> 部署完成"
