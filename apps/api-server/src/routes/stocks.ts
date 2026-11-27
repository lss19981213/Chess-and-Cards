import type { FastifyInstance } from 'fastify';
import {
  STOCK_DEFINITIONS,
  type KlinePeriod,
  type StockHolding,
  type StockLeaderboardEntry,
} from '@cc/protocol';
import { authHeader, httpError } from '../http-utils';
import type { Repository } from '../repository/types';
import { getLiveStockQuotes, getStockKlines, getStockLivePrice, getStockTrends } from '../stock-market';
import { createLogger } from '../logger';

const log = createLogger('stocks-route');

export function registerStockRoutes(app: FastifyInstance, repo: Repository): void {
  /**
   * 获取改命股市全部核心标的最新市场行情快照及标的字典
   */
  app.get('/api/stocks/quotes', async () => {
    const quotes = await getLiveStockQuotes();
    return {
      definitions: STOCK_DEFINITIONS,
      quotes,
      timestamp: Date.now(),
    };
  });

  /**
   * 获取指定标的分时走势数据
   */
  app.get('/api/stocks/trends/:symbol', async (req) => {
    const { symbol } = req.params as { symbol: string };
    if (!symbol) throw httpError('缺少股票代码', 400);

    const trends = await getStockTrends(symbol);
    return { symbol, trends };
  });

  /**
   * 获取指定标的的蜡烛图 K 线数据（日K、周K、月K、年K）
   */
  app.get('/api/stocks/klines/:symbol', async (req) => {
    const { symbol } = req.params as { symbol: string };
    const query = req.query as { period?: KlinePeriod };
    if (!symbol) throw httpError('缺少股票代码', 400);

    const period = query.period || 'day';
    const klines = await getStockKlines(symbol, period);
    return { symbol, period, klines };
  });

  /**
   * 获取当前玩家的全部股票持仓及资产汇总（含做多与做空持仓）
   */
  app.get('/api/stocks/holdings', async (req) => {
    const claims = authHeader(req);
    const userId = claims.sub;

    const [rawHoldings, quotes, balance] = await Promise.all([
      repo.getStockHoldings(userId),
      getLiveStockQuotes(),
      repo.getBalance(userId, 'coin'),
    ]);

    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));
    let totalMarketValue = 0;
    let totalFloatingPnl = 0;
    let totalTodayPnl = 0;
    let totalCostBasis = 0;

    const holdings: StockHolding[] = [];

    for (const h of rawHoldings) {
      if (h.shares <= 0) continue;
      const def = STOCK_DEFINITIONS.find((s) => s.symbol === h.symbol);
      if (!def) continue;

      const side = h.side === 'short' ? 'short' : 'long';
      const q = quoteMap.get(h.symbol);
      const currentPrice = q ? q.price : h.avgCost;
      const yClose = q ? q.yesterdayClose : currentPrice;

      const costBasis = Math.round(h.shares * h.avgCost);
      const floatingPnl =
        side === 'short'
          ? Math.round(h.shares * (h.avgCost - currentPrice))
          : Math.round(h.shares * (currentPrice - h.avgCost));
      const marketValue =
        side === 'short'
          ? Math.max(0, costBasis + floatingPnl)
          : Math.round(h.shares * currentPrice);
      const floatingPnlPercent = costBasis > 0 ? Number(((floatingPnl / costBasis) * 100).toFixed(2)) : 0;
      const todayPnl =
        side === 'short'
          ? Math.round(h.shares * (yClose - currentPrice))
          : Math.round(h.shares * (currentPrice - yClose));

      totalMarketValue += marketValue;
      totalFloatingPnl += floatingPnl;
      totalTodayPnl += todayPnl;
      totalCostBasis += costBasis;

      holdings.push({
        symbol: h.symbol,
        side,
        shares: h.shares,
        avgCost: h.avgCost,
        currentPrice,
        marketValue,
        floatingPnl,
        floatingPnlPercent,
        todayPnl,
        stockMeta: def,
      });
    }

    const totalAssets = balance + totalMarketValue;
    const totalFloatingPercent = totalCostBasis > 0 ? Number(((totalFloatingPnl / totalCostBasis) * 100).toFixed(2)) : 0;

    return {
      holdings,
      summary: {
        totalAssets,
        availableBalance: balance,
        totalMarketValue,
        totalFloatingPnl,
        totalFloatingPercent,
        totalTodayPnl,
      },
    };
  });

  /**
   * 改命股市股神排行榜（按持仓总市值 + 累计已实现/浮动盈亏排序）
   */
  app.get('/api/stocks/leaderboard', async (req) => {
    const query = req.query as { limit?: string };
    const limit = Math.min(50, Math.max(5, Number(query.limit ?? 30) || 30));
    const [snapshots, quotes] = await Promise.all([
      repo.listAllStockHolderSnapshots(),
      getLiveStockQuotes(),
    ]);
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

    const entries: StockLeaderboardEntry[] = snapshots
      .map((s) => {
        let totalMarketValue = 0;
        let totalFloatingPnl = 0;
        for (const h of s.holdings) {
          if (h.shares <= 0) continue;
          const q = quoteMap.get(h.symbol);
          const curPrice = q ? q.price : h.avgCost;
          const costBasis = Math.round(h.shares * h.avgCost);
          const flt =
            h.side === 'short'
              ? Math.round(h.shares * (h.avgCost - curPrice))
              : Math.round(h.shares * (curPrice - h.avgCost));
          const mv = h.side === 'short' ? Math.max(0, costBasis + flt) : Math.round(h.shares * curPrice);
          totalMarketValue += mv;
          totalFloatingPnl += flt;
        }
        const totalStockScore = totalFloatingPnl + s.totalRealizedPnl;
        return {
          rank: 0,
          userId: s.userId,
          nickname: s.nickname,
          avatar: s.avatar,
          equippedFrame: s.equippedFrame,
          totalMarketValue,
          totalFloatingPnl,
          totalRealizedPnl: s.totalRealizedPnl,
          totalStockScore,
        };
      })
      .sort((a, b) => b.totalStockScore - a.totalStockScore || b.totalMarketValue - a.totalMarketValue)
      .slice(0, limit)
      .map((row, idx) => ({ ...row, rank: idx + 1 }));

    return { entries };
  });

  /**
   * 市价买入 / 融券做空开仓
   */
  app.post('/api/stocks/buy', async (req) => {
    const claims = authHeader(req);
    const userId = claims.sub;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const symbol = String(body.symbol ?? '').trim();
    const shares = Math.floor(Number(body.shares ?? 0));
    const side = body.side === 'short' ? 'short' : 'long';

    if (!symbol) throw httpError('请选择要交易的股票标的', 400);
    if (!Number.isInteger(shares) || shares <= 0) throw httpError('委托数量必须为正整数', 400);

    const def = STOCK_DEFINITIONS.find((s) => s.symbol === symbol);
    if (!def) throw httpError('不支持的股票标的代码', 400);

    const { price } = await getStockLivePrice(symbol);
    if (price <= 0) throw httpError('股票行情获取失败，请稍后重试', 503);

    try {
      const result = await repo.buyStock(userId, symbol, shares, price, side);
      log.info(`股市开仓成功: userId=${userId} symbol=${symbol} side=${side} shares=${shares} price=${price}`);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '交易失败';
      throw httpError(msg, 400);
    }
  });

  /**
   * 市价卖出多单 / 平空仓结算
   */
  app.post('/api/stocks/sell', async (req) => {
    const claims = authHeader(req);
    const userId = claims.sub;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const symbol = String(body.symbol ?? '').trim();
    const shares = Math.floor(Number(body.shares ?? 0));
    const side = body.side === 'short' ? 'short' : 'long';

    if (!symbol) throw httpError('请选择要平仓的股票标的', 400);
    if (!Number.isInteger(shares) || shares <= 0) throw httpError('平仓数量必须为正整数', 400);

    const def = STOCK_DEFINITIONS.find((s) => s.symbol === symbol);
    if (!def) throw httpError('不支持的股票标的代码', 400);

    const { price } = await getStockLivePrice(symbol);
    if (price <= 0) throw httpError('股票行情获取失败，请稍后重试', 503);

    try {
      const result = await repo.sellStock(userId, symbol, shares, price, side);
      log.info(`股市平仓成功: userId=${userId} symbol=${symbol} side=${side} shares=${shares} price=${price}`);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '平仓失败';
      throw httpError(msg, 400);
    }
  });

  /**
   * 获取玩家历史股票订单流水
   */
  app.get('/api/stocks/orders', async (req) => {
    const claims = authHeader(req);
    const query = req.query as { limit?: string };
    const limit = query.limit ? Number(query.limit) : 50;

    const orders = await repo.listStockOrders(claims.sub, limit);
    return { orders };
  });
}
