import { createHash, randomUUID } from 'node:crypto';
import {
  applyXpGain,
  parseBigIntSafe,
  totalClaimableLevelReward,
  type Announcement,
  type Currency,
  type Settlement,
} from '@cc/protocol';
import { periodKeyFor } from '../tasks';
import { InsufficientFundsError } from './types';
import { LEADERBOARD_SIZE, rewardForRank } from '../leaderboard';
import type {
  BetAdjustment,
  AuthUser,
  ClaimMailResult,
  EconomyOverview,
  LeaderboardSnapshotRow,
  DailyWinnerRow,
  FriendRequestView,
  GameRecordView,
  LeaderboardRow,
  LedgerRow,
  LevelLeaderboardRow,
  MailRecord,
  PlayerMailView,
  PlayerProfile,
  ProfilePatch,
  RegisterInput,
  RegisterResult,
  Repository,
  SendMailInput,
  SettlementResult,
  SlotsAnalytics,
  SlotsPlayerStat,
  SlotsSpinInput,
  SlotsSpinLog,
  SlotsSpinOutcome,
  SlotsSummaryMetrics,
  TaskProgressRow,
  UserRecord,
} from './types';
import { beijingDayKey } from '../leaderboard';

function avatarUrlFor(userId: string, raw: string | null | undefined): string | null {
  if (!raw) return null;
  const hash = createHash('md5').update(raw).digest('hex').slice(0, 10);
  return `/api/avatar/${encodeURIComponent(userId)}?v=${hash}`;
}

interface TaskCell {
  progress: number;
  claimed: boolean;
}

/** 内存仓储：零依赖跑通全流程，用于本地开发与技术验证。 */
export class MemoryRepository implements Repository {
  private readonly users = new Map<string, UserRecord>();
  private readonly credentials = new Map<string, string>();
  private readonly usernameIndex = new Map<string, string>();
  private readonly emailIndex = new Map<string, string>();
  private readonly oauthIndex = new Map<string, string>();
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
  /** 玩家扩展资料：签名、头像、头像框、膜拜数、荷官皮肤与语音 */
  private readonly profiles = new Map<
    string,
    {
      bio: string;
      avatar: string | null;
      equippedFrame?: string;
      ownedFrames?: string[];
      worshipCount?: number;
      dealerSkin?: string;
      dealerVoice?: string;
      dealerAffection?: number;
      level?: number;
      xp?: string;
      rewardedLevel?: number;
      totalTurnover?: string;
    }
  >();
  private readonly worshipRecords: { worshiperId: string; targetUserId: string; dayKey: string }[] = [];
  /** 好友关系，双向各存一条：`${userId}|${friendId}` */
  private readonly friendships = new Set<string>();
  private readonly friendRequests: FriendRequestView[] = [];
  /** 资金流水明细（GM 控制台与账本透视） */
  private readonly ledgerHistory: LedgerRow[] = [];
  /** 老虎机摇奖经营记录 */
  private readonly slotsSpins: Array<{
    id: string;
    userId: string;
    betPerLine: number;
    lines: number;
    totalBet: number;
    winAmount: number;
    netDelta: number;
    isJackpot: boolean;
    winningLines: number;
    createdAt: number;
  }> = [];
  /** 动态运营配置（游戏分类、老虎机概率等） */
  private readonly settings = new Map<string, unknown>();
  /** 系统与运营邮件 */
  private readonly mails = new Map<string, MailRecord>();
  /** 玩家邮件阅读与领奖状态：`${mailId}|${userId}` */
  private readonly mailUserStatuses = new Map<
    string,
    { isRead: boolean; isClaimed: boolean; claimedAt: number | null; deleted: boolean }
  >();

  constructor(initialCoins: number) {
    this.initialCoins = initialCoins;
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const key = input.username.toLowerCase();
    if (this.usernameIndex.has(key)) return { ok: false, reason: 'username_taken' };

    const normalizedEmail = input.email ? input.email.trim().toLowerCase() : null;
    if (normalizedEmail && this.emailIndex.has(normalizedEmail)) {
      return { ok: false, reason: 'email_taken' };
    }

    const user: UserRecord = {
      id: randomUUID(),
      nickname: input.nickname,
      username: input.username,
      email: normalizedEmail,
      oauthProvider: input.oauthProvider ?? null,
      oauthSub: input.oauthSub ?? null,
      createdAt: Date.now(),
      banned: false,
    };
    this.users.set(user.id, user);
    this.credentials.set(user.id, input.passwordHash);
    this.usernameIndex.set(key, user.id);
    if (normalizedEmail) this.emailIndex.set(normalizedEmail, user.id);
    if (input.oauthProvider && input.oauthSub) {
      this.oauthIndex.set(`${input.oauthProvider}:${input.oauthSub}`, user.id);
    }
    this.balances.set(user.id, this.initialCoins);
    return { ok: true, user };
  }

