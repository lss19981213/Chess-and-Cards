export interface BotConfig {
  enabled: boolean;
  /** 机器人「思考」停留时间（毫秒），避免操作过快 */
  thinkMs: number;
}

export interface RoomServerConfig {
  port: number;
  /** 监听地址，默认只监听本机，由 nginx 反代 */
  host: string;
  jwtSecret: string;
  apiBaseUrl: string;
  internalKey: string;
  /** 允许连接 WebSocket 的来源，逗号分隔；留空则只允许同源 */
  allowedOrigins: string[];
  corsOrigin: string;
  /** 结算 outbox 目录，落盘后重投，避免丢结算 */
  outboxDir: string;
  /** 断线宽限期，超时视为离开房间 */
  disconnectGraceMs: number;
  bot: BotConfig;
}

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? fallback : value;
}

const isProduction = process.env.NODE_ENV === 'production';
const WEAK_SECRETS = new Set([
  'dev-secret-change-me',
  'dev-internal-key',
  'please-change-this-secret',
  'please-change-this-internal-key',
]);

function secret(key: string, devFallback: string): string {
  const value = process.env[key];
  if (value && value.length >= 32 && !WEAK_SECRETS.has(value)) return value;
  if (isProduction) {
    throw new Error(
      `${key} 未配置或强度不足：需要 32 位以上随机字符串，且不能使用示例值`,
    );
  }
  return value && value.length > 0 ? value : devFallback;
}

export const config: RoomServerConfig = {
  port: Number(env('ROOM_PORT', '9000')),
  host: env('ROOM_HOST', '127.0.0.1'),
  jwtSecret: secret('JWT_SECRET', 'dev-secret-change-me'),
  apiBaseUrl: env('API_BASE_URL', 'http://127.0.0.1:8080'),
  internalKey: secret('INTERNAL_KEY', 'dev-internal-key'),
  allowedOrigins: env('WS_ALLOWED_ORIGINS', '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  corsOrigin: env('CORS_ORIGIN', ''),
  outboxDir: env('SETTLEMENT_OUTBOX_DIR', '.outbox'),
  disconnectGraceMs: Number(env('DISCONNECT_GRACE_MS', '60000')),
  bot: {
    enabled: env('BOT_ENABLED', 'true') === 'true',
    thinkMs: Number(env('BOT_THINK_MS', '700')),
  },
};
