import type pg from 'pg';
import { LEADERBOARD_SIZE, rewardForRank } from '../../leaderboard';
import type {
  DailyWinnerRow,
  LeaderboardRow,
  LeaderboardSnapshotRow,
  TaskProgressRow,
} from '../types';
import { bumpTaskTx } from './shared';
import { creditWallet } from './wallet';

export async function getTaskRows(
  pool: pg.Pool,
  userId: string,
  periodKeys: string[],
): Promise<TaskProgressRow[]> {
  const res = await pool.query<{
    task_key: string;
    period_key: string;
    progress: number;
    claimed: boolean;
  }>(
    `select task_key, period_key, progress, (claimed_at is not null) as claimed
       from task_progress
      where user_id = $1 and period_key = any($2::text[])`,
    [userId, periodKeys],
  );
  return res.rows.map((row) => ({
    taskKey: row.task_key,
    periodKey: row.period_key,
    progress: row.progress,
    claimed: row.claimed,
  }));
}

export async function bumpTask(
  pool: pg.Pool,
  userId: string,
  taskKey: string,
  periodKey: string,
  delta: number,
): Promise<number> {
  return bumpTaskTx(pool, userId, taskKey, periodKey, delta);
}

export async function claimTask(
  pool: pg.Pool,
  userId: string,
  taskKey: string,
  periodKey: string,
): Promise<boolean> {
  const res = await pool.query(
    `insert into task_progress (user_id, task_key, period_key, progress, claimed_at)
     values ($1, $2, $3, 0, now())
     on conflict (user_id, task_key, period_key)
     do update set claimed_at = now()
      where task_progress.claimed_at is null
     returning claimed_at`,
    [userId, taskKey, periodKey],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getLeaderboard(pool: pg.Pool, limit: number): Promise<LeaderboardRow[]> {
  const res = await pool.query<{ user_id: string; nickname: string; balance: string }>(
    `select w.user_id, u.nickname, w.balance
       from wallets w
       join users u on u.id = w.user_id
      where w.currency = 'coin'
      order by w.balance desc, u.created_at asc
      limit $1`,
    [limit],
  );
  return res.rows.map((row) => ({
    userId: row.user_id,
    nickname: row.nickname,
    balance: Number(row.balance),
  }));
}

export async function getLeaderboardRank(pool: pg.Pool, userId: string): Promise<number | null> {
  // 名次 = 1 + 排在自己前面的人数，比全表窗口排序便宜得多
  const res = await pool.query<{ rnk: string | null }>(
    `with me as (
       select w.balance, u.created_at
         from wallets w
         join users u on u.id = w.user_id
        where w.user_id = $1 and w.currency = 'coin'
     )
     select case
              when (select count(*) from me) = 0 then null
              else 1 + (
                select count(*)
                  from wallets w2
                  join users u2 on u2.id = w2.user_id
                  cross join me
                 where w2.currency = 'coin'
                   and (w2.balance > me.balance
                        or (w2.balance = me.balance and u2.created_at < me.created_at))
              )
            end as rnk`,
    [userId],
  );
  const value = res.rows[0]?.rnk;
  return value === null || value === undefined ? null : Number(value);
}

export async function settleDailyLeaderboard(pool: pg.Pool, dayKey: string): Promise<number> {
  const rows = await getLeaderboard(pool, LEADERBOARD_SIZE);
  let total = 0;
  for (const [index, row] of rows.entries()) {
    const reward = rewardForRank(index + 1);
    if (reward <= 0) continue;
    const balance = await creditWallet(pool, row.userId, reward, 'leaderboard_daily', `${dayKey}:${row.userId}`);
    await pool.query(
      `insert into leaderboard_daily_snapshots (period_key, user_id, nickname, rank, balance, reward)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (period_key, user_id) do nothing`,
      [dayKey, row.userId, row.nickname, index + 1, balance, reward],
    );
    total += reward;
  }
  return total;
}

export async function listDailySnapshot(
  pool: pg.Pool,
  dayKey: string,
): Promise<LeaderboardSnapshotRow[]> {
  const res = await pool.query<{
    user_id: string;
    nickname: string;
    rank: number;
    balance: string;
    reward: number;
  }>(
    `select user_id, nickname, rank, balance, reward
       from leaderboard_daily_snapshots
      where period_key = $1
      order by rank asc`,
    [dayKey],
  );
  return res.rows.map((row) => ({
    userId: row.user_id,
    nickname: row.nickname,
    rank: row.rank,
    balance: Number(row.balance),
    reward: row.reward,
  }));
}

export async function getDailyWinners(pool: pg.Pool, limit: number): Promise<DailyWinnerRow[]> {
  const res = await pool.query<{
    user_id: string;
    nickname: string;
    net: string;
    rounds: string;
  }>(
    `select l.user_id,
            u.nickname,
            sum(l.delta)::bigint as net,
            count(*)::int as rounds
       from ledger l
       join users u on u.id = l.user_id
      where l.currency = 'coin'
        and l.biz_type = 'game_settle'
        and l.created_at >= (date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')
      group by l.user_id, u.nickname
     having sum(l.delta) > 0
      order by net desc
      limit $1`,
    [limit],
  );
  return res.rows.map((row) => ({
    userId: row.user_id,
    nickname: row.nickname,
    net: Number(row.net),
    rounds: Number(row.rounds),
  }));
}
