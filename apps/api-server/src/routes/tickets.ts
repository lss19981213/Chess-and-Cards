import type { FastifyInstance } from 'fastify';
import type { createLogger } from '../logger';
import { recordEvent } from '../events';
import type {
  Repository,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from '../repository/types';
import { authHeader, httpError, requireAdmin } from '../http-utils';

const VALID_CATEGORIES = new Set<TicketCategory>([
  'bug',
  'suggestion',
  'wallet',
  'gameplay',
  'account',
  'report',
  'other',
]);

const VALID_PRIORITIES = new Set<TicketPriority>(['low', 'normal', 'high', 'urgent']);
const VALID_STATUSES = new Set<TicketStatus>(['open', 'in_progress', 'replied', 'resolved', 'closed']);

const CATEGORY_LABEL: Record<TicketCategory, string> = {
  bug: 'Bug 异常',
  suggestion: '功能建议',
  wallet: '筹码/账务',
  gameplay: '游戏玩法',
  account: '账号/安全',
  report: '投诉/举报',
  other: '其他问题',
};

/** 简单防刷限流：每位玩家 60 秒最多提交 3 条工单 */
const submitBucket = new Map<string, number[]>();

function checkTicketRateLimit(userId: string): void {
  const now = Date.now();
  const list = (submitBucket.get(userId) ?? []).filter((ts) => now - ts < 60_000);
  if (list.length >= 3) {
    throw httpError('提交过于频繁，请 1 分钟后再试', 429);
  }
  list.push(now);
  submitBucket.set(userId, list);
}

function sanitizeAttachment(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const trimmed = raw.trim();
  if (!/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-zA-Z0-9+/=]+$/.test(trimmed)) {
    throw httpError('仅支持 PNG / JPG / WebP / GIF 格式截图附件', 400);
  }
  // 限制约 2MB 原始图片（base64 约 2.8MB）
  if (trimmed.length > 2_900_000) {
    throw httpError('截图体积过大，请上传 2MB 以内的图片', 400);
  }
  return trimmed;
}

