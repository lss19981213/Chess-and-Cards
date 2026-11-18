#!/usr/bin/env bash
# ==============================================================================
# Chess & Cards · 1Panel 一键部署 / 无感优雅更新脚本
# 流程：
#   1. 先拉取代码并预构建镜像（构建期间旧服务零中断）
#   2. 若存在运行中的线上服务：自动进入「排水模式」禁止开新局，耐心等待所有在局玩家打完本局
#   3. 全部对局结算后切入「平台紧急更新中」友好等待页（彻底告别 502），先平滑更新后端再切换前端
#   4. 新版本健康就绪后，自动调用维护完成接口给全服玩家发放 1,000 欢乐豆更新补偿邮件并恢复入口
# ==============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/1panel/apps/chess-and-cards}"
REPO_URL="${REPO_URL:-https://github.com/lss19981213/Chess-and-Cards.git}"
BRANCH="${BRANCH:-main}"
COMPOSE_FILE="docker-compose.1panel.yml"
MAX_DRAIN_WAIT_SEC="${MAX_DRAIN_WAIT_SEC:-600}"
COMPENSATION_COINS="${COMPENSATION_COINS:-1000}"
# 发布范围：full=全站排水更新；web=仅前端（不停房间）；api=仅 API；room=仅房间服（仍排水）
SCOPE="${SCOPE:-full}"

echo "=========================================="
echo "  Chess & Cards 1Panel 一键部署/优雅更新"
echo "  目录: ${APP_DIR}"
echo "  分支: ${BRANCH}"
echo "  范围: ${SCOPE}"
echo "=========================================="

case "${SCOPE}" in
  full|web|api|room) ;;
  *)
    echo "[错误] SCOPE 仅支持 full|web|api|room，当前=${SCOPE}" >&2
    exit 1
    ;;
esac

# 检测 docker compose 命令
if docker compose version >/dev/null 2>&1; then
  DC="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  DC="docker-compose"
else
  echo "[错误] 未检测到 Docker Compose，请先在 1Panel 中确认 Docker 服务已运行。" >&2
  exit 1
fi

# 1. 拉取或克隆代码（多节点自动容错：直连 GitHub + 多个可用国内镜像，成功后自动修正 origin）
clone_or_pull() {
  local candidates=(
    "${REPO_URL}"
    "https://ghfast.top/${REPO_URL}"
    "https://ghproxy.net/${REPO_URL}"
    "https://hk.gh-proxy.com/${REPO_URL}"
    "https://gh-proxy.com/${REPO_URL}"
  )

  if [ ! -d "${APP_DIR}/.git" ]; then
    mkdir -p "$(dirname "${APP_DIR}")"
    echo "==> 首次拉取仓库代码..."
    for url in "${candidates[@]}"; do
      echo "    尝试节点: ${url}"
      if git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 clone -b "${BRANCH}" --depth 1 "${url}" "${APP_DIR}"; then
        return 0
      fi
      rm -rf "${APP_DIR}"
    done
    echo "[错误] 所有 Git 节点均拉取失败，请检查服务器外网连通性。" >&2
    return 1
  else
    cd "${APP_DIR}"
    echo "==> 拉取最新代码 (${BRANCH})..."
    local current_origin
    current_origin="$(git remote get-url origin 2>/dev/null || true)"
    local fetch_list=()
    if [ -n "${current_origin}" ] && [[ "${current_origin}" != *"gh-proxy.com"* ]]; then
      fetch_list+=("${current_origin}")
    fi
    for url in "${candidates[@]}"; do
      if [ "${url}" != "${current_origin}" ]; then
        fetch_list+=("${url}")
      fi
    done

    for url in "${fetch_list[@]}"; do
      echo "    尝试节点: ${url}"
      if git -c http.lowSpeedLimit=1000 -c http.lowSpeedTime=20 fetch "${url}" "${BRANCH}" --depth 1; then
        git remote set-url origin "${url}" 2>/dev/null || true
        git reset --hard FETCH_HEAD
        return 0
      fi
    done
    echo "[错误] 所有 Git 节点均拉取失败，请检查服务器外网连通性。" >&2
    return 1
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

# 奇幻维度 OAuth 2.0 登录配置（在 https://www.fantasyclaw.top 申请应用后填入）
FANTASYCLAW_OAUTH_BASE_URL=https://www.fantasyclaw.top
FANTASYCLAW_OAUTH_CLIENT_ID=
FANTASYCLAW_OAUTH_CLIENT_SECRET=
FANTASYCLAW_OAUTH_REDIRECT_URI=
FANTASYCLAW_OAUTH_SCOPE=profile email
PUBLIC_LOBBY_URL=/lobby/
EOF
  chmod 600 .env
  echo "=========================================="
  echo "  [首次初始化完成] 请妥善保存以下 GM 口令："
  echo "  ADMIN_TOKEN=${ADM_VAL}"
  echo "  配置文件路径: ${APP_DIR}/.env"
  echo "=========================================="
fi

read_env_val() {
  local key="$1"
  grep -E "^${key}=" .env | tail -n1 | cut -d'=' -f2- | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || true
}

WEB_PORT="$(read_env_val WEB_PORT)"
WEB_PORT="${WEB_PORT:-8090}"
ADMIN_TOKEN_VAL="$(read_env_val ADMIN_TOKEN)"
NEW_VERSION="$(git rev-parse --short HEAD 2>/dev/null || date +%Y%m%d%H%M)"
API_BASE="http://127.0.0.1:${WEB_PORT}"

mkdir -p data/postgres data/outbox

# 3. 预构建新镜像（构建期间线上旧服务完全正常运行，零影响）
echo "==> 预构建新版本镜像 (${NEW_VERSION}, SCOPE=${SCOPE})..."
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1
case "${SCOPE}" in
  web) ${DC} -f "${COMPOSE_FILE}" build web ;;
  api|room) ${DC} -f "${COMPOSE_FILE}" build api-server room-server ;;
  *) ${DC} -f "${COMPOSE_FILE}" build ;;
