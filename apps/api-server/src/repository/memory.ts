import { randomUUID } from 'node:crypto';
import type { Announcement, Currency, Settlement } from '@cc/protocol';
import { periodKeyFor } from '../tasks';
import { InsufficientFundsError } from './types';
import { LEADERBOARD_SIZE, rewardForRank } from '../leaderboard';
import type {
  BetAdjustment,
  AuthUser,
  LeaderboardSnapshotRow,
  DailyWinnerRow,
  FriendRequestView,
  GameRecordView,
  LeaderboardRow,
  PlayerProfile,
  ProfilePatch,
  RegisterInput,
  RegisterResult,
  Repository,
  SettlementResult,
  TaskProgressRow,
  UserRecord,
} from './types';

interface TaskCell {
  progress: number;
  claimed: boolean;
}

/** 内存仓储：零依赖跑通全流程，用于本地开发与技术验证。 */
export class MemoryRepository implements Repository {
  private readonly users = new Map<string, UserRecord>();
  private readonly credentials = new Map<string, string>();
  private readonly usernameIndex = new Map<string, string>();
  private readonly balances = new Map<string, number>();
  private readonly appliedKeys = new Set<string>();
  /** 下注/撤注流水：key 为 `${bizType}:${bizId}:${userId}`，value 为 delta */
  private readonly betLedger = new Map<string, number>();
  /** 每局每个玩家已扣未退的净本金（负数），key 为 `${settlementId}:${userId}` */
  private readonly staked = new Map<string, number>();
  private readonly records: GameRecordView[] = [];
  private readonly taskCells = new Map<string, TaskCell>();
  private readonly daily = new Map<string, { dayKey: string; net: number; rounds: number }>();
  private readonly announcements: Announcement[] = [];
  /** 每日排行榜结算快照：dayKey -> 行 */
  private readonly snapshots = new Map<string, LeaderboardSnapshotRow[]>();
  private readonly initialCoins: number;
  /** 玩家扩展资料：签名与头像 */
  private readonly profiles = new Map<string, { bio: string; avatar: string | null }>();
  /** 好友关系，双向各存一条：`${userId}|${friendId}` */
  private readonly friendships = new Set<string>();
  private readonly friendRequests: FriendRequestView[] = [];

  constructor(initialCoins: number) {
    this.initialCoins = initialCoins;
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const key = input.username.toLowerCase();
    if (this.usernameIndex.has(key)) return { ok: false, reason: 'username_taken' };

    const user: UserRecord = {
      id: randomUUID(),
      nickname: input.nickname,
      username: input.username,
      createdAt: Date.now(),
    };
    this.users.set(user.id, user);
    this.credentials.set(user.id, input.passwordHash);
    this.usernameIndex.set(key, user.id);
    this.balances.set(user.id, this.initialCoins);
    return { ok: true, user };
  }

  async findByUsername(username: string): Promise<AuthUser | null> {
    const id = this.usernameIndex.get(username.toLowerCase());
    if (!id) return null;
    const user = this.users.get(id);
    const hash = this.credentials.get(id);
    if (!user || !hash) return null;
    return { ...user, passwordHash: hash };
  }

