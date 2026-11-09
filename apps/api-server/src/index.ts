import Fastify, { type FastifyRequest } from 'fastify';
import { signToken, verifyToken, type TokenPayload } from '@cc/auth';
import type { GameMeta, Settlement } from '@cc/protocol';
import { config } from './config';
import { createLogger } from './logger';
import { getLastSettlementAt, markSettlement, recordEvent, recentEvents } from './events';
import { MemoryRepository } from './repository/memory';
import { PostgresRepository } from './repository/postgres';
import { InsufficientFundsError } from './repository/types';
import type { Repository } from './repository/types';
import { LEADERBOARD_SIZE, beijingDayKey, rewardForRank } from './leaderboard';
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
const apiLog = createLogger('api');
const requestStart = new WeakMap<FastifyRequest, number>();

/** 需要进入后台事件流的路径（轮询类接口不记，避免刷屏） */
const EVENT_PATHS = new Set([
  '/api/register',
  '/api/login',
  '/api/tasks/claim',
  '/api/assistant/chat',
]);

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

    // 当日玩过的不同游戏数量，用于「多面手」这类任务
    const playedToday = new Set(
      rows
        .filter((row) => row.periodKey === dailyKey && row.taskKey.startsWith('game_'))
        .map((row) => row.taskKey),
    ).size;

    return TASKS.map((task) => {
      const pk = periodKeyFor(task.period);
      const ownRow = rows.find((r) => r.taskKey === task.key && r.periodKey === pk);

      let progress = 0;
      if (task.progressSource?.kind === 'gameKinds') {
        progress = playedToday;
      } else {
        const sourceKey = task.progressSource?.key ?? task.key;
        const row = rows.find((r) => r.taskKey === sourceKey && r.periodKey === pk);
        progress = row?.progress ?? 0;
      }

      // 领取状态永远记在任务自身 key 上，避免共用进度时互相顶掉
      const claimed = ownRow?.claimed ?? false;
      const reached = progress >= task.target;
      const blocked = task.maxBalance !== undefined && balance >= task.maxBalance;

      return {
        key: task.key,
        name: task.name,
        description: task.description,
        target: task.target,
        reward: task.reward,
        period: task.period,
        group: task.group,
        progress: Math.min(progress, task.target),
        claimed,
        claimable: reached && !claimed && !blocked,
        locked: blocked && !claimed,
        lockReason: blocked && !claimed ? `筹码需少于 ${task.maxBalance}` : undefined,
      };
    });
  }

  app.addHook('onRequest', async (req, reply) => {
    requestStart.set(req, Date.now());
    reply.header('access-control-allow-origin', config.corsOrigin);
    reply.header('access-control-allow-headers', 'content-type,authorization');
    reply.header('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      await reply.status(204).send();
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    const started = requestStart.get(req);
    const durationMs = started ? Date.now() - started : 0;
    const path = (req.url ?? '/').split('?')[0] ?? '/';
    const status = reply.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
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
    reply.status(status).send({ error: error.message });
  });

  app.get('/health', async () => ({ ok: true, storage: config.databaseUrl ? 'postgres' : 'memory' }));

  app.get('/api/captcha', async () => createCaptcha());

  app.post('/api/guest', async () => {
    const rand = Math.floor(1000 + Math.random() * 9000);
    const username = 'guest_' + Date.now().toString(36) + '_' + rand;
    const nickname = '尊贵牌友_' + rand;
    const passwordHash = await hashPassword('guest123456');
    const result = await repo.register({ username, passwordHash, nickname });
    if (!result.ok) throw httpError('游客账号生成失败', 500);

    const balance = await repo.getBalance(result.user.id, 'coin');
    await repo.bumpTask(result.user.id, 'daily_login', periodKeyFor('daily'), 1);
    const token = signToken(config.jwtSecret, { sub: result.user.id, name: result.user.nickname }, config.tokenTtlSeconds);
    return { token, user: { ...result.user, balance } };
  });

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

  // 打赏荷官：真实扣减筹码并推进当日打赏任务
  app.post('/api/tip-dealer', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const amount = Math.floor(Number(body.amount ?? 0));
    const giftName = String(body.giftName ?? '礼物').slice(0, 20);

    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) {
      throw httpError('打赏金额不合法', 400);
    }

    const balance = await repo.getBalance(claims.sub, 'coin');
    if (balance < amount) throw httpError('筹码不足，先去福利中心领取救济金吧', 400);

    // 每次打赏是独立事件，幂等键带时间戳避免重复提交时被吞掉
    const bizId = `tip:${claims.sub}:${Date.now()}`;
    const newBalance = await repo.credit(claims.sub, -amount, 'dealer_tip', bizId);
    await repo.bumpTask(claims.sub, 'daily_tip', periodKeyFor('daily'), 1);

    return { ok: true, balance: newBalance, amount, giftName };
  });

  app.get('/api/leaderboard', async (req) => {
    // 榜单只展示前 10 名
    const rows = await repo.leaderboard(LEADERBOARD_SIZE);

    let myRank: number | null = null;
    let myUserId: string | null = null;
    try {
      const claims = authHeader(req);
      myUserId = claims.sub;
      myRank = await repo.leaderboardRank(claims.sub);
    } catch {
      /* 未登录也允许查看排行榜 */
    }

    return {
      entries: rows.map((row, index) => ({
        rank: index + 1,
        userId: row.userId,
        nickname: row.nickname,
        balance: row.balance,
        reward: rewardForRank(index + 1),
        title: titleFor(index + 1),
      })),
      myRank,
      myUserId,
    };
  });

  /** 最近一期的排行榜结算快照（每日 0 点结算并发奖） */
  app.get('/api/leaderboard/rewards', async () => {
    const today = beijingDayKey();
    let dayKey = today;
    let entries = await repo.listDailySnapshot(today);
    if (entries.length === 0) {
      dayKey = beijingDayKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
      entries = await repo.listDailySnapshot(dayKey);
    }
    return { dayKey, entries };
  });

  app.get('/api/leaderboard/daily', async (req) => {
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit ?? 10) || 10, 1), 50);
    const rows = await repo.dailyWinners(limit);
    const dayKey = periodKeyFor('daily');
    return { dayKey, entries: rows };
  });

  // ---- 运营后台（口令鉴权）----
  app.get('/api/admin/overview', async (req) => {
    const token = String((req.query as { token?: string }).token ?? '');
    if (!config.adminToken || token !== config.adminToken) {
      throw httpError('后台口令不正确', 403);
    }

    const safeFetch = async (path: string): Promise<Record<string, unknown>> => {
      try {
        const res = await fetch(`${config.roomServerUrl}${path}`, {
          signal: AbortSignal.timeout(2500),
        });
        if (!res.ok) return {};
        return (await res.json()) as Record<string, unknown>;
      } catch {
        return {};
      }
    };

    const [roomData, gameData] = await Promise.all([
      safeFetch('/rooms'),
      safeFetch('/games'),
    ]);

    const rooms = (roomData.rooms as Array<Record<string, unknown>>) ?? [];
    const games = (gameData.games as Array<Record<string, unknown>>) ?? [];
    const daily = await repo.dailyWinners(10);
    const dayKey = periodKeyFor('daily');

    const totalOnline = rooms.reduce((sum, room) => sum + Number(room.players ?? 0), 0);
    const humans = rooms.reduce((sum, room) => sum + Number(room.humans ?? 0), 0);
    const bots = rooms.reduce((sum, room) => sum + Number(room.bots ?? 0), 0);
    const platformRooms = rooms.filter((room) => room.persistent === true).length;
    const playerRooms = rooms.length - platformRooms;

    apiLog.info('后台拉取总览', { rooms: rooms.length, online: totalOnline, humans, bots });

    return {
      dayKey,
      lastSettlementAt: getLastSettlementAt(),
      summary: {
        rooms: rooms.length,
        platformRooms,
        playerRooms,
        online: totalOnline,
        humans,
        bots,
        games: games.length,
      },
      rooms,
      games,
      daily,
    };
  });

  app.get('/api/announcements', async (req) => {
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit ?? 8) || 8, 1), 50);
    return { announcements: await repo.listAnnouncements(limit) };
  });

  app.post('/api/admin/announcements', async (req) => {
    const query = req.query as { token?: string };
    if (!config.adminToken || query.token !== config.adminToken) {
      throw httpError('后台口令不正确', 403);
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = String(body.title ?? '').trim();
    const content = String(body.content ?? '').trim();
    const kind = String(body.kind ?? 'notice');
    if (!title || title.length > 40) throw httpError('标题需在 1–40 字之间', 400);
    if (!content || content.length > 300) throw httpError('内容需在 1–300 字之间', 400);
    if (!['notice', 'event', 'maintenance'].includes(kind)) throw httpError('公告类型不合法', 400);

    const row = await repo.createAnnouncement({
      title,
      content,
      kind: kind as 'notice' | 'event' | 'maintenance',
    });
    apiLog.info('发布公告', { id: row.id, title, kind });
    recordEvent('info', 'announce', `发布公告「${title}」`, { id: row.id, kind });
    return { announcement: row };
  });

  app.delete('/api/admin/announcements/:id', async (req) => {
    const query = req.query as { token?: string };
    if (!config.adminToken || query.token !== config.adminToken) {
      throw httpError('后台口令不正确', 403);
    }
    const id = String((req.params as { id?: string }).id ?? '');
    const ok = await repo.deleteAnnouncement(id);
    if (!ok) throw httpError('公告不存在', 404);
    apiLog.info('删除公告', { id });
    recordEvent('warn', 'announce', `删除公告 ${id}`, { id });
    return { ok: true };
  });

  app.get('/api/admin/events', async (req) => {
    const query = req.query as { token?: string; limit?: string };
    if (!config.adminToken || query.token !== config.adminToken) {
      throw httpError('后台口令不正确', 403);
    }
    const limit = Math.min(Math.max(Number(query.limit ?? 60) || 60, 1), 240);
    return { events: recentEvents(limit) };
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

    const balance = await repo.getBalance(claims.sub, 'coin');

    const raw = assistantReady()
      ? await askAssistant([...history, { role: 'user', content: message }], balance)
      : null;

    if (!raw) {
      return { reply: fallbackReply(message), granted: 0, balance, fallback: true };
    }

    const { text, grant } = splitGrant(raw);
    // 只有玩家真的在求助时，才进入发放判定，避免模型在普通问答里误加标记
    const wantsHelp = /(筹码|救济|输光|没钱|破产|给点|送点|借点|补助|帮帮我)/.test(message);
    let granted = 0;
    let note = '';

    if (grant && wantsHelp) {
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

  /** 下注即时扣款 / 撤注退款。余额校验在数据库原子完成，拒绝超额下注。 */
  app.post('/internal/wallet', async (req, reply) => {
    if (req.headers['x-internal-key'] !== config.internalKey) {
      return reply.status(403).send({ error: '内部接口鉴权失败' });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const playerId = typeof body.playerId === 'string' ? body.playerId : '';
    const bizId = typeof body.bizId === 'string' ? body.bizId : '';
    const amount = Number(body.amount);
    const action = body.action === 'debit' || body.action === 'refund' ? body.action : '';
    if (
      !playerId || !bizId || !action || !Number.isInteger(amount) ||
      (action === 'debit' && (amount <= 0 || amount > 1_000_000))
    ) {
      return reply.status(400).send({ error: '扣款参数不合法' });
    }
    try {
      const balance = await repo.adjustBet({ userId: playerId, amount, action, bizId });
      return { balance };
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        return reply.status(409).send({ error: error.message });
      }
      throw error;
    }
  });

  /** 房间销毁后释放该房间未结算的下注扣款，避免筹码悬空 */
  app.post('/internal/wallet/release', async (req, reply) => {
    if (req.headers['x-internal-key'] !== config.internalKey) {
      return reply.status(403).send({ error: '内部接口鉴权失败' });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    // 不传 roomId 表示房间服务刚重启，全量清理孤儿扣款
    const roomId = typeof body.roomId === 'string' && body.roomId ? body.roomId : undefined;
    const released = await repo.releaseOrphanBets(roomId);
    return { released };
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
    markSettlement();
    const detail = {
      settlementId: settlement.settlementId,
      gameId: settlement.gameId,
      round: settlement.round,
      entries: settlement.entries.length,
      result,
    };

    // 纯氛围局（无真人流水）每几十秒一次，不进后台事件流以免刷屏
    if (settlement.entries.length > 0) {
      if (result === 'duplicate') {
        apiLog.warn('重复结算上报', detail);
        recordEvent('warn', 'settle', `重复结算 ${settlement.gameId} 第 ${settlement.round} 局`, detail);
      } else {
        apiLog.info('结算入账', detail);
        recordEvent('info', 'settle', `${settlement.gameId} 第 ${settlement.round} 局结算入账`, detail);
      }
    }
    return { result };
  });

  app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'not found' }));

  await app.listen({ port: config.port, host: config.host });
  apiLog.info('HTTP 服务已启动', { host: config.host, port: config.port });

  // 每日 0 点结算排行榜并发奖。发奖走 credit 的幂等键，重复触发不会重复发放。
  let settledDay = '';
  const settleDaily = async (): Promise<void> => {
    const dayKey = beijingDayKey();
    if (settledDay === dayKey) return;
    settledDay = dayKey;
    const total = await repo.settleDailyLeaderboard(dayKey);
    apiLog.info('每日排行榜结算完成', { dayKey, total });
  };
  const settleTimer = setInterval(() => {
    void settleDaily().catch((error: unknown) => {
      settledDay = '';
      apiLog.error('每日排行榜结算失败', { error: (error as Error).message });
    });
  }, 30_000);
  settleTimer.unref?.();
  void settleDaily().catch(() => undefined);

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
