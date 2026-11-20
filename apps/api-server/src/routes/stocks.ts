import type { FastifyInstance } from 'fastify';
import { STOCK_DEFINITIONS, type KlinePeriod, type StockHolding } from '@cc/protocol';
import { authHeader, httpError } from '../http-utils';
import type { Repository } from '../repository/types';
import { getLiveStockQuotes, getStockKlines, getStockLivePrice, getStockTrends } from '../stock-market';
import { createLogger } from '../logger';

const log = createLogger('stocks-route');

export function registerStockRoutes(app: FastifyInstance, repo: Repository): void {
  /**
   * 获取改命股市 10 支核心标的最新市场行情快照及标的字典
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
   * 获取当前玩家的全部股票持仓及资产汇总
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

      const q = quoteMap.get(h.symbol);
      const currentPrice = q ? q.price : h.avgCost;
      const yClose = q ? q.yesterdayClose : currentPrice;

      const marketValue = Math.round(h.shares * currentPrice);
      const costBasis = Math.round(h.shares * h.avgCost);
      const floatingPnl = marketValue - costBasis;
      const floatingPnlPercent = costBasis > 0 ? Number(((floatingPnl / costBasis) * 100).toFixed(2)) : 0;
      const todayPnl = Math.round(h.shares * (currentPrice - yClose));

      totalMarketValue += marketValue;
      totalFloatingPnl += floatingPnl;
      totalTodayPnl += todayPnl;
      totalCostBasis += costBasis;

      holdings.push({
        symbol: h.symbol,
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
   * 市价买入股票标的（建仓/加仓）
   */
  app.post('/api/stocks/buy', async (req) => {
    const claims = authHeader(req);
    const userId = claims.sub;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const symbol = String(body.symbol ?? '').trim();
    const shares = Math.floor(Number(body.shares ?? 0));

    if (!symbol) throw httpError('请选择要买入的股票标的', 400);
    if (!Number.isInteger(shares) || shares <= 0) throw httpError('买入数量必须为正整数', 400);

    const def = STOCK_DEFINITIONS.find((s) => s.symbol === symbol);
    if (!def) throw httpError('不支持的股票标的代码', 400);

    const { price } = await getStockLivePrice(symbol);
    if (price <= 0) throw httpError('股票行情获取失败，请稍后重试', 503);

    try {
      const result = await repo.buyStock(userId, symbol, shares, price);
      log.info(`股票买入成功: userId=${userId} symbol=${symbol} shares=${shares} price=${price} total=${result.totalAmount}`);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '买入失败';
      throw httpError(msg, 400);
    }
  });

  /**
   * 市价卖出股票标的（平仓/减仓）
   */
  app.post('/api/stocks/sell', async (req) => {
    const claims = authHeader(req);
    const userId = claims.sub;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const symbol = String(body.symbol ?? '').trim();
    const shares = Math.floor(Number(body.shares ?? 0));

    if (!symbol) throw httpError('请选择要卖出的股票标的', 400);
    if (!Number.isInteger(shares) || shares <= 0) throw httpError('卖出数量必须为正整数', 400);

    const def = STOCK_DEFINITIONS.find((s) => s.symbol === symbol);
    if (!def) throw httpError('不支持的股票标的代码', 400);

    const { price } = await getStockLivePrice(symbol);
    if (price <= 0) throw httpError('股票行情获取失败，请稍后重试', 503);

    try {
      const result = await repo.sellStock(userId, symbol, shares, price);
      log.info(`股票卖出成功: userId=${userId} symbol=${symbol} shares=${shares} price=${price} net=${result.totalAmount}`);
      return result;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '卖出失败';
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
