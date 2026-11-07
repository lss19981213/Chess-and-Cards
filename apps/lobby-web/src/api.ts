import type { GameMeta } from '@cc/protocol';

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
  claimTask: (key: string) =>
    request<{ reward: number; balance: number; tasks: TaskView[] }>('/api/tasks/claim', {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),

  leaderboard: (limit = 50) =>
    request<{ entries: LeaderboardEntry[]; myRank: number | null; myUserId: string | null }>(
      `/api/leaderboard?limit=${limit}`,
    ),
};
