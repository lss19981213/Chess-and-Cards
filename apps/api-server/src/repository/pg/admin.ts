import type pg from 'pg';
import type { EconomyOverview, LedgerRow } from '../types';

export async function setUserStatus(pool: pg.Pool, userId: string, banned: boolean): Promise<boolean> {
  const res = await pool.query('update users set banned = $2 where id = $1', [userId, banned]);
  return (res.rowCount ?? 0) > 0;
}

export async function resetUserPassword(pool: pg.Pool, userId: string, passwordHash: string): Promise<boolean> {
  const res = await pool.query('update users set password_hash = $2 where id = $1', [userId, passwordHash]);
  return (res.rowCount ?? 0) > 0;
}

export async function listUserLedger(pool: pg.Pool, userId: string, limit: number): Promise<LedgerRow[]> {
  const res = await pool.query<{
    id: string;
    user_id: string;
    currency: string;
    delta: string;
    balance_after: string;
    biz_type: string;
    biz_id: string;
    created_at: Date;
  }>(
    `select id, user_id, currency, delta, balance_after, biz_type, biz_id, created_at
       from ledger
      where user_id = $1
      order by created_at desc
      limit $2`,
    [userId, Math.min(Math.max(1, limit), 200)],
  );

  return res.rows.map((row) => ({
    id: String(row.id),
    userId: row.user_id,
    currency: row.currency,
    delta: Number(row.delta),
    balanceAfter: Number(row.balance_after),
    bizType: row.biz_type,
    bizId: row.biz_id,
    createdAt: new Date(row.created_at).getTime(),
  }));
}

export async function getEconomyOverview(pool: pg.Pool): Promise<EconomyOverview> {
  const [usersRes, balanceRes, todayRes] = await Promise.all([
    pool.query<{ count: string }>('select count(*)::text as count from users'),
    pool.query<{ total: string }>("select coalesce(sum(balance), 0)::text as total from wallets where currency = 'coin'"),
    pool.query<{
      today_bet: string;
      today_settle: string;
      today_tip: string;
      today_relief: string;
      today_gm: string;
    }>(
      `select
         coalesce(sum(case when biz_type = 'game_bet' then abs(delta) else 0 end), 0)::text as today_bet,
         coalesce(sum(case when biz_type = 'game_settle' then delta else 0 end), 0)::text as today_settle,
         coalesce(sum(case when biz_type = 'dealer_tip' then abs(delta) else 0 end), 0)::text as today_tip,
         coalesce(sum(case when biz_type = 'task' and biz_id like 'relief:%' then delta else 0 end), 0)::text as today_relief,
         coalesce(sum(case when biz_type = 'gm_grant' then delta else 0 end), 0)::text as today_gm
       from ledger
      where created_at >= (date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')`,
    ),
  ]);

  const today = todayRes.rows[0];
  return {
    totalUsers: Number(usersRes.rows[0]?.count ?? 0),
    totalBalance: Number(balanceRes.rows[0]?.total ?? 0),
    todayBet: Number(today?.today_bet ?? 0),
    todaySettle: Number(today?.today_settle ?? 0),
    todayTip: Number(today?.today_tip ?? 0),
    todayRelief: Number(today?.today_relief ?? 0),
    todayGmGrant: Number(today?.today_gm ?? 0),
  };
}
