import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Settlement } from '@cc/protocol';
import { config } from '../config';
import { getLastSettlementAt, markSettlement, recentEvents, recordEvent } from '../events';
import { clientIp, httpError, safeEqual } from '../http-utils';
import type { createLogger } from '../logger';
import { InsufficientFundsError, type Repository } from '../repository/types';
import { AttemptLimiter } from '../security';
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
