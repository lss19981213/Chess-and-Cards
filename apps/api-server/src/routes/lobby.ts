import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { GameMeta } from '@cc/protocol';
import { config } from '../config';
import { FALLBACK_GAMES } from '../game-catalog';
import { authHeader, httpError } from '../http-utils';
import { LEADERBOARD_SIZE, beijingDayKey, rewardForRank } from '../leaderboard';
import { InsufficientFundsError, type Repository } from '../repository/types';
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

    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) {
      throw httpError('打赏金额不合法', 400);
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

    return { ok: true, balance: newBalance, amount, giftName };
  });

  app.get('/api/leaderboard', async (req) => {
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
