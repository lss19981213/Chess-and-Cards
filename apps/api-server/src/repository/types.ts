import type { Announcement, Currency, Settlement, SettlementEntry } from '@cc/protocol';

export interface UserRecord {
  id: string;
  nickname: string;
  username: string | null;
  email?: string | null;
  invitedBy?: string | null;
  createdAt: number;
  banned?: boolean;
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
  worshipCount?: number;
  equippedFrame?: string;
  avatar?: string | null;
}

export interface LevelLeaderboardRow {
  userId: string;
  nickname: string;
  level: number;
  xp: string;
  totalTurnover: string;
  balance: number;
  worshipCount: number;
  equippedFrame: string;
  avatar: string | null;
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
  email?: string | null;
  oauthProvider?: string | null;
  oauthSub?: string | null;
}

/** 玩家公开资料（好友、搜索、个人中心共用） */
export interface PlayerProfile {
  userId: string;
  nickname: string;
  username: string | null;
  bio: string;
  avatar: string | null;
  banned?: boolean;
  /** 是否已与当前登录用户互为好友 */
  isFriend?: boolean;
  /** 我是否已向对方发出待处理申请 */
  requestPending?: boolean;
  /** 佩戴的头像框 */
  equippedFrame?: string;
  /** 已解锁/拥有的头像框列表 */
  ownedFrames?: string[];
  /** 累计被膜拜次数 */
  worshipCount?: number;
  /** 荷官皮肤配置 */
  dealerSkin?: string;
  /** 荷官性格语言配置 */
  dealerVoice?: string;
  /** 荷官好感度 */
  dealerAffection?: number;
  /** 账号等级（1-100） */
  level?: number;
  /** 当前等级经验值（BigInt 字符串，防止高等级溢出） */
  xp?: string;
  /** 已领取升级奖励的最高等级 */
  rewardedLevel?: number;
  /** 累计有效流水 */
  totalTurnover?: string;
}

export interface LedgerRow {
  id: string;
  userId: string;
  currency: string;
  delta: number;
  balanceAfter: number;
  bizType: string;
  bizId: string;
  createdAt: number;
}

export interface EconomyOverview {
  totalUsers: number;
  totalBalance: number;
  todayBet: number;
  todaySettle: number;
  todayTip: number;
  todayRelief: number;
  todayGmGrant: number;
}

export interface SlotsSpinInput {
  spinId: string;
  userId: string;
  betPerLine: number;
  lines: number;
  totalBet: number;
  winAmount: number;
  winningLines: number[];
  isJackpot: boolean;
  reels: string[][];
}

export interface SlotsSpinOutcome {
  spinId: string;
  balance: number;
  totalBet: number;
  winAmount: number;
  netDelta: number;
  level: number;
  xp: string;
  rewardedLevel: number;
  totalTurnover: string;
  levelsGained: number;
}

export interface SlotsSummaryMetrics {
  spins: number;
  players: number;
  totalBet: number;
  totalPayout: number;
  houseProfit: number;
  rtpPercent: number;
  jackpots: number;
  maxSingleWin: number;
}

export interface SlotsPlayerStat {
  userId: string;
  nickname: string;
  spins: number;
  totalBet: number;
  totalWin: number;
  netProfit: number;
  maxWin: number;
  jackpots: number;
}

export interface SlotsSpinLog {
  id: string;
  userId: string;
  nickname: string;
  betPerLine: number;
  lines: number;
  totalBet: number;
  winAmount: number;
  netDelta: number;
  isJackpot: boolean;
  winningLines: number;
  createdAt: number;
}

