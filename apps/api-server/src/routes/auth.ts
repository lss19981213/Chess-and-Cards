import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { signToken } from '@cc/auth';
import { config } from '../config';
import { authHeader, clientIp, httpError } from '../http-utils';
import type { Repository } from '../repository/types';
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
} from '../security';
import { periodKeyFor } from '../tasks';

export function registerAuthRoutes(app: FastifyInstance, repo: Repository): void {
  // 登录防爆破：IP 维度 10 次 / 10 分钟，账号维度 5 次 / 10 分钟
  const ipLimiter = new AttemptLimiter(10, 10 * 60_000);
  const accountLimiter = new AttemptLimiter(5, 10 * 60_000);
  // 游客注册：每 IP 10 分钟 5 个，既防批量建号刷榜，也容忍同网段多人使用
  const guestLimiter = new AttemptLimiter(5, 10 * 60_000);

  app.get('/health', async () => ({ ok: true, storage: config.databaseUrl ? 'postgres' : 'memory' }));

  app.get('/api/captcha', async () => createCaptcha());

  app.post('/api/guest', async (req) => {
    const ipKey = clientIp(req);
    const state = guestLimiter.check(ipKey);
    if (!state.allowed) {
      throw httpError(`游客登录过于频繁，请 ${Math.ceil(state.remainingMs / 60000)} 分钟后再试`, 429);
    }
    guestLimiter.fail(ipKey);

    const rand = 1000 + randomInt(9000);
    const username = `guest_${Date.now().toString(36)}_${rand}`;
    const nickname = `牌友_${rand}`;
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
}
