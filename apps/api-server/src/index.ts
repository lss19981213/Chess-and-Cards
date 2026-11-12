import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyRequest } from 'fastify';
import { signToken, verifyToken, type TokenPayload } from '@cc/auth';
import type { GameMeta, Settlement } from '@cc/protocol';
import { config } from './config';
import { FALLBACK_GAMES } from './game-catalog';
import { createLogger } from './logger';
import { getLastSettlementAt, markSettlement, recordEvent, recentEvents } from './events';
import { MemoryRepository } from './repository/memory';
import { PostgresRepository } from './repository/postgres';
import { InsufficientFundsError } from './repository/types';
import type { Repository } from './repository/types';
import {
  LEADERBOARD_SIZE,
  beijingDayKey,
  msUntilNextBeijingMidnight,
  rewardForRank,
} from './leaderboard';
import {
  AttemptLimiter,
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_PATTERN,
  burnPasswordCheck,
  consumeCaptcha,
  createCaptcha,
  hashPassword,
  verifyPassword,
} from './security';
import { TASKS, findTask, periodKeyFor, titleFor, type TaskView } from './tasks';


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

/**
 * 只在 Fastify 按 trustProxy 配置解析后取 IP。
 * 直接读 X-Forwarded-For 首段会被客户端伪造，导致限流形同虚设。
 */
function clientIp(req: FastifyRequest): string {
  return req.ip || 'unknown';
}

// 列表接口会随好友/搜索结果返回头像，体积必须压小，否则 N 个好友就是 N×体积
const AVATAR_MAX_BYTES = 64 * 1024;

/** 头像以 data URL 入库，这里校验真实体积与文件头，防止伪造 MIME 塞任意内容 */
function assertValidAvatar(raw: string): void {
  const match = /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!match?.[1]) throw httpError('头像格式不支持，请使用 PNG / JPG / WebP', 400);
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) {
    throw httpError('头像文件过大，请重新选择', 400);
  }
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp =
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!isPng && !isJpeg && !isWebp) throw httpError('头像内容与声明的格式不符', 400);
}

