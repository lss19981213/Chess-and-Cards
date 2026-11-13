import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Currency } from '@cc/protocol';
import { InsufficientFundsError, type AuthUser, type RegisterInput, type RegisterResult, type UserRecord } from '../types';
import { mapUser, type UserRow } from './shared';

export async function registerUser(
  pool: pg.Pool,
  initialCoins: number,
  input: RegisterInput,
): Promise<RegisterResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<UserRow>(
      `insert into users (id, nickname, username, password_hash)
       values ($1, $2, $3, $4)
       returning id, nickname, username, created_at`,
      [randomUUID(), input.nickname, input.username, input.passwordHash],
    );
    const row = res.rows[0];
    if (!row) throw new Error('用户创建失败');
    await client.query(
      `insert into wallets (user_id, currency, balance) values ($1, 'coin', $2)
       on conflict (user_id) do nothing`,
      [row.id, initialCoins],
    );
    await client.query('COMMIT');
    return { ok: true, user: mapUser(row) };
  } catch (error) {
    await client.query('ROLLBACK');
    if ((error as { code?: string }).code === '23505') {
      return { ok: false, reason: 'username_taken' };
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function findUserByUsername(pool: pg.Pool, username: string): Promise<AuthUser | null> {
  const res = await pool.query<UserRow>(
    `select id, nickname, username, password_hash, created_at, coalesce(banned, false) as banned
       from users
      where lower(username) = lower($1)
      limit 1`,
    [username],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { ...mapUser(row), passwordHash: row.password_hash ?? '' };
}

export async function getUserById(pool: pg.Pool, id: string): Promise<UserRecord | null> {
  const res = await pool.query<UserRow>(
    'select id, nickname, username, created_at, coalesce(banned, false) as banned from users where id = $1',
    [id],
  );
  const row = res.rows[0];
  return row ? mapUser(row) : null;
}

export async function getWalletBalance(pool: pg.Pool, userId: string, currency: Currency): Promise<number> {
  const res = await pool.query<{ balance: string }>(
    'select balance from wallets where user_id = $1 and currency = $2',
    [userId, currency],
  );
  return Number(res.rows[0]?.balance ?? 0);
}

export async function creditWallet(
  pool: pg.Pool,
  userId: string,
  amount: number,
  bizType: string,
  bizId: string,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query<{ balance: string }>(
      `update wallets
          set balance = balance + $2, version = version + 1
        where user_id = $1
          and balance + $2 >= 0
          and not exists (
            select 1 from ledger where biz_type = $3 and biz_id = $4 and user_id = $1
          )
      returning balance`,
      [userId, amount, bizType, bizId],
    );

    if (updated.rowCount === 0) {
      const dup = await client.query(
        'select 1 from ledger where biz_type = $1 and biz_id = $2 and user_id = $3',
        [bizType, bizId, userId],
      );
      const current = await client.query<{ balance: string }>(
        'select balance from wallets where user_id = $1',
        [userId],
      );
      await client.query('COMMIT');
      // 幂等重复：返回当前余额；否则就是余额不足，不能静默截断成 0
      if (dup.rowCount && dup.rowCount > 0) return Number(current.rows[0]?.balance ?? 0);
      throw new InsufficientFundsError();
    }

    const balance = Number(updated.rows[0]?.balance ?? 0);
    await client.query(
      `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
       values ($1, 'coin', $2, $3, $4, $5)
       on conflict (biz_type, biz_id, user_id) do nothing`,
      [userId, amount, balance, bizType, bizId],
    );
    await client.query('COMMIT');
    return balance;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
