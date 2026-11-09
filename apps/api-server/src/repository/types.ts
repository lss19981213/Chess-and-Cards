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

/** 每日排行榜结算快照的一行 */
export interface LeaderboardSnapshotRow {
  userId: string;
  nickname: string;
  rank: number;
  balance: number;
  reward: number;
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

/** 玩家公开资料（好友、搜索、个人中心共用） */
export interface PlayerProfile {
  userId: string;
  nickname: string;
  username: string | null;
  bio: string;
  avatar: string | null;
  /** 是否已与当前登录用户互为好友 */
  isFriend?: boolean;
  /** 我是否已向对方发出待处理申请 */
  requestPending?: boolean;
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected';

export interface FriendRequestView {
  id: string;
  fromId: string;
  fromNickname: string;
  fromAvatar: string | null;
  toId: string;
  toNickname: string;
  toAvatar: string | null;
  message: string | null;
  status: FriendRequestStatus;
  createdAt: number;
}

export interface ProfilePatch {
  nickname?: string;
  bio?: string;
  avatar?: string | null;
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
  /** 查询某人在总榜的名次，不在榜返回 null */
  leaderboardRank(userId: string): Promise<number | null>;
  /** 每日 0 点结算：按当前余额取前 N 名发奖并留档，返回发放的筹码总额 */
  settleDailyLeaderboard(dayKey: string): Promise<number>;
  /** 读取某期排行榜结算快照 */
  listDailySnapshot(dayKey: string): Promise<LeaderboardSnapshotRow[]>;
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

  // ---------- 个人资料 ----------
  getProfile(userId: string): Promise<PlayerProfile | null>;
  updateProfile(userId: string, patch: ProfilePatch): Promise<PlayerProfile>;
  /** 按昵称或账号搜索玩家，keyword 为空时返回最近注册的玩家 */
  searchUsers(keyword: string, excludeUserId: string, limit: number): Promise<PlayerProfile[]>;

  // ---------- 好友 ----------
  listFriends(userId: string): Promise<PlayerProfile[]>;
  /** 建立一条待处理申请；已是好友或已有待处理申请时抛错 */
  createFriendRequest(fromId: string, toId: string, message: string | null): Promise<FriendRequestView>;
  listFriendRequests(userId: string): Promise<{ incoming: FriendRequestView[]; outgoing: FriendRequestView[] }>;
  /** 接受申请：写入双向好友关系。返回 false 表示申请不存在或不属于该用户 */
  acceptFriendRequest(requestId: string, userId: string): Promise<boolean>;
  rejectFriendRequest(requestId: string, userId: string): Promise<boolean>;
  removeFriend(userId: string, friendId: string): Promise<boolean>;
  areFriends(userId: string, friendId: string): Promise<boolean>;
}