  async getUser(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async getBalance(userId: string, _currency: Currency): Promise<number> {
    return this.balances.get(userId) ?? 0;
  }

  async init(): Promise<void> {}

  async releaseOrphanBets(roomId?: string): Promise<number> {
    let released = 0;
    for (const [key, staked] of this.staked) {
      if (staked >= 0) continue;
      if (roomId && !key.startsWith(`${roomId}:`)) continue;
      const userId = key.slice(key.lastIndexOf(':') + 1);
      const releaseKey = `game_bet_release:${key}:return:${userId}`;
      if (this.appliedKeys.has(releaseKey)) continue;
      this.appliedKeys.add(releaseKey);
      const amount = -staked;
      this.balances.set(userId, Math.max(0, (this.balances.get(userId) ?? 0) + amount));
      this.staked.set(key, 0);
      released += amount;
    }
    return released;
  }

  async adjustBet(input: BetAdjustment): Promise<number> {
    const bizType = input.action === 'debit' ? 'game_bet' : 'game_bet_refund';
    const ledgerKey = `${bizType}:${input.bizId}:${input.userId}`;
    const current = this.balances.get(input.userId) ?? 0;
    if (this.betLedger.has(ledgerKey)) return current;

    let amount = input.amount;
    const parts = input.bizId.split(':');
    const stakeKey = `${parts.slice(0, 2).join(':')}:${input.userId}`;
    if (input.action === 'refund') {
      const original = this.betLedger.get(`game_bet:${input.bizId}:${input.userId}`);
      if (original === undefined) throw new Error('原下注凭证不存在');
      amount = -original;
      // 与 Postgres 实现保持一致：已随房间销毁释放或已结算退还的注单不再退第二次
      if (
        this.appliedKeys.has(`game_bet_release:${stakeKey}:return:${input.userId}`) ||
        this.appliedKeys.has(`game_bet_return:${stakeKey}:return:${input.userId}`)
      ) {
        throw new Error('该注单已结算或已释放，不能重复退款');
      }
    }
    const delta = input.action === 'debit' ? -amount : amount;
    if (current + delta < 0) throw new InsufficientFundsError();
    const next = current + delta;
    this.balances.set(input.userId, next);
    this.betLedger.set(ledgerKey, delta);
    this.staked.set(stakeKey, (this.staked.get(stakeKey) ?? 0) + delta);
    return next;
  }

  async applySettlement(settlement: Settlement): Promise<SettlementResult> {
    const keys = settlement.entries.map((e) => `game_settle:${settlement.settlementId}:${e.playerId}`);
    if (keys.some((key) => this.appliedKeys.has(key))) return 'duplicate';

    const dayKey = periodKeyFor('daily');
    for (const entry of settlement.entries) {
      const current = this.balances.get(entry.playerId);
      if (current === undefined) continue;
      // 下注时已扣本金，结算时退回本金再按净盈亏入账
      const stakeKey = `${settlement.settlementId}:${entry.playerId}`;
      const staked = this.staked.get(stakeKey) ?? 0;
      this.balances.set(entry.playerId, Math.max(0, current + entry.delta - staked));
      // 结算后本金已归还，必须清零，否则随后的孤儿注单释放会再退一次
      this.staked.delete(stakeKey);
      this.appliedKeys.add(`game_bet_return:${stakeKey}:return:${entry.playerId}`);

      this.bumpCell(entry.playerId, 'daily_play', dayKey, 1);
      if (entry.delta > 0) this.bumpCell(entry.playerId, 'daily_win', dayKey, 1);
      // 记录当日玩过的游戏种类（多面手任务）与单局大赢（大杀四方任务）
      this.bumpCell(entry.playerId, `game_${settlement.gameId}`, dayKey, 1);
      if (entry.delta >= 500) this.bumpCell(entry.playerId, 'daily_bigwin', dayKey, 1);
      // 长期累计：成长任务
      this.bumpCell(entry.playerId, 'total_play', 'all', 1);
      if (entry.delta > 0) this.bumpCell(entry.playerId, 'total_win', 'all', 1);

      // 当日净收益按自然日隔离，跨天自动从零开始
      const stat = this.daily.get(entry.playerId);
      const todayStat = stat && stat.dayKey === dayKey ? stat : { dayKey, net: 0, rounds: 0 };
      todayStat.net += entry.delta;
      todayStat.rounds += 1;
      this.daily.set(entry.playerId, todayStat);
    }
    for (const key of keys) this.appliedKeys.add(key);

    this.records.unshift({
      settlementId: settlement.settlementId,
      roomId: settlement.roomId,
      gameId: settlement.gameId,
      round: settlement.round,
      seed: settlement.seed,
      winners: settlement.winners,
      entries: settlement.entries,
      finishedAt: settlement.finishedAt,
    });
    if (this.records.length > 1000) this.records.length = 1000;

    return 'applied';
  }

  async listRecords(userId: string, limit: number): Promise<GameRecordView[]> {
    return this.records
      .filter((r) => r.entries.some((e) => e.playerId === userId))
      .slice(0, limit);
  }

  async credit(userId: string, amount: number, bizType: string, bizId: string): Promise<number> {
    const key = `${bizType}:${bizId}:${userId}`;
    const current = this.balances.get(userId) ?? 0;
    if (this.appliedKeys.has(key)) return current;
    const next = current + amount;
    // 与 Postgres 一致：余额不足时抛错，不静默截断成 0
    if (next < 0) throw new InsufficientFundsError();
    this.appliedKeys.add(key);
    this.balances.set(userId, next);
    return next;
  }

  async getTaskRows(userId: string, periodKeys: string[]): Promise<TaskProgressRow[]> {
    const rows: TaskProgressRow[] = [];
    for (const [key, cell] of this.taskCells) {
      const [cellUser, taskKey, periodKey] = key.split('|');
      if (cellUser !== userId || !taskKey || !periodKey) continue;
      if (!periodKeys.includes(periodKey)) continue;
      rows.push({ taskKey, periodKey, progress: cell.progress, claimed: cell.claimed });
    }
    return rows;
  }

  async bumpTask(userId: string, taskKey: string, periodKey: string, delta: number): Promise<number> {
    return this.bumpCell(userId, taskKey, periodKey, delta);
  }

  async claimTask(userId: string, taskKey: string, periodKey: string): Promise<boolean> {
    const cell = this.taskCells.get(`${userId}|${taskKey}|${periodKey}`);
    if (cell?.claimed) return false;
    const target = cell ?? { progress: 0, claimed: false };
    this.taskCells.set(`${userId}|${taskKey}|${periodKey}`, { ...target, claimed: true });
    return true;
  }

  async leaderboard(limit: number): Promise<LeaderboardRow[]> {
    return [...this.balances.entries()]
      .map(([userId, balance]) => ({
        userId,
        nickname: this.users.get(userId)?.nickname ?? '未知玩家',
        balance,
      }))
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit);
  }

