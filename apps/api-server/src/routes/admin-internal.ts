import type { FastifyInstance, FastifyRequest } from 'fastify';
import { STOCK_DEFINITIONS, type Settlement } from '@cc/protocol';
import { config } from '../config';
import { getLastSettlementAt, markSettlement, recentEvents, recordEvent } from '../events';
import { clientIp, httpError, safeEqual } from '../http-utils';
import type { createLogger } from '../logger';
import { InsufficientFundsError, type Repository } from '../repository/types';
import { getLiveStockQuotes, refreshLiveStockQuotes } from '../stock-market';
import {
  sanitizeGameCategoriesConfig,
  type GameCategoriesConfig,
} from '../game-categories';
import { sanitizeSlotsConfig, type SlotsConfig } from '../slots-engine';
import { AttemptLimiter, hashPassword } from '../security';
import {
  TASKS,
  TASK_METRICS_META,
  loadTasksConfig,
  periodKeyFor,
  sanitizeSingleTask,
  sanitizeTasksConfig,
  toEnrichedTask,
  type TaskConfigInput,
} from '../tasks';

type Logger = ReturnType<typeof createLogger>;

export function registerAdminAndInternalRoutes(
  app: FastifyInstance,
  repo: Repository,
  apiLog: Logger,
): void {
  // GM 接口：每 IP 每分钟 180 次；口令错误单独限 20 次 / 5 分钟（避免切服或并发大盘请求瞬间误锁）
  const adminLimiter = new AttemptLimiter(180, 60_000);
  const adminFailLimiter = new AttemptLimiter(20, 5 * 60_000);

  function adminTokenOf(req: FastifyRequest): string {
    const header = req.headers.authorization;
    return header && header.startsWith('Bearer ') ? header.slice(7) : '';
  }

  /**
   * GM 鉴权：口令只从 Authorization 头读取，恒定时间比较，
   * 并按 IP 限制总请求量与错误次数；校验通过后清空该 IP 的错误计数。
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
    adminFailLimiter.reset(ip);
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

  // 老虎机经营数据总览（今日/累计营收、RTP、热门玩家排行、最近摇奖记录 + 当前概率配置）
  app.get('/api/admin/slots/analytics', async (req) => {
    requireAdmin(req);
    const query = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 50) || 50, 1), 200);
    const [analytics, savedCfg] = await Promise.all([
      repo.getSlotsAnalytics(limit),
      repo.getSetting<Partial<SlotsConfig>>('slots_config'),
    ]);
    return { analytics, config: sanitizeSlotsConfig(savedCfg) };
  });

  // GM 实时读取与修改老虎机中奖概率配置
  app.get('/api/admin/slots/config', async (req) => {
    requireAdmin(req);
    const saved = await repo.getSetting<Partial<SlotsConfig>>('slots_config');
    return { config: sanitizeSlotsConfig(saved) };
  });

  app.put('/api/admin/slots/config', async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as Partial<SlotsConfig>;
    const next = sanitizeSlotsConfig(body);
    await repo.setSetting('slots_config', next);
    const nextDetail: Record<string, unknown> = { ...next };
    apiLog.info('GM 更新老虎机中奖概率配置', nextDetail);
    recordEvent(
      'warn',
      'slots',
      `GM 调整老虎机概率：中奖率 ${next.hitRatePercent}% / 派彩倍率 ${next.payoutMultiplier}x / 大奖率 ${next.jackpotRatePercent}%`,
      nextDetail,
    );
    return { ok: true, config: next };
  });

  // ---------- 改命股市运营监控与行情管理 ----------
  app.get('/api/admin/stocks/overview', async (req) => {
    requireAdmin(req);
    const [quotes, dbStats] = await Promise.all([
      getLiveStockQuotes(),
      repo.getAdminStockOverview(),
    ]);

    const priceMap = new Map(quotes.map((q) => [q.symbol, q.price]));
    let totalHoldingsMarketValue = 0;
    const symbolStats = dbStats.symbolHoldings.map((sh) => {
      const price = priceMap.get(sh.symbol) ?? 0;
      const marketValue = Math.round(sh.totalShares * price);
      totalHoldingsMarketValue += marketValue;
      const def = STOCK_DEFINITIONS.find((s) => s.symbol === sh.symbol);
      return {
        ...sh,
        stockName: def?.name ?? sh.symbol,
        currentPrice: price,
        marketValue,
      };
    });

    return {
      success: true,
      summary: {
        totalHolders: dbStats.totalHolders,
        totalHoldingsMarketValue,
        totalOrderCount: dbStats.totalOrderCount,
        totalTurnover: dbStats.totalTurnover,
        totalFees: dbStats.totalFees,
      },
      quotes,
      symbolStats,
      recentOrders: dbStats.recentOrders,
    };
  });

  app.post('/api/admin/stocks/refresh', async (req) => {
    requireAdmin(req);
    const quotes = await refreshLiveStockQuotes();
    apiLog.info('GM 强制刷新股市行情大盘数据', { quotesCount: quotes.length });
    return {
      success: true,
      message: '行情缓存已刷新，已同步最新大盘数据',
      quotesCount: quotes.length,
    };
  });

  // GM 实时读取与修改游戏分类配置（新增/重命名/排序分类、调整每个游戏归属分类）
  app.get('/api/admin/game-categories', async (req) => {
    requireAdmin(req);
    const saved = await repo.getSetting<Partial<GameCategoriesConfig>>('game_categories');
    let games: Array<Record<string, unknown>> = [];
    try {
      const res = await fetch(`${config.roomServerUrl}/games`, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const body = (await res.json()) as { games?: Array<Record<string, unknown>> };
        if (Array.isArray(body.games)) games = body.games;
      }
    } catch {
      /* room-server 不可达时仍允许编辑分类 */
    }
    const cfg = sanitizeGameCategoriesConfig(saved);
    return { ...cfg, games };
  });

  app.put('/api/admin/game-categories', async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as Partial<GameCategoriesConfig>;
    const next = sanitizeGameCategoriesConfig(body);
    await repo.setSetting('game_categories', next);
    apiLog.info('GM 更新游戏分类配置', {
      categories: next.categories.length,
      mappedGames: Object.keys(next.gameCategoryMap).length,
    });
    recordEvent(
      'info',
      'category',
      `GM 更新游戏分类配置（共 ${next.categories.length} 个分类）`,
    );
    return { ok: true, ...next };
  });

  // ==================== GM 每日任务 & 成长任务动态管理 ====================
  app.get('/api/admin/tasks', async (req) => {
    requireAdmin(req);
    const list = await loadTasksConfig((k) => repo.getSetting(k));
    return {
      tasks: list.map((t, idx) => toEnrichedTask(t, idx)),
      metrics: TASK_METRICS_META,
    };
  });

  // 新增或修改单个任务（按 key 匹配：存在则更新，不存在则新增，立即生效）
  app.post('/api/admin/tasks', async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as TaskConfigInput & { originalKey?: unknown };
    const sanitized = sanitizeSingleTask(body);
    if (!sanitized) {
      throw httpError('任务参数不合法：请检查任务标识(英文/数字/下划线)、名称、目标进度与奖励数额', 400);
    }

    const current = await loadTasksConfig((k) => repo.getSetting(k));
    const originalKey = typeof body.originalKey === 'string' ? body.originalKey.trim().toLowerCase() : '';
    const matchKey = originalKey || sanitized.key;
    const existingIdx = current.findIndex((t) => t.key === matchKey);

    // 若改名后的新 key 与其他已有任务冲突则拒绝
    if (originalKey && originalKey !== sanitized.key && current.some((t) => t.key === sanitized.key)) {
      throw httpError(`任务标识 "${sanitized.key}" 已存在，请更换其他唯一标识`, 409);
    }

    const next = [...current];
    let action: 'created' | 'updated';
    if (existingIdx >= 0) {
      next[existingIdx] = sanitized;
      action = 'updated';
    } else {
      // 每日任务插到每日任务末尾，成长任务插到列表末尾
      if (sanitized.group === 'daily') {
        const firstGrowthIdx = next.findIndex((t) => t.group === 'growth');
        if (firstGrowthIdx >= 0) next.splice(firstGrowthIdx, 0, sanitized);
        else next.push(sanitized);
      } else {
        next.push(sanitized);
      }
      action = 'created';
    }

    await repo.setSetting('tasks_config', { tasks: next });
    const groupLabel = sanitized.group === 'daily' ? '每日任务' : '成长任务';
    apiLog.info(`GM ${action === 'created' ? '新增' : '修改'}${groupLabel}`, {
      key: sanitized.key,
      name: sanitized.name,
      target: sanitized.target,
      reward: sanitized.reward,
    });
    recordEvent(
      'info',
      'task',
      `GM ${action === 'created' ? '新增' : '修改'}${groupLabel}「${sanitized.name}」(${sanitized.key})，目标 ${sanitized.target}，奖励 ${sanitized.reward.toLocaleString()} 豆`,
    );

    return {
      ok: true,
      action,
      task: toEnrichedTask(sanitized, next.findIndex((t) => t.key === sanitized.key)),
      tasks: next.map((t, idx) => toEnrichedTask(t, idx)),
    };
  });

  // 批量保存任务列表与排序
  app.put('/api/admin/tasks', async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as { tasks?: unknown };
    if (!Array.isArray(body.tasks)) {
      throw httpError('缺少 tasks 数组参数', 400);
    }
    const next = sanitizeTasksConfig(body.tasks);
    await repo.setSetting('tasks_config', { tasks: next });
    apiLog.info('GM 批量更新任务配置', { count: next.length });
    recordEvent('info', 'task', `GM 批量更新任务配置（共 ${next.length} 条任务）`);
    return {
      ok: true,
      tasks: next.map((t, idx) => toEnrichedTask(t, idx)),
    };
  });

  // 删除指定任务
  app.delete('/api/admin/tasks/:key', async (req) => {
    requireAdmin(req);
    const key = String((req.params as { key?: string }).key ?? '').trim().toLowerCase();
    if (!key) throw httpError('缺少任务标识 key', 400);

    const current = await loadTasksConfig((k) => repo.getSetting(k));
    const target = current.find((t) => t.key === key);
    if (!target) throw httpError('任务不存在', 404);

    const next = current.filter((t) => t.key !== key);
    await repo.setSetting('tasks_config', { tasks: next });
    apiLog.warn('GM 删除任务', { key, name: target.name });
    recordEvent('warn', 'task', `GM 删除任务「${target.name}」(${key})`);
    return {
      ok: true,
      deletedKey: key,
      tasks: next.map((t, idx) => toEnrichedTask(t, idx)),
    };
  });

  // 一键恢复系统默认任务列表
  app.post('/api/admin/tasks/reset', async (req) => {
    requireAdmin(req);
    const defaults = sanitizeTasksConfig(TASKS);
    await repo.setSetting('tasks_config', { tasks: defaults });
    apiLog.warn('GM 恢复默认任务列表', { count: defaults.length });
    recordEvent('warn', 'task', `GM 将每日/成长任务恢复为系统默认配置（共 ${defaults.length} 条）`);
    return {
      ok: true,
      tasks: defaults.map((t, idx) => toEnrichedTask(t, idx)),
    };
  });

