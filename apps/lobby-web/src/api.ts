import type { GameMeta } from '@cc/protocol';

export interface User {
  id: string;
  nickname: string;
  balance: number;
}

const TOKEN_KEY = 'cc.token';

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

  const res = await fetch(path, { ...init, headers });
  const text = await res.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    throw new Error(typeof body.error === 'string' ? body.error : `请求失败 (${res.status})`);
  }
  return body as T;
}

export const api = {
  login: (nickname: string) =>
    request<{ token: string; user: User }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ nickname }),
    }),
  me: () => request<{ user: User }>('/api/me'),
  games: () => request<{ games: GameMeta[] }>('/api/games'),
  records: () => request<{ records: unknown[] }>('/api/records?limit=20'),
};