  async findByOAuth(provider: string, sub: string): Promise<UserRecord | null> {
    const id = this.oauthIndex.get(`${provider}:${sub}`);
    return id ? (this.users.get(id) ?? null) : null;
  }

  async bindOAuth(userId: string, provider: string, sub: string): Promise<void> {
    const user = this.users.get(userId);
    if (!user) return;
    user.oauthProvider = provider;
    user.oauthSub = sub;
    this.oauthIndex.set(`${provider}:${sub}`, userId);
  }

  async findByUsername(username: string): Promise<AuthUser | null> {
    const id = this.usernameIndex.get(username.toLowerCase());
    if (!id) return null;
    const user = this.users.get(id);
    const hash = this.credentials.get(id);
    if (!user || !hash) return null;
    return { ...user, passwordHash: hash };
  }

  async findByEmail(email: string): Promise<AuthUser | null> {
    const id = this.emailIndex.get(email.toLowerCase());
    if (!id) return null;
    const user = this.users.get(id);
    const hash = this.credentials.get(id);
    if (!user || !hash) return null;
    return { ...user, passwordHash: hash };
  }

  async updatePassword(userId: string, passwordHash: string): Promise<boolean> {
    if (!this.users.has(userId)) return false;
    this.credentials.set(userId, passwordHash);
    return true;
  }

