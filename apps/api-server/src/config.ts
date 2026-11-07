export interface ApiConfig {
  port: number;
  host: string;
  jwtSecret: string;
  internalKey: string;
  roomServerUrl: string;
  databaseUrl: string | null;
  initialCoins: number;
  tokenTtlSeconds: number;
  corsOrigin: string;
}

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? fallback : value;
}

export const config: ApiConfig = {
  port: Number(env('PORT', '8080')),
  host: env('HOST', '0.0.0.0'),
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-me'),
  internalKey: env('INTERNAL_KEY', 'dev-internal-key'),
  roomServerUrl: env('ROOM_SERVER_URL', 'http://127.0.0.1:9000'),
  databaseUrl: process.env.DATABASE_URL ?? null,
  initialCoins: Number(env('INITIAL_COINS', '1000')),
  tokenTtlSeconds: Number(env('TOKEN_TTL', '7200')),
  corsOrigin: env('CORS_ORIGIN', '*'),
};
