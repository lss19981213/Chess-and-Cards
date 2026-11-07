export interface RoomServerConfig {
  port: number;
  jwtSecret: string;
  apiBaseUrl: string;
  internalKey: string;
  /** 断线宽限期，超时视为离开房间 */
  disconnectGraceMs: number;
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
};
