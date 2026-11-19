#!/usr/bin/env bash
# ==============================================================================
# Chess & Cards · 单游戏热更新（不触发全站维护页 / 不发放全服补偿）
# 用法：
#   bash infra/1panel-game-update.sh <gameId|pkgName>
# 示例：
#   bash infra/1panel-game-update.sh dice
#   bash infra/1panel-game-update.sh @cc/game-cs-mahjong
# 流程：拉代码 → 变更范围门禁 → drain → 等待本游戏人类局结束 → reload → enable
# ==============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/1panel/apps/chess-and-cards}"
REPO_URL="${REPO_URL:-https://github.com/lss19981213/Chess-and-Cards.git}"
BRANCH="${BRANCH:-main}"
MAX_DRAIN_WAIT_SEC="${MAX_DRAIN_WAIT_SEC:-600}"
GAME_KEY="${1:-}"

if [ -z "${GAME_KEY}" ]; then
  echo "[错误] 请指定 gameId 或包名，例如: bash infra/1panel-game-update.sh dice" >&2
  exit 1
fi

echo "=========================================="
echo "  Chess & Cards 单游戏热更新"
echo "  目标: ${GAME_KEY}"
echo "  目录: ${APP_DIR}"
echo "=========================================="

# 禁止误调全站维护接口（脚本内硬编码约束，勿删除）
FORBIDDEN_PATHS=(
  "/api/admin/maintenance/drain"
  "/api/admin/maintenance/updating"
  "/api/admin/maintenance/complete"
)

clone_or_pull() {
  local candidates=(
    "${REPO_URL}"
    "https://ghfast.top/${REPO_URL}"
    "https://ghproxy.net/${REPO_URL}"
    "https://hk.gh-proxy.com/${REPO_URL}"
    "https://gh-proxy.com/${REPO_URL}"
  )
  if [ ! -d "${APP_DIR}/.git" ]; then
    echo "[错误] ${APP_DIR} 不是 git 仓库，请先用 1panel-update.sh 完成首次部署。" >&2
    exit 1
  fi
  cd "${APP_DIR}"
  echo "==> 拉取最新代码 (${BRANCH})..."
  local current_origin
  current_origin="$(git remote get-url origin 2>/dev/null || true)"
  local fetch_list=()
  if [ -n "${current_origin}" ]; then
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
  echo "[错误] 所有 Git 节点均拉取失败。" >&2
  return 1
}

clone_or_pull
cd "${APP_DIR}"

if [ ! -f .env ]; then
  echo "[错误] 缺少 .env，无法读取 ADMIN_TOKEN。" >&2
  exit 1
fi

read_env_val() {
  local key="$1"
  grep -E "^${key}=" .env | tail -n1 | cut -d'=' -f2- | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || true
}

WEB_PORT="$(read_env_val WEB_PORT)"
WEB_PORT="${WEB_PORT:-8090}"
ADMIN_TOKEN_VAL="$(read_env_val ADMIN_TOKEN)"
API_BASE="http://127.0.0.1:${WEB_PORT}"

if [ -z "${ADMIN_TOKEN_VAL}" ]; then
  echo "[错误] .env 中 ADMIN_TOKEN 为空。" >&2
  exit 1
fi

# ---- 变更范围门禁：触及共享包 / API / 多游戏则拒绝 ----
echo "==> 校验变更是否允许单游戏热更..."
PREV_HEAD="$(git rev-parse HEAD@{1} 2>/dev/null || git rev-parse HEAD~1 2>/dev/null || true)"
if [ -n "${PREV_HEAD}" ]; then
  CHANGED="$(git diff --name-only "${PREV_HEAD}" HEAD || true)"
else
  CHANGED="$(git show --name-only --pretty='' HEAD || true)"
fi

if printf '%s\n' "${CHANGED}" | grep -E '^(packages/(protocol|game-sdk|auth)/|apps/api-server/|services/room-server/src/(?!plugins\.ts)|infra/1panel-update\.sh)' >/dev/null 2>&1; then
  # room-server 核心（除 plugins 热更入口）变更也走全量更稳妥；上面正则在部分 grep 不支持前瞻，改用更简单规则：
  :
fi

