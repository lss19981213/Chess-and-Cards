import type pg from 'pg';
import type { UserRecord } from '../types';

export type PgQueryable = pg.Pool | pg.PoolClient;

export interface UserRow {
  id: string;
  nickname: string;
  username: string | null;
  created_at: Date;
  password_hash?: string;
}

export function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    nickname: row.nickname,
    username: row.username,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/**
 * 列表/资料只返回轻量头像 URL（含内容短哈希作缓存破坏），
 * 完整 base64 头像只在 `/api/avatar/:userId` 按需读取，避免好友与搜索响应膨胀。
 */
export function avatarUrlSql(profileAlias: string, userIdExpr: string): string {
  return `case when ${profileAlias}.avatar is not null and ${profileAlias}.avatar <> '' then '/api/avatar/' || ${userIdExpr} || '?v=' || substr(md5(${profileAlias}.avatar), 1, 10) else null end`;
}

export async function bumpTaskTx(
  client: PgQueryable,
  userId: string,
  taskKey: string,
  periodKey: string,
  delta: number,
): Promise<number> {
  const res = await client.query<{ progress: number }>(
    `insert into task_progress (user_id, task_key, period_key, progress)
     values ($1, $2, $3, $4)
     on conflict (user_id, task_key, period_key)
     do update set progress = task_progress.progress + $4
     returning progress`,
    [userId, taskKey, periodKey, delta],
  );
  return res.rows[0]?.progress ?? 0;
}
