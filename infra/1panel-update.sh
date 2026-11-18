#!/usr/bin/env bash
# ==============================================================================
# Chess & Cards · 1Panel 一键部署 / 秒级更新脚本
# 用法：
#   1. 首次部署：直接执行本脚本（会自动克隆代码、生成安全 .env 密钥并启动全套容器）
#   2. 日常更新：挂到 1Panel「计划任务 -> Shell 脚本」，以后每次更新代码点一下「执行」即可！
# ==============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/1panel/apps/chess-and-cards}"
REPO_URL="${REPO_URL:-https://github.com/lss19981213/Chess-and-Cards.git}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="docker-compose.1panel.yml"

echo "=========================================="
echo "  Chess & Cards 1Panel 一键部署/更新"
echo "  目录: ${APP_DIR}"
echo "  分支: ${BRANCH}"
echo "=========================================="

# 检测 docker compose 命令
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "[错误] 未检测到 Docker Compose，请先在 1Panel 中确认 Docker 服务已运行。" >&2
  exit 1
fi

# 1. 拉取或克隆代码（直连 GitHub 失败时自动回退国内镜像代理）
clone_or_pull() {
  if [ ! -d "${APP_DIR}/.git" ]; then
    mkdir -p "$(dirname "${APP_DIR}")"
    echo "==> 首次拉取仓库代码..."
    git clone -b "${BRANCH}" --depth 1 "${REPO_URL}" "${APP_DIR}" \
      || git clone -b "${BRANCH}" --depth 1 "https://gh-proxy.com/${REPO_URL}" "${APP_DIR}"
  else
    cd "${APP_DIR}"
    echo "==> 拉取最新代码 (${BRANCH})..."
    git fetch origin "${BRANCH}" --depth 1 \
      || git fetch "https://gh-proxy.com/${REPO_URL}" "${BRANCH}" --depth 1
    git reset --hard FETCH_HEAD
  fi
}

clone_or_pull
cd "${APP_DIR}"

# 2. 首次运行自动生成生产级随机密钥 .env（后续更新绝不覆盖已有配置与数据库密码）
if [ ! -f .env ]; then
  echo "==> 未发现 .env，正在自动生成高强度随机密钥..."
  rand_hex() {
    if command -v openssl >/dev/null 2>&1; then
      openssl rand -hex 32
    else
      head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
    fi
  }
  PG_PASS="$(rand_hex | cut -c1-24)"
  JWT_VAL="$(rand_hex)"
  INT_VAL="$(rand_hex)"
  ADM_VAL="$(rand_hex)"

  cat > .env <<EOF
# Chess & Cards 1Panel 生产环境配置（自动生成）
WEB_BIND=127.0.0.1
WEB_PORT=8090

POSTGRES_USER=cc
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=chess_cards

# 如需改用 1Panel 应用商店已有 PostgreSQL，请取消下面注释并填入实际地址：
# DATABASE_URL=postgres://user:pass@172.17.0.1:5432/chess_cards

JWT_SECRET=${JWT_VAL}
INTERNAL_KEY=${INT_VAL}
ADMIN_TOKEN=${ADM_VAL}
TOKEN_TTL=7200
INITIAL_COINS=1000
CORS_ORIGIN=*
WS_ALLOWED_ORIGINS=
DISCONNECT_GRACE_MS=60000
BOT_ENABLED=true
BOT_THINK_MS=700
EOF
  chmod 600 .env
  echo "=========================================="
  echo "  [首次初始化完成] 请妥善保存以下 GM 口令："
  echo "  ADMIN_TOKEN=${ADM_VAL}"
  echo "  配置文件路径: ${APP_DIR}/.env"
  echo "=========================================="
fi

# 读取 WEB_PORT 用于最终健康检查
WEB_PORT="$(grep -E '^WEB_PORT=' .env | tail -n1 | cut -d'=' -f2 | tr -d '[:space:]\r' || true)"
WEB_PORT="${WEB_PORT:-8090}"

mkdir -p data/postgres data/outbox

# 3. 增量构建镜像并滚动重启（利用 BuildKit 缓存，日常代码更新约 15~30 秒完成）
echo "==> 开始增量构建并启动容器..."
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
${DC} -f "${COMPOSE_FILE}" build
${DC} -f "${COMPOSE_FILE}" up -d --remove-orphans

# 4. 等待服务健康就绪
echo "==> 正在进行服务健康检查..."
for i in $(seq 1 20); do
  if curl -fsS --max-time 5 "http://127.0.0.1:${WEB_PORT}/health" >/dev/null 2>&1; then
    echo "✅ 服务已就绪！健康状态："
    curl -fsS "http://127.0.0.1:${WEB_PORT}/health" || true
    echo ""
    break
  fi
  if [ "$i" -eq 20 ]; then
    echo "❌ 健康检查超时，最近日志如下：" >&2
    ${DC} -f "${COMPOSE_FILE}" logs --tail=50 api-server room-server web >&2
    exit 1
  fi
  sleep 2
done

# 5. 清理悬空旧镜像，防止服务器磁盘越占越多
docker image prune -f >/dev/null 2>&1 || true

echo "=========================================="
echo "  🚀 部署/更新全部完成！"
echo "  本机入口: http://127.0.0.1:${WEB_PORT}/lobby/"
echo "  GM 接口:  http://127.0.0.1:${WEB_PORT}/api/"
echo "  当前版本: $(git rev-parse --short HEAD) ($(git log -1 --pretty=%s))"
echo "=========================================="