esac

# 4. 全站排水仅在 full / room / api 时启用；SCOPE=web 不打扰在局玩家
NEED_DRAIN=0
case "${SCOPE}" in
  full|room|api) NEED_DRAIN=1 ;;
esac

IS_UPGRADE=0
if [ "${NEED_DRAIN}" -eq 1 ] && [ -n "${ADMIN_TOKEN_VAL}" ] && curl -fsS --max-time 3 "${API_BASE}/health" >/dev/null 2>&1; then
  IS_UPGRADE=1
  echo "==> 检测到线上服务运行中，开启维护排水模式（暂停开启新游戏，等待在局玩家打完本局）..."
  curl -fsS --max-time 5 -X POST "${API_BASE}/api/admin/maintenance/drain" \
    -H "Authorization: Bearer ${ADMIN_TOKEN_VAL}" \
    -H "content-type: application/json" \
    -d "{\"compensationCoins\":${COMPENSATION_COINS}}" >/dev/null 2>&1 || true

  WAITED=0
  while [ "${WAITED}" -lt "${MAX_DRAIN_WAIT_SEC}" ]; do
    STATUS_JSON="$(curl -fsS --max-time 4 "${API_BASE}/api/admin/maintenance/status" \
      -H "Authorization: Bearer ${ADMIN_TOKEN_VAL}" 2>/dev/null || echo '{"activeHumanGames":0}')"
    ACTIVE_GAMES="$(printf '%s' "${STATUS_JSON}" | sed -n 's/.*"activeHumanGames"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n1)"
    ACTIVE_GAMES="${ACTIVE_GAMES:-0}"
    if [ "${ACTIVE_GAMES}" -eq 0 ]; then
      echo "✅ 所有进行中的玩家对局已全部结算完毕！"
      break
    fi
    echo "⏳ 等待进行中的 ${ACTIVE_GAMES} 桌玩家对局结束（已等待 ${WAITED}s / 上限 ${MAX_DRAIN_WAIT_SEC}s）..."
    sleep 3
    WAITED=$((WAITED + 3))
  done

  echo "==> 切换为「平台紧急更新中」友好等待页（期间零 502 报错）..."
  curl -fsS --max-time 5 -X POST "${API_BASE}/api/admin/maintenance/updating" \
    -H "Authorization: Bearer ${ADMIN_TOKEN_VAL}" \
    -H "content-type: application/json" \
    -d "{\"compensationCoins\":${COMPENSATION_COINS}}" >/dev/null 2>&1 || true
  sleep 2