  async leaderboardRank(userId: string): Promise<number | null> {
    const rows = await this.leaderboard(Number.MAX_SAFE_INTEGER);
    const index = rows.findIndex((row) => row.userId === userId);
    return index >= 0 ? index + 1 : null;
  }

  async settleDailyLeaderboard(dayKey: string): Promise<number> {
    const rows = await this.leaderboard(LEADERBOARD_SIZE);
    const snapshot: LeaderboardSnapshotRow[] = [];
    let total = 0;
    for (const [index, row] of rows.entries()) {
      const reward = rewardForRank(index + 1);
      if (reward <= 0) continue;
      const balance = await this.credit(row.userId, reward, 'leaderboard_daily', `${dayKey}:${row.userId}`);
      snapshot.push({
        userId: row.userId,
        nickname: row.nickname,
        rank: index + 1,
        balance,
        reward,
      });
      total += reward;
    }
    this.snapshots.set(dayKey, snapshot);
    return total;
  }

  async listDailySnapshot(dayKey: string): Promise<LeaderboardSnapshotRow[]> {
    return this.snapshots.get(dayKey) ?? [];
  }

  async dailyWinners(limit: number): Promise<DailyWinnerRow[]> {
    const dayKey = periodKeyFor('daily');
    return [...this.daily.entries()]
      .filter(([, stat]) => stat.dayKey === dayKey)
      .map(([userId, stat]) => ({
        userId,
        nickname: this.users.get(userId)?.nickname ?? '未知玩家',
        net: stat.net,
        rounds: stat.rounds,
      }))
      .filter((row) => row.net > 0)
      .sort((a, b) => b.net - a.net)
      .slice(0, limit);
  }