export function registerTicketRoutes(
  app: FastifyInstance,
  repo: Repository,
  apiLog: ReturnType<typeof createLogger>,
): void {
  // ==================== 玩家端工单接口 ====================

  app.get('/api/tickets', async (req) => {
    const claims = authHeader(req);
    const tickets = await repo.listPlayerTickets(claims.sub, 50);
    const unreadCount = tickets.filter((t) => t.hasUnreadReply).length;
    return {
      tickets: tickets.map((t) => ({ ...t, adminNote: '' })),
      unreadCount,
    };
  });

  app.get('/api/tickets/:id', async (req) => {
    const claims = authHeader(req);
    const id = String((req.params as { id?: string }).id ?? '').trim();
    if (!id) throw httpError('缺少工单编号', 400);

    const ticket = await repo.getTicketDetail(id);
    if (!ticket || ticket.userId !== claims.sub) {
      throw httpError('工单不存在或无权查看', 404);
    }

    if (ticket.hasUnreadReply) {
      await repo.markTicketReadByPlayer(id, claims.sub);
      ticket.hasUnreadReply = false;
    }

    return { ticket: { ...ticket, adminNote: '' } };
  });

  app.post('/api/tickets', async (req) => {
    const claims = authHeader(req);
    checkTicketRateLimit(claims.sub);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawCat = String(body.category ?? 'bug').trim() as TicketCategory;
    const category: TicketCategory = VALID_CATEGORIES.has(rawCat) ? rawCat : 'other';

    const rawPri = String(body.priority ?? 'normal').trim() as TicketPriority;
    const priority: TicketPriority = VALID_PRIORITIES.has(rawPri) ? rawPri : 'normal';

    const title = String(body.title ?? '').trim();
    const content = String(body.content ?? '').trim();
    const contact = String(body.contact ?? '').trim().slice(0, 80);
    const clientInfo = String(body.clientInfo ?? '').trim().slice(0, 240);
    const attachment = sanitizeAttachment(body.attachment);

    if (title.length < 2 || title.length > 80) {
      throw httpError('工单标题需在 2 ~ 80 字之间', 400);
    }
    if (content.length < 5 || content.length > 2000) {
      throw httpError('问题描述需在 5 ~ 2000 字之间', 400);
    }

    const profile = await repo.getProfile(claims.sub);
    const ticket = await repo.createTicket({
      userId: claims.sub,
      username: profile?.username ?? '',
      nickname: profile?.nickname ?? claims.name ?? '玩家',
      category,
      priority,
      title,
      content,
      contact,
      attachment,
      clientInfo,
    });

    apiLog.info(`玩家提交反馈工单 id=${ticket.id} userId=${claims.sub} cat=${category}`);
    recordEvent('info', 'ticket', `新工单 [${ticket.id}] (${CATEGORY_LABEL[category]}) ${ticket.nickname}: ${title}`, {
      ticketId: ticket.id,
      userId: claims.sub,
      category,
      priority,
    });

    return { ok: true, ticket: { ...ticket, adminNote: '' } };
  });

  app.post('/api/tickets/:id/reply', async (req) => {
    const claims = authHeader(req);
    const id = String((req.params as { id?: string }).id ?? '').trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const content = String(body.content ?? '').trim();

    if (!id) throw httpError('缺少工单编号', 400);
    if (content.length < 1 || content.length > 1500) {
      throw httpError('回复内容需在 1 ~ 1500 字之间', 400);
    }

    const ticket = await repo.getTicketDetail(id);
    if (!ticket || ticket.userId !== claims.sub) {
      throw httpError('工单不存在或无权操作', 404);
    }
    if (ticket.status === 'closed') {
      throw httpError('该工单已关闭，如需继续反馈请提交新工单', 400);
    }

    const profile = await repo.getProfile(claims.sub);
    const reply = await repo.addTicketReply({
      ticketId: id,
      senderRole: 'player',
      senderName: profile?.nickname ?? claims.name ?? '玩家',
      content,
      nextStatus: 'open',
    });

    const updated = await repo.getTicketDetail(id);
    return { ok: true, reply, ticket: updated ? { ...updated, adminNote: '' } : null };
  });

  app.post('/api/tickets/:id/close', async (req) => {
    const claims = authHeader(req);
    const id = String((req.params as { id?: string }).id ?? '').trim();
    if (!id) throw httpError('缺少工单编号', 400);

    const ticket = await repo.getTicketDetail(id);
    if (!ticket || ticket.userId !== claims.sub) {
      throw httpError('工单不存在或无权操作', 404);
    }

    const updated = await repo.updateTicketStatus(id, 'closed');
    return { ok: true, ticket: updated ? { ...updated, adminNote: '' } : null };
  });

  // ==================== GM 运营中台工单管理接口 ====================

  app.get('/api/admin/tickets', async (req) => {
    requireAdmin(req);
    const query = req.query as {
      status?: string;
      category?: string;
      keyword?: string;
      limit?: string;
    };
    const limit = Math.min(Math.max(Number(query.limit ?? 150) || 150, 1), 300);
    return await repo.listAdminTickets({
      status: query.status,
      category: query.category,
      keyword: query.keyword,
      limit,
    });
  });

  app.get('/api/admin/tickets/:id', async (req) => {
    requireAdmin(req);
    const id = String((req.params as { id?: string }).id ?? '').trim();
    if (!id) throw httpError('缺少工单编号', 400);
    const ticket = await repo.getTicketDetail(id);
    if (!ticket) throw httpError('工单不存在', 404);
    const balance = await repo.getBalance(ticket.userId, 'coin');
    return { ticket, playerBalance: balance };
  });

  app.post('/api/admin/tickets/:id/reply', async (req) => {
    requireAdmin(req);
    const id = String((req.params as { id?: string }).id ?? '').trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const content = String(body.content ?? '').trim();
    const senderName = String(body.senderName ?? '官方客服 · GM').trim().slice(0, 30) || '官方客服 · GM';
    const rawNextStatus = typeof body.status === 'string' ? (body.status.trim() as TicketStatus) : 'replied';
    const nextStatus: TicketStatus = VALID_STATUSES.has(rawNextStatus) ? rawNextStatus : 'replied';
    const rewardCoins = Math.max(0, Math.min(50_000_000, Math.floor(Number(body.rewardCoins ?? 0)) || 0));
    const notifyMail = body.notifyMail !== false;

    if (!id) throw httpError('缺少工单编号', 400);
    if (content.length < 1 || content.length > 2000) {
      throw httpError('回复内容需在 1 ~ 2000 字之间', 400);
    }

    const ticket = await repo.getTicketDetail(id);
    if (!ticket) throw httpError('工单不存在', 404);

    const reply = await repo.addTicketReply({
      ticketId: id,
      senderRole: 'gm',
      senderName,
      content,
      nextStatus,
    });

    if (typeof body.adminNote === 'string') {
      await repo.updateTicketStatus(id, nextStatus, body.adminNote.slice(0, 500));
    }

    // 若勾选通知邮件或附带反馈奖励筹码，同步投递至玩家站内信箱
    if (notifyMail || rewardCoins > 0) {
      const mailContent =
        `您在工单 [${ticket.id}]「${ticket.title}」提交的反馈已收到官方回复：\n\n` +
        `${content}\n\n` +
        (rewardCoins > 0 ? `感谢您的宝贵反馈，特奉上 ${rewardCoins.toLocaleString()} 欢乐豆致谢，请点击下方领取！` : '您可随时前往大厅右上角「问题反馈 → 我的工单」查看完整沟通记录。');
      await repo.sendMail({
        targetType: 'user',
        targetUserId: ticket.userId,
        sender: senderName,
        title: `工单回复 [${ticket.id}]：${ticket.title.slice(0, 28)}`,
        content: mailContent,
        rewardCoins,
      });
    }

    apiLog.info(`GM 回复工单 id=${id} status=${nextStatus} reward=${rewardCoins}`);
    recordEvent('info', 'ticket', `GM 回复工单 [${id}] → ${nextStatus}${rewardCoins > 0 ? ` (附赠 ${rewardCoins} 豆)` : ''}`, {
      ticketId: id,
      status: nextStatus,
      rewardCoins,
    });

    const updated = await repo.getTicketDetail(id);
    return { ok: true, reply, ticket: updated };
  });

  app.post('/api/admin/tickets/:id/status', async (req) => {
    requireAdmin(req);
    const id = String((req.params as { id?: string }).id ?? '').trim();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawStatus = String(body.status ?? '').trim() as TicketStatus;
    const adminNote = typeof body.adminNote === 'string' ? body.adminNote.slice(0, 500) : undefined;

    if (!id) throw httpError('缺少工单编号', 400);
    if (!VALID_STATUSES.has(rawStatus)) {
      throw httpError('工单状态不合法', 400);
    }

    const updated = await repo.updateTicketStatus(id, rawStatus, adminNote);
    if (!updated) throw httpError('工单不存在', 404);

    apiLog.info(`GM 更新工单状态 id=${id} status=${rawStatus}`);
    return { ok: true, ticket: updated };
  });

  app.delete('/api/admin/tickets/:id', async (req) => {
    requireAdmin(req);
    const id = String((req.params as { id?: string }).id ?? '').trim();
    if (!id) throw httpError('缺少工单编号', 400);
    const ok = await repo.deleteTicket(id);
    if (!ok) throw httpError('工单不存在', 404);
    apiLog.info(`GM 删除工单 id=${id}`);
    return { ok: true };
  });
}
