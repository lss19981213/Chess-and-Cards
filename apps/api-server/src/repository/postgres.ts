import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Announcement, Currency, Settlement } from '@cc/protocol';
import { SCHEMA_SQL } from '../schema';
import { periodKeyFor } from '../tasks';
import { InsufficientFundsError } from './types';
import { LEADERBOARD_SIZE, rewardForRank } from '../leaderboard';
import type {
  AuthUser,
  BetAdjustment,
  GameRecordView,
  LeaderboardSnapshotRow,
  DailyWinnerRow,
  LeaderboardRow,
  RegisterInput,
  RegisterResult,
  Repository,
  SettlementResult,
  TaskProgressRow,
  UserRecord,
} from './types';

const { Pool } = pg;

interface UserRow {
  id: string;
  nickname: string;
  username: string | null;
  created_at: Date;
  password_hash?: string;
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    nickname: row.nickname,
    username: row.username,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/** PostgreSQL 仓储：钱包与账本强事务，生产环境使用。 */
export class PostgresRepository implements Repository {
  private readonly pool: pg.Pool;
  private readonly initialCoins: number;

  constructor(databaseUrl: string, initialCoins: number) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
    this.initialCoins = initialCoins;
  }

  async init(): Promise<void> {
    await this.pool.query(SCHEMA_SQL);
  }

