import { randomUUID } from 'node:crypto';
import type { Currency, Settlement } from '@cc/protocol';
import { periodKeyFor } from '../tasks';
import type {
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
  private readonly records: GameRecordView[] = [];
  private readonly taskCells = new Map<string, TaskCell>();
  private readonly daily = new Map<string, { net: number; rounds: number }>();
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

  async applySettlement(settlement: Settlement): Promise<SettlementResult> {
    const keys = settlement.entries.map((e) => `game_settle:${settlement.settlementId}:${e.playerId}`);
    if (keys.some((key) => this.appliedKeys.has(key))) return 'duplicate';

    const dayKey = periodKeyFor('daily');
    for (const entry of settlement.entries) {
      const current = this.balances.get(entry.playerId);
      if (current === undefined) continue;
      this.balances.set(entry.playerId, current + entry.delta);
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
    const next = current + amount;
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
