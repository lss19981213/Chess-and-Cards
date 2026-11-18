import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { signToken } from '@cc/auth';
import { config } from '../config';
import { authHeader, clientIp, httpError } from '../http-utils';
import type { AuthUser, Repository } from '../repository/types';
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

async function broadcastToRoomServer(text: string): Promise<void> {
  if (!config.roomServerUrl) return;
  try {
    await fetch(`${config.roomServerUrl}/admin/broadcast`, {
      method: 'POST',
      headers: {
        'x-internal-key': config.internalKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    /* 忽略非阻断异常 */
  }
}

async function checkTop10Announcement(
  repo: Repository,
  userId: string,
  nickname: string,
  balance: number,
): Promise<void> {
  try {
    const rank = await repo.leaderboardRank(userId);
    if (rank !== null && rank <= 10) {
      const titles = ['赌神', '赌圣', '赌侠', '赌王', '赌将', '豪侠', '名手', '高手', '老手', '新星'];
      const title = titles[rank - 1] ?? '赌神';
      const text = `👑【全服广播】${title}「${nickname}」（排名第 ${rank}，坐拥 ${balance.toLocaleString()} 筹码）已经上线，快去挑战他吧！`;
      await repo.createAnnouncement({
        title: '👑 赌神登场',
        content: text,
        kind: 'notice',
      });
      await broadcastToRoomServer(text);
    }
  } catch {
    /* 忽略非阻断异常 */
  }
}

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
    return {
      token,
      user: { ...result.user, balance, level: 1, xp: '0', rewardedLevel: 1, totalTurnover: '0' },
    };
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

    const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '';
    if (inviteCode) {
      try {
        const inviter = (await repo.getUser(inviteCode)) || (await repo.findByUsername(inviteCode));
        if (inviter && inviter.id !== result.user.id) {
          await repo.setInvitedBy(result.user.id, inviter.id);
          await repo.bumpTask(inviter.id, 'daily_invite', periodKeyFor('daily'), 1);
          await repo.sendMail({
            targetType: 'user',
            targetUserId: inviter.id,
            title: '🎁 成功邀请新好友',
            content: `恭喜！新好友「${result.user.nickname}」已通过您的专属邀请加入游戏！快前往每日任务领取 1,000 筹码奖励吧（上不封顶）！`,
            sender: '系统福利官',
            rewardCoins: 0,
            expireDays: 30,
          });
        }
      } catch (e) {
        console.warn('[register] 邀请绑定异常', e);
      }
    }

    ipLimiter.reset(ipKey);
    const balance = await repo.getBalance(result.user.id, 'coin');
    await repo.bumpTask(result.user.id, 'daily_login', periodKeyFor('daily'), 1);
    const token = signToken(config.jwtSecret, { sub: result.user.id, name: result.user.nickname }, config.tokenTtlSeconds);
    return {
      token,
      user: { ...result.user, balance, level: 1, xp: '0', rewardedLevel: 1, totalTurnover: '0' },
    };
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

    if (user.banned) {
      throw httpError('该账号已被管理员封禁，如有疑问请联系客服', 403);
    }

    ipLimiter.reset(ipKey);
    accountLimiter.reset(accountKey);

    const [balance, profile] = await Promise.all([
      repo.getBalance(user.id, 'coin'),
      repo.getProfile(user.id),
    ]);
    await repo.bumpTask(user.id, 'daily_login', periodKeyFor('daily'), 1);
    void checkTop10Announcement(repo, user.id, user.nickname, balance);
    const token = signToken(config.jwtSecret, { sub: user.id, name: user.nickname }, config.tokenTtlSeconds);
    return {
      token,
      user: {
        id: user.id,
        nickname: user.nickname,
        username: user.username,
        email: user.email ?? null,
        invitedBy: user.invitedBy ?? null,
        createdAt: user.createdAt,
        balance,
        avatar: profile?.avatar ?? null,
        equippedFrame: profile?.equippedFrame ?? 'frame_default',
        worshipCount: profile?.worshipCount ?? 0,
        dealerSkin: profile?.dealerSkin ?? 'classic',
        dealerVoice: profile?.dealerVoice ?? 'classic',
        dealerAffection: profile?.dealerAffection ?? 0,
        level: profile?.level ?? 1,
        xp: profile?.xp ?? '0',
        rewardedLevel: profile?.rewardedLevel ?? 1,
        totalTurnover: profile?.totalTurnover ?? '0',
      },
    };
  });

  app.get('/api/me', async (req) => {
    const claims = authHeader(req);
    const user = await repo.getUser(claims.sub);
    if (!user) throw httpError('用户不存在', 404);
    if (user.banned) throw httpError('该账号已被管理员封禁', 403);
    const [balance, profile] = await Promise.all([
      repo.getBalance(user.id, 'coin'),
      repo.getProfile(user.id),
    ]);
    return {
      user: {
        ...user,
        balance,
        avatar: profile?.avatar ?? null,
        equippedFrame: profile?.equippedFrame ?? 'frame_default',
        worshipCount: profile?.worshipCount ?? 0,
        dealerSkin: profile?.dealerSkin ?? 'classic',
        dealerVoice: profile?.dealerVoice ?? 'classic',
        dealerAffection: profile?.dealerAffection ?? 0,
        level: profile?.level ?? 1,
        xp: profile?.xp ?? '0',
        rewardedLevel: profile?.rewardedLevel ?? 1,
        totalTurnover: profile?.totalTurnover ?? '0',
      },
    };
  });

  const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const resetCodes = new Map<string, { code: string; expireAt: number; email: string }>();

  // 修改密码
  app.post('/api/auth/change-password', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const oldPassword = typeof body.oldPassword === 'string' ? body.oldPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
      throw httpError(`新密码长度需在 ${PASSWORD_MIN}-${PASSWORD_MAX} 位之间`, 400);
    }

    const user = await repo.getUser(claims.sub);
    if (!user || !user.username) throw httpError('用户不存在', 404);

    const authUser = await repo.findByUsername(user.username);
    if (!authUser) throw httpError('用户验证失败', 404);

    const matched = authUser.passwordHash ? await verifyPassword(oldPassword, authUser.passwordHash) : true;
    if (!matched) throw httpError('原密码错误', 400);

    const newHash = await hashPassword(newPassword);
    await repo.updatePassword(claims.sub, newHash);
    return { ok: true, message: '密码已成功修改' };
  });

  // 绑定/修改邮箱
  app.post('/api/auth/update-email', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!EMAIL_PATTERN.test(email)) {
      throw httpError('邮箱格式不正确', 400);
    }

    const existing = await repo.findByEmail(email);
    if (existing && existing.id !== claims.sub) {
      throw httpError('该邮箱已被其他账号绑定', 409);
    }

    await repo.updateEmail(claims.sub, email);
    return { ok: true, email, message: '安全邮箱已成功绑定' };
  });

  // 忘记密码：发送邮箱验证码
  app.post('/api/auth/send-reset-code', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const accountOrEmail = typeof body.account === 'string' ? body.account.trim() : '';
    const captchaId = typeof body.captchaId === 'string' ? body.captchaId : '';
    const captcha = typeof body.captcha === 'string' ? body.captcha : '';

    if (!consumeCaptcha(captchaId, captcha)) {
      throw httpError('图形验证码错误或已过期', 400);
    }

    if (!accountOrEmail) throw httpError('请输入绑定的邮箱或账号', 400);

    let authUser: AuthUser | null = null;
    if (EMAIL_PATTERN.test(accountOrEmail)) {
      authUser = await repo.findByEmail(accountOrEmail);
    }
    if (!authUser) {
      authUser = await repo.findByUsername(accountOrEmail);
    }

    if (!authUser) {
      throw httpError('未找到匹配的账号信息', 404);
    }

    if (!authUser.email) {
      throw httpError('该账号尚未绑定安全邮箱，无法通过邮箱找回密码，请联系客服', 400);
    }

    const code = String(100000 + randomInt(900000));
    resetCodes.set(authUser.id, {
      code,
      expireAt: Date.now() + 10 * 60_000,
      email: authUser.email,
    });

    console.info(`[Auth] 密码找回验证码: 用户=${authUser.username}, 邮箱=${authUser.email}, 验证码=${code}`);

    return {
      ok: true,
      emailMasked: authUser.email.replace(/(.{2}).+(@.+)/, '$1***$2'),
      message: `6位数字验证码已发送至邮箱 ${authUser.email.replace(/(.{2}).+(@.+)/, '$1***$2')}，请在10分钟内输入`,
      devCode: code, // 本地开发与测试便捷显示
    };
  });

  // 忘记密码：校验验证码并重置密码
  app.post('/api/auth/reset-password', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const accountOrEmail = typeof body.account === 'string' ? body.account.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
      throw httpError(`新密码长度需在 ${PASSWORD_MIN}-${PASSWORD_MAX} 位之间`, 400);
    }

    let authUser: AuthUser | null = null;
    if (EMAIL_PATTERN.test(accountOrEmail)) {
      authUser = await repo.findByEmail(accountOrEmail);
    }
    if (!authUser) {
      authUser = await repo.findByUsername(accountOrEmail);
    }

    if (!authUser) throw httpError('未找到匹配的账号', 404);

    const record = resetCodes.get(authUser.id);
    if (!record || Date.now() > record.expireAt) {
      throw httpError('验证码已过期或不存在，请重新获取', 400);
    }

    if (record.code !== code) {
      throw httpError('邮箱验证码错误', 400);
    }

    const newHash = await hashPassword(newPassword);
    await repo.updatePassword(authUser.id, newHash);
    resetCodes.delete(authUser.id);

    return { ok: true, message: '密码重置成功，请使用新密码重新登录' };
  });
}
