import Fastify, { type FastifyRequest } from 'fastify';
import { signToken, verifyToken, type TokenPayload } from '@cc/auth';
import type { GameMeta, Settlement } from '@cc/protocol';
import { config } from './config';
import { MemoryRepository } from './repository/memory';
import { PostgresRepository } from './repository/postgres';
import type { Repository } from './repository/types';

const FALLBACK_GAMES: GameMeta[] = [
  {
    gameId: 'gomoku',
    name: '五子棋',
    description: '15 路经典五子棋，先连成五子者胜',
    icon: '⚫',
    minPlayers: 2,
    maxPlayers: 2,
    version: '1.0.0',
    clientBundle: 'builtin:gomoku',
    tags: ['棋类', '双人', '休闲'],
  },
];

async function createRepository(): Promise<Repository> {
  if (config.databaseUrl) {
    const repo = new PostgresRepository(config.databaseUrl, config.initialCoins);
    await repo.init();
    console.log('[api] 使用 PostgreSQL 仓储');
    return repo;
  }
  console.log('[api] 未配置 DATABASE_URL，使用内存仓储（重启数据丢失）');
  return new MemoryRepository(config.initialCoins);
}

function authHeader(req: FastifyRequest): TokenPayload {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = token ? verifyToken(config.jwtSecret, token) : null;
  if (!claims) {
    const error = new Error('未登录或登录已过期');
    (error as Error & { statusCode?: number }).statusCode = 401;
    throw error;
  }
  return claims;
}

async function start(): Promise<void> {
  const repo = await createRepository();
  const app = Fastify({ logger: false });

  let gamesCache: { at: number; data: GameMeta[] } = { at: 0, data: FALLBACK_GAMES };

  async function getGames(): Promise<GameMeta[]> {
    if (Date.now() - gamesCache.at < 5000 && gamesCache.data.length > 0) return gamesCache.data;
    try {
      const res = await fetch(`${config.roomServerUrl}/games`, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { games?: GameMeta[] };
      const games = Array.isArray(body.games) && body.games.length > 0 ? body.games : FALLBACK_GAMES;
      gamesCache = { at: Date.now(), data: games };
      return games;
    } catch (error) {
      console.warn('[api] 拉取游戏服列表失败，使用兜底列表', (error as Error).message);
      gamesCache = { at: Date.now(), data: FALLBACK_GAMES };
      return FALLBACK_GAMES;
    }
  }

  app.addHook('onRequest', async (req, reply) => {
    reply.header('access-control-allow-origin', config.corsOrigin);
    reply.header('access-control-allow-headers', 'content-type,authorization');
    reply.header('access-control-allow-methods', 'GET,POST,OPTIONS');
    if (req.method === 'OPTIONS') {
      await reply.status(204).send();
    }
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) console.error('[api] 请求异常', error);
    reply.status(status).send({ error: error.message });
  });

  app.get('/health', async () => ({ ok: true, storage: config.databaseUrl ? 'postgres' : 'memory' }));

  app.post('/api/login', async (req) => {
    const body = (req.body ?? {}) as { nickname?: unknown };
    const raw = typeof body.nickname === 'string' ? body.nickname.trim() : '';
    if (raw.length < 2 || raw.length > 16) {
      const error = new Error('昵称长度需在 2-16 个字符之间');
      (error as Error & { statusCode?: number }).statusCode = 400;
      throw error;
    }
    const user = await repo.loginOrCreate(raw);
    const balance = await repo.getBalance(user.id, 'coin');
    const token = signToken(config.jwtSecret, { sub: user.id, name: user.nickname }, config.tokenTtlSeconds);
    return { token, user: { ...user, balance } };
  });

  app.get('/api/me', async (req) => {
    const claims = authHeader(req);
    const user = await repo.getUser(claims.sub);
    if (!user) {
      const error = new Error('用户不存在');
      (error as Error & { statusCode?: number }).statusCode = 404;
      throw error;
    }
    const balance = await repo.getBalance(user.id, 'coin');
    return { user: { ...user, balance } };
  });

  app.get('/api/games', async () => ({ games: await getGames() }));

  app.get('/api/rooms', async (req) => {
    const query = req.query as { gameId?: string };
    try {
      const url = new URL(`${config.roomServerUrl}/rooms`);
      if (query.gameId) url.searchParams.set('gameId', query.gameId);
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      return await res.json();
    } catch {
      return { rooms: [] };
    }
  });

  app.get('/api/records', async (req) => {
    const claims = authHeader(req);
    const query = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 20) || 20, 1), 100);
    return { records: await repo.listRecords(claims.sub, limit) };
  });

  app.post('/internal/settle', async (req, reply) => {
    if (req.headers['x-internal-key'] !== config.internalKey) {
      return reply.status(403).send({ error: '内部接口鉴权失败' });
    }
    const settlement = req.body as Settlement;
    if (!settlement || typeof settlement.settlementId !== 'string' || !Array.isArray(settlement.entries)) {
      return reply.status(400).send({ error: '结算数据格式错误' });
    }
    const result = await repo.applySettlement(settlement);
    return { result };
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not found' }));

  await app.listen({ port: config.port, host: config.host });
  console.log(`[api] http://${config.host}:${config.port}`);

  const shutdown = async (): Promise<void> => {
    console.log('[api] 正在关闭...');
    await app.close();
    await repo.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

start().catch((error) => {
  console.error('[api] 启动失败', error);
  process.exit(1);
});
