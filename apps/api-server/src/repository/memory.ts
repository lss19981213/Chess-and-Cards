import { randomUUID } from 'node:crypto';
import type { Currency, Settlement } from '@cc/protocol';
import type {
  GameRecordView,
  Repository,
  SettlementResult,
  UserRecord,
} from './types';

/** 内存仓储：零依赖跑通全流程，用于本地开发与技术验证。 */
export class MemoryRepository implements Repository {
  private readonly users = new Map<string, UserRecord>();
  private readonly nicknameIndex = new Map<string, string>();
  private readonly balances = new Map<string, number>();
  private readonly appliedKeys = new Set<string>();
  private readonly records: GameRecordView[] = [];
  private readonly initialCoins: number;

  constructor(initialCoins: number) {
    this.initialCoins = initialCoins;
  }

  async loginOrCreate(nickname: string): Promise<UserRecord> {
    const existingId = this.nicknameIndex.get(nickname);
    if (existingId) {
      const user = this.users.get(existingId);
      if (user) return user;
    }
    const user: UserRecord = { id: randomUUID(), nickname, createdAt: Date.now() };
    this.users.set(user.id, user);
    this.nicknameIndex.set(nickname, user.id);
    this.balances.set(user.id, this.initialCoins);
    return user;
  }

  async getUser(id: string): Promise<UserRecord | null> {
    return this.users.get(id) ?? null;
  }

  async getBalance(userId: string, _currency: Currency): Promise<number> {
    return this.balances.get(userId) ?? 0;
  }

  async applySettlement(settlement: Settlement): Promise<SettlementResult> {
    const keys = settlement.entries.map((e) => `${settlement.settlementId}:${e.playerId}`);
    if (keys.some((key) => this.appliedKeys.has(key))) return 'duplicate';

    for (const entry of settlement.entries) {
      const current = this.balances.get(entry.playerId);
      if (current === undefined) continue;
      this.balances.set(entry.playerId, current + entry.delta);
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

  async close(): Promise<void> {
    /* nothing to release */
  }
}
