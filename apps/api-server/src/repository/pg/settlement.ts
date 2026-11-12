import type pg from 'pg';
import type { Settlement } from '@cc/protocol';
import { periodKeyFor } from '../../tasks';
import { InsufficientFundsError, type BetAdjustment, type GameRecordView, type SettlementResult } from '../types';
import { bumpTaskTx } from './shared';

export async function releaseOrphanBets(pool: pg.Pool, roomId?: string): Promise<number> {
  const client = await pool.connect();
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
      const ledgerId = `${row.hold_id}:return`;

      // 先锁钱包行，再复核是否已释放/已结算，最后才加钱，避免重复退款
      const walletRes = await client.query<{ balance: string }>(
        'select balance from wallets where user_id = $1 for update',
        [row.user_id],
      );
      if (walletRes.rowCount === 0) continue;
      const done = await client.query(
        `select 1 from ledger
          where user_id = $1
            and biz_type in ('game_bet_return', 'game_bet_release')
            and biz_id = $2`,
        [row.user_id, ledgerId],
      );
      if (done.rowCount && done.rowCount > 0) continue;

      const balance = Number(walletRes.rows[0]?.balance ?? 0) + amount;
      await client.query(
        'update wallets set balance = $2, version = version + 1 where user_id = $1',
        [row.user_id, balance],
      );
      await client.query(
        `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
         values ($1, 'coin', $2, $3, 'game_bet_release', $4)`,
        [row.user_id, amount, balance, ledgerId],
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

export async function adjustBet(pool: pg.Pool, input: BetAdjustment): Promise<number> {
  const client = await pool.connect();
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
      amount = -Number(origin.rows[0]?.delta ?? 0);

      const holdId = `${input.bizId.split(':').slice(0, -1).join(':')}:return`;
      const settledOrReleased = await client.query(
        `select 1 from ledger
          where user_id = $1
            and biz_type in ('game_bet_return', 'game_bet_release')
            and biz_id = $2`,
        [input.userId, holdId],
      );
      if (settledOrReleased.rowCount && settledOrReleased.rowCount > 0) {
        throw new Error('该注单已结算或已释放，不能重复退款');
      }
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

export async function applySettlement(pool: pg.Pool, settlement: Settlement): Promise<SettlementResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let applied = 0;
    const dayKey = periodKeyFor('daily');

    for (const entry of settlement.entries) {
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

      const walletRes = await client.query<{ balance: string }>(
        'select balance from wallets where user_id = $1 for update',
        [entry.playerId],
      );
      if (walletRes.rowCount === 0) continue;
      const balanceBefore = Number(walletRes.rows[0]?.balance ?? 0);

      const settled = await client.query(
        `select 1 from ledger
          where biz_type = 'game_settle' and biz_id = $1 and user_id = $2`,
        [settlement.settlementId, entry.playerId],
      );
      if (settled.rowCount && settled.rowCount > 0) continue;

      const appliedDelta = Math.max(credit, -balanceBefore);
      const balanceAfter = balanceBefore + appliedDelta;

      await client.query(
        'update wallets set balance = $2, version = version + 1 where user_id = $1',
        [entry.playerId, balanceAfter],
      );
      await client.query(
        `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
         values ($1, $2, $3, $4, 'game_settle', $5)`,
        [entry.playerId, entry.currency, appliedDelta, balanceAfter, settlement.settlementId],
      );
      if (staked < 0) {
        await client.query(
          `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
           values ($1, 'coin', $2, $3, 'game_bet_return', $4)
           on conflict (biz_type, biz_id, user_id) do nothing`,
          [entry.playerId, -staked, balanceAfter, `${settlement.settlementId}:${entry.playerId}:return`],
        );
      }

      await bumpTaskTx(client, entry.playerId, 'daily_play', dayKey, 1);
      if (entry.delta > 0) {
        await bumpTaskTx(client, entry.playerId, 'daily_win', dayKey, 1);
      }
      await bumpTaskTx(client, entry.playerId, `game_${settlement.gameId}`, dayKey, 1);
      if (entry.delta >= 500) {
        await bumpTaskTx(client, entry.playerId, 'daily_bigwin', dayKey, 1);
      }
      await bumpTaskTx(client, entry.playerId, 'total_play', 'all', 1);
      if (entry.delta > 0) {
        await bumpTaskTx(client, entry.playerId, 'total_win', 'all', 1);
      }
      applied += 1;
    }

    const participants = Array.from(new Set(settlement.entries.map((e) => e.playerId)));
    await client.query(
      `insert into game_records (settlement_id, room_id, game_id, round, seed, winners, participants, detail)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (settlement_id) do nothing`,
      [
        settlement.settlementId,
        settlement.roomId,
        settlement.gameId,
        settlement.round,
        settlement.seed,
        settlement.winners,
        participants,
        JSON.stringify(settlement),
      ],
    );

    await client.query('COMMIT');
    return applied > 0 || settlement.entries.length === 0 ? 'applied' : 'duplicate';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listGameRecords(pool: pg.Pool, userId: string, limit: number): Promise<GameRecordView[]> {
  // 直接命中 participants text[] 的 GIN 索引，避免每次展开 detail JSONB 做全表扫
  const res = await pool.query<{
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
      where participants @> array[$1]::text[]
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
