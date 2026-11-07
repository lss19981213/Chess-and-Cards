import type { Currency, Settlement, SettlementEntry } from '@cc/protocol';

export interface UserRecord {
  id: string;
  nickname: string;
  createdAt: number;
}

export interface UserProfile extends UserRecord {
  balance: number;
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

export interface Repository {
  /** 按昵称查找用户，不存在则创建（游客登录） */
  loginOrCreate(nickname: string): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  getBalance(userId: string, currency: Currency): Promise<number>;
  /** 幂等记账：同一 settlementId 重复上报只生效一次 */
  applySettlement(settlement: Settlement): Promise<SettlementResult>;
  listRecords(userId: string, limit: number): Promise<GameRecordView[]>;
  close(): Promise<void>;
}
