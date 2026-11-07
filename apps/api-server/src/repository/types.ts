import type { Announcement, Currency, Settlement, SettlementEntry } from '@cc/protocol';

export interface UserRecord {
  id: string;
  nickname: string;
  username: string | null;
  createdAt: number;
}

export interface UserProfile extends UserRecord {
  balance: number;
}

export interface AuthUser extends UserRecord {
  passwordHash: string;
}

export interface GameRecordView {
  settlementId: string;
  roomId: string;
  gameId: string;
  round: number;
  seed: string;
  winners: string[];
  entries: SettlementEntry[];
  finishedAt: number;
}

export type SettlementResult = 'applied' | 'duplicate';

/** 下注即时扣款 / 撤注退款 */
export interface BetAdjustment {
  userId: string;
  amount: number;
  action: 'debit' | 'refund';
  /** 幂等凭证，格式 `${roomId}:${round}:${userId}:${seq}` */
  bizId: string;
}

export class InsufficientFundsError extends Error {
  constructor() {
    super('筹码不足，无法下注');
    this.name = 'InsufficientFundsError';
  }
}

export interface TaskProgressRow {
  taskKey: string;
  periodKey: string;
  progress: number;
  claimed: boolean;
}

export interface LeaderboardRow {
  userId: string;
  nickname: string;
  balance: number;
}

export interface DailyWinnerRow {
  userId: string;
  nickname: string;
  /** 今日净收益 */
  net: number;
  /** 今日结算局数 */
  rounds: number;
}

export interface RegisterInput {
  username: string;
  passwordHash: string;
  nickname: string;
}

export type RegisterResult = { ok: true; user: UserRecord } | { ok: false; reason: 'username_taken' };

export interface Repository {
  register(input: RegisterInput): Promise<RegisterResult>;
  findByUsername(username: string): Promise<AuthUser | null>;
  getUser(id: string): Promise<UserRecord | null>;
  getBalance(userId: string, currency: Currency): Promise<number>;
  /** 幂等记账：同一 settlementId 重复上报只生效一次 */
  applySettlement(settlement: Settlement): Promise<SettlementResult>;
  /** 原子扣款/退款，返回操作后的余额；余额不足抛 InsufficientFundsError */
  adjustBet(input: BetAdjustment): Promise<number>;
  /**
   * 释放未结算的已扣本金。房间销毁或房间服务重启后，那些局永远不会再有结算，
   * 需要把冻结的筹码退回，避免玩家凭空损失。roomId 为空则全量清理。
   */
  releaseOrphanBets(roomId?: string): Promise<number>;
  listRecords(userId: string, limit: number): Promise<GameRecordView[]>;
  /** 幂等加币（任务奖励等），返回入账后余额 */
  credit(userId: string, amount: number, bizType: string, bizId: string): Promise<number>;
  getTaskRows(userId: string, periodKeys: string[]): Promise<TaskProgressRow[]>;
  /** 累加任务进度，返回累加后的进度 */
  bumpTask(userId: string, taskKey: string, periodKey: string, delta: number): Promise<number>;
  /** 标记已领取，返回 false 表示此前已领取过 */
  claimTask(userId: string, taskKey: string, periodKey: string): Promise<boolean>;
  leaderboard(limit: number): Promise<LeaderboardRow[]>;
  /** 今日净收益榜（按结算流水聚合） */
  dailyWinners(limit: number): Promise<DailyWinnerRow[]>;
  listAnnouncements(limit: number): Promise<Announcement[]>;
  createAnnouncement(input: {
    title: string;
    content: string;
    kind: Announcement['kind'];
  }): Promise<Announcement>;
  deleteAnnouncement(id: string): Promise<boolean>;
  close(): Promise<void>;
}
