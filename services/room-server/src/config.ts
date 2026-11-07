export interface BotConfig {
  enabled: boolean;
  /** 智谱开放平台的 API Key，留空则只用规则 AI */
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  /** 机器人「思考」停留时间，避免操作过快 */
  thinkMs: number;
}

export interface RoomServerConfig {
  port: number;
  jwtSecret: string;
  apiBaseUrl: string;
  internalKey: string;
  /** 断线宽限期，超时视为离开房间 */
  disconnectGraceMs: number;
  bot: BotConfig;
}

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? fallback : value;
}

export const config: RoomServerConfig = {
  port: Number(env('ROOM_PORT', '9000')),
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me'),
  apiBaseUrl: env('API_BASE_URL', 'http://127.0.0.1:8080'),
  internalKey: env('INTERNAL_KEY', 'dev-internal-key'),
  disconnectGraceMs: Number(env('DISCONNECT_GRACE_MS', '60000')),
  bot: {
    enabled: env('BOT_ENABLED', 'true') === 'true',
    apiKey: env('ZHIPU_API_KEY', ''),
    baseUrl: env('ZHIPU_BASE_URL', 'https://open.bigmodel.cn/api/paas/v4'),
    model: env('ZHIPU_MODEL', 'glm-4-flash'),
    timeoutMs: Number(env('ZHIPU_TIMEOUT_MS', '3000')),
    thinkMs: Number(env('BOT_THINK_MS', '700')),
  },
};
