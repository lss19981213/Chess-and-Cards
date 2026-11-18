import type pg from 'pg';
import { applyXpGain, parseBigIntSafe } from '@cc/protocol';
import { periodKeyFor } from '../../tasks';
import {
  InsufficientFundsError,
  type SlotsAnalytics,
  type SlotsPlayerStat,
  type SlotsSpinInput,
  type SlotsSpinLog,
  type SlotsSpinOutcome,
  type SlotsSummaryMetrics,
} from '../types';
import { bumpTaskTx } from './shared';

export async function playSlotsSpin(
  pool: pg.Pool,
  input: SlotsSpinInput,
): Promise<SlotsSpinOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const wRes = await client.query<{ balance: string }>(
      `select balance from wallets where user_id = $1 and currency = 'coin' for update`,
      [input.userId],
    );
    if (wRes.rowCount === 0) throw new InsufficientFundsError();
    const balanceBefore = Number(wRes.rows[0]?.balance ?? 0);
    if (balanceBefore < input.totalBet) {
      throw new InsufficientFundsError();
    }

    const balanceAfterBet = balanceBefore - input.totalBet;
    const balanceAfter = balanceAfterBet + input.winAmount;
    const netDelta = input.winAmount - input.totalBet;

    await client.query(
      `update wallets set balance = $2, version = version + 1 where user_id = $1 and currency = 'coin'`,
      [input.userId, balanceAfter],
    );

    // 1. 写入完整账本流水：押注扣款 (game_bet) + 派彩结算 (game_settle)
    await client.query(
      `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
       values ($1, 'coin', $2, $3, 'game_bet', $4)`,
      [input.userId, -input.totalBet, balanceAfterBet, `slots:${input.spinId}:bet`],
    );
    await client.query(
      `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
       values ($1, 'coin', $2, $3, 'game_settle', $4)`,
      [input.userId, input.winAmount, balanceAfter, `slots:${input.spinId}:win`],
    );

    // 2. 写入老虎机专项经营记录表
    await client.query(
      `insert into slots_spins
         (id, user_id, bet_per_line, lines, total_bet, win_amount, net_delta, is_jackpot, winning_lines, reels)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        input.spinId,
        input.userId,
        input.betPerLine,
        input.lines,
        input.totalBet,
        input.winAmount,
        netDelta,
        input.isJackpot,
        input.winningLines.length,
        JSON.stringify(input.reels),
      ],
    );

    // 3. 写入全局对局记录表 game_records
    const detail = {
      settlementId: `slots:${input.spinId}`,
      roomId: 'slots-lobby',
      gameId: 'slots',
      round: 1,
      seed: input.spinId,
      winners: netDelta > 0 ? [input.userId] : [],
      entries: [
        {
          playerId: input.userId,
          currency: 'coin',
          delta: netDelta,
          reason: input.isJackpot ? 'slots.jackpot' : input.winAmount > 0 ? 'slots.win' : 'slots.spin',
        },
      ],
      finishedAt: Date.now(),
    };
    await client.query(
      `insert into game_records (settlement_id, room_id, game_id, round, seed, winners, participants, detail)
       values ($1, 'slots-lobby', 'slots', 1, $2, $3, $4, $5)
       on conflict (settlement_id) do nothing`,
      [
        `slots:${input.spinId}`,
        input.spinId,
        netDelta > 0 ? [input.userId] : [],
        [input.userId],
        JSON.stringify(detail),
      ],
    );

    // 4. 推进每日与成长任务进度
    const dayKey = periodKeyFor('daily');
    await bumpTaskTx(client, input.userId, 'daily_play', dayKey, 1);
    await bumpTaskTx(client, input.userId, 'game_slots', dayKey, 1);
    await bumpTaskTx(client, input.userId, 'total_play', 'all', 1);
    if (netDelta > 0) {
      await bumpTaskTx(client, input.userId, 'daily_win', dayKey, 1);
      await bumpTaskTx(client, input.userId, 'total_win', 'all', 1);
    }
    if (netDelta >= 500) {
      await bumpTaskTx(client, input.userId, 'daily_bigwin', dayKey, 1);
    }

    // 5. 有效投注流水 1:1 转化为账号经验与升级进度
    await client.query(
      `insert into user_profiles (user_id) values ($1) on conflict (user_id) do nothing`,
      [input.userId],
    );
    const profRes = await client.query<{
      level: number;
      xp: string;
      rewarded_level: number;
      total_turnover: string;
    }>(
      `select coalesce(level, 1) as level,
              coalesce(xp, 0)::text as xp,
              coalesce(rewarded_level, 1) as rewarded_level,
              coalesce(total_turnover, 0)::text as total_turnover
         from user_profiles
        where user_id = $1
        for update`,
      [input.userId],
    );
    const cur = profRes.rows[0];
    const nextProg = applyXpGain(cur?.level ?? 1, cur?.xp ?? '0', input.totalBet);
    const nextTurnover = (parseBigIntSafe(cur?.total_turnover) + BigInt(input.totalBet)).toString();

    await client.query(
      `update user_profiles
          set level = $2,
              xp = $3::numeric,
              total_turnover = $4::numeric,
              updated_at = now()
        where user_id = $1`,
      [input.userId, nextProg.level, nextProg.xp, nextTurnover],
    );

    await client.query('COMMIT');
    return {
      spinId: input.spinId,
      balance: balanceAfter,
      totalBet: input.totalBet,
      winAmount: input.winAmount,
      netDelta,
      level: nextProg.level,
      xp: nextProg.xp,
      rewardedLevel: Number(cur?.rewarded_level ?? 1),
      totalTurnover: nextTurnover,
      levelsGained: nextProg.levelsGained,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function buildMetrics(row: {
  spins: string;
  players: string;
  total_bet: string;
  total_payout: string;
  jackpots: string;
  max_win: string;
}): SlotsSummaryMetrics {
  const totalBet = Number(row.total_bet ?? 0);
  const totalPayout = Number(row.total_payout ?? 0);
  const houseProfit = totalBet - totalPayout;
  const rtpPercent = totalBet > 0 ? Math.round((totalPayout / totalBet) * 10000) / 100 : 0;
  return {
    spins: Number(row.spins ?? 0),
    players: Number(row.players ?? 0),
    totalBet,
    totalPayout,
    houseProfit,
    rtpPercent,
    jackpots: Number(row.jackpots ?? 0),
    maxSingleWin: Number(row.max_win ?? 0),
  };
}

export async function getSlotsAnalytics(pool: pg.Pool, limit = 50): Promise<SlotsAnalytics> {
  const safeLimit = Math.min(Math.max(1, limit), 200);
  const [todayRes, totalRes, playersRes, recentRes] = await Promise.all([
    pool.query<{
      spins: string;
      players: string;
      total_bet: string;
      total_payout: string;
      jackpots: string;
      max_win: string;
    }>(
      `select
         count(*)::text as spins,
         count(distinct user_id)::text as players,
         coalesce(sum(total_bet), 0)::text as total_bet,
         coalesce(sum(win_amount), 0)::text as total_payout,
         coalesce(sum(case when is_jackpot then 1 else 0 end), 0)::text as jackpots,
         coalesce(max(win_amount), 0)::text as max_win
       from slots_spins
      where created_at >= (date_trunc('day', now() at time zone 'Asia/Shanghai') at time zone 'Asia/Shanghai')`,
    ),
    pool.query<{
      spins: string;
      players: string;
      total_bet: string;
      total_payout: string;
      jackpots: string;
      max_win: string;
    }>(
      `select
         count(*)::text as spins,
         count(distinct user_id)::text as players,
         coalesce(sum(total_bet), 0)::text as total_bet,
         coalesce(sum(win_amount), 0)::text as total_payout,
         coalesce(sum(case when is_jackpot then 1 else 0 end), 0)::text as jackpots,
         coalesce(max(win_amount), 0)::text as max_win
       from slots_spins`,
    ),
    pool.query<{
      user_id: string;
      nickname: string;
      spins: string;
      total_bet: string;
      total_win: string;
      net_profit: string;
      max_win: string;
      jackpots: string;
    }>(
      `select
         s.user_id,
         coalesce(u.nickname, '玩家') as nickname,
         count(*)::text as spins,
         coalesce(sum(s.total_bet), 0)::text as total_bet,
         coalesce(sum(s.win_amount), 0)::text as total_win,
         coalesce(sum(s.net_delta), 0)::text as net_profit,
         coalesce(max(s.win_amount), 0)::text as max_win,
         coalesce(sum(case when s.is_jackpot then 1 else 0 end), 0)::text as jackpots
       from slots_spins s
       left join users u on u.id = s.user_id
       group by s.user_id, u.nickname
       order by sum(s.total_bet) desc
       limit 30`,
    ),
    pool.query<{
      id: string;
      user_id: string;
      nickname: string;
      bet_per_line: number;
      lines: number;
      total_bet: string;
      win_amount: string;
      net_delta: string;
      is_jackpot: boolean;
      winning_lines: number;
      created_at: Date;
    }>(
      `select
         s.id,
         s.user_id,
         coalesce(u.nickname, '玩家') as nickname,
         s.bet_per_line,
         s.lines,
         s.total_bet::text,
         s.win_amount::text,
         s.net_delta::text,
         s.is_jackpot,
         s.winning_lines,
         s.created_at
       from slots_spins s
       left join users u on u.id = s.user_id
       order by s.created_at desc
       limit $1`,
      [safeLimit],
    ),
  ]);

  const emptyRow = { spins: '0', players: '0', total_bet: '0', total_payout: '0', jackpots: '0', max_win: '0' };
  const topPlayers: SlotsPlayerStat[] = playersRes.rows.map((r) => ({
    userId: r.user_id,
    nickname: r.nickname,
    spins: Number(r.spins),
    totalBet: Number(r.total_bet),
    totalWin: Number(r.total_win),
    netProfit: Number(r.net_profit),
    maxWin: Number(r.max_win),
    jackpots: Number(r.jackpots),
  }));

  const recentSpins: SlotsSpinLog[] = recentRes.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    nickname: r.nickname,
    betPerLine: Number(r.bet_per_line),
    lines: Number(r.lines),
    totalBet: Number(r.total_bet),
    winAmount: Number(r.win_amount),
    netDelta: Number(r.net_delta),
    isJackpot: Boolean(r.is_jackpot),
    winningLines: Number(r.winning_lines),
    createdAt: new Date(r.created_at).getTime(),
  }));

  return {
    today: buildMetrics(todayRes.rows[0] ?? emptyRow),
    total: buildMetrics(totalRes.rows[0] ?? emptyRow),
    topPlayers,
    recentSpins,
  };
}
