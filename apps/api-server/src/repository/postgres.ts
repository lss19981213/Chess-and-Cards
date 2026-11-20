import pg from 'pg';
import type { Announcement, Currency, Settlement, StockOrder, StockTradeResult } from '@cc/protocol';
import { SCHEMA_SQL } from '../schema';
import type {
  AuthUser,
  BetAdjustment,
  DailyWinnerRow,
  EconomyOverview,
  FriendRequestView,
  GameRecordView,
  LeaderboardRow,
  LeaderboardSnapshotRow,
  LedgerRow,
  LevelLeaderboardRow,
  PlayerProfile,
  ProfilePatch,
  RegisterInput,
  RegisterResult,
  Repository,
  SettlementResult,
  SlotsAnalytics,
  SlotsSpinInput,
  SlotsSpinOutcome,
  StockHoldingRow,
  AdminStockOverviewData,
  TaskProgressRow,
  UserRecord,
} from './types';
import { buyStock, getAdminStockOverview, getStockHoldings, listStockOrders, sellStock } from './pg/stocks';
import { getSlotsAnalytics, playSlotsSpin } from './pg/slots';
import { getSetting, setSetting } from './pg/settings';
import {
  adjustBet,
  applySettlement,
  listGameRecords,
  releaseOrphanBets,
} from './pg/settlement';
import {
  bindUserOAuth,
  creditWallet,
  findUserByEmail,
  findUserByOAuth,
  findUserByUsername,
  getUserById,
  getWalletBalance,
  registerUser,
  setUserInvitedBy,
  updateUserEmail,
  updateUserPassword,
} from './pg/wallet';
import {
  bumpTask,
  claimTask,
  getDailyWinners,
  getLeaderboard,
  getLeaderboardRank,
  getLevelLeaderboard,
  getLevelLeaderboardRank,
  getTaskRows,
  listDailySnapshot,
  settleDailyLeaderboard,
} from './pg/tasks-leaderboard';
import {
  acceptFriendRequest,
  areFriends,
  createAnnouncement,
  createFriendRequest,
  deleteAnnouncement,
  getAvatar,
  getProfile,
  listAnnouncements,
  listFriendRequests,
  listFriends,
  rejectFriendRequest,
  removeFriend,
  searchUsers,
  updateProfile,
  buyAvatarFrame,
  equipAvatarFrame,
  worshipUser,
  getWorshipRemainingToday,
  customizeDealer,
  addDealerAffection,
  claimLevelReward,
} from './pg/social';
import {
  getEconomyOverview,
  listUserLedger,
  resetUserPassword,
  setUserStatus,
} from './pg/admin';
import {
  claimMailReward,
  deleteAdminMail,
  deletePlayerMail,
  listAdminMails,
  listPlayerMails,
  markMailRead,
  sendMail,
} from './pg/mail';
import {
  addTicketReply,
  createTicket,
  deleteTicket,
  getTicketDetail,
  listAdminTickets,
  listPlayerTickets,
  markTicketReadByPlayer,
  updateTicketStatus,
} from './pg/tickets';
import type {
  AddTicketReplyInput,
  AdminTicketFilter,
  ClaimMailResult,
  CreateTicketInput,
  FeedbackTicket,
  FeedbackTicketReply,
  MailRecord,
  PlayerMailView,
  SendMailInput,
  TicketStats,
  TicketStatus,
} from './types';

const { Pool } = pg;

/** PostgreSQL 仓储：钱包与账本强事务，生产环境使用。按域拆分子模块于 ./pg/。 */
export class PostgresRepository implements Repository {
  private readonly pool: pg.Pool;
  private readonly initialCoins: number;

  constructor(databaseUrl: string, initialCoins: number) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
    this.initialCoins = initialCoins;
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  releaseOrphanBets(roomId?: string): Promise<number> {
    return releaseOrphanBets(this.pool, roomId);
  }

  register(input: RegisterInput): Promise<RegisterResult> {
    return registerUser(this.pool, this.initialCoins, input);
  }

  findByUsername(username: string): Promise<AuthUser | null> {
    return findUserByUsername(this.pool, username);
  }

  findByEmail(email: string): Promise<AuthUser | null> {
    return findUserByEmail(this.pool, email);
  }

  findByOAuth(provider: string, sub: string): Promise<UserRecord | null> {
    return findUserByOAuth(this.pool, provider, sub);
  }

  bindOAuth(userId: string, provider: string, sub: string): Promise<void> {
    return bindUserOAuth(this.pool, userId, provider, sub);
  }

  updatePassword(userId: string, passwordHash: string): Promise<boolean> {
    return updateUserPassword(this.pool, userId, passwordHash);
  }

  updateEmail(userId: string, email: string): Promise<boolean> {
    return updateUserEmail(this.pool, userId, email);
  }