  async listAnnouncements(limit: number): Promise<Announcement[]> {
    return [...this.announcements]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.min(Math.max(1, limit), 50));
  }

  async createAnnouncement(input: {
    title: string;
    content: string;
    kind: Announcement['kind'];
  }): Promise<Announcement> {
    const row: Announcement = { id: randomUUID(), ...input, createdAt: Date.now() };
    this.announcements.unshift(row);
    if (this.announcements.length > 200) this.announcements.length = 200;
    return row;
  }

  async deleteAnnouncement(id: string): Promise<boolean> {
    const index = this.announcements.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.announcements.splice(index, 1);
    return true;
  }

  async close(): Promise<void> {
    /* nothing to release */
  }

  // ---------- 个人资料 ----------

  async getProfile(userId: string): Promise<PlayerProfile | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    const extra = this.profiles.get(userId);
    return {
      userId: user.id,
      nickname: user.nickname,
      username: user.username,
      bio: extra?.bio ?? '',
      avatar: extra?.avatar ?? null,
    };
  }

  async updateProfile(userId: string, patch: ProfilePatch): Promise<PlayerProfile> {
    const user = this.users.get(userId);
    if (!user) throw new Error('用户不存在');

    if (patch.nickname !== undefined) {
      const nickname = patch.nickname.trim();
      if (nickname.length < 2 || nickname.length > 16) throw new Error('昵称需 2-16 个字符');
      const taken = [...this.users.values()].some(
        (item) => item.id !== userId && item.nickname.toLowerCase() === nickname.toLowerCase(),
      );
      if (taken) throw new Error('该昵称已被其他玩家使用');
      this.users.set(userId, { ...user, nickname });
    }
    const current = this.profiles.get(userId) ?? { bio: '', avatar: null };
    this.profiles.set(userId, {
      bio: patch.bio !== undefined ? patch.bio.slice(0, 60) : current.bio,
      avatar: patch.avatar !== undefined ? patch.avatar : current.avatar,
    });

    const profile = await this.getProfile(userId);
    return profile as PlayerProfile;
  }

  async searchUsers(keyword: string, excludeUserId: string, limit: number): Promise<PlayerProfile[]> {
    const q = keyword.trim().toLowerCase();
    const all = [...this.users.values()].filter((user) => user.id !== excludeUserId);
    const matched = q
      ? all.filter(
          (user) =>
            user.nickname.toLowerCase().includes(q) ||
            (user.username ?? '').toLowerCase().includes(q),
        )
      : all;

    return matched
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((user) => {
        const extra = this.profiles.get(user.id);
        return {
          userId: user.id,
          nickname: user.nickname,
          username: user.username,
          bio: extra?.bio ?? '',
          avatar: extra?.avatar ?? null,
          isFriend: this.friendships.has(`${excludeUserId}|${user.id}`),
          requestPending: this.friendRequests.some(
            (r) => r.fromId === excludeUserId && r.toId === user.id && r.status === 'pending',
          ),
        };
      });
  }

  // ---------- 好友 ----------

  async listFriends(userId: string): Promise<PlayerProfile[]> {
    const ids = [...this.friendships]
      .filter((key) => key.startsWith(`${userId}|`))
      .map((key) => key.split('|')[1]!)
      .filter(Boolean);

    const result: PlayerProfile[] = [];
    for (const id of ids) {
      const profile = await this.getProfile(id);
      if (profile) result.push({ ...profile, isFriend: true });
    }
    return result.sort((a, b) => a.nickname.localeCompare(b.nickname, 'zh-Hans-CN'));
  }

  async createFriendRequest(fromId: string, toId: string, message: string | null): Promise<FriendRequestView> {
    if (fromId === toId) throw new Error('不能添加自己为好友');
    if (!this.users.has(toId)) throw new Error('该玩家不存在');
    if (this.friendships.has(`${fromId}|${toId}`)) throw new Error('你们已经是好友了');
    if (this.friendRequests.some((r) => r.status === 'pending' && r.fromId === fromId && r.toId === toId)) {
      throw new Error('已发送过申请，请等待对方处理');
    }
    // 对方先发过申请时直接互相成为好友
    const reverse = this.friendRequests.find(
      (r) => r.status === 'pending' && r.fromId === toId && r.toId === fromId,
    );
    if (reverse) {
      reverse.status = 'accepted';
      this.friendships.add(`${fromId}|${toId}`);
      this.friendships.add(`${toId}|${fromId}`);
    }

    const from = await this.getProfile(fromId);
    const to = await this.getProfile(toId);
    const row: FriendRequestView = {
      id: randomUUID(),
      fromId,
      fromNickname: from?.nickname ?? '未知玩家',
      fromAvatar: from?.avatar ?? null,
      toId,
      toNickname: to?.nickname ?? '未知玩家',
      toAvatar: to?.avatar ?? null,
      message: message ?? null,
      status: reverse ? 'accepted' : 'pending',
      createdAt: Date.now(),
    };
    this.friendRequests.push(row);
    return row;
  }

  async listFriendRequests(userId: string): Promise<{
    incoming: FriendRequestView[];
    outgoing: FriendRequestView[];
  }> {
    const pending = this.friendRequests.filter((r) => r.status === 'pending');
    return {
      incoming: pending.filter((r) => r.toId === userId).sort((a, b) => b.createdAt - a.createdAt),
      outgoing: pending.filter((r) => r.fromId === userId).sort((a, b) => b.createdAt - a.createdAt),
    };
  }

  async acceptFriendRequest(requestId: string, userId: string): Promise<boolean> {
    const row = this.friendRequests.find((r) => r.id === requestId);
    if (!row || row.toId !== userId || row.status !== 'pending') return false;
    row.status = 'accepted';
    this.friendships.add(`${row.fromId}|${row.toId}`);
    this.friendships.add(`${row.toId}|${row.fromId}`);
    return true;
  }

  async rejectFriendRequest(requestId: string, userId: string): Promise<boolean> {
    const row = this.friendRequests.find((r) => r.id === requestId);
    if (!row || row.toId !== userId || row.status !== 'pending') return false;
    row.status = 'rejected';
    return true;
  }

  async removeFriend(userId: string, friendId: string): Promise<boolean> {
    const had = this.friendships.delete(`${userId}|${friendId}`);
    this.friendships.delete(`${friendId}|${userId}`);
    return had;
  }

  async areFriends(userId: string, friendId: string): Promise<boolean> {
    return this.friendships.has(`${userId}|${friendId}`);
  }

  private bumpCell(userId: string, taskKey: string, periodKey: string, delta: number): number {
    const key = `${userId}|${taskKey}|${periodKey}`;
    const cell = this.taskCells.get(key) ?? { progress: 0, claimed: false };
    const next = { ...cell, progress: cell.progress + delta };
    this.taskCells.set(key, next);
    return next.progress;
  }
}
