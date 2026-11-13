import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Settlement } from '@cc/protocol';
import { config } from '../config';
import { getLastSettlementAt, markSettlement, recentEvents, recordEvent } from '../events';
import { clientIp, httpError, safeEqual } from '../http-utils';
import type { createLogger } from '../logger';
import { InsufficientFundsError, type Repository } from '../repository/types';
import { AttemptLimiter, hashPassword } from '../security';
import { periodKeyFor } from '../tasks';

type Logger = ReturnType<typeof createLogger>;

export function registerAdminAndInternalRoutes(
  app: FastifyInstance,
  repo: Repository,
  apiLog: Logger,
): void {
  // GM 接口：每 IP 每分钟 120 次；口令错误单独限 5 次 / 5 分钟
  const adminLimiter = new AttemptLimiter(120, 60_000);
  const adminFailLimiter = new AttemptLimiter(5, 5 * 60_000);

  function adminTokenOf(req: FastifyRequest): string {
    const header = req.headers.authorization;
    return header && header.startsWith('Bearer ') ? header.slice(7) : '';
  }

  /**
   * GM 鉴权：口令只从 Authorization 头读取，恒定时间比较，
   * 并按 IP 限制总请求量与错误次数。
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

    const [roomData, gameData] = await Promise.all([safeFetch('/rooms'), safeFetch('/games')]);

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

  app.get('/api/admin/economy', async (req) => {
    requireAdmin(req);
    const overview = await repo.getEconomyOverview();
    return { overview };
  });

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

  app.get('/api/admin/players/:userId/ledger', async (req) => {
    requireAdmin(req);
    const userId = String((req.params as { userId?: string }).userId ?? '');
    const query = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 200);
    const ledger = await repo.listUserLedger(userId, limit);
    return { ledger };
  });

  app.post('/api/admin/players/:userId/status', async (req) => {
    requireAdmin(req);
    const userId = String((req.params as { userId?: string }).userId ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const banned = Boolean(body.banned);
    const ok = await repo.setUserStatus(userId, banned);
    if (!ok) throw httpError('玩家不存在', 404);
    apiLog.warn(`GM 变更玩家状态 userId=${userId} banned=${banned}`);
    recordEvent('warn', 'player', `GM 变更玩家状态 ${userId} banned=${banned}`, { userId, banned });
    return { ok: true, banned };
  });

  app.post('/api/admin/players/:userId/reset-password', async (req) => {
    requireAdmin(req);
    const userId = String((req.params as { userId?: string }).userId ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const newPassword = String(body.newPassword ?? '');
    if (newPassword.length < 6 || newPassword.length > 32) {
      throw httpError('新密码长度需在 6-32 位之间', 400);
    }
    const hash = await hashPassword(newPassword);
    const ok = await repo.resetUserPassword(userId, hash);
    if (!ok) throw httpError('玩家不存在', 404);
    apiLog.warn(`GM 重置玩家密码 userId=${userId}`);
    recordEvent('warn', 'player', `GM 重置玩家密码 ${userId}`, { userId });
    return { ok: true };
  });

  app.post('/api/admin/players/:userId/update', async (req) => {
    requireAdmin(req);
    const userId = String((req.params as { userId?: string }).userId ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: { nickname?: string; bio?: string } = {};
    if (typeof body.nickname === 'string') patch.nickname = body.nickname;
    if (typeof body.bio === 'string') patch.bio = body.bio;
    const profile = await repo.updateProfile(userId, patch);
    apiLog.info(`GM 更新玩家资料 userId=${userId}`, patch);
    return { ok: true, profile };
  });

  // GM 发放 / 扣除筹码，走账本幂等入账
  app.post('/api/admin/grant', async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const amount = Math.floor(Number(body.amount ?? 0));
    const reason = typeof body.reason === 'string' ? body.reason.slice(0, 40) : 'GM 调整';
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

  // ---- 房间管理：平台坐庄房间的创建与销毁 ----

  /** 调用房间服的内部管理接口 */
  async function roomAdmin(
    path: string,
    init: { method: string; body?: unknown },
  ): Promise<{ ok: boolean; data: Record<string, unknown> }> {
    try {
      const res = await fetch(`${config.roomServerUrl}${path}`, {
        method: init.method,
        headers: {
          'x-internal-key': config.internalKey,
          ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(4000),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw httpError(String(data.error ?? `房间服返回 ${res.status}`), 400);
      return { ok: true, data };
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw httpError('房间服无响应，请检查 cc-room 是否在线', 503);
      }
      throw error;
    }
  }

  app.get('/api/admin/rooms', async (req) => {
    requireAdmin(req);
    const query = req.query as { gameId?: string };
    try {
      const url = new URL(`${config.roomServerUrl}/rooms`);
      if (query.gameId) url.searchParams.set('gameId', query.gameId);
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      const data = (await res.json()) as { rooms?: unknown[] };
      return { rooms: data.rooms ?? [] };
    } catch {
      throw httpError('房间服无响应，请检查 cc-room 是否在线', 503);
    }
  });

  app.post('/api/admin/rooms', async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const gameId = typeof body.gameId === 'string' ? body.gameId : '';
    const count = Math.min(Math.max(Number(body.count ?? 1) || 1, 1), 10);
    if (!gameId) throw httpError('缺少 gameId', 400);

    const { data } = await roomAdmin('/admin/rooms', { method: 'POST', body: { gameId, count } });
    const created = (data.created as unknown[] | undefined)?.length ?? 0;
    apiLog.info(`GM 创建平台庄房间 gameId=${gameId} count=${created}`);
    recordEvent('info', 'room', `GM 创建 ${created} 间平台庄房间`, { gameId, created });
    return { ok: true, created: data.created ?? [] };
  });

  app.delete('/api/admin/rooms/:roomId', async (req) => {
    requireAdmin(req);
    const roomId = String((req.params as { roomId?: string }).roomId ?? '');
    if (!roomId) throw httpError('缺少房间号', 400);
    await roomAdmin(`/admin/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
    apiLog.info(`GM 销毁房间 roomId=${roomId}`);
    recordEvent('warn', 'room', `GM 销毁房间 ${roomId}`, { roomId });
    return { ok: true };
  });

  app.get('/api/admin/rooms/:roomId/detail', async (req) => {
    requireAdmin(req);
    const roomId = String((req.params as { roomId?: string }).roomId ?? '');
    const { data } = await roomAdmin(`/admin/rooms/${encodeURIComponent(roomId)}/detail`, {
      method: 'GET',
    });
    return data;
  });

  app.post('/api/admin/rooms/:roomId/kick', async (req) => {
    requireAdmin(req);
    const roomId = String((req.params as { roomId?: string }).roomId ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { data } = await roomAdmin(`/admin/rooms/${encodeURIComponent(roomId)}/kick`, {
      method: 'POST',
      body,
    });
    recordEvent('warn', 'room', `GM 从房间 ${roomId} 踢出玩家 ${String(body.playerId ?? '')}`);
    return data;
  });

  app.post('/api/admin/rooms/:roomId/bot', async (req) => {
    requireAdmin(req);
    const roomId = String((req.params as { roomId?: string }).roomId ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { data } = await roomAdmin(`/admin/rooms/${encodeURIComponent(roomId)}/bot`, {
      method: 'POST',
      body,
    });
    return data;
  });

  app.post('/api/admin/rooms/:roomId/reset', async (req) => {
    requireAdmin(req);
    const roomId = String((req.params as { roomId?: string }).roomId ?? '');
    const { data } = await roomAdmin(`/admin/rooms/${encodeURIComponent(roomId)}/reset`, {
      method: 'POST',
    });
    recordEvent('warn', 'room', `GM 强制流局退款重置房间 ${roomId}`);
    return data;
  });

  app.post('/api/admin/broadcast', async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text = String(body.text ?? '').trim();
    if (!text) throw httpError('缺少广播内容', 400);
    const { data } = await roomAdmin('/admin/broadcast', { method: 'POST', body });
    recordEvent('info', 'broadcast', `GM 发送全服广播: ${text}`, { text });
    return data;
  });

  app.post('/api/admin/security/clear-limits', async (req) => {
    requireAdmin(req);
    adminLimiter.reset(clientIp(req));
    adminFailLimiter.reset(clientIp(req));
    recordEvent('info', 'security', 'GM 清理限流白名单');
    return { ok: true, message: '限流白名单已刷新' };
  });

  // ---- 公告列表（GM 工具展示与删除）----
  app.get('/api/admin/announcements', async (req) => {
    requireAdmin(req);
    const announcements = await repo.listAnnouncements(50);
    return { announcements };
  });

  // ---- 邮箱系统（GM 发送与管理）----
  app.get('/api/admin/mail', async (req) => {
    requireAdmin(req);
    const query = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 200);
    const mails = await repo.listAdminMails(limit);
    return { mails };
  });

  app.post('/api/admin/mail', async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const targetType = body.targetType === 'user' ? 'user' : 'all';
    let targetUserId = typeof body.targetUserId === 'string' ? body.targetUserId.trim() : null;
    const targetUsername = typeof body.targetUsername === 'string' ? body.targetUsername.trim() : '';

    if (targetType === 'user') {
      if (!targetUserId && targetUsername) {
        const u = await repo.findByUsername(targetUsername);
        if (!u) throw httpError(`未找到账号为「${targetUsername}」的玩家`, 404);
        targetUserId = u.id;
      }
      if (!targetUserId) throw httpError('定向邮件必须指定玩家 UID 或账号', 400);
      const targetUser = await repo.getUser(targetUserId);
      if (!targetUser) throw httpError('玩家不存在', 404);
    }

    const title = String(body.title ?? '').trim();
    const content = String(body.content ?? '').trim();
    const rewardCoins = Math.max(0, Math.floor(Number(body.rewardCoins ?? 0)));
    const sender = typeof body.sender === 'string' && body.sender.trim() ? body.sender.trim() : '系统管理员';

    if (!title || title.length > 40) throw httpError('邮件标题需在 1-40 字之间', 400);
    if (!content || content.length > 500) throw httpError('邮件内容需在 1-500 字之间', 400);
    if (rewardCoins > 10_000_000) throw httpError('单封邮件附带筹码不能超过 1000 万', 400);

    const mail = await repo.sendMail({
      targetType,
      targetUserId,
      sender,
      title,
      content,
      rewardCoins,
    });

    const targetDesc = targetType === 'all' ? '全服玩家' : `玩家 ${targetUserId}`;
    apiLog.info(`GM 发送邮件: title="${title}" target=${targetDesc} coins=${rewardCoins}`);
    recordEvent(
      'info',
      'mail',
      `GM 发送邮件「${title}」给 ${targetDesc}${rewardCoins > 0 ? `，附带 ${rewardCoins} 筹码` : ''}`,
    );

    return { ok: true, mail };
  });

  app.delete('/api/admin/mail/:id', async (req) => {
    requireAdmin(req);
    const { id } = req.params as { id: string };
    const ok = await repo.deleteAdminMail(id);
    if (!ok) throw httpError('邮件不存在', 404);
    recordEvent('warn', 'mail', `GM 撤回/删除邮件 ${id}`);
    return { ok: true };
  });

  /** 下注即时扣款 / 撤注退款 */
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
      !playerId ||
      !bizId ||
      !action ||
      !Number.isInteger(amount) ||
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

  /** 房间销毁后释放该房间未结算的下注扣款 */
  app.post('/internal/wallet/release', async (req, reply) => {
    if (req.headers['x-internal-key'] !== config.internalKey) {
      return reply.status(403).send({ error: '内部接口鉴权失败' });
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
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
}
