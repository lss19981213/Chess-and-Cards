#!/usr/bin/env bash
# 数据库每日备份。建议配置 cron：
#   0 4 * * * /opt/chess-and-cards/infra/backup-db.sh >> /var/log/cc-backup.log 2>&1
set -euo pipefail

APP_DIR=/opt/chess-and-cards
BACKUP_DIR="${BACKUP_DIR:-/var/backups/chess-cards}"
KEEP_DAYS="${KEEP_DAYS:-14}"

cd "$APP_DIR"
if [ ! -f .env ]; then
  echo "缺少 $APP_DIR/.env" >&2
  exit 1
fi

DATABASE_URL="$(grep -E '^DATABASE_URL=' .env | head -1 | cut -d= -f2-)"
if [ -z "$DATABASE_URL" ]; then
  echo "未配置 DATABASE_URL，跳过备份" >&2
  exit 0
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$BACKUP_DIR/chess_cards-$STAMP.sql.gz"

# 用环境变量传连接串，避免出现在命令行参数里
PGPASSWORD="" pg_dump --no-owner --no-privileges --dbname="$DATABASE_URL" | gzip > "$FILE"
chmod 600 "$FILE"

# 清理过期备份
find "$BACKUP_DIR" -name 'chess_cards-*.sql.gz' -mtime +"$KEEP_DAYS" -delete

echo "备份完成：$FILE"
