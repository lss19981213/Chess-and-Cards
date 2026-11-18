export interface FantasyClawOAuthConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** 留空时按当前请求 Host 自动推导为 ${proto}://${host}/lobby/api/auth/oauth/fantasyclaw/callback */
  redirectUri: string;
  scope: string;
  lobbyUrl: string;
}

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
  /** 运营后台访问口令 */
  adminToken: string;
  oauth: {
    fantasyclaw: FantasyClawOAuthConfig;
  };
}

function env(key: string, fallback: string): string {
  const value = process.env[key];
  return value === undefined || value.length === 0 ? fallback : value;
}

const isProduction = process.env.NODE_ENV === 'production';

/** 示例值 / 开发兜底值，生产环境出现即视为未配置 */
const WEAK_SECRETS = new Set([
  'dev-secret-change-me',
  'dev-internal-key',
  'admin-dev-token',
  'please-change-this-secret',
  'please-change-this-internal-key',
]);

const MIN_SECRET_LENGTH = 32;

/**
 * 读取敏感配置。生产环境缺配置、长度不足或仍是示例值时直接抛错，
 * 避免用公开的默认密钥把服务跑起来。
 */
function secret(key: string, devFallback: string): string {
  const value = process.env[key];
  const tooWeak =
    !value || value.length < MIN_SECRET_LENGTH || WEAK_SECRETS.has(value);
  if (!tooWeak) return value;
  if (isProduction) {
    throw new Error(
      `${key} 未配置或强度不足：需要 ${MIN_SECRET_LENGTH} 位以上随机字符串，且不能使用示例值`,
    );
  }
  return value && value.length > 0 ? value : devFallback;
}

export const config: ApiConfig = {
  port: Number(env('PORT', '8080')),
  host: env('HOST', '0.0.0.0'),
  jwtSecret: secret('JWT_SECRET', 'dev-secret-change-me'),
  internalKey: secret('INTERNAL_KEY', 'dev-internal-key'),
  roomServerUrl: env('ROOM_SERVER_URL', 'http://127.0.0.1:9000'),
  databaseUrl: process.env.DATABASE_URL ?? null,
  initialCoins: Number(env('INITIAL_COINS', '1000')),
  tokenTtlSeconds: Number(env('TOKEN_TTL', '7200')),
  corsOrigin: env('CORS_ORIGIN', '*'),
  adminToken: secret('ADMIN_TOKEN', 'admin-dev-token'),
  oauth: {
    fantasyclaw: {
      baseUrl: env('FANTASYCLAW_OAUTH_BASE_URL', 'https://www.fantasyclaw.top').replace(/\/$/, ''),
      clientId: env('FANTASYCLAW_OAUTH_CLIENT_ID', ''),
      clientSecret: env('FANTASYCLAW_OAUTH_CLIENT_SECRET', ''),
      redirectUri: env('FANTASYCLAW_OAUTH_REDIRECT_URI', ''),
      scope: env('FANTASYCLAW_OAUTH_SCOPE', 'profile email'),
      lobbyUrl: env('PUBLIC_LOBBY_URL', '/lobby/'),
    },
  },
};