async function start(): Promise<void> {
  const repo = await createRepository();
  const app = Fastify({
    logger: false,
    // 默认只信任本机反代（nginx）。跨机部署时用 TRUST_PROXY 指定具体代理地址。
    trustProxy: process.env.TRUST_PROXY ?? '127.0.0.1',
    bodyLimit: 1024 * 1024,
  });
const apiLog = createLogger('api');
const requestStart = new WeakMap<FastifyRequest, number>();

/** 房间邀请短时效缓存（30 分钟），进程内存储，重启即清空 */
interface RoomInviteRecord {
  id: string;
  fromId: string;
  fromNickname: string;
  fromAvatar: string | null;
  toId: string;
  roomId: string;
  gameId: string;
  roomName: string;
  createdAt: number;
}

const INVITE_TTL_MS = 30 * 60_000;
const roomInvites: RoomInviteRecord[] = [];

function pruneInvites(): void {
  const deadline = Date.now() - INVITE_TTL_MS;
  for (let i = roomInvites.length - 1; i >= 0; i -= 1) {
    if (roomInvites[i]!.createdAt < deadline) roomInvites.splice(i, 1);
  }
}

/** 需要进入后台事件流的路径（轮询类接口不记，避免刷屏） */
const EVENT_PATHS = new Set([
  '/api/register',
  '/api/login',
  '/api/tasks/claim',
]);

  // 登录防爆破：IP 维度 10 次 / 10 分钟，账号维度 5 次 / 10 分钟
  const ipLimiter = new AttemptLimiter(10, 10 * 60_000);
  const accountLimiter = new AttemptLimiter(5, 10 * 60_000);
  // 游客注册：每 IP 10 分钟 5 个，既防批量建号刷榜，也容忍同网段多人使用
  const guestLimiter = new AttemptLimiter(5, 10 * 60_000);
  // GM 接口：每 IP 每分钟 120 次；口令错误单独限 5 次 / 5 分钟
  const adminLimiter = new AttemptLimiter(120, 60_000);
  const adminFailLimiter = new AttemptLimiter(5, 5 * 60_000);

  /** 从 Authorization: Bearer <token> 取 GM 口令 */
  function adminTokenOf(req: FastifyRequest): string {
    const header = req.headers.authorization;
    return header && header.startsWith('Bearer ') ? header.slice(7) : '';
  }

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
      const blocked = task.maxBalance !== undefined && balance >= task.maxBalance;
      // 救济金没有进度事件，直接以「余额低于阈值」判定达成
      const reached = task.kind === 'relief' ? true : progress >= task.target;

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
    // 5xx 不把内部错误细节回传客户端，避免泄漏 SQL 与约束名
    const message = status >= 500 ? '服务暂时不可用，请稍后重试' : error.message;
    reply.status(status).send({ error: message });
  });

  app.get('/health', async () => ({ ok: true, storage: config.databaseUrl ? 'postgres' : 'memory' }));

  app.get('/api/captcha', async () => createCaptcha());

  app.post('/api/guest', async (req) => {
    // 游客号每次都要建账号并跑一次 scrypt，必须限流，否则可被刷 CPU 与榜单
    const ipKey = clientIp(req);
    const state = guestLimiter.check(ipKey);
    if (!state.allowed) {
      throw httpError(`游客登录过于频繁，请 ${Math.ceil(state.remainingMs / 60000)} 分钟后再试`, 429);
    }
    guestLimiter.fail(ipKey);

    const rand = 1000 + randomInt(9000);
    const username = 'guest_' + Date.now().toString(36) + '_' + rand;
    const nickname = '牌友_' + rand;
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
    // 账号不存在时也跑一次同等开销的散列，避免通过响应时间枚举账号
    const matched = user
      ? await verifyPassword(password, user.passwordHash)
      : (await burnPasswordCheck(password), false);
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
    if (task.kind !== 'relief' && view.progress < task.target) throw httpError('任务尚未完成', 400);

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

    // 每次打赏是独立事件，幂等键用随机 UUID，避免同毫秒重复提交被吞单
    const bizId = `tip:${claims.sub}:${randomUUID()}`;
    let newBalance: number;
    try {
      newBalance = await repo.credit(claims.sub, -amount, 'dealer_tip', bizId);
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw httpError('筹码不足，先去福利中心领取救济金吧', 400);
      }
      throw error;
    }
    await repo.bumpTask(claims.sub, 'daily_tip', periodKeyFor('daily'), 1);

    return { ok: true, balance: newBalance, amount, giftName };
  });

  // ---------- 个人资料 ----------

  app.get('/api/profile', async (req) => {
    const claims = authHeader(req);
    const [profile, balance, friends, rank] = await Promise.all([
      repo.getProfile(claims.sub),
      repo.getBalance(claims.sub, 'coin'),
      repo.listFriends(claims.sub),
      repo.leaderboardRank(claims.sub),
    ]);
    if (!profile) throw httpError('用户不存在', 404);
    const tasks = await buildTasks(claims.sub, balance);
    const achieved = tasks.filter((task) => task.claimed).length;
    return { profile, balance, friendsCount: friends.length, rank, achievements: achieved };
  });

  app.patch('/api/profile', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: { nickname?: string; bio?: string; avatar?: string | null } = {};

    if (body.nickname !== undefined) {
      const nickname = String(body.nickname).trim();
      if (nickname.length < 2 || nickname.length > 16) throw httpError('昵称需 2-16 个字符', 400);
      patch.nickname = nickname;
    }
    if (body.bio !== undefined) patch.bio = String(body.bio).slice(0, 60);
    if (body.avatar !== undefined) {
      const avatar = body.avatar === null ? null : String(body.avatar);
      // 头像以 data URL 存入数据库，校验体积与真实文件头
      if (avatar) assertValidAvatar(avatar);
      patch.avatar = avatar;
    }
    if (Object.keys(patch).length === 0) throw httpError('没有需要更新的内容', 400);

    try {
      const profile = await repo.updateProfile(claims.sub, patch);
      return { profile };
    } catch (error) {
      throw httpError((error as Error).message, 400);
    }
  });

  app.get('/api/users/search', async (req) => {
    const claims = authHeader(req);
    const query = req.query as { q?: string };
    const keyword = (query.q ?? '').trim();
    const users = await repo.searchUsers(keyword, claims.sub, 20);
    return { users };
  });

  // ---------- 好友 ----------

  app.get('/api/friends', async (req) => {
    const claims = authHeader(req);
    const [friends, requests] = await Promise.all([
      repo.listFriends(claims.sub),
      repo.listFriendRequests(claims.sub),
    ]);
    return { friends, incoming: requests.incoming, outgoing: requests.outgoing };
  });

  app.post('/api/friends/request', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const message = typeof body.message === 'string' ? body.message.slice(0, 40) : null;
    if (!userId) throw httpError('缺少目标玩家', 400);

    try {
      const created = await repo.createFriendRequest(claims.sub, userId, message);
      return { ok: true, request: created };
    } catch (error) {
      throw httpError((error as Error).message, 400);
    }
  });

  app.post('/api/friends/accept', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const ok = await repo.acceptFriendRequest(requestId, claims.sub);
    if (!ok) throw httpError('申请不存在或已处理', 404);
    const friends = await repo.listFriends(claims.sub);
    return { ok: true, friends };
  });

  app.post('/api/friends/reject', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const ok = await repo.rejectFriendRequest(requestId, claims.sub);
    if (!ok) throw httpError('申请不存在或已处理', 404);
    return { ok: true };
  });

  app.delete('/api/friends/:userId', async (req) => {
    const claims = authHeader(req);
    const { userId } = req.params as { userId: string };
    const ok = await repo.removeFriend(claims.sub, userId);
    if (!ok) throw httpError('你们还不是好友', 404);
    return { ok: true };
  });

  // ---------- 房间邀请 ----------
  // 邀请是短时效消息，放进程内存即可；重启丢失不影响正确性
  app.post('/api/rooms/invite', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const roomId = typeof body.roomId === 'string' ? body.roomId : '';
    const gameId = typeof body.gameId === 'string' ? body.gameId : '';
    const roomName = typeof body.roomName === 'string' ? body.roomName.slice(0, 30) : '牌桌';
    const targets = Array.isArray(body.friendIds)
      ? (body.friendIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];

    if (!roomId || !gameId) throw httpError('缺少房间信息', 400);
    if (targets.length === 0) throw httpError('请先选择好友', 400);

    const me = await repo.getProfile(claims.sub);
    let sent = 0;
    for (const toId of targets.slice(0, 20)) {
      if (!(await repo.areFriends(claims.sub, toId))) continue;
      roomInvites.push({
        id: randomUUID(),
        fromId: claims.sub,
        fromNickname: me?.nickname ?? '牌友',
        fromAvatar: me?.avatar ?? null,
        toId,
        roomId,
        gameId,
        roomName,
        createdAt: Date.now(),
      });
      sent += 1;
    }
    pruneInvites();
    if (sent === 0) throw httpError('只能邀请好友，非好友请复制邀请链接', 400);
    return { ok: true, sent };
  });

  app.get('/api/rooms/invites', async (req) => {
    const claims = authHeader(req);
    pruneInvites();
    const mine = roomInvites
      .filter((invite) => invite.toId === claims.sub)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20);
    return { invites: mine };
  });

  app.delete('/api/rooms/invites/:id', async (req) => {
    const claims = authHeader(req);
    const { id } = req.params as { id: string };
    const index = roomInvites.findIndex((invite) => invite.id === id && invite.toId === claims.sub);
    if (index >= 0) roomInvites.splice(index, 1);
    return { ok: index >= 0 };
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
    requireAdmin(req);

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

  // ---------- GM 工具接口（本地桌面工具专用） ----------

  /** 恒定时间比较，避免按响应时间逐位猜口令 */
  function safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  }

  /**
   * GM 鉴权：口令只从 Authorization 头读取（不再接受 query，避免进 access log），
   * 恒定时间比较，并按 IP 限制总请求量与错误次数。
   */
  function requireAdmin(req: FastifyRequest): void {
    const ip = clientIp(req);
    const ipState = adminLimiter.check(ip);
    if (!ipState.allowed) throw httpError('后台接口调用过于频繁，请稍后再试', 429);
    const failState = adminFailLimiter.check(ip);
    if (!failState.allowed) {
      throw httpError(`后台口令错误次数过多，请 ${Math.ceil(failState.remainingMs / 60000)} 分钟后再试`, 429);
    }
    adminLimiter.fail(ip);
    const provided = adminTokenOf(req);
    if (!config.adminToken || !safeEqual(provided, config.adminToken)) {
      adminFailLimiter.fail(ip);
      throw httpError('后台口令不正确', 403);
    }
  }

  app.get('/api/admin/players', async (req) => {
    requireAdmin(req);
    const query = req.query as { q?: string };

    const keyword = String(query.q ?? '').trim();
    const users = await repo.searchUsers(keyword, '', 30);
    const players = await Promise.all(
      users.map(async (user) => ({
        ...user,
        balance: await repo.getBalance(user.userId, 'coin'),
      })),
    );
    return { players };
  });

  // GM 发放 / 扣除筹码，走账本幂等入账
  app.post('/api/admin/grant', async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const amount = Math.floor(Number(body.amount ?? 0));
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 40) : 'GM 调整';
    // 幂等键由调用方提供，网络重试或双击不会重复发币
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey
        ? body.idempotencyKey.slice(0, 80)
        : '';

    if (!userId) throw httpError('缺少玩家 ID', 400);
    if (!Number.isFinite(amount) || amount === 0) throw httpError('金额需为非零整数', 400);
    if (Math.abs(amount) > 1_000_000) throw httpError('单次调整不能超过 100 万', 400);
    if (!idempotencyKey) throw httpError('缺少幂等键 idempotencyKey', 400);

    const target = await repo.getProfile(userId);
    if (!target) throw httpError('玩家不存在', 404);

    let balance: number;
    try {
      balance = await repo.credit(userId, amount, 'gm_grant', `gm:${idempotencyKey}`);
    } catch (error) {
      if (error instanceof InsufficientFundsError) throw httpError('扣减后余额不能为负', 400);
      throw error;
    }
    apiLog.info(`GM 调整筹码 userId=${userId} amount=${amount} reason=${reason} balance=${balance}`);
    return { ok: true, nickname: target.nickname, balance };
  });

  app.post('/api/admin/announcements', async (req) => {
    requireAdmin(req);
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
    requireAdmin(req);
    const id = String((req.params as { id?: string }).id ?? '');
    const ok = await repo.deleteAnnouncement(id);
    if (!ok) throw httpError('公告不存在', 404);
    apiLog.info('删除公告', { id });
    recordEvent('warn', 'announce', `删除公告 ${id}`, { id });
    return { ok: true };
  });

  app.get('/api/admin/events', async (req) => {
    requireAdmin(req);
    const query = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 60) || 60, 1), 240);
    return { events: recentEvents(limit) };
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

  /**
   * 每日 0 点结算「昨天」的排行榜并发奖。
   * 是否已结算以快照表为准（不是进程内变量），因此重启既不会漏结，也不会提前按
   * 当下余额发奖；发奖幂等键含 userId，重跑也不会串人。
   */
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
  // 启动时补结算：若跨 0 点时服务不在线，这里会把昨天补上
  void settleDaily().catch((error: unknown) => {
    apiLog.error('启动补结算失败', { error: (error as Error).message });
  });

  // 邀请记录只增不减会缓慢吃内存，定期清理过期项
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

start().catch((error) => {
  console.error('[api] 启动失败', error);
  process.exit(1);
});