  async releaseOrphanBets(roomId?: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const groups = await client.query<{ user_id: string; hold_id: string; staked: string }>(
        `select l.user_id,
                split_part(l.biz_id, ':', 1) || ':' || split_part(l.biz_id, ':', 2) || ':' || l.user_id as hold_id,
                sum(l.delta) as staked
           from ledger l
          where l.biz_type in ('game_bet', 'game_bet_refund')
            and ($1::text is null or split_part(l.biz_id, ':', 1) = $1)
            and not exists (
              select 1 from ledger r
               where r.biz_type in ('game_bet_return', 'game_bet_release')
                 and r.user_id = l.user_id
                 and r.biz_id = split_part(l.biz_id, ':', 1) || ':' || split_part(l.biz_id, ':', 2) || ':' || l.user_id || ':return'
            )
          group by 1, 2
         having sum(l.delta) < 0`,
        [roomId ?? null],
      );

      let released = 0;
      for (const row of groups.rows) {
        const amount = -Number(row.staked);
        const updated = await client.query<{ balance: string }>(
          'update wallets set balance = balance + $2, version = version + 1 where user_id = $1 returning balance',
          [row.user_id, amount],
        );
        await client.query(
          `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
           values ($1, 'coin', $2, $3, 'game_bet_release', $4)
           on conflict (biz_type, biz_id, user_id) do nothing`,
          [row.user_id, amount, Number(updated.rows[0]?.balance ?? 0), `${row.hold_id}:return`],
        );
        released += amount;
      }
      await client.query('COMMIT');
      return released;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async register(input: RegisterInput): Promise<RegisterResult> {
    const client = await this.pool.connect();
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
        [row.id, this.initialCoins],
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

  async findByUsername(username: string): Promise<AuthUser | null> {
    const res = await this.pool.query<UserRow>(
      `select id, nickname, username, password_hash, created_at
         from users
        where lower(username) = lower($1)
        limit 1`,
      [username],
    );
    const row = res.rows[0];
    if (!row) return null;
    return { ...mapUser(row), passwordHash: row.password_hash ?? '' };
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const res = await this.pool.query<UserRow>(
      'select id, nickname, username, created_at from users where id = $1',
      [id],
    );
    const row = res.rows[0];
    return row ? mapUser(row) : null;
  }

  async getBalance(userId: string, currency: Currency): Promise<number> {
    const res = await this.pool.query<{ balance: string }>(
      'select balance from wallets where user_id = $1 and currency = $2',
      [userId, currency],
    );
    return Number(res.rows[0]?.balance ?? 0);
  }

  async adjustBet(input: BetAdjustment): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      let amount = input.amount;
      if (input.action === 'refund') {
        const origin = await client.query<{ delta: string }>(
          `select delta from ledger
            where user_id = $1 and biz_type = 'game_bet' and biz_id = $2`,
          [input.userId, input.bizId],
        );
        if (origin.rowCount === 0) throw new Error('原下注凭证不存在');
        // 以实际扣款额为准，不信任调用方传来的金额
        amount = -Number(origin.rows[0]?.delta ?? 0);
      }

      const bizType = input.action === 'debit' ? 'game_bet' : 'game_bet_refund';
      const delta = input.action === 'debit' ? -amount : amount;
      const updated = await client.query<{ balance: string }>(
        `update wallets
            set balance = balance + $2, version = version + 1
          where user_id = $1
            and balance + $2 >= 0
            and not exists (
              select 1 from ledger where biz_type = $3 and biz_id = $4 and user_id = $1
            )
        returning balance`,
        [input.userId, delta, bizType, input.bizId],
      );

      if (updated.rowCount === 0) {
        const dup = await client.query(
          'select 1 from ledger where biz_type = $1 and biz_id = $2 and user_id = $3',
          [bizType, input.bizId, input.userId],
        );
        const current = await client.query<{ balance: string }>(
          'select balance from wallets where user_id = $1',
          [input.userId],
        );
        const balance = Number(current.rows[0]?.balance ?? 0);
        await client.query('COMMIT');
        if (dup.rowCount && dup.rowCount > 0) return balance;
        throw new InsufficientFundsError();
      }

      const balance = Number(updated.rows[0]?.balance ?? 0);
      await client.query(
        `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
         values ($1, 'coin', $2, $3, $4, $5)
         on conflict (biz_type, biz_id, user_id) do nothing`,
        [input.userId, delta, balance, bizType, input.bizId],
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

  async applySettlement(settlement: Settlement): Promise<SettlementResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let applied = 0;
      const dayKey = periodKeyFor('daily');

      for (const entry of settlement.entries) {
        // 本局下注已即时扣过本金，结算时先退还本金，再按净盈亏入账。
        // game_settle 仍记净额，战报/今日净收益的口径不变。
        const stakedRes = await client.query<{ staked: string }>(
          `select coalesce(sum(delta), 0) as staked from ledger
            where user_id = $1
              and biz_type in ('game_bet', 'game_bet_refund')
              and biz_id like $2
              and not exists (
                select 1 from ledger r
                 where r.biz_type = 'game_bet_release' and r.user_id = $1 and r.biz_id = $3
              )`,
          [
            entry.playerId,
            `${settlement.settlementId}:${entry.playerId}:%`,
            `${settlement.settlementId}:${entry.playerId}:return`,
          ],
        );
        const staked = Number(stakedRes.rows[0]?.staked ?? 0);
        const credit = entry.delta - staked;

        const updated = await client.query<{ balance: string }>(
          `update wallets
              set balance = greatest(balance + $2, 0), version = version + 1
            where user_id = $1
              and not exists (
                select 1 from ledger
                 where biz_type = 'game_settle' and biz_id = $3 and user_id = $1
              )
          returning balance`,
          [entry.playerId, credit, settlement.settlementId],
        );
        if (updated.rowCount === 0) continue;
        const balanceAfter = Number(updated.rows[0]?.balance ?? 0);

        await client.query(
          `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
           values ($1, $2, $3, $4, 'game_settle', $5)
           on conflict (biz_type, biz_id, user_id) do nothing`,
          [entry.playerId, entry.currency, entry.delta, balanceAfter, settlement.settlementId],
        );
        if (staked < 0) {
          await client.query(
            `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
             values ($1, 'coin', $2, $3, 'game_bet_return', $4)
             on conflict (biz_type, biz_id, user_id) do nothing`,
            [entry.playerId, -staked, balanceAfter, `${settlement.settlementId}:${entry.playerId}:return`],
          );
        }

        await this.bumpTaskTx(client, entry.playerId, 'daily_play', dayKey, 1);
        if (entry.delta > 0) {
          await this.bumpTaskTx(client, entry.playerId, 'daily_win', dayKey, 1);
        }
        // 记录当日玩过的游戏种类（多面手）与单局大赢（大杀四方）
        await this.bumpTaskTx(client, entry.playerId, `game_${settlement.gameId}`, dayKey, 1);
        if (entry.delta >= 500) {
          await this.bumpTaskTx(client, entry.playerId, 'daily_bigwin', dayKey, 1);
        }
        // 长期累计：成长任务
        await this.bumpTaskTx(client, entry.playerId, 'total_play', 'all', 1);
        if (entry.delta > 0) {
          await this.bumpTaskTx(client, entry.playerId, 'total_win', 'all', 1);
        }
        applied += 1;
      }

      await client.query(
        `insert into game_records (settlement_id, room_id, game_id, round, seed, winners, detail)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (settlement_id) do nothing`,
        [
          settlement.settlementId,
          settlement.roomId,
          settlement.gameId,
          settlement.round,
          settlement.seed,
          settlement.winners,
          JSON.stringify(settlement),
        ],
      );

      await client.query('COMMIT');
      // 无真人流水的结算单（纯氛围机器人局）只记战报，不判为重复
      return applied > 0 || settlement.entries.length === 0 ? 'applied' : 'duplicate';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listRecords(userId: string, limit: number): Promise<GameRecordView[]> {
    const res = await this.pool.query<{
      settlement_id: string;
      room_id: string;
      game_id: string;
      round: number;
      seed: string;
      winners: string[];
      detail: { entries: GameRecordView['entries']; finishedAt: number };
    }>(
      `select settlement_id, room_id, game_id, round, seed, winners, detail
         from game_records
        where exists (
          select 1 from jsonb_array_elements(detail->'entries') e
           where e->>'playerId' = $1
        )
        order by created_at desc
        limit $2`,
      [userId, limit],
    );

    return res.rows.map((row) => ({
      settlementId: row.settlement_id,
      roomId: row.room_id,
      gameId: row.game_id,
      round: row.round,
      seed: row.seed,
      winners: row.winners,
      entries: row.detail?.entries ?? [],
      finishedAt: row.detail?.finishedAt ?? 0,
    }));
  }

  async credit(userId: string, amount: number, bizType: string, bizId: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query<{ balance: string }>(
        `update wallets
            set balance = greatest(balance + $2, 0), version = version + 1
          where user_id = $1
            and not exists (
              select 1 from ledger where biz_type = $3 and biz_id = $4 and user_id = $1
            )
        returning balance`,
        [userId, amount, bizType, bizId],
      );

      if (updated.rowCount === 0) {
        const current = await client.query<{ balance: string }>(
          'select balance from wallets where user_id = $1',
          [userId],
        );
        await client.query('COMMIT');
        return Number(current.rows[0]?.balance ?? 0);
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

  async getTaskRows(userId: string, periodKeys: string[]): Promise<TaskProgressRow[]> {
    const res = await this.pool.query<{
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

  async bumpTask(userId: string, taskKey: string, periodKey: string, delta: number): Promise<number> {
    const res = await this.bumpTaskTx(this.pool, userId, taskKey, periodKey, delta);
    return res;
  }

  async claimTask(userId: string, taskKey: string, periodKey: string): Promise<boolean> {
    const res = await this.pool.query(
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

  async leaderboard(limit: number): Promise<LeaderboardRow[]> {
    const res = await this.pool.query<{ user_id: string; nickname: string; balance: string }>(
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

  async leaderboardRank(userId: string): Promise<number | null> {
    const res = await this.pool.query<{ rnk: string }>(
      `select rnk
         from (
           select w.user_id,
                  row_number() over (order by w.balance desc, u.created_at asc) as rnk
             from wallets w
             join users u on u.id = w.user_id
            where w.currency = 'coin'
         ) t
        where t.user_id = $1`,
      [userId],
    );
    return res.rows[0] ? Number(res.rows[0].rnk) : null;
  }

  async settleDailyLeaderboard(dayKey: string): Promise<number> {
    const rows = await this.leaderboard(LEADERBOARD_SIZE);
    let total = 0;
    for (const [index, row] of rows.entries()) {
      const reward = rewardForRank(index + 1);
      if (reward <= 0) continue;
      const balance = await this.credit(row.userId, reward, 'leaderboard_daily', `${dayKey}:${index + 1}`);
      await this.pool.query(
        `insert into leaderboard_daily_snapshots (period_key, user_id, nickname, rank, balance, reward)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (period_key, user_id) do nothing`,
        [dayKey, row.userId, row.nickname, index + 1, balance, reward],
      );
      total += reward;
    }
    return total;
  }

  async listDailySnapshot(dayKey: string): Promise<LeaderboardSnapshotRow[]> {
    const res = await this.pool.query<{
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

  async dailyWinners(limit: number): Promise<DailyWinnerRow[]> {
    const res = await this.pool.query<{
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

  async listAnnouncements(limit: number): Promise<Announcement[]> {
    const res = await this.pool.query<{
      id: string;
      title: string;
      content: string;
      kind: string;
      created_at: Date;
    }>(
      `select id, title, content, kind, created_at
         from announcements
        order by created_at desc
        limit $1`,
      [Math.min(Math.max(1, limit), 50)],
    );
    return res.rows.map((row) => ({
      id: row.id,
      title: row.title,
      content: row.content,
      kind: row.kind as Announcement['kind'],
      createdAt: new Date(row.created_at).getTime(),
    }));
  }

  async createAnnouncement(input: {
    title: string;
    content: string;
    kind: Announcement['kind'];
  }): Promise<Announcement> {
    const id = randomUUID();
    const res = await this.pool.query<{ created_at: Date }>(
      `insert into announcements (id, title, content, kind)
       values ($1, $2, $3, $4)
       returning created_at`,
      [id, input.title, input.content, input.kind],
    );
    const created = res.rows[0]?.created_at;
    return { id, ...input, createdAt: created ? new Date(created).getTime() : Date.now() };
  }

  async deleteAnnouncement(id: string): Promise<boolean> {
    const res = await this.pool.query('delete from announcements where id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async bumpTaskTx(
    client: pg.Pool | pg.PoolClient,
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
}
