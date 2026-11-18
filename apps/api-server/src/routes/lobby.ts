import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { AVATAR_FRAMES, type GameMeta } from '@cc/protocol';
import { config } from '../config';
import { FALLBACK_GAMES } from '../game-catalog';
import { authHeader, httpError } from '../http-utils';
import { LEADERBOARD_SIZE, beijingDayKey, rewardForRank } from '../leaderboard';
import { InsufficientFundsError, type Repository } from '../repository/types';
import { SLOT_BET_OPTIONS, SLOT_PAYLINES, rollSlots } from '../slots-engine';
import { TASKS, findTask, periodKeyFor, titleFor, type TaskView } from '../tasks';

export async function buildTasks(
  repo: Repository,
  userId: string,
  balance: number,
): Promise<TaskView[]> {
  const dailyKey = periodKeyFor('daily');
  const onceKey = periodKeyFor('once');
  const rows = await repo.getTaskRows(userId, [dailyKey, onceKey]);

  const playedToday = new Set(
    rows
      .filter((row) => row.periodKey === dailyKey && row.taskKey.startsWith('game_'))
      .map((row) => row.taskKey),
  ).size;

  return TASKS.map((task) => {
    const pk = periodKeyFor(task.period);
    const ownRow = rows.find((r) => r.taskKey === task.key && r.periodKey === pk);

    if (task.key === 'daily_invite') {
      const inviteRow = rows.find((r) => r.taskKey === 'daily_invite' && r.periodKey === pk);
      const claimedRow = rows.find((r) => r.taskKey === 'daily_invite_claimed' && r.periodKey === pk);
      const totalInvites = inviteRow?.progress ?? 0;
      const claimedCount = claimedRow?.progress ?? 0;
      const unclaimed = Math.max(0, totalInvites - claimedCount);
      const claimable = unclaimed > 0;
      return {
        key: task.key,
        name: task.name,
        description: `每邀请1位新玩家注册入场奖励 1,000 筹码（无上限），今日已邀请 ${totalInvites} 人${unclaimed > 0 ? `，待领取 ${unclaimed} 份（${(unclaimed * 1000).toLocaleString()} 筹码）` : ''}！`,
        target: Math.max(1, totalInvites),
        reward: unclaimed > 0 ? unclaimed * 1000 : 1000,
        period: task.period,
        group: task.group,
        progress: totalInvites,
        claimed: totalInvites > 0 && unclaimed === 0,
        claimable,
        locked: false,
      };
    }

    let progress: number;
    if (task.progressSource?.kind === 'gameKinds') {
      progress = playedToday;
    } else {
      const sourceKey = task.progressSource?.key ?? task.key;
      const row = rows.find((r) => r.taskKey === sourceKey && r.periodKey === pk);
      progress = row?.progress ?? 0;
    }

    const claimed = ownRow?.claimed ?? false;
    const blocked = task.maxBalance !== undefined && balance >= task.maxBalance;
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

export function registerLobbyRoutes(app: FastifyInstance, repo: Repository): void {
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
    return { balance, tasks: await buildTasks(repo, claims.sub, balance) };
  });

  app.post('/api/tasks/claim', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = typeof body.key === 'string' ? body.key : '';
    const task = findTask(key);
    if (!task) throw httpError('任务不存在', 404);

    const pk = periodKeyFor(task.period);

    // 邀请新玩家：按未领取的邀请人头全额发放，无上限！
    if (key === 'daily_invite') {
      const rows = await repo.getTaskRows(claims.sub, [pk]);
      const inviteRow = rows.find((r) => r.taskKey === 'daily_invite' && r.periodKey === pk);
      const claimedRow = rows.find((r) => r.taskKey === 'daily_invite_claimed' && r.periodKey === pk);
      const totalInvites = inviteRow?.progress ?? 0;
      const claimedCount = claimedRow?.progress ?? 0;
      const unclaimed = Math.max(0, totalInvites - claimedCount);
      if (unclaimed <= 0) throw httpError('暂无可领取的邀请奖励，快去邀请好友吧！', 400);

      const rewardAmount = unclaimed * 1000;
      const bizId = `invite:${claims.sub}:${pk}:${Date.now()}`;
      const newBalance = await repo.credit(claims.sub, rewardAmount, 'task', bizId);
      await repo.bumpTask(claims.sub, 'daily_invite_claimed', pk, unclaimed);
      return { reward: rewardAmount, balance: newBalance, tasks: await buildTasks(repo, claims.sub, newBalance) };
    }

    const balance = await repo.getBalance(claims.sub, 'coin');
    const views = await buildTasks(repo, claims.sub, balance);
    const view = views.find((v) => v.key === key);
    if (!view) throw httpError('任务不存在', 404);
    if (view.claimed) throw httpError('该任务奖励已领取', 409);
    if (view.locked) throw httpError(view.lockReason ?? '当前无法领取', 400);
    if (task.kind !== 'relief' && view.progress < task.target) throw httpError('任务尚未完成', 400);

    const newBalance = await repo.credit(claims.sub, task.reward, 'task', `${key}:${pk}`);
    const claimed = await repo.claimTask(claims.sub, key, pk);
    if (!claimed) throw httpError('该任务奖励已领取', 409);

    return { reward: task.reward, balance: newBalance, tasks: await buildTasks(repo, claims.sub, newBalance) };
  });

  // 打赏荷官：真实扣减筹码并推进当日打赏任务
  app.post('/api/tip-dealer', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const amount = Math.floor(Number(body.amount ?? 0));
    const giftName = String(body.giftName ?? '礼物').slice(0, 20);

    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000) {
      throw httpError('打赏金额不合法，单次打赏上限为 1,000 筹码', 400);
    }

    const balance = await repo.getBalance(claims.sub, 'coin');
    if (balance < amount) throw httpError('筹码不足，先去福利中心领取救济金吧', 400);

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
    const affection = await repo.addDealerAffection(claims.sub, amount);

    return { ok: true, balance: newBalance, amount, giftName, affection };
  });

  app.get('/api/leaderboard', async (req) => {
    const rows = await repo.leaderboard(LEADERBOARD_SIZE);

    let myRank: number | null = null;
    let myUserId: string | null = null;
    let remainingWorshipsToday = 10;
    try {
      const claims = authHeader(req);
      myUserId = claims.sub;
      myRank = await repo.leaderboardRank(claims.sub);
      remainingWorshipsToday = await repo.getWorshipRemainingToday(claims.sub, beijingDayKey());
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
        worshipCount: row.worshipCount ?? 0,
        equippedFrame: row.equippedFrame ?? 'frame_default',
        avatar: row.avatar ?? null,
      })),
      myRank,
      myUserId,
      remainingWorshipsToday,
    };
  });

  app.post('/api/leaderboard/:userId/worship', async (req) => {
    const claims = authHeader(req);
    const targetUserId = String((req.params as { userId?: string }).userId ?? '');
    if (!targetUserId) throw httpError('缺少目标玩家 ID', 400);

    try {
      const res = await repo.worshipUser(claims.sub, targetUserId, beijingDayKey());
      return res;
    } catch (err) {
      throw httpError(err instanceof Error ? err.message : '膜拜失败', 400);
    }
  });

  app.get('/api/avatar-frames/catalog', async (req) => {
    let equippedFrame = 'frame_default';
    let ownedFrames = ['frame_default'];
    let worshipCount = 0;
    try {
      const claims = authHeader(req);
      const profile = await repo.getProfile(claims.sub);
      if (profile) {
        equippedFrame = profile.equippedFrame ?? 'frame_default';
        ownedFrames = profile.ownedFrames ?? ['frame_default'];
        worshipCount = profile.worshipCount ?? 0;
      }
    } catch {
      /* 游客模式返回默认 */
    }
    return {
      frames: AVATAR_FRAMES,
      equippedFrame,
      ownedFrames,
      worshipCount,
    };
  });

  app.post('/api/avatar-frames/buy', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as { frameId?: string };
    const frameId = String(body.frameId ?? '');
    const meta = AVATAR_FRAMES.find((f) => f.id === frameId);
    if (!meta) throw httpError('头像框不存在', 404);

    try {
      const res = await repo.buyAvatarFrame(claims.sub, frameId, meta.price);
      return res;
    } catch (err) {
      throw httpError(err instanceof Error ? err.message : '购买头像框失败', 400);
    }
  });

  app.post('/api/avatar-frames/equip', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as { frameId?: string };
    const frameId = String(body.frameId ?? '');
    if (!frameId) throw httpError('缺少头像框 ID', 400);

    try {
      const res = await repo.equipAvatarFrame(claims.sub, frameId);
      return res;
    } catch (err) {
      throw httpError(err instanceof Error ? err.message : '佩戴头像框失败', 400);
    }
  });

  app.post('/api/dealer/customize', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as { skin?: string; voice?: string };
    const skin = String(body.skin ?? 'classic');
    const voice = String(body.voice ?? 'classic');

    const res = await repo.customizeDealer(claims.sub, skin, voice);
    return res;
  });

  // 领取账号升级筹码奖励（Lv.2=1000, Lv.3=2000, Lv.4=3000... 依次递增）
  app.post('/api/level/claim', async (req) => {
    const claims = authHeader(req);
    try {
      return await repo.claimLevelReward(claims.sub);
    } catch (err) {
      throw httpError(err instanceof Error ? err.message : '领取升级奖励失败', 400);
    }
  });

  // 服务端权威老虎机摇奖结算：真实扣款与派彩、写入流水账本、累计经验值与 GM 经营统计（无免费旋转）
  app.post('/api/slots/spin', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const betPerLine = Math.floor(Number(body.betPerLine ?? 0));
    const lines = Math.floor(Number(body.lines ?? 25));

    if (!SLOT_BET_OPTIONS.includes(betPerLine as (typeof SLOT_BET_OPTIONS)[number])) {
      throw httpError('单线押注金额不合法', 400);
    }
    if (!Number.isInteger(lines) || lines < 1 || lines > SLOT_PAYLINES.length) {
      throw httpError(`赔付线数需在 1-${SLOT_PAYLINES.length} 之间`, 400);
    }

    const rolled = rollSlots(betPerLine, lines);
    const spinId = randomUUID();
    try {
      const outcome = await repo.playSlotsSpin({
        spinId,
        userId: claims.sub,
        betPerLine: rolled.betPerLine,
        lines: rolled.lines,
        totalBet: rolled.totalBet,
        winAmount: rolled.winAmount,
        isJackpot: rolled.isJackpot,
        winningLines: rolled.winningLines,
        reels: rolled.reels,
      });
      return {
        ok: true,
        spinId: outcome.spinId,
        reels: rolled.reels,
        betPerLine: rolled.betPerLine,
        lines: rolled.lines,
        totalBet: outcome.totalBet,
        winAmount: outcome.winAmount,
        netDelta: outcome.netDelta,
        winningLines: rolled.winningLines,
        isJackpot: rolled.isJackpot,
        balance: outcome.balance,
        level: outcome.level,
        xp: outcome.xp,
        rewardedLevel: outcome.rewardedLevel,
        totalTurnover: outcome.totalTurnover,
        levelsGained: outcome.levelsGained,
      };
    } catch (error) {
      if (error instanceof InsufficientFundsError) {
        throw httpError('筹码不足，请先降低押注或前往福利中心领取救济金', 400);
      }
      throw error;
    }
  });

  // 轻量级荷官中文语音合成兜底代理（当客户端浏览器缺失本地 TTS 语音包时提供稳定有声回退）
  const ttsCache = new Map<string, Buffer>();
  app.get('/api/tts', async (req, reply) => {
    const rawText = String((req.query as { text?: string }).text ?? '').trim();
    const cleaned = rawText
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9，。！？、：；,.!?\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 100);
    if (!cleaned) {
      return reply.status(400).send({ error: '缺少朗读文本' });
    }

    const cached = ttsCache.get(cleaned);
    if (cached) {
      reply.header('cache-control', 'public, max-age=86400');
      return reply.type('audio/mpeg').send(cached);
    }

    try {
      const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleaned)}&le=zh`;
      const res = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(4500),
      });
      if (!res.ok) throw new Error(`TTS upstream ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 256) throw new Error('TTS empty payload');

      if (ttsCache.size >= 120) {
        const firstKey = ttsCache.keys().next().value;
        if (firstKey !== undefined) ttsCache.delete(firstKey);
      }
      ttsCache.set(cleaned, buf);
      reply.header('cache-control', 'public, max-age=86400');
      return reply.type('audio/mpeg').send(buf);
    } catch {
      return reply.status(503).send({ error: '语音合成暂不可用' });
    }
  });

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

  app.get('/api/announcements', async (req) => {
    const limit = Math.min(Math.max(Number((req.query as { limit?: string }).limit ?? 8) || 8, 1), 50);
    return { announcements: await repo.listAnnouncements(limit) };
  });
}