BLOCKED=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    packages/protocol/*|packages/game-sdk/*|packages/auth/*|apps/api-server/*)
      echo "  ✗ 禁止路径: $f"
      BLOCKED=1
      ;;
    services/room-server/src/registry.ts|services/room-server/src/room.ts|services/room-server/src/index.ts|services/room-server/src/settlement.ts|services/room-server/src/wallet.ts)
      echo "  ✗ 禁止路径: $f（房间服核心，请走全量更新）"
      BLOCKED=1
      ;;
  esac
done <<< "${CHANGED}"

# 同时改了 ≥3 个无关游戏包则拒绝
GAME_PKGS_CHANGED="$(printf '%s\n' "${CHANGED}" | grep -E '^services/games/[^/]+/' | sed -E 's|^services/games/([^/]+)/.*|\1|' | sort -u | wc -l | tr -d ' ')"
if [ "${GAME_PKGS_CHANGED}" -ge 3 ]; then
  echo "  ✗ 本次变更涉及 ${GAME_PKGS_CHANGED} 个游戏包，请使用全量 1panel-update.sh"
  BLOCKED=1
fi

if [ "${BLOCKED}" -eq 1 ]; then
  echo "[错误] 变更超出单游戏热更白名单，请执行: bash infra/1panel-update.sh" >&2
  exit 2
fi

echo "✅ 变更范围通过门禁（游戏包变更数: ${GAME_PKGS_CHANGED}）"

ENC_KEY="$(python3 -c "import urllib.parse; print(urllib.parse.quote('''${GAME_KEY}''', safe=''))" 2>/dev/null \
  || node -e "console.log(encodeURIComponent(process.argv[1]))" "${GAME_KEY}")"

admin_post() {
  local path="$1"
  local body="${2:-{}}"
  for forbidden in "${FORBIDDEN_PATHS[@]}"; do
    if [ "${path}" = "${forbidden}" ]; then
      echo "[致命] 单游戏脚本禁止调用 ${path}" >&2
      exit 99
    fi
  done
  curl -fsS --max-time 30 -X POST "${API_BASE}${path}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN_VAL}" \
    -H "content-type: application/json" \
    -d "${body}"
}

admin_get() {
  local path="$1"
  curl -fsS --max-time 8 "${API_BASE}${path}" \
    -H "Authorization: Bearer ${ADMIN_TOKEN_VAL}"
}

echo "==> 对 ${GAME_KEY} 进入排水模式..."
admin_post "/api/admin/games/${ENC_KEY}/drain" '{"message":"该游戏即将热更新，暂停新开局"}' >/dev/null

WAITED=0
while [ "${WAITED}" -lt "${MAX_DRAIN_WAIT_SEC}" ]; do
  STATUS_JSON="$(admin_get "/api/admin/games/${ENC_KEY}/status" 2>/dev/null || echo '{"activeHumanGames":0}')"
  # 若返回的是包级 games 数组，取最大 activeHumanGames
  ACTIVE="$(printf '%s' "${STATUS_JSON}" | sed -n 's/.*"activeHumanGames"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | sort -nr | head -n1)"
  ACTIVE="${ACTIVE:-0}"
  if [ "${ACTIVE}" -eq 0 ]; then
    echo "✅ 目标游戏活跃真人对局已清零"
    break
  fi
  echo "⏳ 等待 ${ACTIVE} 桌结束（${WAITED}s / ${MAX_DRAIN_WAIT_SEC}s）..."
  sleep 3
  WAITED=$((WAITED + 3))
done

if [ "${ACTIVE:-0}" -ne 0 ]; then
  echo "[错误] 排水超时，游戏保持 draining，请人工处理后再 reload。" >&2
  exit 3
fi

echo "==> 同步最新游戏源码至 room-server 容器..."
docker cp services/games/. cc-room-server:/app/services/games/ 2>/dev/null || true

echo "==> 热加载插件 ${GAME_KEY}..."
RELOAD_RES="$(admin_post "/api/admin/games/${ENC_KEY}/reload" '{}')"
echo "    reload: ${RELOAD_RES}"

echo "==> 确认启用..."
admin_post "/api/admin/games/${ENC_KEY}/enable" '{}' >/dev/null || true

echo "==> 健康核对..."
HEALTH="$(curl -fsS --max-time 5 "${API_BASE}/health" || true)"
echo "    health: ${HEALTH}"

echo "=========================================="
echo "  单游戏热更新完成: ${GAME_KEY}"
echo "  （未触发全站维护页，未发放全服补偿）"
echo "=========================================="
