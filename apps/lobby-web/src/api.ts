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
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
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
    request<{ announcement: Announcement }>(`/api/admin/announcements?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  adminDeleteAnnouncement: (token: string, id: string) =>
    request<{ ok: boolean }>(
      `/api/admin/announcements/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`,
      { method: 'DELETE' },
    ),

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

  assistantChat: (message: string, history: Array<{ role: string; content: string }>) =>
    request<{ reply: string; granted: number; balance: number; fallback?: boolean }>('/api/assistant/chat', {
      method: 'POST',
      body: JSON.stringify({ message, history }),
    }),

  leaderboard: () =>
    request<{ entries: LeaderboardEntry[]; myRank: number | null; myUserId: string | null }>(
      '/api/leaderboard',
    ),

  leaderboardRewards: () =>
    request<{ dayKey: string; entries: LeaderboardRewardRow[] }>('/api/leaderboard/rewards'),
};