  setInvitedBy(userId: string, invitedBy: string): Promise<void> {
    return setUserInvitedBy(this.pool, userId, invitedBy);
  }

  getUser(id: string): Promise<UserRecord | null> {
    return getUserById(this.pool, id);
  }

  getBalance(userId: string, currency: Currency): Promise<number> {
    return getWalletBalance(this.pool, userId, currency);
  }

  adjustBet(input: BetAdjustment): Promise<number> {
    return adjustBet(this.pool, input);
  }

  applySettlement(settlement: Settlement): Promise<SettlementResult> {
    return applySettlement(this.pool, settlement);
  }

  listRecords(userId: string, limit: number): Promise<GameRecordView[]> {
    return listGameRecords(this.pool, userId, limit);
  }

  credit(userId: string, amount: number, bizType: string, bizId: string): Promise<number> {
    return creditWallet(this.pool, userId, amount, bizType, bizId);
  }

  getTaskRows(userId: string, periodKeys: string[]): Promise<TaskProgressRow[]> {
    return getTaskRows(this.pool, userId, periodKeys);
  }

  bumpTask(userId: string, taskKey: string, periodKey: string, delta: number): Promise<number> {
    return bumpTask(this.pool, userId, taskKey, periodKey, delta);
  }

  claimTask(userId: string, taskKey: string, periodKey: string): Promise<boolean> {
    return claimTask(this.pool, userId, taskKey, periodKey);
  }

  leaderboard(limit: number): Promise<LeaderboardRow[]> {
    return getLeaderboard(this.pool, limit);
  }

  leaderboardRank(userId: string): Promise<number | null> {
    return getLeaderboardRank(this.pool, userId);
  }

  levelLeaderboard(limit: number): Promise<LevelLeaderboardRow[]> {
    return getLevelLeaderboard(this.pool, limit);
  }

  levelLeaderboardRank(userId: string): Promise<number | null> {
    return getLevelLeaderboardRank(this.pool, userId);
  }

  settleDailyLeaderboard(dayKey: string): Promise<number> {
    return settleDailyLeaderboard(this.pool, dayKey);
  }

  listDailySnapshot(dayKey: string): Promise<LeaderboardSnapshotRow[]> {
    return listDailySnapshot(this.pool, dayKey);
  }

  dailyWinners(limit: number): Promise<DailyWinnerRow[]> {
    return getDailyWinners(this.pool, limit);
  }

  listAnnouncements(limit: number): Promise<Announcement[]> {
    return listAnnouncements(this.pool, limit);
  }

  createAnnouncement(input: {
    title: string;
    content: string;
    kind: Announcement['kind'];
  }): Promise<Announcement> {
    return createAnnouncement(this.pool, input);
  }

