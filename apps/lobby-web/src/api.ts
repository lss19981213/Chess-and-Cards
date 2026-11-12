import type { Announcement, GameMeta } from '@cc/protocol';

export interface User {
  id: string;
  nickname: string;
  username: string | null;
  balance: number;
  createdAt?: number;
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
  ) =>
    request<{ token: string; user: User }>('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, nickname, captchaId, captcha }),
    }),

  me: () => request<{ user: User }>('/api/me'),
  games: () => request<{ games: GameMeta[] }>('/api/games'),
  records: () => request<{ records: unknown[] }>('/api/records?limit=20'),

  tasks: () => request<{ balance: number; tasks: TaskView[] }>('/api/tasks'),
  tipDealer: (amount: number, giftName?: string) =>
    request<{ ok: boolean; balance: number; amount: number; giftName: string }>('/api/tip-dealer', {
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
    request<{ entries: LeaderboardEntry[]; myRank: number | null; myUserId: string | null }>(
      '/api/leaderboard',
    ),

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
};

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
