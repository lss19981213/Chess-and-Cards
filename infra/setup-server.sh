#!/usr/bin/env bash
# 服务器一次性初始化（幂等，可重复执行）
# 用法: CC_DB_PASSWORD=xxx bash setup-server.sh
#      或 bash setup-server.sh（交互式输入，不回显）
set -euo pipefail

DB_PASSWORD="${CC_DB_PASSWORD:-${1:-}}"
if [ -z "$DB_PASSWORD" ]; then
  read -rsp "请输入数据库密码（不会回显）: " DB_PASSWORD
  echo
fi
if [ -z "$DB_PASSWORD" ]; then
  echo "数据库密码不能为空" >&2
  exit 1
fi
# 密码走 SQL 字面量，单引号需要转义；同时避免出现在命令行参数/ps 输出里
DB_PASSWORD_SQL="$(printf '%s' "$DB_PASSWORD" | sed "s/'/''/g")"
APP_DIR=/opt/chess-and-cards

echo "==> 配置 swap（1.9G 内存机器需要，防止安装依赖时 OOM）"
if ! swapon --show 2>/dev/null | grep -q '/swapfile'; then
  if [ ! -f /swapfile ]; then
    sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
  fi
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

echo "==> 安装 pnpm"
if ! command -v pnpm >/dev/null 2>&1; then
  sudo npm install -g pnpm@11
fi

echo "==> 安装 PostgreSQL"
if ! command -v psql >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql
fi
sudo systemctl enable --now postgresql

echo "==> 初始化数据库与账号"
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='cc'" | grep -q 1; then
  printf "%s\n" "CREATE ROLE cc LOGIN PASSWORD '${DB_PASSWORD_SQL}';" | sudo -u postgres psql -q
fi
# 密码经 stdin 传入，不进命令行参数，也不会被 ps/历史记录看到
printf "%s\n" "ALTER ROLE cc WITH PASSWORD '${DB_PASSWORD_SQL}';" | sudo -u postgres psql -q
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='chess_cards'" | grep -q 1 || \
  sudo -u postgres createdb -O cc chess_cards

echo "==> 准备应用目录"
sudo mkdir -p "$APP_DIR"
sudo chown -R "$(id -un):$(id -gn)" "$APP_DIR"

echo "==> 服务端初始化完成"
