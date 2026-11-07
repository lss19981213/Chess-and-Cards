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