  deleteAnnouncement(id: string): Promise<boolean> {
    return deleteAnnouncement(this.pool, id);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  getAvatar(userId: string): Promise<string | null> {
    return getAvatar(this.pool, userId);
  }

  getProfile(userId: string): Promise<PlayerProfile | null> {
    return getProfile(this.pool, userId);
  }

  updateProfile(userId: string, patch: ProfilePatch): Promise<PlayerProfile> {
    return updateProfile(this.pool, userId, patch);
  }

  searchUsers(keyword: string, excludeUserId: string, limit: number): Promise<PlayerProfile[]> {
    return searchUsers(this.pool, keyword, excludeUserId, limit);
  }

  listFriends(userId: string): Promise<PlayerProfile[]> {
    return listFriends(this.pool, userId);
  }

  createFriendRequest(
    fromId: string,
    toId: string,
    message: string | null,
  ): Promise<FriendRequestView> {
    return createFriendRequest(this.pool, fromId, toId, message);
  }

  listFriendRequests(userId: string): Promise<{
    incoming: FriendRequestView[];
    outgoing: FriendRequestView[];
  }> {
    return listFriendRequests(this.pool, userId);
  }

  acceptFriendRequest(requestId: string, userId: string): Promise<boolean> {
    return acceptFriendRequest(this.pool, requestId, userId);
  }

  rejectFriendRequest(requestId: string, userId: string): Promise<boolean> {
    return rejectFriendRequest(this.pool, requestId, userId);
  }

  removeFriend(userId: string, friendId: string): Promise<boolean> {
    return removeFriend(this.pool, userId, friendId);
  }

  areFriends(userId: string, friendId: string): Promise<boolean> {
    return areFriends(this.pool, userId, friendId);
  }

  setUserStatus(userId: string, banned: boolean): Promise<boolean> {
    return setUserStatus(this.pool, userId, banned);
  }

  resetUserPassword(userId: string, passwordHash: string): Promise<boolean> {
    return resetUserPassword(this.pool, userId, passwordHash);
  }

  listUserLedger(userId: string, limit: number): Promise<LedgerRow[]> {
    return listUserLedger(this.pool, userId, limit);
  }

  getEconomyOverview(): Promise<EconomyOverview> {
    return getEconomyOverview(this.pool);
  }

  // ---------- 邮箱系统 ----------
  sendMail(input: SendMailInput): Promise<MailRecord> {
    return sendMail(this.pool, input);
  }

  listPlayerMails(userId: string): Promise<PlayerMailView[]> {
    return listPlayerMails(this.pool, userId);
  }

  markMailRead(mailId: string, userId: string): Promise<boolean> {
    return markMailRead(this.pool, mailId, userId);
  }

  claimMailReward(mailId: string, userId: string): Promise<ClaimMailResult> {
    return claimMailReward(this.pool, mailId, userId);
  }

  deletePlayerMail(mailId: string, userId: string): Promise<boolean> {
    return deletePlayerMail(this.pool, mailId, userId);
  }

  listAdminMails(limit: number): Promise<MailRecord[]> {
    return listAdminMails(this.pool, limit);
  }

  deleteAdminMail(mailId: string): Promise<boolean> {
    return deleteAdminMail(this.pool, mailId);
  }

  buyAvatarFrame(userId: string, frameId: string, price: number) {
    return buyAvatarFrame(this.pool, userId, frameId, price);
  }

  equipAvatarFrame(userId: string, frameId: string) {
    return equipAvatarFrame(this.pool, userId, frameId);
  }

  worshipUser(worshiperId: string, targetUserId: string, dayKey: string) {
    return worshipUser(this.pool, worshiperId, targetUserId, dayKey);
  }

  getWorshipRemainingToday(worshiperId: string, dayKey: string) {
    return getWorshipRemainingToday(this.pool, worshiperId, dayKey);
  }

  customizeDealer(userId: string, skin: string, voice: string) {
    return customizeDealer(this.pool, userId, skin, voice);
  }

  addDealerAffection(userId: string, amount: number) {
    return addDealerAffection(this.pool, userId, amount);
  }

  claimLevelReward(userId: string) {
    return claimLevelReward(this.pool, userId);
  }

  playSlotsSpin(input: SlotsSpinInput): Promise<SlotsSpinOutcome> {
    return playSlotsSpin(this.pool, input);
  }

  getSlotsAnalytics(limit?: number): Promise<SlotsAnalytics> {
    return getSlotsAnalytics(this.pool, limit);
  }

  getSetting<T>(key: string): Promise<T | null> {
    return getSetting<T>(this.pool, key);
  }

  setSetting<T>(key: string, value: T): Promise<void> {
    return setSetting<T>(this.pool, key, value);
  }

  createTicket(input: CreateTicketInput): Promise<FeedbackTicket> {
    return createTicket(this.pool, input);
  }

  listPlayerTickets(userId: string, limit?: number): Promise<FeedbackTicket[]> {
    return listPlayerTickets(this.pool, userId, limit);
  }

  getTicketDetail(ticketId: string): Promise<FeedbackTicket | null> {
    return getTicketDetail(this.pool, ticketId);
  }

  markTicketReadByPlayer(ticketId: string, userId: string): Promise<void> {
    return markTicketReadByPlayer(this.pool, ticketId, userId);
  }

  addTicketReply(input: AddTicketReplyInput): Promise<FeedbackTicketReply> {
    return addTicketReply(this.pool, input);
  }

  updateTicketStatus(
    ticketId: string,
    status: TicketStatus,
    adminNote?: string,
  ): Promise<FeedbackTicket | null> {
    return updateTicketStatus(this.pool, ticketId, status, adminNote);
  }

  listAdminTickets(filter?: AdminTicketFilter): Promise<{ tickets: FeedbackTicket[]; stats: TicketStats }> {
    return listAdminTickets(this.pool, filter);
  }

  deleteTicket(ticketId: string): Promise<boolean> {
    return deleteTicket(this.pool, ticketId);
  }

  // ---------- 改命股市 ----------
  getStockHoldings(userId: string): Promise<StockHoldingRow[]> {
    return getStockHoldings(this.pool, userId);
  }

  buyStock(userId: string, symbol: string, shares: number, currentPrice: number): Promise<StockTradeResult> {
    return buyStock(this.pool, userId, symbol, shares, currentPrice);
  }

  sellStock(userId: string, symbol: string, shares: number, currentPrice: number): Promise<StockTradeResult> {
    return sellStock(this.pool, userId, symbol, shares, currentPrice);
  }

  listStockOrders(userId: string, limit?: number): Promise<StockOrder[]> {
    return listStockOrders(this.pool, userId, limit);
  }

  getAdminStockOverview(): Promise<AdminStockOverviewData> {
    return getAdminStockOverview(this.pool);
  }
}