  async updateEmail(userId: string, email: string): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) return false;
    user.email = email;
    this.emailIndex.set(email.toLowerCase(), userId);
    return true;
  }

  async setInvitedBy(userId: string, invitedBy: string): Promise<void> {
    const user = this.users.get(userId);
    if (user && !user.invitedBy) {
      user.invitedBy = invitedBy;
    }
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
      const nextBalance = Math.max(0, (this.balances.get(userId) ?? 0) + amount);
      this.balances.set(userId, nextBalance);
      this.staked.set(key, 0);
      this.ledgerHistory.unshift({
        id: randomUUID(),
        userId,
        currency: 'coin',
        delta: amount,
        balanceAfter: nextBalance,
        bizType: 'game_bet_release',
        bizId: key,
        createdAt: Date.now(),
      });
      if (this.ledgerHistory.length > 5000) this.ledgerHistory.length = 5000;
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
    this.ledgerHistory.unshift({
      id: randomUUID(),
      userId: input.userId,
      currency: 'coin',
      delta,
      balanceAfter: next,
      bizType,
      bizId: input.bizId,
      createdAt: Date.now(),
    });
    if (this.ledgerHistory.length > 5000) this.ledgerHistory.length = 5000;
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
      const nextBalance = Math.max(0, current + entry.delta - staked);
      this.balances.set(entry.playerId, nextBalance);
      // 结算后本金已归还，必须清零，否则随后的孤儿注单释放会再退一次
      this.staked.delete(stakeKey);
      this.appliedKeys.add(`game_bet_return:${stakeKey}:return:${entry.playerId}`);

      const netDelta = entry.delta - staked;
      this.ledgerHistory.unshift({
        id: randomUUID(),
        userId: entry.playerId,
        currency: 'coin',
        delta: netDelta,
        balanceAfter: nextBalance,
        bizType: 'game_settle',
        bizId: `${settlement.roomId}:${settlement.round}`,
        createdAt: settlement.finishedAt || Date.now(),
      });
      if (this.ledgerHistory.length > 5000) this.ledgerHistory.length = 5000;

      this.bumpCell(entry.playerId, 'daily_play', dayKey, 1);
      if (entry.delta > 0) this.bumpCell(entry.playerId, 'daily_win', dayKey, 1);
      // 记录当日及历史玩过的游戏种类、雀神麻将活跃与单局大赢
      this.bumpCell(entry.playerId, `game_${settlement.gameId}`, dayKey, 1);
      this.bumpCell(entry.playerId, `game_${settlement.gameId}`, 'all', 1);
      if (
        settlement.gameId === 'cs-mahjong' ||
        settlement.gameId === 'sc-mahjong' ||
        settlement.gameId === 'gd-mahjong' ||
        settlement.gameId === 'guobiao-mahjong' ||
        settlement.gameId === 'hz-mahjong'
      ) {
        this.bumpCell(entry.playerId, 'daily_mahjong', dayKey, 1);
      }
      if (entry.delta >= 500) this.bumpCell(entry.playerId, 'daily_bigwin', dayKey, 1);
      // 长期累计：成长任务
      this.bumpCell(entry.playerId, 'total_play', 'all', 1);
      if (entry.delta > 0) this.bumpCell(entry.playerId, 'total_win', 'all', 1);

      // 有效流水转化为账号经验（1 流水 = 1 经验），并推进每日流水任务
      const turnover = Math.max(-staked, Math.abs(entry.delta));
      if (turnover > 0) {
        this.bumpCell(entry.playerId, 'daily_turnover', dayKey, Math.floor(turnover));
        const curProfile = this.profiles.get(entry.playerId) ?? { bio: '', avatar: null };
        const nextProg = applyXpGain(curProfile.level ?? 1, curProfile.xp ?? '0', turnover);
        const nextTurnover = (parseBigIntSafe(curProfile.totalTurnover) + BigInt(Math.floor(turnover))).toString();
        this.profiles.set(entry.playerId, {
          ...curProfile,
          level: nextProg.level,
          xp: nextProg.xp,
          rewardedLevel: curProfile.rewardedLevel ?? 1,
          totalTurnover: nextTurnover,
        });
      }

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
    this.ledgerHistory.unshift({
      id: randomUUID(),
      userId,
      currency: 'coin',
      delta: amount,
      balanceAfter: next,
      bizType,
      bizId,
      createdAt: Date.now(),
    });
    if (this.ledgerHistory.length > 5000) this.ledgerHistory.length = 5000;
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
      .map(([userId, balance]) => {
        const extra = this.profiles.get(userId);
        return {
          userId,
          nickname: this.users.get(userId)?.nickname ?? '未知玩家',
          balance,
          worshipCount: extra?.worshipCount ?? 0,
          equippedFrame: extra?.equippedFrame ?? 'frame_default',
          avatar: avatarUrlFor(userId, extra?.avatar),
        };
      })
      .sort((a, b) => b.balance - a.balance)
      .slice(0, limit);
  }

  async leaderboardRank(userId: string): Promise<number | null> {
    const rows = await this.leaderboard(Number.MAX_SAFE_INTEGER);
    const index = rows.findIndex((row) => row.userId === userId);
    return index >= 0 ? index + 1 : null;
  }

  async levelLeaderboard(limit: number): Promise<LevelLeaderboardRow[]> {
    return [...this.users.values()]
      .map((user) => {
        const extra = this.profiles.get(user.id);
        return {
          userId: user.id,
          nickname: user.nickname,
          level: extra?.level ?? 1,
          xp: extra?.xp ?? '0',
          totalTurnover: extra?.totalTurnover ?? '0',
          balance: this.balances.get(user.id) ?? 0,
          worshipCount: extra?.worshipCount ?? 0,
          equippedFrame: extra?.equippedFrame ?? 'frame_default',
          avatar: avatarUrlFor(user.id, extra?.avatar),
          _createdAt: user.createdAt,
        };
      })
      .sort((a, b) => {
        if (b.level !== a.level) return b.level - a.level;
        const bt = parseBigIntSafe(b.totalTurnover);
        const at = parseBigIntSafe(a.totalTurnover);
        if (bt !== at) return bt > at ? 1 : -1;
        const bx = parseBigIntSafe(b.xp);
        const ax = parseBigIntSafe(a.xp);
        if (bx !== ax) return bx > ax ? 1 : -1;
        return a._createdAt - b._createdAt;
      })
      .slice(0, limit)
      .map(({ _createdAt: _, ...row }) => row);
  }

  async levelLeaderboardRank(userId: string): Promise<number | null> {
    const rows = await this.levelLeaderboard(Number.MAX_SAFE_INTEGER);
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

  async getAvatar(userId: string): Promise<string | null> {
    return this.profiles.get(userId)?.avatar ?? null;
  }

  async getProfile(userId: string): Promise<PlayerProfile | null> {
    const user = this.users.get(userId);
    if (!user) return null;
    const extra = this.profiles.get(userId);
    return {
      userId: user.id,
      nickname: user.nickname,
      username: user.username,
      bio: extra?.bio ?? '',
      avatar: avatarUrlFor(user.id, extra?.avatar),
      banned: user.banned ?? false,
      equippedFrame: extra?.equippedFrame ?? 'frame_default',
      ownedFrames: extra?.ownedFrames ?? ['frame_default'],
      worshipCount: extra?.worshipCount ?? 0,
      dealerSkin: extra?.dealerSkin ?? 'classic',
      dealerVoice: extra?.dealerVoice ?? 'classic',
      dealerAffection: extra?.dealerAffection ?? 0,
      level: extra?.level ?? 1,
      xp: extra?.xp ?? '0',
      rewardedLevel: extra?.rewardedLevel ?? 1,
      totalTurnover: extra?.totalTurnover ?? '0',
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
      ...current,
      bio: patch.bio !== undefined ? patch.bio.slice(0, 60) : current.bio,
      avatar: patch.avatar !== undefined ? patch.avatar : current.avatar,
      equippedFrame: patch.equippedFrame !== undefined ? patch.equippedFrame : current.equippedFrame,
      dealerSkin: patch.dealerSkin !== undefined ? patch.dealerSkin : current.dealerSkin,
      dealerVoice: patch.dealerVoice !== undefined ? patch.dealerVoice : current.dealerVoice,
      dealerAffection: patch.dealerAffection !== undefined ? Math.max(0, Math.floor(patch.dealerAffection)) : current.dealerAffection,
    });

    const profile = await this.getProfile(userId);
    return profile as PlayerProfile;
  }

  async buyAvatarFrame(
    userId: string,
    frameId: string,
    price: number,
  ): Promise<{ ok: boolean; balance: number; equippedFrame: string; ownedFrames: string[] }> {
    const current = this.profiles.get(userId) ?? { bio: '', avatar: null };
    const owned = current.ownedFrames ?? ['frame_default'];
    if (owned.includes(frameId)) {
      this.profiles.set(userId, { ...current, equippedFrame: frameId });
      const balance = await this.getBalance(userId, 'coin');
      return { ok: true, balance, equippedFrame: frameId, ownedFrames: owned };
    }
    const currentBalance = await this.getBalance(userId, 'coin');
    if (currentBalance < price) {
      throw new Error(`筹码不足，购买头像框需要 ${price.toLocaleString()} 筹码`);
    }
    const newBalance = await this.credit(userId, -price, 'buy_frame', `${frameId}:${Date.now()}`);
    const updatedOwned = [...new Set([...owned, frameId])];
    this.profiles.set(userId, {
      ...current,
      equippedFrame: frameId,
      ownedFrames: updatedOwned,
    });
    return { ok: true, balance: newBalance, equippedFrame: frameId, ownedFrames: updatedOwned };
  }

  async equipAvatarFrame(userId: string, frameId: string): Promise<{ ok: boolean; equippedFrame: string }> {
    const current = this.profiles.get(userId) ?? { bio: '', avatar: null };
    const owned = current.ownedFrames ?? ['frame_default'];
    if (frameId !== 'frame_default' && !owned.includes(frameId)) {
      throw new Error('未拥有该头像框，请先使用筹码购买');
    }
    this.profiles.set(userId, { ...current, equippedFrame: frameId });
    return { ok: true, equippedFrame: frameId };
  }

  async getWorshipRemainingToday(worshiperId: string, dayKey: string): Promise<number> {
    const used = this.worshipRecords.filter(
      (r) => r.worshiperId === worshiperId && r.dayKey === dayKey,
    ).length;
    return Math.max(0, 10 - used);
  }

  async worshipUser(
    worshiperId: string,
    targetUserId: string,
    dayKey: string,
  ): Promise<{ ok: boolean; remainingToday: number; newWorshipCount: number; reward: number; message?: string }> {
    if (worshiperId === targetUserId) {
      throw new Error('不能膜拜自己哦');
    }
    const remaining = await this.getWorshipRemainingToday(worshiperId, dayKey);
    if (remaining <= 0) {
      throw new Error('今日膜拜次数已达上限（10/10 次），明天再来吧');
    }
    this.worshipRecords.push({ worshiperId, targetUserId, dayKey });
    const targetProfile = this.profiles.get(targetUserId) ?? { bio: '', avatar: null };
    const newCount = (targetProfile.worshipCount ?? 0) + 1;
    this.profiles.set(targetUserId, { ...targetProfile, worshipCount: newCount });

    const rewardCoins = 188;
    await this.credit(worshiperId, rewardCoins, 'worship_reward', `${dayKey}:${worshiperId}:${Date.now()}`);
    return {
      ok: true,
      remainingToday: remaining - 1,
      newWorshipCount: newCount,
      reward: rewardCoins,
      message: `膜拜成功！获得赞誉回馈 +${rewardCoins} 筹码！`,
    };
  }

  async customizeDealer(
    userId: string,
    skin: string,
    voice: string,
  ): Promise<{ ok: boolean; dealerSkin: string; dealerVoice: string }> {
    const current = this.profiles.get(userId) ?? { bio: '', avatar: null };
    this.profiles.set(userId, {
      ...current,
      dealerSkin: skin,
      dealerVoice: voice,
    });
    return { ok: true, dealerSkin: skin, dealerVoice: voice };
  }

  async addDealerAffection(userId: string, amount: number): Promise<number> {
    const current = this.profiles.get(userId) ?? { bio: '', avatar: null };
    const safeAmount = Math.max(0, Math.floor(amount));
    const newAffection = (current.dealerAffection ?? 0) + safeAmount;
    this.profiles.set(userId, {
      ...current,
      dealerAffection: newAffection,
    });
    return newAffection;
  }

  async claimLevelReward(userId: string): Promise<{
    ok: boolean;
    claimedLevels: number;
    reward: number;
    balance: number;
    level: number;
    rewardedLevel: number;
  }> {
    const current = this.profiles.get(userId) ?? { bio: '', avatar: null };
    const level = current.level ?? 1;
    const rewardedLevel = current.rewardedLevel ?? 1;
    const reward = totalClaimableLevelReward(level, rewardedLevel);
    const claimedLevels = Math.max(0, level - rewardedLevel);
    if (claimedLevels <= 0 || reward <= 0) {
      throw new Error('暂无可领取的升级筹码奖励，快去对局积累流水升级吧！');
    }
    const newBalance = await this.credit(userId, reward, 'level_reward', `level:${userId}:${rewardedLevel}->${level}`);
    this.profiles.set(userId, {
      ...current,
      level,
      rewardedLevel: level,
    });
    return {
      ok: true,
      claimedLevels,
      reward,
      balance: newBalance,
      level,
      rewardedLevel: level,
    };
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
          avatar: avatarUrlFor(user.id, extra?.avatar),
          equippedFrame: extra?.equippedFrame ?? 'frame_default',
          isFriend: this.friendships.has(`${excludeUserId}|${user.id}`),
          requestPending: this.friendRequests.some(
            (r) => r.fromId === excludeUserId && r.toId === user.id && r.status === 'pending',
          ),
          banned: user.banned ?? false,
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
      fromEquippedFrame: from?.equippedFrame ?? 'frame_default',
      toId,
      toNickname: to?.nickname ?? '未知玩家',
      toAvatar: to?.avatar ?? null,
      toEquippedFrame: to?.equippedFrame ?? 'frame_default',
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

  // ---------- GM 运营管理 ----------

  async setUserStatus(userId: string, banned: boolean): Promise<boolean> {
    const user = this.users.get(userId);
    if (!user) return false;
    user.banned = banned;
    return true;
  }

  async resetUserPassword(userId: string, passwordHash: string): Promise<boolean> {
    if (!this.users.has(userId)) return false;
    this.credentials.set(userId, passwordHash);
    return true;
  }

  async listUserLedger(userId: string, limit: number): Promise<LedgerRow[]> {
    return this.ledgerHistory
      .filter((r) => r.userId === userId)
      .slice(0, Math.min(Math.max(1, limit), 500));
  }

  async getEconomyOverview(): Promise<EconomyOverview> {
    const totalUsers = this.users.size;
    let totalBalance = 0;
    for (const bal of this.balances.values()) {
      totalBalance += bal;
    }

    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    let todayBet = 0;
    let todaySettle = 0;
    let todayTip = 0;
    let todayRelief = 0;
    let todayGmGrant = 0;

    for (const item of this.ledgerHistory) {
      if (item.createdAt >= startOfDay) {
        if (item.bizType === 'game_bet') {
          todayBet += Math.abs(item.delta);
        } else if (item.bizType === 'game_settle') {
          todaySettle += item.delta;
        } else if (item.bizType === 'dealer_tip') {
          todayTip += Math.abs(item.delta);
        } else if (item.bizType === 'task' && item.bizId.startsWith('relief:')) {
          todayRelief += item.delta;
        } else if (item.bizType === 'gm_grant') {
          todayGmGrant += item.delta;
        }
      }
    }

    return {
      totalUsers,
      totalBalance,
      todayBet,
      todaySettle,
      todayTip,
      todayRelief,
      todayGmGrant,
    };
  }

  // ---------- 邮箱系统 ----------

  async sendMail(input: SendMailInput): Promise<MailRecord> {
    const id = randomUUID();
    const now = Date.now();
    const expireDays = Math.max(1, Math.min(input.expireDays ?? 30, 365));
    const expireAt = now + expireDays * 86400_000;
    const record: MailRecord = {
      id,
      targetType: input.targetType,
      targetUserId: input.targetType === 'user' ? (input.targetUserId ?? null) : null,
      sender: input.sender?.trim() || '系统管理员',
      title: input.title.trim(),
      content: input.content.trim(),
      rewardCoins: Math.max(0, Math.floor(input.rewardCoins ?? 0)),
      createdAt: now,
      expireAt,
    };
    this.mails.set(id, record);
    return record;
  }

  async listPlayerMails(userId: string): Promise<PlayerMailView[]> {
    const now = Date.now();
    const results: PlayerMailView[] = [];
    for (const mail of this.mails.values()) {
      if (mail.expireAt <= now) continue;
      if (mail.targetType === 'user' && mail.targetUserId !== userId) continue;
      const status = this.mailUserStatuses.get(`${mail.id}|${userId}`) ?? {
        isRead: false,
        isClaimed: false,
        claimedAt: null,
        deleted: false,
      };
      if (status.deleted) continue;
      results.push({
        id: mail.id,
        sender: mail.sender,
        title: mail.title,
        content: mail.content,
        rewardCoins: mail.rewardCoins,
        createdAt: mail.createdAt,
        isRead: status.isRead,
        isClaimed: status.isClaimed,
        claimedAt: status.claimedAt,
      });
    }
    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  async markMailRead(mailId: string, userId: string): Promise<boolean> {
    const mail = this.mails.get(mailId);
    if (!mail) return false;
    const key = `${mailId}|${userId}`;
    const current = this.mailUserStatuses.get(key) ?? {
      isRead: false,
      isClaimed: false,
      claimedAt: null,
      deleted: false,
    };
    this.mailUserStatuses.set(key, { ...current, isRead: true });
    return true;
  }

  async claimMailReward(mailId: string, userId: string): Promise<ClaimMailResult> {
    const mail = this.mails.get(mailId);
    const balance = await this.getBalance(userId, 'coin');
    if (!mail) return { ok: false, rewardCoins: 0, balance, reason: '邮件不存在' };
    if (mail.expireAt <= Date.now()) return { ok: false, rewardCoins: 0, balance, reason: '邮件已过期' };
    if (mail.targetType === 'user' && mail.targetUserId !== userId) {
      return { ok: false, rewardCoins: 0, balance, reason: '无权领取此邮件' };
    }
    if (mail.rewardCoins <= 0) {
      return { ok: false, rewardCoins: 0, balance, reason: '该邮件无附带筹码' };
    }
    const key = `${mailId}|${userId}`;
    const current = this.mailUserStatuses.get(key) ?? {
      isRead: false,
      isClaimed: false,
      claimedAt: null,
      deleted: false,
    };
    if (current.isClaimed) {
      return { ok: false, rewardCoins: 0, balance, reason: '附件已领取，请勿重复操作' };
    }
    this.mailUserStatuses.set(key, { ...current, isRead: true, isClaimed: true, claimedAt: Date.now() });
    const nextBalance = await this.credit(userId, mail.rewardCoins, 'mail_reward', `mail:${mailId}:${userId}`);
    return { ok: true, rewardCoins: mail.rewardCoins, balance: nextBalance };
  }

  async deletePlayerMail(mailId: string, userId: string): Promise<boolean> {
    const key = `${mailId}|${userId}`;
    const current = this.mailUserStatuses.get(key) ?? {
      isRead: false,
      isClaimed: false,
      claimedAt: null,
      deleted: false,
    };
    this.mailUserStatuses.set(key, { ...current, deleted: true });
    return true;
  }

  async listAdminMails(limit: number): Promise<MailRecord[]> {
    return [...this.mails.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, Math.min(Math.max(1, limit), 200));
  }

  async deleteAdminMail(mailId: string): Promise<boolean> {
    return this.mails.delete(mailId);
  }

  // ---------- 老虎机服务端结算与经营分析 ----------

  async playSlotsSpin(input: SlotsSpinInput): Promise<SlotsSpinOutcome> {
    const current = this.balances.get(input.userId);
    if (current === undefined || current < input.totalBet) {
      throw new InsufficientFundsError();
    }

    const now = Date.now();
    const balanceAfterBet = current - input.totalBet;
    const balanceAfter = balanceAfterBet + input.winAmount;
    const netDelta = input.winAmount - input.totalBet;
    this.balances.set(input.userId, balanceAfter);

    this.ledgerHistory.unshift({
      id: randomUUID(),
      userId: input.userId,
      currency: 'coin',
      delta: -input.totalBet,
      balanceAfter: balanceAfterBet,
      bizType: 'game_bet',
      bizId: `slots:${input.spinId}:bet`,
      createdAt: now,
    });
    this.ledgerHistory.unshift({
      id: randomUUID(),
      userId: input.userId,
      currency: 'coin',
      delta: input.winAmount,
      balanceAfter,
      bizType: 'game_settle',
      bizId: `slots:${input.spinId}:win`,
      createdAt: now,
    });
    if (this.ledgerHistory.length > 5000) this.ledgerHistory.length = 5000;

    this.slotsSpins.unshift({
      id: input.spinId,
      userId: input.userId,
      betPerLine: input.betPerLine,
      lines: input.lines,
      totalBet: input.totalBet,
      winAmount: input.winAmount,
      netDelta,
      isJackpot: input.isJackpot,
      winningLines: input.winningLines.length,
      createdAt: now,
    });
    if (this.slotsSpins.length > 20000) this.slotsSpins.length = 20000;

    this.records.unshift({
      settlementId: `slots:${input.spinId}`,
      roomId: 'slots-lobby',
      gameId: 'slots',
      round: 1,
      seed: input.spinId,
      winners: netDelta > 0 ? [input.userId] : [],
      entries: [
        {
          playerId: input.userId,
          currency: 'coin',
          delta: netDelta,
          reason: input.isJackpot ? 'slots.jackpot' : input.winAmount > 0 ? 'slots.win' : 'slots.spin',
        },
      ],
      finishedAt: now,
    });
    if (this.records.length > 1000) this.records.length = 1000;

    const dayKey = periodKeyFor('daily');
    this.bumpCell(input.userId, 'daily_play', dayKey, 1);
    this.bumpCell(input.userId, 'game_slots', dayKey, 1);
    this.bumpCell(input.userId, 'game_slots', 'all', 1);
    this.bumpCell(input.userId, 'total_play', 'all', 1);
    if (input.totalBet > 0) {
      this.bumpCell(input.userId, 'daily_turnover', dayKey, Math.floor(input.totalBet));
    }
    if (netDelta > 0) {
      this.bumpCell(input.userId, 'daily_win', dayKey, 1);
      this.bumpCell(input.userId, 'total_win', 'all', 1);
    }
    if (netDelta >= 500) {
      this.bumpCell(input.userId, 'daily_bigwin', dayKey, 1);
    }

    const stat = this.daily.get(input.userId);
    const todayStat = stat && stat.dayKey === dayKey ? stat : { dayKey, net: 0, rounds: 0 };
    todayStat.net += netDelta;
    todayStat.rounds += 1;
    this.daily.set(input.userId, todayStat);

    const curProfile = this.profiles.get(input.userId) ?? { bio: '', avatar: null };
    const nextProg = applyXpGain(curProfile.level ?? 1, curProfile.xp ?? '0', input.totalBet);
    const nextTurnover = (
      parseBigIntSafe(curProfile.totalTurnover) + BigInt(Math.floor(input.totalBet))
    ).toString();
    const rewardedLevel = curProfile.rewardedLevel ?? 1;
    this.profiles.set(input.userId, {
      ...curProfile,
      level: nextProg.level,
      xp: nextProg.xp,
      rewardedLevel,
      totalTurnover: nextTurnover,
    });

    return {
      spinId: input.spinId,
      balance: balanceAfter,
      totalBet: input.totalBet,
      winAmount: input.winAmount,
      netDelta,
      level: nextProg.level,
      xp: nextProg.xp,
      rewardedLevel,
      totalTurnover: nextTurnover,
      levelsGained: nextProg.levelsGained,
    };
  }

  async getSlotsAnalytics(limit = 50): Promise<SlotsAnalytics> {
    const safeLimit = Math.min(Math.max(1, limit), 200);
    const todayKey = beijingDayKey();

    const calcMetrics = (rows: typeof this.slotsSpins): SlotsSummaryMetrics => {
      const players = new Set<string>();
      let totalBet = 0;
      let totalPayout = 0;
      let jackpots = 0;
      let maxSingleWin = 0;
      for (const r of rows) {
        players.add(r.userId);
        totalBet += r.totalBet;
        totalPayout += r.winAmount;
        if (r.isJackpot) jackpots += 1;
        if (r.winAmount > maxSingleWin) maxSingleWin = r.winAmount;
      }
      const houseProfit = totalBet - totalPayout;
      const rtpPercent = totalBet > 0 ? Math.round((totalPayout / totalBet) * 10000) / 100 : 0;
      return {
        spins: rows.length,
        players: players.size,
        totalBet,
        totalPayout,
        houseProfit,
        rtpPercent,
        jackpots,
        maxSingleWin,
      };
    };

    const todayRows = this.slotsSpins.filter((r) => beijingDayKey(new Date(r.createdAt)) === todayKey);

    const byPlayer = new Map<string, SlotsPlayerStat>();
    for (const r of this.slotsSpins) {
      let entry = byPlayer.get(r.userId);
      if (!entry) {
        entry = {
          userId: r.userId,
          nickname: this.users.get(r.userId)?.nickname ?? '玩家',
          spins: 0,
          totalBet: 0,
          totalWin: 0,
          netProfit: 0,
          maxWin: 0,
          jackpots: 0,
        };
        byPlayer.set(r.userId, entry);
      }
      entry.spins += 1;
      entry.totalBet += r.totalBet;
      entry.totalWin += r.winAmount;
      entry.netProfit += r.netDelta;
      if (r.winAmount > entry.maxWin) entry.maxWin = r.winAmount;
      if (r.isJackpot) entry.jackpots += 1;
    }

    const topPlayers = [...byPlayer.values()]
      .sort((a, b) => b.totalBet - a.totalBet)
      .slice(0, 30);

    const recentSpins: SlotsSpinLog[] = this.slotsSpins.slice(0, safeLimit).map((r) => ({
      id: r.id,
      userId: r.userId,
      nickname: this.users.get(r.userId)?.nickname ?? '玩家',
      betPerLine: r.betPerLine,
      lines: r.lines,
      totalBet: r.totalBet,
      winAmount: r.winAmount,
      netDelta: r.netDelta,
      isJackpot: r.isJackpot,
      winningLines: r.winningLines,
      createdAt: r.createdAt,
    }));

    return {
      today: calcMetrics(todayRows),
      total: calcMetrics(this.slotsSpins),
      topPlayers,
      recentSpins,
    };
  }

  async getSetting<T>(key: string): Promise<T | null> {
    if (!this.settings.has(key)) return null;
    return this.settings.get(key) as T;
  }

  async setSetting<T>(key: string, value: T): Promise<void> {
    this.settings.set(key, value);
  }

  private bumpCell(userId: string, taskKey: string, periodKey: string, delta: number): number {
    const key = `${userId}|${taskKey}|${periodKey}`;
    const cell = this.taskCells.get(key) ?? { progress: 0, claimed: false };
    const next = { ...cell, progress: cell.progress + delta };
    this.taskCells.set(key, next);
    return next.progress;
  }
}
