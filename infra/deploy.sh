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

# .env 收紧权限，避免同机其他用户读取
chmod 600 .env 2>/dev/null || true

# 逐行解析部署变量（含可选的 NGINX_TARGET_CONF）。
# 不能用 `. ./.env`：那会把配置当 shell 执行，一个反引号就能执行任意命令。
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  case "$line" in
    ''|\#*) continue ;;
  esac
  key="${line%%=*}"
  value="${line#*=}"
  key="$(printf '%s' "$key" | tr -d '[:space:]')"
  case "$key" in
    ''|*[!A-Za-z0-9_]*) continue ;;
  esac
  export "$key=$value"
done < .env

TARGET="${NGINX_TARGET_CONF:-}"

# 生产环境必须配好密钥，否则服务会拒绝启动，提前给出明确提示
if [ "${NODE_ENV:-}" = "production" ]; then
  for key in JWT_SECRET INTERNAL_KEY ADMIN_TOKEN; do
    val="${!key:-}"
    if [ "${#val}" -lt 32 ]; then
      echo "$key 未配置或不足 32 位（生成方式：openssl rand -hex 32）" >&2
      exit 1
    fi
  done
fi

# tar 覆盖式解压只会新增/覆盖，不会删除仓库里已移除的旧文件。
# 残留的 .ts/.tsx 会被 tsc 编译到，导致 "property does not exist" 之类的构建失败。
# 因此按归档清单清理掉已经不在版本控制中的源码文件。
echo "==> 同步删除已移除的源码"
ARCHIVE_LIST=/tmp/cc-archive-files.txt
LOCAL_LIST=/tmp/cc-local-files.txt
if [ -f /tmp/cc-deploy.tar.gz ]; then
  tar -tzf /tmp/cc-deploy.tar.gz \
    | grep -E '^(apps|packages|services|scripts|infra)/' \
    | sed 's#/$##' | sort -u > "$ARCHIVE_LIST"

  find apps packages services scripts infra -type f \
    -not -path '*/node_modules/*' -not -path '*/dist/*' \
    \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.mjs' \
       -o -name '*.js' -o -name '*.json' -o -name '*.svg' -o -name '*.jpg' \
       -o -name '*.png' -o -name '*.sh' -o -name '*.conf' -o -name '*.service' \) \
    2>/dev/null | sort -u > "$LOCAL_LIST"

  # grep -Fvx 不依赖排序，避免不同 locale 下 comm 误报 "not in sorted order"
  grep -Fvx -f "$ARCHIVE_LIST" "$LOCAL_LIST" > /tmp/cc-stale-files.txt || true
  REMOVED=$(wc -l < /tmp/cc-stale-files.txt)
  if [ "$REMOVED" -gt 0 ]; then
    echo "    清理 $REMOVED 个已移除文件"
    while IFS= read -r file; do rm -f -- "$file"; done < /tmp/cc-stale-files.txt
  fi
fi

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

echo "==> 健康检查"
# 重启后 tsx / PostgreSQL 首次启动可能要数秒，轮询等待而非常量 sleep
wait_health() {
  local url="$1" name="$2" unit="$3" i
  for i in $(seq 1 15); do
    if curl -fsS --max-time 5 "$url" >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "$name 健康检查失败，最近日志：" >&2
  sudo journalctl -u "$unit" -n 40 --no-pager >&2 || true
  return 1
}

wait_health "http://127.0.0.1:${PORT:-8080}/health" "cc-api" "cc-api" || exit 1
wait_health "http://127.0.0.1:${ROOM_PORT:-9000}/health" "cc-room" "cc-room" || exit 1

echo "==> 配置 nginx 片段"
sudo mkdir -p /etc/nginx/snippets
sudo cp infra/nginx-lobby.conf "$SNIPPET"

BT_NGINX_CONF=/www/server/nginx/conf/nginx.conf
BT_VHOST_DIR=/www/server/panel/vhost/nginx
if [ -f "$BT_NGINX_CONF" ] && [ -d "$BT_VHOST_DIR" ]; then
  # 宝塔的 server 块分行书写，sed 注入不生效，改用独立 default_server
  echo "    检测到宝塔面板，安装独立 vhost"
  sudo cp infra/nginx-bt-lobby.conf "$BT_VHOST_DIR/cc-lobby.conf"
elif [ -z "$TARGET" ]; then
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