export interface SlotsAnalytics {
  today: SlotsSummaryMetrics;
  total: SlotsSummaryMetrics;
  topPlayers: SlotsPlayerStat[];
  recentSpins: SlotsSpinLog[];
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected';

export interface FriendRequestView {
  id: string;
  fromId: string;
  fromNickname: string;
  fromAvatar: string | null;
  fromEquippedFrame?: string;
  toId: string;
  toNickname: string;
  toAvatar: string | null;
  toEquippedFrame?: string;
  message: string | null;
  status: FriendRequestStatus;
  createdAt: number;
}

export interface ProfilePatch {
  nickname?: string;
  bio?: string;
  avatar?: string | null;
  equippedFrame?: string;
  dealerSkin?: string;
  dealerVoice?: string;
  dealerAffection?: number;
}

export interface MailRecord {
  id: string;
  targetType: 'user' | 'all';
  targetUserId: string | null;
  sender: string;
  title: string;
  content: string;
  rewardCoins: number;
  createdAt: number;
  expireAt: number;
}

export interface PlayerMailView {
  id: string;
  sender: string;
  title: string;
  content: string;
  rewardCoins: number;
  createdAt: number;
  isRead: boolean;
  isClaimed: boolean;
  claimedAt: number | null;
}

export interface SendMailInput {
  targetType: 'user' | 'all';
  targetUserId?: string | null;
  sender?: string;
  title: string;
  content: string;
  rewardCoins?: number;
  expireDays?: number;
}

export interface ClaimMailResult {
  ok: boolean;
  rewardCoins: number;
  balance: number;
  reason?: string;
}

export type RegisterResult =
  | { ok: true; user: UserRecord }
  | { ok: false; reason: 'username_taken' | 'email_taken' | 'nickname_taken' };

export interface Repository {
  register(input: RegisterInput): Promise<RegisterResult>;
  findByUsername(username: string): Promise<AuthUser | null>;
  findByEmail(email: string): Promise<AuthUser | null>;
  findByOAuth(provider: string, sub: string): Promise<UserRecord | null>;
  bindOAuth(userId: string, provider: string, sub: string): Promise<void>;
  updatePassword(userId: string, passwordHash: string): Promise<boolean>;
  updateEmail(userId: string, email: string): Promise<boolean>;
  setInvitedBy(userId: string, invitedBy: string): Promise<void>;
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
  /** 等级排行榜（按等级、累计流水、经验排序） */
  levelLeaderboard(limit: number): Promise<LevelLeaderboardRow[]>;
  /** 查询某人在等级榜的名次 */
  levelLeaderboardRank(userId: string): Promise<number | null>;
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
  getAvatar(userId: string): Promise<string | null>;
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

  // ---------- GM 运营管理 ----------
  setUserStatus(userId: string, banned: boolean): Promise<boolean>;
  resetUserPassword(userId: string, passwordHash: string): Promise<boolean>;
  listUserLedger(userId: string, limit: number): Promise<LedgerRow[]>;
  getEconomyOverview(): Promise<EconomyOverview>;

  // ---------- 邮箱系统 ----------
  sendMail(input: SendMailInput): Promise<MailRecord>;
  listPlayerMails(userId: string): Promise<PlayerMailView[]>;
  markMailRead(mailId: string, userId: string): Promise<boolean>;
  claimMailReward(mailId: string, userId: string): Promise<ClaimMailResult>;
  deletePlayerMail(mailId: string, userId: string): Promise<boolean>;
  listAdminMails(limit: number): Promise<MailRecord[]>;
  deleteAdminMail(mailId: string): Promise<boolean>;

  // ---------- 头像框、膜拜与荷官个性化 ----------
  buyAvatarFrame(userId: string, frameId: string, price: number): Promise<{ ok: boolean; balance: number; equippedFrame: string; ownedFrames: string[] }>;
  equipAvatarFrame(userId: string, frameId: string): Promise<{ ok: boolean; equippedFrame: string }>;
  worshipUser(worshiperId: string, targetUserId: string, dayKey: string): Promise<{ ok: boolean; remainingToday: number; newWorshipCount: number; reward: number; message?: string }>;
  getWorshipRemainingToday(worshiperId: string, dayKey: string): Promise<number>;
  customizeDealer(userId: string, skin: string, voice: string): Promise<{ ok: boolean; dealerSkin: string; dealerVoice: string }>;
  addDealerAffection(userId: string, amount: number): Promise<number>;
  claimLevelReward(userId: string): Promise<{
    ok: boolean;
    claimedLevels: number;
    reward: number;
    balance: number;
    level: number;
    rewardedLevel: number;
  }>;

  // ---------- 老虎机服务端权威摇奖与 GM 经营分析 ----------
  playSlotsSpin(input: SlotsSpinInput): Promise<SlotsSpinOutcome>;
  getSlotsAnalytics(limit?: number): Promise<SlotsAnalytics>;

  // ---------- 全局动态运营配置（游戏分类 / 老虎机概率等） ----------
  getSetting<T>(key: string): Promise<T | null>;
  setSetting<T>(key: string, value: T): Promise<void>;
}
