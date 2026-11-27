import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { STOCK_DEFINITIONS, type StockOrder, type StockTradeResult } from '@cc/protocol';
import {
  InsufficientFundsError,
  type AdminStockOverviewData,
  type StockHolderSnapshotRow,
  type StockHoldingRow,
} from '../types';

export async function getStockHoldings(pool: pg.Pool, userId: string): Promise<StockHoldingRow[]> {
  const res = await pool.query<{
    user_id: string;
    symbol: string;
    side: 'long' | 'short';
    shares: string;
    avg_cost: string;
    updated_at: Date;
  }>(
    `select user_id, symbol, coalesce(side, 'long') as side, shares, avg_cost, updated_at
       from stock_holdings
      where user_id = $1 and shares > 0
      order by updated_at desc`,
    [userId],
  );

  return res.rows.map((r) => ({
    userId: r.user_id,
    symbol: r.symbol,
    side: r.side === 'short' ? 'short' : 'long',
    shares: Number(r.shares),
    avgCost: Number(r.avg_cost),
    updatedAt: r.updated_at.getTime(),
  }));
}

export async function buyStock(
  pool: pg.Pool,
  userId: string,
  symbol: string,
  shares: number,
  currentPrice: number,
  side: 'long' | 'short' = 'long',
): Promise<StockTradeResult> {
  if (!Number.isInteger(shares) || shares <= 0) {
    throw new Error('委托数量必须为正整数');
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error('股票行情价格异常');
  }

  const def = STOCK_DEFINITIONS.find((s) => s.symbol === symbol);
  const stockName = def ? def.name : symbol;

  const totalCost = Math.round(shares * currentPrice);
  const fee = Math.max(1, Math.floor(totalCost * 0.0003));
  const totalDebit = totalCost + fee;
  const orderId = randomUUID();
  const action = side === 'short' ? 'short_open' : 'buy';
  const bizType = side === 'short' ? 'stock_short_open' : 'stock_buy';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const walletRes = await client.query<{ balance: string }>(
      'select balance from wallets where user_id = $1 for update',
      [userId],
    );
    if (walletRes.rowCount === 0) {
      throw new Error('玩家钱包不存在');
    }
    const currentBalance = Number(walletRes.rows[0]?.balance ?? 0);
    if (currentBalance < totalDebit) {
      throw new InsufficientFundsError(
        `欢乐豆余额不足！${side === 'short' ? '融券做空保证金' : '买入'}需 ${totalDebit.toLocaleString()} 豆，当前仅有 ${currentBalance.toLocaleString()} 豆`,
      );
    }

    const nextBalance = currentBalance - totalDebit;
    await client.query(
      'update wallets set balance = $2, version = version + 1 where user_id = $1',
      [userId, nextBalance],
    );

    await client.query(
      `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
       values ($1, 'coin', $2, $3, $4, $5)`,
      [userId, -totalDebit, nextBalance, bizType, `stock:${orderId}`],
    );

    const holdingRes = await client.query<{ shares: string; avg_cost: string }>(
      'select shares, avg_cost from stock_holdings where user_id = $1 and symbol = $2 and side = $3 for update',
      [userId, symbol, side],
    );

    let newShares = shares;
    let newAvgCost = currentPrice;

    if (holdingRes.rowCount && holdingRes.rowCount > 0) {
      const oldShares = Number(holdingRes.rows[0]?.shares ?? 0);
      const oldAvgCost = Number(holdingRes.rows[0]?.avg_cost ?? 0);
      newShares = oldShares + shares;
      newAvgCost = (oldShares * oldAvgCost + totalCost) / newShares;
    }

    await client.query(
      `insert into stock_holdings (user_id, symbol, side, shares, avg_cost, updated_at)
       values ($1, $2, $3, $4, $5, now())
       on conflict (user_id, symbol, side)
       do update set shares = $4, avg_cost = $5, updated_at = now()`,
      [userId, symbol, side, newShares, Number(newAvgCost.toFixed(2))],
    );

    await client.query(
      `insert into stock_orders (id, user_id, symbol, stock_name, action, shares, price, total_amount, fee, realized_pnl)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0)`,
      [orderId, userId, symbol, stockName, action, shares, currentPrice, totalDebit, fee],
    );

    await client.query('COMMIT');

    return {
      ok: true,
      orderId,
      symbol,
      stockName,
      action,
      shares,
      price: currentPrice,
      totalAmount: totalDebit,
      fee,
      realizedPnl: 0,
      balanceAfter: nextBalance,
      message:
        side === 'short'
          ? `📉 成功开空 ${shares} ${def?.unitName ?? '股'}【${stockName}】，开空均价 ${currentPrice.toFixed(2)}！`
          : `🎉 成功买入 ${shares} ${def?.unitName ?? '股'}【${stockName}】，成交均价 ${currentPrice.toFixed(2)}！`,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function sellStock(
  pool: pg.Pool,
  userId: string,
  symbol: string,
  shares: number,
  currentPrice: number,
  side: 'long' | 'short' = 'long',
): Promise<StockTradeResult> {
  if (!Number.isInteger(shares) || shares <= 0) {
    throw new Error('平仓数量必须为正整数');
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error('股票行情价格异常');
  }

  const def = STOCK_DEFINITIONS.find((s) => s.symbol === symbol);
  const stockName = def ? def.name : symbol;
  const action = side === 'short' ? 'short_close' : 'sell';
  const bizType = side === 'short' ? 'stock_short_close' : 'stock_sell';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const holdingRes = await client.query<{ shares: string; avg_cost: string }>(
      'select shares, avg_cost from stock_holdings where user_id = $1 and symbol = $2 and side = $3 for update',
      [userId, symbol, side],
    );
    if (!holdingRes.rowCount || holdingRes.rowCount === 0) {
      throw new Error(`您尚未持有【${stockName}】${side === 'short' ? '空单' : '多单'}，无法平仓`);
    }

    const currentShares = Number(holdingRes.rows[0]?.shares ?? 0);
    const avgCost = Number(holdingRes.rows[0]?.avg_cost ?? 0);
    if (currentShares < shares) {
      throw new Error(`持仓不足！当前仅持有 ${currentShares} ${def?.unitName ?? '股'}，无法平仓 ${shares} 股`);
    }

    const grossAmount =
      side === 'short'
        ? Math.max(0, Math.round(avgCost * shares + (avgCost - currentPrice) * shares))
        : Math.round(shares * currentPrice);
    const fee = Math.max(1, Math.floor(Math.round(shares * currentPrice) * 0.001));
    const netCredit = Math.max(0, grossAmount - fee);
    const realizedPnl =
      side === 'short'
        ? Math.round((avgCost - currentPrice) * shares - fee)
        : Math.round((currentPrice - avgCost) * shares - fee);
    const orderId = randomUUID();

    const remainingShares = currentShares - shares;
    if (remainingShares > 0) {
      await client.query(
        'update stock_holdings set shares = $4, updated_at = now() where user_id = $1 and symbol = $2 and side = $3',
        [userId, symbol, side, remainingShares],
      );
    } else {
      await client.query(
        'update stock_holdings set shares = 0, avg_cost = 0, updated_at = now() where user_id = $1 and symbol = $2 and side = $3',
        [userId, symbol, side],
      );
    }

    const walletRes = await client.query<{ balance: string }>(
      'select balance from wallets where user_id = $1 for update',
      [userId],
    );
    const currentBalance = Number(walletRes.rows[0]?.balance ?? 0);
    const nextBalance = currentBalance + netCredit;

    await client.query(
      'update wallets set balance = $2, version = version + 1 where user_id = $1',
      [userId, nextBalance],
    );

    await client.query(
      `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
       values ($1, 'coin', $2, $3, $4, $5)`,
      [userId, netCredit, nextBalance, bizType, `stock:${orderId}`],
    );

    await client.query(
      `insert into stock_orders (id, user_id, symbol, stock_name, action, shares, price, total_amount, fee, realized_pnl)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [orderId, userId, symbol, stockName, action, shares, currentPrice, netCredit, fee, realizedPnl],
    );

    await client.query('COMMIT');

    const pnlSign = realizedPnl >= 0 ? `+${realizedPnl.toLocaleString()}` : realizedPnl.toLocaleString();
    return {
      ok: true,
      orderId,
      symbol,
      stockName,
      action,
      shares,
      price: currentPrice,
      totalAmount: netCredit,
      fee,
      realizedPnl,
      balanceAfter: nextBalance,
      message:
        side === 'short'
          ? `📈 成功平空 ${shares} ${def?.unitName ?? '股'}【${stockName}】，退回结算 ${netCredit.toLocaleString()} 豆（实现盈亏: ${pnlSign} 豆）！`
          : `🎉 成功卖出 ${shares} ${def?.unitName ?? '股'}【${stockName}】，净收 ${netCredit.toLocaleString()} 豆（实现盈亏: ${pnlSign} 豆）！`,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listStockOrders(pool: pg.Pool, userId: string, limit = 50): Promise<StockOrder[]> {
  const safeLimit = Math.min(100, Math.max(1, limit));
  const res = await pool.query<{
    id: string;
    user_id: string;
    symbol: string;
    stock_name: string;
    action: StockOrder['action'];
    shares: string;
    price: string;
    total_amount: string;
    fee: string;
    realized_pnl: string;
    created_at: Date;
  }>(
    `select id, user_id, symbol, stock_name, action, shares, price, total_amount, fee, realized_pnl, created_at
       from stock_orders
      where user_id = $1
      order by created_at desc
      limit $2`,
    [userId, safeLimit],
  );

  return res.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    symbol: r.symbol,
    stockName: r.stock_name,
    action: r.action,
    shares: Number(r.shares),
    price: Number(r.price),
    totalAmount: Number(r.total_amount),
    fee: Number(r.fee),
    realizedPnl: Number(r.realized_pnl),
    createdAt: r.created_at.getTime(),
  }));
}

export async function listAllStockHolderSnapshots(pool: pg.Pool): Promise<StockHolderSnapshotRow[]> {
  const [holdRes, orderRes] = await Promise.all([
    pool.query<{
      user_id: string;
      symbol: string;
      side: 'long' | 'short';
      shares: string;
      avg_cost: string;
      updated_at: Date;
      nickname: string;
      avatar: string | null;
      equipped_frame: string | null;
    }>(
      `select h.user_id, h.symbol, coalesce(h.side, 'long') as side, h.shares, h.avg_cost, h.updated_at,
              u.nickname, p.avatar, p.equipped_frame
         from stock_holdings h
         join users u on u.id = h.user_id
         left join user_profiles p on p.user_id = h.user_id
        where h.shares > 0`,
    ),
    pool.query<{
      user_id: string;
      realized_sum: string;
      nickname: string;
      avatar: string | null;
      equipped_frame: string | null;
    }>(
      `select o.user_id, sum(o.realized_pnl) as realized_sum,
              u.nickname, p.avatar, p.equipped_frame
         from stock_orders o
         join users u on u.id = o.user_id
         left join user_profiles p on p.user_id = o.user_id
        group by o.user_id, u.nickname, p.avatar, p.equipped_frame`,
    ),
  ]);

  const userMap = new Map<string, StockHolderSnapshotRow>();
  for (const r of holdRes.rows) {
    const entry = userMap.get(r.user_id) ?? {
      userId: r.user_id,
      nickname: r.nickname,
      avatar: r.avatar ?? null,
      equippedFrame: r.equipped_frame ?? 'frame_default',
      holdings: [],
      totalRealizedPnl: 0,
    };
    entry.holdings.push({
      userId: r.user_id,
      symbol: r.symbol,
      side: r.side === 'short' ? 'short' : 'long',
      shares: Number(r.shares),
      avgCost: Number(r.avg_cost),
      updatedAt: r.updated_at.getTime(),
    });
    userMap.set(r.user_id, entry);
  }
  for (const r of orderRes.rows) {
    const entry = userMap.get(r.user_id) ?? {
      userId: r.user_id,
      nickname: r.nickname,
      avatar: r.avatar ?? null,
      equippedFrame: r.equipped_frame ?? 'frame_default',
      holdings: [],
      totalRealizedPnl: 0,
    };
    entry.totalRealizedPnl = Number(r.realized_sum ?? 0);
    userMap.set(r.user_id, entry);
  }

  return [...userMap.values()];
}

export async function getAdminStockOverview(pool: pg.Pool): Promise<AdminStockOverviewData> {
  const holdersRes = await pool.query<{ count: string }>(
    `select count(distinct user_id) as count from stock_holdings where shares > 0`,
  );
  const totalHolders = Number(holdersRes.rows[0]?.count ?? 0);

  const symbolRes = await pool.query<{
    symbol: string;
    total_shares: string;
    holder_count: string;
  }>(
    `select symbol, sum(shares) as total_shares, count(distinct user_id) as holder_count
       from stock_holdings
      where shares > 0
      group by symbol`,
  );
  const symbolHoldings = symbolRes.rows.map((r) => ({
    symbol: r.symbol,
    totalShares: Number(r.total_shares),
    holderCount: Number(r.holder_count),
  }));

  const statsRes = await pool.query<{
    total_orders: string;
    total_turnover: string;
    total_fees: string;
  }>(
    `select count(*) as total_orders,
            coalesce(sum(total_amount), 0) as total_turnover,
            coalesce(sum(fee), 0) as total_fees
       from stock_orders`,
  );
  const totalOrderCount = Number(statsRes.rows[0]?.total_orders ?? 0);
  const totalTurnover = Number(statsRes.rows[0]?.total_turnover ?? 0);
  const totalFees = Number(statsRes.rows[0]?.total_fees ?? 0);

  const ordersRes = await pool.query<{
    id: string;
    user_id: string;
    nickname: string | null;
    username: string | null;
    symbol: string;
    stock_name: string;
    action: StockOrder['action'];
    shares: string;
    price: string;
    total_amount: string;
    fee: string;
    realized_pnl: string;
    created_at: Date;
  }>(
    `select o.id, o.user_id, u.nickname, u.username, o.symbol, o.stock_name, o.action,
            o.shares, o.price, o.total_amount, o.fee, o.realized_pnl, o.created_at
       from stock_orders o
       left join users u on o.user_id = u.id
      order by o.created_at desc
      limit 50`,
  );
  const recentOrders = ordersRes.rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    nickname: r.nickname ?? '神秘玩家',
    username: r.username ?? undefined,
    symbol: r.symbol,
    stockName: r.stock_name,
    action: r.action,
    shares: Number(r.shares),
    price: Number(r.price),
    totalAmount: Number(r.total_amount),
    fee: Number(r.fee),
    realizedPnl: Number(r.realized_pnl),
    createdAt: r.created_at.getTime(),
  }));

  return {
    totalHolders,
    symbolHoldings,
    totalOrderCount,
    totalTurnover,
    totalFees,
    recentOrders,
  };
}
