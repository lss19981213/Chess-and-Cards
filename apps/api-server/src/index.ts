import Fastify, { type FastifyRequest } from 'fastify';
import { signToken, verifyToken, type TokenPayload } from '@cc/auth';
import type { GameMeta, Settlement } from '@cc/protocol';
import { config } from './config';
import { MemoryRepository } from './repository/memory';
import { PostgresRepository } from './repository/postgres';
import type { Repository } from './repository/types';
import {
  AttemptLimiter,
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_PATTERN,
  consumeCaptcha,
  createCaptcha,
  hashPassword,
  verifyPassword,
} from './security';
import { TASKS, findTask, periodKeyFor, titleFor, type TaskView } from './tasks';
import {
  GRANT_AMOUNT,
  GRANT_MAX_BALANCE,
  askAssistant,
  assistantReady,
  fallbackReply,
  splitGrant,
  type ChatMessage,
} from './assistant';

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
  {
    gameId: 'doudizhu',
    name: '斗地主',
    description: '经典三人斗地主，抢地主抢先出完手牌',
    icon: '🃏',
    minPlayers: 3,
    maxPlayers: 3,
    version: '1.0.0',
    clientBundle: 'builtin:doudizhu',
    tags: ['牌类', '三人', '热门'],
  },
  {
    gameId: 'paodekuai',
    name: '跑得快',
    description: '16 张牌快节奏对局，先跑完者胜',
    icon: '💨',
    minPlayers: 3,
    maxPlayers: 3,
    version: '1.0.0',
    clientBundle: 'builtin:paodekuai',
    tags: ['牌类', '三人', '快节奏'],
  },
  {
    gameId: 'tuizhuanzi',
    name: '推筒子',
    description: '两张牌比点数，庄闲对决一局定胜负',
    icon: '🎴',
    minPlayers: 2,
    maxPlayers: 5,
    version: '1.0.0',
    clientBundle: 'builtin:tuizhuanzi',
    tags: ['牌类', '多人', '刺激'],
  },
  {
    gameId: 'texas',
    name: '德州扑克',
    description: '两张底牌加五张公共牌，比牌型大小',
    icon: '♠️',
    minPlayers: 2,
    maxPlayers: 6,
    version: '1.0.0',
    clientBundle: 'builtin:texas',
    tags: ['牌类', '多人', '竞技'],
  },
];

function httpError(message: string, statusCode: number): Error {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

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
  if (!claims) throw httpError('未登录或登录已过期', 401);
  return claims;
}

function clientIp(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? 'unknown';
  }
  return req.ip ?? 'unknown';
}