const LEDGER_BIZ_META: Record<string, { label: string; category: string }> = {
  game_bet: { label: '游戏下注', category: 'game' },
  game_bet_refund: { label: '撤注退还', category: 'game' },
  game_bet_return: { label: '本金返还', category: 'game' },
  game_settle: { label: '游戏结算', category: 'game' },
  slots_bet: { label: '老虎机押注', category: 'slots' },
  slots_win: { label: '老虎机派彩', category: 'slots' },
  slots_spin: { label: '老虎机结算', category: 'slots' },
  mail_reward: { label: '邮箱领取', category: 'mail' },
  task: { label: '任务奖励', category: 'task' },
  level_reward: { label: '等级升级奖', category: 'task' },
  leaderboard: { label: '排行榜奖励', category: 'task' },
  worship: { label: '膜拜奖励', category: 'social' },
  dealer_tip: { label: '打赏荷官', category: 'social' },
  avatar_frame: { label: '购买头像框', category: 'social' },
  stock_buy: { label: '改命股市买入', category: 'stock' },
  stock_sell: { label: '改命股市卖出', category: 'stock' },
  gm_grant: { label: 'GM 调账', category: 'gm' },
  init: { label: '注册赠豆', category: 'gm' },
  relief: { label: '救济金', category: 'task' },
};

