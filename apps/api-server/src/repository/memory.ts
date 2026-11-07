import { randomUUID } from 'node:crypto';
import type { Announcement, Currency, Settlement } from '@cc/protocol';
import { periodKeyFor } from '../tasks';
import { InsufficientFundsError } from './types';
import type {
  BetAdjustment,
  AuthUser,
  DailyWinnerRow,
  GameRecordView,
  LeaderboardRow,
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
  private readonly daily = new Map<string, { net: number; rounds: number }>();
  private readonly announcements: Announcement[] = [];
  private readonly initialCoins: number;

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

  async adjustBet(input: BetAdjustment): Promise<number> {
    const bizType = input.action === 'debit' ? 'game_bet' : 'game_bet_refund';
    const ledgerKey = `${bizType}:${input.bizId}:${input.userId}`;
    const current = this.balances.get(input.userId) ?? 0;
    if (this.betLedger.has(ledgerKey)) return current;

    let amount = input.amount;
    if (input.action === 'refund') {
      const original = this.betLedger.get(`game_bet:${input.bizId}:${input.userId}`);
      if (original === undefined) throw new Error('原下注凭证不存在');
      amount = -original;
    }
    const delta = input.action === 'debit' ? -amount : amount;
    if (current + delta < 0) throw new InsufficientFundsError();
    const next = current + delta;
    this.balances.set(input.userId, next);
    this.betLedger.set(ledgerKey, delta);
    const parts = input.bizId.split(':');
    const stakeKey = `${parts.slice(0, 2).join(':')}:${input.userId}`;
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
      const staked = this.staked.get(`${settlement.settlementId}:${entry.playerId}`) ?? 0;
      this.balances.set(entry.playerId, Math.max(0, current + entry.delta - staked));
      this.bumpCell(entry.playerId, 'daily_play', dayKey, 1);
      if (entry.delta > 0) this.bumpCell(entry.playerId, 'daily_win', dayKey, 1);

      const stat = this.daily.get(entry.playerId) ?? { net: 0, rounds: 0 };
      stat.net += entry.delta;
      stat.rounds += 1;
      this.daily.set(entry.playerId, stat);
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
    this.appliedKeys.add(key);
    const next = Math.max(0, current + amount);
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

  async dailyWinners(limit: number): Promise<DailyWinnerRow[]> {
    return [...this.daily.entries()]
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

  private bumpCell(userId: string, taskKey: string, periodKey: string, delta: number): number {
    const key = `${userId}|${taskKey}|${periodKey}`;
    const cell = this.taskCells.get(key) ?? { progress: 0, claimed: false };
    const next = { ...cell, progress: cell.progress + delta };
    this.taskCells.set(key, next);
    return next.progress;
  }
}
