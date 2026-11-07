import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Currency, Settlement } from '@cc/protocol';
import { SCHEMA_SQL } from '../schema';
import { periodKeyFor } from '../tasks';
import type {
  AuthUser,
  GameRecordView,
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

  async applySettlement(settlement: Settlement): Promise<SettlementResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      let applied = 0;
      const dayKey = periodKeyFor('daily');

      for (const entry of settlement.entries) {
        const updated = await client.query<{ balance: string }>(
          `update wallets
              set balance = balance + $2, version = version + 1
            where user_id = $1
              and not exists (
                select 1 from ledger
                 where biz_type = 'game_settle' and biz_id = $3 and user_id = $1
              )
          returning balance`,
          [entry.playerId, entry.delta, settlement.settlementId],
        );
        if (updated.rowCount === 0) continue;

        await client.query(
          `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
           values ($1, $2, $3, $4, 'game_settle', $5)
           on conflict (biz_type, biz_id, user_id) do nothing`,
          [entry.playerId, entry.currency, entry.delta, Number(updated.rows[0]?.balance ?? 0), settlement.settlementId],
        );

        await this.bumpTaskTx(client, entry.playerId, 'daily_play', dayKey, 1);
        if (entry.delta > 0) {
          await this.bumpTaskTx(client, entry.playerId, 'daily_win', dayKey, 1);
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
      return applied > 0 ? 'applied' : 'duplicate';
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
            set balance = balance + $2, version = version + 1
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