async function start(): Promise<void> {
  const repo = await createRepository();
  const app = Fastify({ logger: false });

  // 登录防爆破：IP 维度 10 次 / 10 分钟，账号维度 5 次 / 10 分钟
  const ipLimiter = new AttemptLimiter(10, 10 * 60_000);
  const accountLimiter = new AttemptLimiter(5, 10 * 60_000);
  // AI 助手：每用户每分钟最多 20 次
  const assistantLimiter = new AttemptLimiter(20, 60_000);

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

  async function buildTasks(userId: string, balance: number): Promise<TaskView[]> {
    const dailyKey = periodKeyFor('daily');
    const onceKey = periodKeyFor('once');
    const rows = await repo.getTaskRows(userId, [dailyKey, onceKey]);

    return TASKS.map((task) => {
      const pk = periodKeyFor(task.period);
      const row = rows.find((r) => r.taskKey === task.key && r.periodKey === pk);
      const progress = row?.progress ?? 0;
      const claimed = row?.claimed ?? false;
      const reached = progress >= task.target;
      const blocked = task.maxBalance !== undefined && balance >= task.maxBalance;

      return {
        key: task.key,
        name: task.name,
        description: task.description,
        target: task.target,
        reward: task.reward,
        period: task.period,
        progress: Math.min(progress, task.target),
        claimed,
        claimable: reached && !claimed && !blocked,
        locked: blocked && !claimed,
        lockReason: blocked && !claimed ? `筹码需少于 ${task.maxBalance}` : undefined,
      };
    });
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

  app.get('/api/captcha', async () => createCaptcha());

  app.post('/api/register', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const nicknameRaw = typeof body.nickname === 'string' ? body.nickname.trim() : '';
    const captchaId = typeof body.captchaId === 'string' ? body.captchaId : '';
    const captcha = typeof body.captcha === 'string' ? body.captcha : '';

    const ipKey = clientIp(req);
    const ipState = ipLimiter.check(ipKey);
    if (!ipState.allowed) throw httpError('操作过于频繁，请稍后再试', 429);

    if (!consumeCaptcha(captchaId, captcha)) {
      ipLimiter.fail(ipKey);
      throw httpError('验证码错误或已过期', 400);
    }
    if (!USERNAME_PATTERN.test(username)) {
      throw httpError('账号需为 4-20 位字母、数字或下划线', 400);
    }
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw httpError(`密码长度需在 ${PASSWORD_MIN}-${PASSWORD_MAX} 位之间`, 400);
    }

    const nickname = nicknameRaw.length >= 2 && nicknameRaw.length <= 12 ? nicknameRaw : username;
    const passwordHash = await hashPassword(password);
    const result = await repo.register({ username, passwordHash, nickname });
    if (!result.ok) throw httpError('该账号已被注册', 409);

    ipLimiter.reset(ipKey);
    const balance = await repo.getBalance(result.user.id, 'coin');
    await repo.bumpTask(result.user.id, 'daily_login', periodKeyFor('daily'), 1);
    const token = signToken(config.jwtSecret, { sub: result.user.id, name: result.user.nickname }, config.tokenTtlSeconds);
    return { token, user: { ...result.user, balance } };
  });

  app.post('/api/login', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const captchaId = typeof body.captchaId === 'string' ? body.captchaId : '';
    const captcha = typeof body.captcha === 'string' ? body.captcha : '';

    const ipKey = clientIp(req);
    const accountKey = username.toLowerCase() || 'anonymous';

    const ipState = ipLimiter.check(ipKey);
    if (!ipState.allowed) {
      throw httpError(`尝试次数过多，请 ${Math.ceil(ipState.remainingMs / 60000)} 分钟后再试`, 429);
    }
    const accountState = accountLimiter.check(accountKey);
    if (!accountState.allowed) {
      throw httpError(`该账号已被临时锁定，请 ${Math.ceil(accountState.remainingMs / 60000)} 分钟后再试`, 429);
    }

    if (!consumeCaptcha(captchaId, captcha)) {
      ipLimiter.fail(ipKey);
      accountLimiter.fail(accountKey);
      throw httpError('验证码错误或已过期', 400);
    }

    const user = username ? await repo.findByUsername(username) : null;
    const matched = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!user || !matched) {
      ipLimiter.fail(ipKey);
      accountLimiter.fail(accountKey);
      throw httpError('账号或密码错误', 401);
    }

    ipLimiter.reset(ipKey);
    accountLimiter.reset(accountKey);

    const balance = await repo.getBalance(user.id, 'coin');
    await repo.bumpTask(user.id, 'daily_login', periodKeyFor('daily'), 1);
    const token = signToken(config.jwtSecret, { sub: user.id, name: user.nickname }, config.tokenTtlSeconds);
    return {
      token,
      user: { id: user.id, nickname: user.nickname, username: user.username, createdAt: user.createdAt, balance },
    };
  });

  app.get('/api/me', async (req) => {
    const claims = authHeader(req);
    const user = await repo.getUser(claims.sub);
    if (!user) throw httpError('用户不存在', 404);
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

  app.get('/api/tasks', async (req) => {
    const claims = authHeader(req);
    const balance = await repo.getBalance(claims.sub, 'coin');
    return { balance, tasks: await buildTasks(claims.sub, balance) };
  });

  app.post('/api/tasks/claim', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = typeof body.key === 'string' ? body.key : '';
    const task = findTask(key);
    if (!task) throw httpError('任务不存在', 404);

    const pk = periodKeyFor(task.period);
    const balance = await repo.getBalance(claims.sub, 'coin');
    const views = await buildTasks(claims.sub, balance);
    const view = views.find((v) => v.key === key);
    if (!view) throw httpError('任务不存在', 404);
    if (view.claimed) throw httpError('该任务奖励已领取', 409);
    if (view.locked) throw httpError(view.lockReason ?? '当前无法领取', 400);
    if (view.progress < task.target) throw httpError('任务尚未完成', 400);

    const newBalance = await repo.credit(claims.sub, task.reward, 'task', `${key}:${pk}`);
    const claimed = await repo.claimTask(claims.sub, key, pk);
    if (!claimed) throw httpError('该任务奖励已领取', 409);

    return { reward: task.reward, balance: newBalance, tasks: await buildTasks(claims.sub, newBalance) };
  });

  app.get('/api/leaderboard', async (req) => {
    const query = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 100);
    const rows = await repo.leaderboard(limit);

    let myRank: number | null = null;
    let myUserId: string | null = null;
    try {
      const claims = authHeader(req);
      myUserId = claims.sub;
      const index = rows.findIndex((row) => row.userId === claims.sub);
      myRank = index >= 0 ? index + 1 : null;
    } catch {
      /* 未登录也允许查看排行榜 */
    }

    return {
      entries: rows.map((row, index) => ({
        rank: index + 1,
        userId: row.userId,
        nickname: row.nickname,
        balance: row.balance,
        title: titleFor(index + 1),
      })),
      myRank,
      myUserId,
    };
  });

  app.post('/api/assistant/chat', async (req) => {
    const claims = authHeader(req);
    const state = assistantLimiter.check(claims.sub);
    if (!state.allowed) throw httpError('问得有点快，喝口水再来问我', 429);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 400) : '';
    if (!message) throw httpError('说点什么吧', 400);

    const rawHistory = Array.isArray(body.history) ? body.history : [];
    const history: ChatMessage[] = rawHistory
      .filter(
        (item): item is { role: string; content: string } =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as { role?: unknown }).role === 'string' &&
          typeof (item as { content?: unknown }).content === 'string',
      )
      .slice(-6)
      .map((item) => ({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        content: item.content.slice(0, 400),
      }));

    assistantLimiter.fail(claims.sub);

    const raw = assistantReady()
      ? await askAssistant([...history, { role: 'user', content: message }])
      : null;

    const balance = await repo.getBalance(claims.sub, 'coin');

    if (!raw) {
      return { reply: fallbackReply(message), granted: 0, balance, fallback: true };
    }

    const { text, grant } = splitGrant(raw);
    let granted = 0;
    let note = '';

    if (grant) {
      if (balance >= GRANT_MAX_BALANCE) {
        note = '\n\n（牌友，你筹码还厚实，机会留给真断粮的兄弟吧～）';
      } else {
        const dayKey = periodKeyFor('daily');
        const fresh = await repo.claimTask(claims.sub, 'assistant_grant', dayKey);
        if (!fresh) {
          note = '\n\n（今天的救济已经给过你啦，明天再来找我。）';
        } else {
          granted = GRANT_AMOUNT;
          await repo.credit(claims.sub, granted, 'assistant', `${claims.sub}:${dayKey}`);
        }
      }
    }

    const newBalance = granted > 0 ? await repo.getBalance(claims.sub, 'coin') : balance;
    return { reply: text + note, granted, balance: newBalance };
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
