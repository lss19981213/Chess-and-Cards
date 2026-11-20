import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { STOCK_DEFINITIONS, type StockOrder, type StockTradeResult } from '@cc/protocol';
import { InsufficientFundsError, type StockHoldingRow } from '../types';

export async function getStockHoldings(pool: pg.Pool, userId: string): Promise<StockHoldingRow[]> {
  const res = await pool.query<{
    user_id: string;
    symbol: string;
    shares: string;
    avg_cost: string;
    updated_at: Date;
  }>(
    `select user_id, symbol, shares, avg_cost, updated_at
       from stock_holdings
      where user_id = $1 and shares > 0
      order by updated_at desc`,
    [userId],
  );

  return res.rows.map((r) => ({
    userId: r.user_id,
    symbol: r.symbol,
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
): Promise<StockTradeResult> {
  if (!Number.isInteger(shares) || shares <= 0) {
    throw new Error('买入数量必须为正整数');
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error('股票行情价格异常');
  }

  const def = STOCK_DEFINITIONS.find((s) => s.symbol === symbol);
  const stockName = def ? def.name : symbol;

  const totalCost = Math.round(shares * currentPrice);
  // 万分之三佣金手续费，最低 1 筹码
  const fee = Math.max(1, Math.floor(totalCost * 0.0003));
  const totalDebit = totalCost + fee;
  const orderId = randomUUID();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 锁定并核对钱包余额
    const walletRes = await client.query<{ balance: string }>(
      'select balance from wallets where user_id = $1 for update',
      [userId],
    );
    if (walletRes.rowCount === 0) {
      throw new Error('玩家钱包不存在');
    }
    const currentBalance = Number(walletRes.rows[0]?.balance ?? 0);
    if (currentBalance < totalDebit) {
      throw new InsufficientFundsError(`欢乐豆余额不足！买入需 ${totalDebit.toLocaleString()} 豆，当前仅有 ${currentBalance.toLocaleString()} 豆`);
    }

    const nextBalance = currentBalance - totalDebit;
    await client.query(
      'update wallets set balance = $2, version = version + 1 where user_id = $1',
      [userId, nextBalance],
    );

    // 记录流水账本
    await client.query(
      `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
       values ($1, 'coin', $2, $3, 'stock_buy', $4)`,
      [userId, -totalDebit, nextBalance, `stock:${orderId}`],
    );

    // 查询历史持仓计算加权成本
    const holdingRes = await client.query<{ shares: string; avg_cost: string }>(
      'select shares, avg_cost from stock_holdings where user_id = $1 and symbol = $2 for update',
      [userId, symbol],
    );

    let newShares = shares;
    let newAvgCost = currentPrice;

    if (holdingRes.rowCount && holdingRes.rowCount > 0) {
      const oldShares = Number(holdingRes.rows[0]?.shares ?? 0);
      const oldAvgCost = Number(holdingRes.rows[0]?.avg_cost ?? 0);
      newShares = oldShares + shares;
      newAvgCost = (oldShares * oldAvgCost + totalCost) / newShares;
    }

    // 更新持仓
    await client.query(
      `insert into stock_holdings (user_id, symbol, shares, avg_cost, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (user_id, symbol)
       do update set shares = $3, avg_cost = $4, updated_at = now()`,
      [userId, symbol, newShares, Number(newAvgCost.toFixed(2))],
    );

    // 写入订单流水
    await client.query(
      `insert into stock_orders (id, user_id, symbol, stock_name, action, shares, price, total_amount, fee, realized_pnl)
       values ($1, $2, $3, $4, 'buy', $5, $6, $7, $8, 0)`,
      [orderId, userId, symbol, stockName, shares, currentPrice, totalDebit, fee],
    );

    await client.query('COMMIT');

    return {
      ok: true,
      orderId,
      symbol,
      stockName,
      action: 'buy',
      shares,
      price: currentPrice,
      totalAmount: totalDebit,
      fee,
      realizedPnl: 0,
      balanceAfter: nextBalance,
      message: `🎉 成功买入 ${shares} ${def?.unitName ?? '股'}【${stockName}】，成交均价 ${currentPrice.toFixed(2)}！`,
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
): Promise<StockTradeResult> {
  if (!Number.isInteger(shares) || shares <= 0) {
    throw new Error('卖出数量必须为正整数');
  }
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error('股票行情价格异常');
  }

  const def = STOCK_DEFINITIONS.find((s) => s.symbol === symbol);
  const stockName = def ? def.name : symbol;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 锁定并检查持仓
    const holdingRes = await client.query<{ shares: string; avg_cost: string }>(
      'select shares, avg_cost from stock_holdings where user_id = $1 and symbol = $2 for update',
      [userId, symbol],
    );
    if (!holdingRes.rowCount || holdingRes.rowCount === 0) {
      throw new Error(`您尚未持有【${stockName}】，无法卖出`);
    }

    const currentShares = Number(holdingRes.rows[0]?.shares ?? 0);
    const avgCost = Number(holdingRes.rows[0]?.avg_cost ?? 0);
    if (currentShares < shares) {
      throw new Error(`持仓不足！您当前仅持有 ${currentShares} ${def?.unitName ?? '股'}，无法卖出 ${shares} 股`);
    }

    const grossAmount = Math.round(shares * currentPrice);
    // 千分之一印花税/手续费，最低 1 筹码
    const fee = Math.max(1, Math.floor(grossAmount * 0.001));
    const netCredit = Math.max(0, grossAmount - fee);
    const realizedPnl = Math.round((currentPrice - avgCost) * shares - fee);
    const orderId = randomUUID();

    // 扣减持仓
    const remainingShares = currentShares - shares;
    if (remainingShares > 0) {
      await client.query(
        'update stock_holdings set shares = $3, updated_at = now() where user_id = $1 and symbol = $2',
        [userId, symbol, remainingShares],
      );
    } else {
      await client.query(
        'update stock_holdings set shares = 0, avg_cost = 0, updated_at = now() where user_id = $1 and symbol = $2',
        [userId, symbol],
      );
    }

    // 结算货款入钱包
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

    // 记录流水账本
    await client.query(
      `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
       values ($1, 'coin', $2, $3, 'stock_sell', $4)`,
      [userId, netCredit, nextBalance, `stock:${orderId}`],
    );

    // 写入订单流水
    await client.query(
      `insert into stock_orders (id, user_id, symbol, stock_name, action, shares, price, total_amount, fee, realized_pnl)
       values ($1, $2, $3, $4, 'sell', $5, $6, $7, $8, $9)`,
      [orderId, userId, symbol, stockName, shares, currentPrice, netCredit, fee, realizedPnl],
    );

    await client.query('COMMIT');

    const pnlSign = realizedPnl >= 0 ? `+${realizedPnl.toLocaleString()}` : realizedPnl.toLocaleString();
    return {
      ok: true,
      orderId,
      symbol,
      stockName,
      action: 'sell',
      shares,
      price: currentPrice,
      totalAmount: netCredit,
      fee,
      realizedPnl,
      balanceAfter: nextBalance,
      message: `🎉 成功卖出 ${shares} ${def?.unitName ?? '股'}【${stockName}】，净收 ${netCredit.toLocaleString()} 豆（实现盈亏: ${pnlSign} 豆）！`,
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
    action: 'buy' | 'sell';
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