function describeLedgerRow(bizType: string, bizId: string): { bizLabel: string; category: string; note: string } {
  const meta = LEDGER_BIZ_META[bizType] ?? { label: bizType || '其他', category: 'other' };
  const cleanId = bizId ? bizId.slice(0, 48) : '';
  let note = cleanId ? `${meta.label} · 单号 ${cleanId}` : meta.label;
  if (bizType === 'mail_reward') note = `邮箱附件领取 (${cleanId})`;
  else if (bizType === 'gm_grant') note = `GM 后台调账 (${cleanId})`;
  else if (bizType === 'game_settle') note = `牌局结算入账 (${cleanId})`;
  else if (bizType === 'game_bet') note = `牌局实时下注 (${cleanId})`;
  else if (bizType === 'game_bet_return') note = `牌局下注本金返还 (${cleanId})`;
  else if (bizType === 'slots_spin' || bizType === 'slots_bet' || bizType === 'slots_win') {
    note = `777 老虎机真实流水 (${cleanId})`;
  } else if (bizType === 'stock_buy') note = `改命股市买入标的 (${cleanId})`;
  else if (bizType === 'stock_sell') note = `改命股市平仓卖出 (${cleanId})`;
  else if (bizType === 'dealer_tip') note = `打赏荷官艾莉丝 (${cleanId})`;
  else if (bizType === 'avatar_frame') note = `商城解锁动态头像框 (${cleanId})`;
  else if (bizType === 'task') note = `悬赏福利任务领奖 (${cleanId})`;
  else if (bizType === 'level_reward') note = `账号升级筹码奖励 (${cleanId})`;
  return { bizLabel: meta.label, category: meta.category, note };
}

  app.get('/api/admin/players', async (req) => {
    requireAdmin(req);
    const query = req.query as { q?: string };

    const keyword = String(query.q ?? '').trim();
    const users = await repo.searchUsers(keyword, '', 50);
    const players = await Promise.all(
      users.map(async (user) => {
        const [balance, prof] = await Promise.all([
          repo.getBalance(user.userId, 'coin'),
          repo.getProfile(user.userId),
        ]);
        return {
          ...user,
          balance,
          level: prof?.level ?? 1,
          totalTurnover: prof?.totalTurnover ?? '0',
        };
      }),
    );
    return { players };
  });

  app.get('/api/admin/players/:userId/ledger', async (req) => {
    requireAdmin(req);
    const userId = String((req.params as { userId?: string }).userId ?? '');
    const query = req.query as { limit?: string; category?: string };
    const limit = Math.min(Math.max(Number(query.limit ?? 200) || 200, 1), 500);
    const category = typeof query.category === 'string' ? query.category.trim().toLowerCase() : 'all';

    const [rawLedger, currentBalance, profile] = await Promise.all([
      repo.listUserLedger(userId, limit),
      repo.getBalance(userId, 'coin'),
      repo.getProfile(userId),
    ]);

    let totalIn = 0;
    let totalOut = 0;
    let gameTurnover = 0;
    let mailClaimed = 0;
    let gmAdjusted = 0;

    const enriched = rawLedger.map((row) => {
      const desc = describeLedgerRow(row.bizType, row.bizId);
      if (row.delta > 0) totalIn += row.delta;
      else if (row.delta < 0) totalOut += Math.abs(row.delta);
      if (desc.category === 'game' || desc.category === 'slots') {
        gameTurnover += Math.abs(row.delta);
      }
      if (row.bizType === 'mail_reward' && row.delta > 0) mailClaimed += row.delta;
      if (row.bizType === 'gm_grant') gmAdjusted += row.delta;
      return {
        ...row,
        bizLabel: desc.bizLabel,
        category: desc.category,
        note: desc.note,
      };
    });

    const filtered =
      category && category !== 'all'
        ? enriched.filter((row) => row.category === category)
        : enriched;

    return {
      ledger: filtered,
      summary: {
        nickname: profile?.nickname ?? '',
        level: profile?.level ?? 1,
        currentBalance,
        totalTurnover: profile?.totalTurnover ?? '0',
        totalCount: enriched.length,
        filteredCount: filtered.length,
        totalIn,
        totalOut,
        netChange: totalIn - totalOut,
        gameTurnover,
        mailClaimed,
        gmAdjusted,
      },
    };
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

  // GM 批量创建账号
  app.post('/api/admin/players/batch-create', async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const prefix = typeof body.prefix === 'string' && body.prefix.trim() ? body.prefix.trim() : 'user_';
    const nicknamePrefix = typeof body.nicknamePrefix === 'string' && body.nicknamePrefix.trim() ? body.nicknamePrefix.trim() : '牌友_';
    const rawPassword = typeof body.password === 'string' && body.password ? body.password : '123456';
    const count = Math.min(Math.max(Number(body.count ?? 10) || 10, 1), 50);
    const initialCoins = Math.max(0, Math.floor(Number(body.initialCoins ?? 10_000)));

    if (rawPassword.length < 6 || rawPassword.length > 32) {
      throw httpError('密码长度需在 6-32 位之间', 400);
    }

    const passwordHash = await hashPassword(rawPassword);
    const created: Array<{
      userId: string;
      username: string;
      nickname: string;
      balance: number;
      initialPassword: string;
    }> = [];

    for (let i = 0; i < count; i++) {
      const randomSuffix = Math.floor(1000 + Math.random() * 9000).toString();
      const randomChar = Math.random().toString(36).substring(2, 5);
      let username = `${prefix}${randomChar}${randomSuffix}`;
      if (username.length > 20) username = username.slice(0, 20);
      if (username.length < 4) username = `${username}_000`.slice(0, 20);

      const nickname = `${nicknamePrefix}${randomSuffix}`;
      const res = await repo.register({ username, passwordHash, nickname });
      if (res.ok) {
        let balance = await repo.getBalance(res.user.id, 'coin');
        if (initialCoins > 0) {
          const idempotencyKey = `batch_init:${res.user.id}:${Date.now()}`;
          try {
            balance = await repo.credit(res.user.id, initialCoins, 'gm_grant', idempotencyKey);
          } catch {
            // 保底
          }
        }
        created.push({
          userId: res.user.id,
          username: res.user.username ?? username,
          nickname: res.user.nickname,
          balance,
          initialPassword: rawPassword,
        });
      }
    }

    apiLog.info(`GM 批量创建账号成功 count=${created.length}`);
    recordEvent('info', 'player', `GM 批量创建了 ${created.length} 个账号，初始筹码: ${initialCoins}`, { count: created.length });
    return { ok: true, count: created.length, accounts: created };
  });

  // GM 补发 / 扣除筹码：正数补发统一通过玩家邮箱发送（需玩家进邮箱领取），负数直接扣减；单次上限 5000 万
  app.post('/api/admin/grant', async (req) => {
    requireAdmin(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const amount = Math.floor(Number(body.amount ?? 0));
    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 80)
      : 'GM 管理员补发补偿';
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' && body.idempotencyKey
        ? body.idempotencyKey.slice(0, 80)
        : '';

    if (!userId) throw httpError('缺少玩家 ID', 400);
    if (!Number.isFinite(amount) || amount === 0) throw httpError('金额需为非零整数', 400);
    if (Math.abs(amount) > 50_000_000) throw httpError('单次补发或扣减上限为 5,000 万欢乐豆', 400);
    if (!idempotencyKey) throw httpError('缺少幂等键 idempotencyKey', 400);

    const target = await repo.getProfile(userId);
    if (!target) throw httpError('玩家不存在', 404);

    // 正数补发：改为发往玩家邮箱，需玩家进入邮箱手动领取
    if (amount > 0) {
      const mail = await repo.sendMail({
        targetType: 'user',
        targetUserId: userId,
        sender: 'GM 客服中心',
        title: `🎁 筹码补发通知 (+${amount.toLocaleString()})`,
        content: `亲爱的 ${target.nickname}：管理员已为您补发 ${amount.toLocaleString()} 欢乐豆（备注：${reason}）。请点击下方按钮领取附件，领取后立即计入您的账户余额与流水账单！`,
        rewardCoins: amount,
      });
      const currentBalance = await repo.getBalance(userId, 'coin');
      apiLog.info(`GM 邮箱补发筹码 userId=${userId} amount=${amount} mailId=${mail.id} reason=${reason}`);
      recordEvent(
        'info',
        'mail',
        `GM 通过邮箱向 ${target.nickname} 补发 +${amount.toLocaleString()} 欢乐豆（待玩家邮箱领取）`,
        { userId, amount, mailId: mail.id },
      );
      return {
        ok: true,
        delivery: 'mail',
        mailId: mail.id,
        nickname: target.nickname,
        balance: currentBalance,
        amount,
        message: `已通过邮箱向「${target.nickname}」补发 +${amount.toLocaleString()} 欢乐豆，需玩家前往大厅「邮箱」领取！`,
      };
    }

    // 负数扣减：直接实时扣减账户余额
    let balance: number;
    try {
      balance = await repo.credit(userId, amount, 'gm_grant', `gm:${idempotencyKey}`);
    } catch (error) {
      if (error instanceof InsufficientFundsError) throw httpError('扣减后余额不能为负', 400);
      throw error;
    }
    apiLog.info(`GM 扣减筹码 userId=${userId} amount=${amount} reason=${reason} balance=${balance}`);
    recordEvent(
      'warn',
      'player',
      `GM 扣减 ${target.nickname} ${amount.toLocaleString()} 欢乐豆（余额: ${balance.toLocaleString()}）`,
      { userId, amount, balance },
    );
    return {
      ok: true,
      delivery: 'direct',
      nickname: target.nickname,
      balance,
      amount,
      message: `已扣除「${target.nickname}」${Math.abs(amount).toLocaleString()} 欢乐豆，当前余额 ${balance.toLocaleString()}`,
    };
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
    if (rewardCoins > 50_000_000) throw httpError('单封邮件附带筹码不能超过 5,000 万', 400);

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
      (action === 'debit' && (amount <= 0 || amount > 100_000_000_000))
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

  // ==================== 单游戏运营 / 热更新（代理 room-server，不触发全站维护补偿） ====================

  /**
   * 转发单游戏运维请求到房间服内部接口。
   * @param path 相对路径，如 /internal/games 或 /internal/games/dice/drain
   * @param method HTTP 方法
   * @param body 可选 JSON 体
   */
  async function proxyGameOps(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const res = await fetch(`${config.roomServerUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-internal-key': config.internalKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(method === 'POST' && path.endsWith('/reload') ? 30_000 : 8_000),
    });
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      data = { error: text || '房间服返回非 JSON' };
    }
    if (!res.ok) {
      throw httpError(typeof data.error === 'string' ? data.error : `房间服错误 (${res.status})`, res.status);
    }
    return data;
  }

  /** GM：全部游戏运营态列表 */
  app.get('/api/admin/games', async (req) => {
    requireAdmin(req);
    return proxyGameOps('/internal/games', 'GET');
  });

  /** GM：单游戏状态 */
  app.get<{ Params: { gameId: string } }>('/api/admin/games/:gameId/status', async (req) => {
    requireAdmin(req);
    const gameId = encodeURIComponent(req.params.gameId);
    return proxyGameOps(`/internal/games/${gameId}/status`, 'GET');
  });

  /** GM：排水 / 禁用 / 启用 / 热重载 */
  for (const action of ['drain', 'disable', 'enable', 'reload'] as const) {
    app.post<{ Params: { gameId: string } }>(`/api/admin/games/:gameId/${action}`, async (req) => {
      requireAdmin(req);
      const gameId = encodeURIComponent(req.params.gameId);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await proxyGameOps(`/internal/games/${gameId}/${action}`, 'POST', body);
      apiLog.info(`GM 单游戏运维: ${action}`, { gameId: req.params.gameId, result });
      recordEvent(
        'warn',
        'game-ops',
        `GM ${action} 游戏 ${req.params.gameId}`,
        { gameId: req.params.gameId, action },
      );
      return result;
    });
  }
}