fi

# 5. 按 SCOPE 滚动重启
echo "==> 平滑启动服务容器 (SCOPE=${SCOPE})..."
${DC} -f "${COMPOSE_FILE}" up -d postgres
case "${SCOPE}" in
  web)
    ${DC} -f "${COMPOSE_FILE}" up -d --no-deps --remove-orphans web
    ;;
  api)
    ${DC} -f "${COMPOSE_FILE}" up -d --no-deps api-server
    ;;
  room)
    ${DC} -f "${COMPOSE_FILE}" up -d --no-deps room-server
    ;;
  *)
    ${DC} -f "${COMPOSE_FILE}" up -d --no-deps api-server room-server
    ;;
esac

if [ "${SCOPE}" != "web" ]; then
  echo "==> 等待后端核心服务健康就绪..."
  for i in $(seq 1 25); do
    API_OK=1
    ROOM_OK=1
    if [ "${SCOPE}" = "api" ] || [ "${SCOPE}" = "full" ]; then
      docker exec cc-api-server wget -qO- http://127.0.0.1:8080/health >/dev/null 2>&1 || API_OK=0
    fi
    if [ "${SCOPE}" = "room" ] || [ "${SCOPE}" = "full" ]; then
      docker exec cc-room-server wget -qO- http://127.0.0.1:9000/health >/dev/null 2>&1 || ROOM_OK=0
    fi
    if [ "${API_OK}" -eq 1 ] && [ "${ROOM_OK}" -eq 1 ]; then
      echo "✅ 目标后端服务已健康就绪！"
      break
    fi
    if [ "$i" -eq 25 ]; then
      echo "❌ 后端健康检查超时，最近日志如下：" >&2
      ${DC} -f "${COMPOSE_FILE}" logs --tail=50 api-server room-server >&2
      exit 1
    fi
    sleep 2
  done
fi

if [ "${SCOPE}" = "full" ]; then
  ${DC} -f "${COMPOSE_FILE}" up -d --no-deps --remove-orphans web
fi

# 6. 最终入口健康检查
echo "==> 正在进行最终入口健康检查..."
for i in $(seq 1 15); do
  if curl -fsS --max-time 5 "${API_BASE}/health" >/dev/null 2>&1; then
    echo "✅ 服务入口已就绪！健康状态："
    curl -fsS "${API_BASE}/health" || true
    echo ""
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "❌ 健康检查超时，最近日志如下：" >&2
    ${DC} -f "${COMPOSE_FILE}" logs --tail=50 api-server room-server web >&2
    exit 1
  fi
  sleep 2
done

# 7. 仅全站/后端排水更新发放补偿；SCOPE=web 不补偿
if [ "${IS_UPGRADE}" -eq 1 ] && [ -n "${ADMIN_TOKEN_VAL}" ]; then
  echo "==> 自动发放全服更新补偿 (${COMPENSATION_COINS} 欢乐豆/人) 并恢复平台服务..."
  COMP_RES="$(curl -fsS --max-time 8 -X POST "${API_BASE}/api/admin/maintenance/complete" \
    -H "Authorization: Bearer ${ADMIN_TOKEN_VAL}" \
    -H "content-type: application/json" \
    -d "{\"version\":\"${NEW_VERSION}\",\"compensationCoins\":${COMPENSATION_COINS}}" 2>/dev/null || true)"
  echo "    补偿结果: ${COMP_RES}"
fi

# 8. 清理悬空旧镜像，防止服务器磁盘越占越多
docker image prune -f >/dev/null 2>&1 || true

echo "=========================================="
echo "  🚀 部署/优雅更新全部完成！"
echo "  本机入口: http://127.0.0.1:${WEB_PORT}/lobby/"
echo "  GM 接口:  http://127.0.0.1:${WEB_PORT}/api/"
echo "  当前版本: ${NEW_VERSION} ($(git log -1 --pretty=%s))"
echo "=========================================="
