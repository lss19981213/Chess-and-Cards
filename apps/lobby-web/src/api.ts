import type { Announcement, GameMeta } from '@cc/protocol';

export interface User {
  id: string;
  nickname: string;
  username: string | null;
  balance: number;
  email?: string | null;
  invitedBy?: string | null;
  createdAt?: number;
  avatar?: string | null;
  equippedFrame?: string;
  worshipCount?: number;
  dealerSkin?: string;
  dealerVoice?: string;
  dealerAffection?: number;
  level?: number;
  xp?: string;
  rewardedLevel?: number;
  totalTurnover?: string;
}

export interface Captcha {
  id: string;
  svg: string;
  expiresIn: number;
}

export interface TaskView {
  key: string;
  name: string;
  description: string;
  target: number;
  reward: number;
  period: 'daily' | 'once';
  group: 'daily' | 'growth';
  progress: number;
  claimed: boolean;
  claimable: boolean;
  locked: boolean;
  lockReason?: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  nickname: string;
  balance: number;
  title: string;
  reward: number;
  worshipCount?: number;
  equippedFrame?: string;
  avatar?: string | null;
}

/** 每日 0 点结算的排行榜快照 */
export interface LeaderboardRewardRow {
  userId: string;
  nickname: string;
  rank: number;
  balance: number;
  reward: number;
}

const TOKEN_KEY = 'cc.token';

/** 站点部署在子路径（/lobby/），所有接口都带此前缀 */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

/** 将后端返回的 `/api/avatar/...` 路径补全站点前缀，兼容本地 data URL 预览 */
export function resolveAvatarUrl(avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  if (avatar.startsWith('/api/')) return `${BASE_PATH}${avatar}`;
  return avatar;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  const res = await fetch(`${BASE_PATH}${path}`, { ...init, headers });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  if (!res.ok) {
    // 令牌过期或失效时立刻清掉，避免每次启动都拿废 token 请求一遍
    if (res.status === 401) setToken(null);
    throw new Error(typeof body.error === 'string' ? body.error : `请求失败 (${res.status})`);
  }
  return body as T;
}

