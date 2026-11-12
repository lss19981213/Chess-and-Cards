import pg from 'pg';
import type { Announcement, Currency, Settlement } from '@cc/protocol';
import { SCHEMA_SQL } from '../schema';
import type {
  AuthUser,
  BetAdjustment,
  DailyWinnerRow,
  FriendRequestView,
  GameRecordView,
  LeaderboardRow,
  LeaderboardSnapshotRow,
  PlayerProfile,
  ProfilePatch,
  RegisterInput,
  RegisterResult,
  Repository,
  SettlementResult,
  TaskProgressRow,
  UserRecord,
} from './types';
import {
  adjustBet,
  applySettlement,
  listGameRecords,
  releaseOrphanBets,
} from './pg/settlement';
import {
  creditWallet,
  findUserByUsername,
  getUserById,
  getWalletBalance,
  registerUser,
} from './pg/wallet';
import {
  bumpTask,
  claimTask,
  getDailyWinners,
  getLeaderboard,
  getLeaderboardRank,
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
} from './pg/social';

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
}
