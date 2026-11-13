import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { ClaimMailResult, MailRecord, PlayerMailView, SendMailInput } from '../types';
import { creditWallet, getWalletBalance } from './wallet';

export async function sendMail(pool: pg.Pool, input: SendMailInput): Promise<MailRecord> {
  const id = randomUUID();
  const expireDays = Math.max(1, Math.min(input.expireDays ?? 30, 365));
  const rewardCoins = Math.max(0, Math.floor(input.rewardCoins ?? 0));
  const sender = input.sender?.trim() || '系统管理员';
  const targetUserId = input.targetType === 'user' ? (input.targetUserId ?? null) : null;

  const res = await pool.query<{
    id: string;
    target_type: string;
    target_user_id: string | null;
    sender: string;
    title: string;
    content: string;
    reward_coins: string;
    created_at: Date;
    expire_at: Date;
  }>(
    `insert into mails (id, target_type, target_user_id, sender, title, content, reward_coins, expire_at)
     values ($1, $2, $3, $4, $5, $6, $7, now() + ($8 || ' days')::interval)
     returning id, target_type, target_user_id, sender, title, content, reward_coins, created_at, expire_at`,
    [id, input.targetType, targetUserId, sender, input.title.trim(), input.content.trim(), rewardCoins, expireDays],
  );

  const row = res.rows[0]!;
  return {
    id: row.id,
    targetType: row.target_type as 'user' | 'all',
    targetUserId: row.target_user_id,
    sender: row.sender,
    title: row.title,
    content: row.content,
    rewardCoins: Number(row.reward_coins),
    createdAt: new Date(row.created_at).getTime(),
    expireAt: new Date(row.expire_at).getTime(),
  };
}

export async function listPlayerMails(pool: pg.Pool, userId: string): Promise<PlayerMailView[]> {
  const res = await pool.query<{
    id: string;
    sender: string;
    title: string;
    content: string;
    reward_coins: string;
    created_at: Date;
    is_read: boolean | null;
    is_claimed: boolean | null;
    claimed_at: Date | null;
  }>(
    `select m.id, m.sender, m.title, m.content, m.reward_coins, m.created_at,
            coalesce(s.is_read, false) as is_read,
            coalesce(s.is_claimed, false) as is_claimed,
            s.claimed_at
       from mails m
  left join mail_user_status s on s.mail_id = m.id and s.user_id = $1
      where m.expire_at > now()
        and (m.target_type = 'all' or (m.target_type = 'user' and m.target_user_id = $1))
        and coalesce(s.deleted, false) = false
      order by m.created_at desc
      limit 100`,
    [userId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    sender: row.sender,
    title: row.title,
    content: row.content,
    rewardCoins: Number(row.reward_coins),
    createdAt: new Date(row.created_at).getTime(),
    isRead: Boolean(row.is_read),
    isClaimed: Boolean(row.is_claimed),
    claimedAt: row.claimed_at ? new Date(row.claimed_at).getTime() : null,
  }));
}

export async function markMailRead(pool: pg.Pool, mailId: string, userId: string): Promise<boolean> {
  const res = await pool.query(
    `insert into mail_user_status (mail_id, user_id, is_read)
     values ($1, $2, true)
     on conflict (mail_id, user_id)
     do update set is_read = true`,
    [mailId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function claimMailReward(pool: pg.Pool, mailId: string, userId: string): Promise<ClaimMailResult> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const mailRes = await client.query<{
      id: string;
      target_type: string;
      target_user_id: string | null;
      reward_coins: string;
      expire_at: Date;
    }>(
      `select id, target_type, target_user_id, reward_coins, expire_at
         from mails where id = $1 for share`,
      [mailId],
    );
    const balance = await getWalletBalance(pool, userId, 'coin');
    const mail = mailRes.rows[0];
    if (!mail) {
      await client.query('rollback');
      return { ok: false, rewardCoins: 0, balance, reason: '邮件不存在' };
    }
    if (new Date(mail.expire_at).getTime() <= Date.now()) {
      await client.query('rollback');
      return { ok: false, rewardCoins: 0, balance, reason: '邮件已过期' };
    }
    if (mail.target_type === 'user' && mail.target_user_id !== userId) {
      await client.query('rollback');
      return { ok: false, rewardCoins: 0, balance, reason: '无权领取此邮件' };
    }
    const rewardCoins = Number(mail.reward_coins);
    if (rewardCoins <= 0) {
      await client.query('rollback');
      return { ok: false, rewardCoins: 0, balance, reason: '该邮件无附带筹码' };
    }

    const statusRes = await client.query<{ is_claimed: boolean }>(
      `select is_claimed from mail_user_status where mail_id = $1 and user_id = $2 for update`,
      [mailId, userId],
    );
    if (statusRes.rows[0]?.is_claimed) {
      await client.query('rollback');
      return { ok: false, rewardCoins: 0, balance, reason: '附件已领取，请勿重复操作' };
    }

    await client.query(
      `insert into mail_user_status (mail_id, user_id, is_read, is_claimed, claimed_at)
       values ($1, $2, true, true, now())
       on conflict (mail_id, user_id)
       do update set is_read = true, is_claimed = true, claimed_at = now()`,
      [mailId, userId],
    );

    const nextBalance = await creditWallet(pool, userId, rewardCoins, 'mail_reward', `mail:${mailId}:${userId}`);
    await client.query('commit');
    return { ok: true, rewardCoins, balance: nextBalance };
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePlayerMail(pool: pg.Pool, mailId: string, userId: string): Promise<boolean> {
  const res = await pool.query(
    `insert into mail_user_status (mail_id, user_id, deleted)
     values ($1, $2, true)
     on conflict (mail_id, user_id)
     do update set deleted = true`,
    [mailId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listAdminMails(pool: pg.Pool, limit: number): Promise<MailRecord[]> {
  const res = await pool.query<{
    id: string;
    target_type: string;
    target_user_id: string | null;
    sender: string;
    title: string;
    content: string;
    reward_coins: string;
    created_at: Date;
    expire_at: Date;
  }>(
    `select id, target_type, target_user_id, sender, title, content, reward_coins, created_at, expire_at
       from mails
      order by created_at desc
      limit $1`,
    [Math.min(Math.max(1, limit), 200)],
  );

  return res.rows.map((row) => ({
    id: row.id,
    targetType: row.target_type as 'user' | 'all',
    targetUserId: row.target_user_id,
    sender: row.sender,
    title: row.title,
    content: row.content,
    rewardCoins: Number(row.reward_coins),
    createdAt: new Date(row.created_at).getTime(),
    expireAt: new Date(row.expire_at).getTime(),
  }));
}

export async function deleteAdminMail(pool: pg.Pool, mailId: string): Promise<boolean> {
  const res = await pool.query('delete from mails where id = $1', [mailId]);
  return (res.rowCount ?? 0) > 0;
}