export const api = {
  captcha: () => request<Captcha>('/api/captcha'),
  guest: () => request<{ token: string; user: User }>('/api/guest', { method: 'POST', body: '{}' }),

  login: (username: string, password: string, captchaId: string, captcha: string) =>
    request<{ token: string; user: User }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, captchaId, captcha }),
    }),

  register: (
    username: string,
    password: string,
    nickname: string,
    captchaId: string,
    captcha: string,
    inviteCode?: string,
  ) =>
    request<{ token: string; user: User }>('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, nickname, captchaId, captcha, inviteCode }),
    }),

  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }),

  updateEmail: (email: string) =>
    request<{ ok: boolean; email: string; message: string }>('/api/auth/update-email', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  sendResetCode: (account: string, captchaId: string, captcha: string) =>
    request<{ ok: boolean; message: string; devCode?: string }>('/api/auth/send-reset-code', {
      method: 'POST',
      body: JSON.stringify({ account, captchaId, captcha }),
    }),

  resetPassword: (account: string, code: string, newPassword: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ account, code, newPassword }),
    }),

  me: () => request<{ user: User }>('/api/me'),
  games: () => request<{ games: GameMeta[] }>('/api/games'),
  records: () => request<{ records: unknown[] }>('/api/records?limit=20'),

  tasks: () => request<{ balance: number; tasks: TaskView[] }>('/api/tasks'),
  tipDealer: (amount: number, giftName?: string) =>
    request<{ ok: boolean; balance: number; amount: number; giftName: string; affection: number }>('/api/tip-dealer', {
      method: 'POST',
      body: JSON.stringify({ amount, giftName }),
    }),
  claimTask: (key: string) =>
    request<{ reward: number; balance: number; tasks: TaskView[] }>('/api/tasks/claim', {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),

  announcements: () =>
    request<{ announcements: Announcement[] }>('/api/announcements'),

  adminCreateAnnouncement: (
    token: string,
    input: { title: string; content: string; kind: Announcement['kind'] },
  ) =>
    request<{ announcement: Announcement }>('/api/admin/announcements', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    }),

  adminDeleteAnnouncement: (token: string, id: string) =>
    request<{ ok: boolean }>(`/api/admin/announcements/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    }),

  rooms: (gameId: string) =>
    request<{
      rooms: Array<{
        roomId: string;
        gameId: string;
        roomName: string;
        hostId: string | null;
        hostName: string;
        players: number;
        maxPlayers: number;
        status: 'waiting' | 'playing' | 'settled';
        persistent: boolean;
        botHosted?: boolean;
        spectators?: number;
        joinable: boolean;
        recent: Array<{ round: number; text: string; tone: 'red' | 'blue' | 'green' | 'neutral' }>;
      }>;
    }>(`/api/rooms?gameId=${encodeURIComponent(gameId)}`),

  dailyWinners: (limit = 10) =>
    request<{
      dayKey: string;
      entries: Array<{ userId: string; nickname: string; net: number; rounds: number }>;
    }>(`/api/leaderboard/daily?limit=${limit}`),

  leaderboard: () =>
    request<{
      entries: LeaderboardEntry[];
      myRank: number | null;
      myUserId: string | null;
      remainingWorshipsToday: number;
    }>('/api/leaderboard'),

  worshipUser: (userId: string) =>
    request<{
      ok: boolean;
      remainingToday: number;
      newWorshipCount: number;
      reward: number;
      message?: string;
    }>(`/api/leaderboard/${encodeURIComponent(userId)}/worship`, { method: 'POST', body: '{}' }),

  avatarFramesCatalog: () =>
    request<{
      frames: import('@cc/protocol').AvatarFrameMeta[];
      equippedFrame: string;
      ownedFrames: string[];
      worshipCount: number;
    }>('/api/avatar-frames/catalog'),

  buyAvatarFrame: (frameId: string) =>
    request<{
      ok: boolean;
      balance: number;
      equippedFrame: string;
      ownedFrames: string[];
    }>('/api/avatar-frames/buy', {
      method: 'POST',
      body: JSON.stringify({ frameId }),
    }),

  equipAvatarFrame: (frameId: string) =>
    request<{ ok: boolean; equippedFrame: string }>('/api/avatar-frames/equip', {
      method: 'POST',
      body: JSON.stringify({ frameId }),
    }),

  customizeDealer: (skin: string, voice: string) =>
    request<{ ok: boolean; dealerSkin: string; dealerVoice: string }>('/api/dealer/customize', {
      method: 'POST',
      body: JSON.stringify({ skin, voice }),
    }),

  claimLevelReward: () =>
    request<{
      ok: boolean;
      claimedLevels: number;
      reward: number;
      balance: number;
      level: number;
      rewardedLevel: number;
    }>('/api/level/claim', { method: 'POST', body: '{}' }),

  leaderboardRewards: () =>
    request<{ dayKey: string; entries: LeaderboardRewardRow[] }>('/api/leaderboard/rewards'),

  // ---------- 个人资料与好友 ----------
  profile: () =>
    request<{
      profile: PlayerProfile;
      balance: number;
      friendsCount: number;
      rank: number | null;
      achievements: number;
    }>('/api/profile'),

  updateProfile: (patch: { nickname?: string; bio?: string; avatar?: string | null }) =>
    request<{ profile: PlayerProfile }>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  searchUsers: (keyword: string) =>
    request<{ users: PlayerProfile[] }>(`/api/users/search?q=${encodeURIComponent(keyword)}`),

  friends: () =>
    request<{
      friends: PlayerProfile[];
      incoming: FriendRequestView[];
      outgoing: FriendRequestView[];
    }>('/api/friends'),

  requestFriend: (userId: string, message?: string) =>
    request<{ ok: boolean; request: FriendRequestView }>('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify({ userId, message }),
    }),

  acceptFriend: (requestId: string) =>
    request<{ ok: boolean; friends: PlayerProfile[] }>('/api/friends/accept', {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }),

  rejectFriend: (requestId: string) =>
    request<{ ok: boolean }>('/api/friends/reject', {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }),

  removeFriend: (userId: string) =>
    request<{ ok: boolean }>(`/api/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' }),

  // ---------- 房间邀请 ----------
  inviteToRoom: (input: { roomId: string; gameId: string; roomName?: string; friendIds: string[] }) =>
    request<{ ok: boolean; sent: number }>('/api/rooms/invite', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  roomInvites: () => request<{ invites: RoomInviteView[] }>('/api/rooms/invites'),

  dismissInvite: (id: string) =>
    request<{ ok: boolean }>(`/api/rooms/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ---------- 邮箱系统 ----------
  listMails: () => request<{ mails: PlayerMailView[]; unreadCount: number }>('/api/mail'),
  readMail: (id: string) => request<{ ok: boolean }>(`/api/mail/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  claimMail: (id: string) =>
    request<{ ok: boolean; rewardCoins: number; balance: number }>(`/api/mail/${encodeURIComponent(id)}/claim`, {
      method: 'POST',
    }),
  deleteMail: (id: string) =>
    request<{ ok: boolean }>(`/api/mail/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

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

export interface RoomInviteView {
  id: string;
  fromId: string;
  fromNickname: string;
  fromAvatar: string | null;
  toId: string;
  roomId: string;
  gameId: string;
  roomName: string;
  createdAt: number;
}

export interface PlayerProfile {
  userId: string;
  nickname: string;
  username: string | null;
  bio: string;
  avatar: string | null;
  isFriend?: boolean;
  requestPending?: boolean;
  equippedFrame?: string;
  ownedFrames?: string[];
  worshipCount?: number;
  dealerSkin?: string;
  dealerVoice?: string;
  dealerAffection?: number;
  level?: number;
  xp?: string;
  rewardedLevel?: number;
  totalTurnover?: string;
}

export interface FriendRequestView {
  id: string;
  fromId: string;
  fromNickname: string;
  fromAvatar: string | null;
  toId: string;
  toNickname: string;
  toAvatar: string | null;
  message: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
}
