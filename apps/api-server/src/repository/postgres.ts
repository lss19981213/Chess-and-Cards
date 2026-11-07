import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Currency, Settlement } from '@cc/protocol';
import { SCHEMA_SQL } from '../schema';
import type {
  GameRecordView,
  Repository,
  SettlementResult,
  UserRecord,
} from './types';

const { Pool } = pg;

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

  async loginOrCreate(nickname: string): Promise<UserRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query<{ id: string; nickname: string; created_at: Date }>(
        `insert into users (id, nickname) values ($1, $2)
         on conflict (nickname) do update set nickname = excluded.nickname
         returning id, nickname, created_at`,
        [randomUUID(), nickname],
      );
      const row = res.rows[0];
      if (!row) throw new Error('用户创建失败');
      await client.query(
        `insert into wallets (user_id, currency, balance) values ($1, 'coin', $2)
         on conflict (user_id) do nothing`,
        [row.id, this.initialCoins],
      );
      await client.query('COMMIT');
      return { id: row.id, nickname: row.nickname, createdAt: new Date(row.created_at).getTime() };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getUser(id: string): Promise<UserRecord | null> {
    const res = await this.pool.query<{ id: string; nickname: string; created_at: Date }>(
      'select id, nickname, created_at from users where id = $1',
      [id],
    );
    const row = res.rows[0];
    return row ? { id: row.id, nickname: row.nickname, createdAt: new Date(row.created_at).getTime() } : null;
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

      for (const entry of settlement.entries) {
        // 幂等保护：该单据对应用户已入账则跳过更新
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

  async close(): Promise<void> {
    await this.pool.end();
  }
}
