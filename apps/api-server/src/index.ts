import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { config } from './config';
import { createLogger } from './logger';
import { recordEvent } from './events';
import { MemoryRepository } from './repository/memory';
import { PostgresRepository } from './repository/postgres';
import type { Repository } from './repository/types';
import { beijingDayKey, msUntilNextBeijingMidnight } from './leaderboard';
import { registerAuthRoutes } from './routes/auth';
import { registerLobbyRoutes } from './routes/lobby';
import { registerSocialRoutes } from './routes/social';
import { registerAdminAndInternalRoutes } from './routes/admin-internal';

/** 需要进入后台事件流的路径（轮询类接口不记，避免刷屏） */
const EVENT_PATHS = new Set(['/api/guest', '/api/register', '/api/login', '/api/tasks/claim']);

export async function createRepository(): Promise<Repository> {
  if (config.databaseUrl) {
    const repo = new PostgresRepository(config.databaseUrl, config.initialCoins);
    await repo.init();
    console.log('[api] 使用 PostgreSQL 仓储');
    return repo;
  }
  console.log('[api] 未配置 DATABASE_URL，使用内存仓储（重启数据丢失）');
  return new MemoryRepository(config.initialCoins);
}

export function createApiApp(repo: Repository): {
  app: FastifyInstance;
  pruneInvites: () => void;
  apiLog: ReturnType<typeof createLogger>;
} {
  const app = Fastify({
    logger: false,
    // 默认只信任本机反代（nginx）。跨机部署时用 TRUST_PROXY 指定具体代理地址。
    trustProxy: process.env.TRUST_PROXY ?? '127.0.0.1',
    bodyLimit: 1024 * 1024,
  });
  const apiLog = createLogger('api');
  const requestStart = new WeakMap<FastifyRequest, number>();

  app.addHook('onRequest', async (req, reply) => {
    requestStart.set(req, Date.now());
    reply.header('access-control-allow-origin', config.corsOrigin);
    reply.header('access-control-allow-headers', 'content-type,authorization');
    reply.header('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      await reply.status(204).send();
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    const started = requestStart.get(req);
    const durationMs = started ? Date.now() - started : 0;
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const status = reply.statusCode;
    const detail = { method: req.method, path, status, durationMs };

    if (status >= 400) {
      apiLog.warn('HTTP 请求异常', detail);
      recordEvent('warn', 'http', `${req.method} ${path} → ${status}`, detail);
    } else {
      apiLog.debug('HTTP 请求', detail);
      if (EVENT_PATHS.has(path)) {
        recordEvent('info', 'http', `${req.method} ${path} → ${status}`, detail);
      }
    }
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, req, reply) => {
    const status = error.statusCode ?? 500;
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    apiLog.error('请求处理异常', { method: req.method, path, status, error: error.message });
    recordEvent('error', 'http', `${req.method} ${path} 处理失败：${error.message}`, {
      method: req.method,
      path,
      status,
    });
    // 5xx 不把内部错误细节回传客户端，避免泄漏 SQL 与约束名
    const message = status >= 500 ? '服务暂时不可用，请稍后重试' : error.message;
    reply.status(status).send({ error: message });
  });

  registerAuthRoutes(app, repo);
  registerLobbyRoutes(app, repo);
  const pruneInvites = registerSocialRoutes(app, repo);
  registerAdminAndInternalRoutes(app, repo, apiLog);

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not found' }));

  return { app, pruneInvites, apiLog };
}

export async function start(): Promise<void> {
  const repo = await createRepository();
  const { app, pruneInvites, apiLog } = createApiApp(repo);

  await app.listen({ port: config.port, host: config.host });
  apiLog.info('HTTP 服务已启动', { host: config.host, port: config.port });

  const settleDaily = async (): Promise<void> => {
    const dayKey = beijingDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const existing = await repo.listDailySnapshot(dayKey);
    if (existing.length > 0) return;
    const total = await repo.settleDailyLeaderboard(dayKey);
    apiLog.info('每日排行榜结算完成', { dayKey, total });
  };

  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleDailySettle = (): void => {
    settleTimer = setTimeout(() => {
      void settleDaily().catch((error: unknown) => {
        apiLog.error('每日排行榜结算失败', { error: (error as Error).message });
      });
      scheduleDailySettle();
    }, msUntilNextBeijingMidnight() + 5_000);
    settleTimer.unref?.();
  };
  scheduleDailySettle();
  void settleDaily().catch((error: unknown) => {
    apiLog.error('启动补结算失败', { error: (error as Error).message });
  });

  const invitePruneTimer = setInterval(pruneInvites, 10 * 60_000);
  invitePruneTimer.unref?.();

  const shutdown = async (): Promise<void> => {
    console.log('[api] 正在关闭...');
    await app.close();
    await repo.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

const isEntry = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntry) {
  start().catch((error) => {
    console.error('[api] 启动失败', error);
    process.exit(1);
  });
}
