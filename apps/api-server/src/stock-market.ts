import { STOCK_DEFINITIONS, type KlinePeriod, type StockKlineItem, type StockMeta, type StockQuote, type StockTrendPoint } from '@cc/protocol';
import { createLogger } from './logger';

const log = createLogger('stocks');

interface CachedQuotes {
  quotes: Map<string, StockQuote>;
  timestamp: number;
}

/** 报价缓存有效期：3 秒，避免高频请求触发第三方风控 */
const CACHE_TTL_MS = 3_000;

let quotesCache: CachedQuotes = {
  quotes: new Map(),
  timestamp: 0,
};

/** 兜底基准价格（当网络首次断网时使用） */
const BASELINE_PRICES: Record<string, { price: number; yesterdayClose: number; high: number; low: number; open: number }> = {
  XAU: { price: 3541.2, yesterdayClose: 3625.0, high: 3636.6, low: 3537.8, open: 3628.8 },
  XAG: { price: 41.9, yesterdayClose: 42.85, high: 43.21, low: 41.74, open: 43.03 },
  XPT: { price: 1298.8, yesterdayClose: 1347.5, high: 1340.3, low: 1297.0, open: 1336.7 },
  '600519': { price: 1439.1, yesterdayClose: 1460.2, high: 1459.0, low: 1439.0, open: 1450.8 },
  '000858': { price: 72.1, yesterdayClose: 73.4, high: 73.02, low: 71.6, open: 73.02 },
  '002594': { price: 79.1, yesterdayClose: 80.38, high: 79.5, low: 78.6, open: 79.5 },
  '300750': { price: 228.6, yesterdayClose: 234.58, high: 230.0, low: 227.1, open: 230.0 },
  '601318': { price: 53.86, yesterdayClose: 54.66, high: 54.17, low: 53.5, open: 54.17 },
  '600036': { price: 42.94, yesterdayClose: 43.32, high: 43.15, low: 42.8, open: 43.15 },
  '688981': { price: 121.5, yesterdayClose: 122.25, high: 122.0, low: 119.7, open: 119.7 },
  // 20 支新增标的基准报价
  XPD: { price: 888.29, yesterdayClose: 917.7, high: 913.0, low: 874.5, open: 906.0 },
  CL: { price: 83.05, yesterdayClose: 82.44, high: 83.25, low: 82.37, open: 83.1 },
  '601899': { price: 23.73, yesterdayClose: 23.88, high: 23.91, low: 22.56, open: 22.85 },
  '000568': { price: 79.74, yesterdayClose: 81.89, high: 81.5, low: 78.88, open: 81.01 },
  '600809': { price: 129.0, yesterdayClose: 130.58, high: 130.04, low: 125.5, open: 130.0 },
  '603288': { price: 36.25, yesterdayClose: 36.44, high: 36.37, low: 35.41, open: 36.31 },
  '600887': { price: 33.35, yesterdayClose: 32.91, high: 33.51, low: 32.58, open: 32.69 },
  '601012': { price: 10.89, yesterdayClose: 10.95, high: 10.95, low: 10.56, open: 10.72 },
  '600438': { price: 11.11, yesterdayClose: 11.39, high: 11.31, low: 11.09, open: 11.15 },
  '002466': { price: 31.87, yesterdayClose: 32.96, high: 32.69, low: 31.64, open: 32.5 },
  '601127': { price: 39.83, yesterdayClose: 40.06, high: 39.83, low: 38.68, open: 39.3 },
  '600941': { price: 108.71, yesterdayClose: 107.8, high: 108.71, low: 106.81, open: 107.12 },
  '002230': { price: 34.5, yesterdayClose: 35.9, high: 35.48, low: 34.38, open: 35.38 },
  '300059': { price: 18.41, yesterdayClose: 18.37, high: 18.49, low: 17.91, open: 18.21 },
  '000725': { price: 4.39, yesterdayClose: 4.33, high: 4.45, low: 4.23, open: 4.28 },
  '600584': { price: 50.2, yesterdayClose: 55.47, high: 54.6, low: 50.1, open: 53.6 },
  '300418': { price: 31.7, yesterdayClose: 34.05, high: 33.55, low: 31.67, open: 33.05 },
  '600030': { price: 25.39, yesterdayClose: 25.19, high: 25.47, low: 24.76, open: 24.98 },
  '601398': { price: 9.4, yesterdayClose: 9.1, high: 9.49, low: 9.04, open: 9.09 },
  '601857': { price: 13.22, yesterdayClose: 12.63, high: 13.39, low: 12.5, open: 12.6 },
};

/**
 * 格式化数值保留 2 位小数
 */
function toNum(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : fallback;
}

/**
 * 抓取并更新 10 支核心标的最新真实市场报价
 */
export async function getLiveStockQuotes(): Promise<StockQuote[]> {
  const now = Date.now();
  if (quotesCache.quotes.size > 0 && now - quotesCache.timestamp < CACHE_TTL_MS) {
    return Array.from(quotesCache.quotes.values());
  }
  return fetchFreshLiveStockQuotes();
}

/**
 * 强制穿透缓存刷新 10 支核心标的最新市场报价
 */
export async function refreshLiveStockQuotes(): Promise<StockQuote[]> {
  quotesCache = { quotes: new Map(), timestamp: 0 };
  return fetchFreshLiveStockQuotes();
}

async function fetchFreshLiveStockQuotes(): Promise<StockQuote[]> {
  const now = Date.now();
  const queryParam = STOCK_DEFINITIONS.map((s) => s.querySymbol).join(',');
  const url = `https://qt.gtimg.cn/q=${queryParam}`;

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`行情接口响应异常: ${res.status}`);
    }

    const buffer = await res.arrayBuffer();
    const decoder = new TextDecoder('gbk');
    const text = decoder.decode(buffer);

    const parsedMap = new Map<string, StockQuote>();
    const lines = text.split(';').filter((l) => l.trim().length > 0);

    for (const line of lines) {
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const rawKey = line.slice(0, eqIdx).trim(); // 如 v_sh600519 或 v_hf_XAU
      const rawVal = line.slice(eqIdx + 1).trim().replace(/^"|"$/g, '');
      if (!rawVal) continue;

      const def = STOCK_DEFINITIONS.find((s) => rawKey.includes(s.querySymbol));
      if (!def) continue;

      let quote: StockQuote;
      if (rawKey.includes('hf_')) {
        // 国际商品/现货行情格式：逗号分隔
        // 0:现价, 1:涨跌幅%, 2:买价, 3:卖价, 4:最高, 5:最低, 6:时间, 7:昨收, 8:今开, 9:成交量, 10:持仓量, 11:结算价, 12:日期, 13:品名
        const p = rawVal.split(',');
        const price = toNum(p[0], BASELINE_PRICES[def.symbol]?.price ?? 100);
        const yClose = toNum(p[7], price);
        const tOpen = toNum(p[8], yClose);
        const high = toNum(p[4], Math.max(price, tOpen));
        const low = toNum(p[5], Math.min(price, tOpen));
        const chgAmt = toNum(price - yClose);
        const chgPct = yClose > 0 ? toNum(((price - yClose) / yClose) * 100) : toNum(p[1]);

        quote = {
          symbol: def.symbol,
          name: def.name,
          price,
          yesterdayClose: yClose,
          todayOpen: tOpen,
          high,
          low,
          changeAmount: chgAmt,
          changePercent: chgPct,
          volume: Math.max(100, Number(p[9] || 2500)),
          turnover: toNum((price * Math.max(100, Number(p[9] || 2500))) / 10_000),
          updatedAt: now,
          bid1Price: toNum(p[2] || price),
          bid1Volume: 50,
          ask1Price: toNum(p[3] || price + 0.05),
          ask1Volume: 50,
          isTrading: true,
        };
      } else {
        // A 股行情格式：波浪号 (~) 分隔
        // 1:品名, 2:代码, 3:现价, 4:昨收, 5:今开, 6:成交量(手), 9:买一价, 10:买一量, 19:卖一价, 20:卖一量, 31:涨跌额, 32:涨跌幅%, 33:最高, 34:最低, 37:成交额(万元)
        const p = rawVal.split('~');
        const price = toNum(p[3], BASELINE_PRICES[def.symbol]?.price ?? 100);
        const yClose = toNum(p[4], price);
        const tOpen = toNum(p[5], yClose);
        const high = toNum(p[33], Math.max(price, tOpen));
        const low = toNum(p[34], Math.min(price, tOpen));
        const chgAmt = toNum(p[31], toNum(price - yClose));
        const chgPct = toNum(p[32], yClose > 0 ? toNum(((price - yClose) / yClose) * 100) : 0);
        const vol = Math.max(50, Math.round(Number(p[6] || 0) / 100));
        const turnover = toNum(p[37], toNum((price * vol) / 100));

        quote = {
          symbol: def.symbol,
          name: def.name,
          price,
          yesterdayClose: yClose,
          todayOpen: tOpen,
          high,
          low,
          changeAmount: chgAmt,
          changePercent: chgPct,
          volume: vol,
          turnover,
          updatedAt: now,
          bid1Price: toNum(p[9] || price),
          bid1Volume: Math.max(1, Math.round(Number(p[10] || 10) / 100)),
          ask1Price: toNum(p[19] || price + 0.01),
          ask1Volume: Math.max(1, Math.round(Number(p[20] || 10) / 100)),
          isTrading: true,
        };
      }

      parsedMap.set(def.symbol, quote);
    }

    if (parsedMap.size > 0) {
      quotesCache = {
        quotes: parsedMap,
        timestamp: now,
      };
      return Array.from(parsedMap.values());
    }
  } catch (err) {
    log.warn('获取实时行情失败，使用现有缓存或基准报价', { err });
  }

  // 兜底返回上一有效快照或基准报价
  if (quotesCache.quotes.size > 0) {
    return Array.from(quotesCache.quotes.values());
  }

  const fallbacks: StockQuote[] = STOCK_DEFINITIONS.map((def) => {
    const base = BASELINE_PRICES[def.symbol] ?? { price: 100, yesterdayClose: 100, high: 102, low: 98, open: 100 };
    return {
      symbol: def.symbol,
      name: def.name,
      price: base.price,
      yesterdayClose: base.yesterdayClose,
      todayOpen: base.open,
      high: base.high,
      low: base.low,
      changeAmount: toNum(base.price - base.yesterdayClose),
      changePercent: toNum(((base.price - base.yesterdayClose) / base.yesterdayClose) * 100),
      volume: 8888,
      turnover: toNum((base.price * 8888) / 10_000),
      updatedAt: now,
      bid1Price: base.price,
      bid1Volume: 50,
      ask1Price: toNum(base.price + 0.05),
      ask1Volume: 50,
      isTrading: false,
    };
  });

  for (const q of fallbacks) {
    quotesCache.quotes.set(q.symbol, q);
  }
  quotesCache.timestamp = now;
  return fallbacks;
}

/**
 * 获取单支标的的最新即时价格（交易校验专用）
 */
export async function getStockLivePrice(symbol: string): Promise<{ price: number; quote: StockQuote }> {
  const quotes = await getLiveStockQuotes();
  const q = quotes.find((item) => item.symbol === symbol);
  if (!q) {
    const base = BASELINE_PRICES[symbol]?.price ?? 100;
    return {
      price: base,
      quote: {
        symbol,
        name: symbol,
        price: base,
        yesterdayClose: base,
        todayOpen: base,
        high: base,
        low: base,
        changeAmount: 0,
        changePercent: 0,
        volume: 1000,
        turnover: 10,
        updatedAt: Date.now(),
        isTrading: false,
      },
    };
  }
  return { price: q.price, quote: q };
}

/**
 * 获取标的分时走势图（Eastmoney 实盘分时或高保真分时走势）
 */
export async function getStockTrends(symbol: string): Promise<StockTrendPoint[]> {
  const { quote } = await getStockLivePrice(symbol);
  const def = STOCK_DEFINITIONS.find((s) => s.symbol === symbol);
  const secid = def?.market === 'SH' ? `1.${def.symbol}` : def?.market === 'SZ' ? `0.${def.symbol}` : null;

  if (secid) {
    try {
      const url = `https://push2his.eastmoney.com/api/qt/stock/trends2/get?secid=${secid}&fields1=f1,f2,f3,f4&fields2=f51,f52,f53,f54,f55,f56,f57,f58`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const json = (await res.json()) as { data?: { trends?: string[] } };
        const trends = json?.data?.trends;
        if (Array.isArray(trends) && trends.length > 0) {
          return trends.map((item) => {
            // item 格式: "2026-11-20 09:30,1450.89,1451.00,1452.00,1450.00,100,145100,1451.2"
            const parts = item.split(',');
            const timeStr = parts[0]?.split(' ')[1] || '09:30';
            const price = Number(parts[2] || parts[1] || quote.price);
            const avgPrice = Number(parts[7] || price);
            const volume = Number(parts[5] || 10);
            return {
              time: timeStr,
              price,
              avgPrice,
              volume,
            };
          });
        }
      }
    } catch {
      // 网络超时走自适应合成
    }
  }

  // 若无真实分时数据（如现货或网络休市），基于今开、最高、最低、现价合成平滑高保真 60 点分时走势
  const points: StockTrendPoint[] = [];
  const basePrice = quote.todayOpen || quote.yesterdayClose;
  const currentPrice = quote.price;
  const count = 60;

  for (let i = 0; i <= count; i++) {
    const progress = i / count;
    // 伪随机微噪平滑过渡
    const noise = Math.sin(i * 0.4) * (quote.high - quote.low) * 0.15;
    const interp = basePrice + (currentPrice - basePrice) * progress + noise;
    const clamped = Math.max(quote.low, Math.min(quote.high, Number(interp.toFixed(2))));

    const hour = 9 + Math.floor((30 + i * 2) / 60);
    const minute = (30 + i * 2) % 60;
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    points.push({
      time,
      price: clamped,
      avgPrice: Number(((basePrice + clamped) / 2).toFixed(2)),
      volume: Math.max(10, Math.round(quote.volume / 60 + Math.sin(i) * 5)),
    });
  }

  return points;
}

const EASTMONEY_SECIDS: Record<string, string> = {
  XAU: '122.XAU',
  XAG: '122.XAG',
  XPT: '102.PL00Y',
  '600519': '1.600519',
  '000858': '0.000858',
  '002594': '0.002594',
  '300750': '0.300750',
  '601318': '1.601318',
  '600036': '1.600036',
  '688981': '1.688981',
  // 20 支新增标的对应东财 secid
  XPD: '102.PA00Y',
  CL: '102.CL00Y',
  '601899': '1.601899',
  '000568': '0.000568',
  '600809': '1.600809',
  '603288': '1.603288',
  '600887': '1.600887',
  '601012': '1.601012',
  '600438': '1.600438',
  '002466': '0.002466',
  '601127': '1.601127',
  '600941': '1.600941',
  '002230': '0.002230',
  '300059': '0.300059',
  '000725': '0.000725',
  '600584': '1.600584',
  '300418': '0.300418',
  '600030': '1.600030',
  '601398': '1.601398',
  '601857': '1.601857',
};

const KLT_MAP: Record<KlinePeriod, number> = {
  day: 101,
  week: 102,
  month: 103,
  year: 105,
};

/**
 * 获取标的蜡烛图 K 线数据（日K、周K、月K、年K）
 */
export async function getStockKlines(
  symbol: string,
  period: KlinePeriod = 'day',
): Promise<StockKlineItem[]> {
  const { quote } = await getStockLivePrice(symbol);
  const secid = EASTMONEY_SECIDS[symbol];
  const klt = KLT_MAP[period] || 101;

  if (secid) {
    try {
      const url = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=${klt}&fqt=1&lmt=60&end=20500101&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (res.ok) {
        const json = (await res.json()) as { data?: { klines?: string[] } };
        const klines = json?.data?.klines;
        if (Array.isArray(klines) && klines.length > 0) {
          const list: StockKlineItem[] = klines.map((raw) => {
            const p = raw.split(',');
            return {
              date: p[0] || '',
              open: toNum(p[1], quote.todayOpen),
              close: toNum(p[2], quote.price),
              high: toNum(p[3], quote.high),
              low: toNum(p[4], quote.low),
              volume: Math.max(1, Math.round(Number(p[5] || 100))),
              changePercent: toNum(p[8], 0),
            };
          });

          // 计算 MA5, MA10, MA20
          for (let i = 0; i < list.length; i++) {
            if (i >= 4) {
              const slice5 = list.slice(i - 4, i + 1);
              list[i]!.ma5 = toNum(slice5.reduce((sum, item) => sum + item.close, 0) / 5);
            }
            if (i >= 9) {
              const slice10 = list.slice(i - 9, i + 1);
              list[i]!.ma10 = toNum(slice10.reduce((sum, item) => sum + item.close, 0) / 10);
            }
            if (i >= 19) {
              const slice20 = list.slice(i - 19, i + 1);
              list[i]!.ma20 = toNum(slice20.reduce((sum, item) => sum + item.close, 0) / 20);
            }
          }
          return list;
        }
      }
    } catch {
      // 网络波动平滑兜底
    }
  }

  // 兜底高保真模拟生成 40 根 K 线
  const list: StockKlineItem[] = [];
  const count = 40;
  let curr = quote.price * (period === 'year' ? 0.6 : period === 'month' ? 0.85 : 0.95);

  for (let i = 0; i < count; i++) {
    const isLast = i === count - 1;
    const open = isLast ? (quote.todayOpen || quote.price) : curr;
    const delta = (Math.random() - 0.48) * (quote.price * 0.03);
    const close = isLast ? quote.price : toNum(open + delta);
    const high = toNum(Math.max(open, close) + Math.random() * (quote.price * 0.015));
    const low = toNum(Math.min(open, close) - Math.random() * (quote.price * 0.015));
    const chgPct = open > 0 ? toNum(((close - open) / open) * 100) : 0;

    let dateLabel = `D-${count - i}`;
    if (period === 'day') {
      const d = new Date(Date.now() - (count - 1 - i) * 86400_000);
      dateLabel = `${d.getMonth() + 1}/${d.getDate()}`;
    } else if (period === 'week') {
      dateLabel = `W${i + 1}`;
    } else if (period === 'month') {
      dateLabel = `M${i + 1}`;
    } else if (period === 'year') {
      dateLabel = `${2026 - (count - 1 - i)}`;
    }

    list.push({
      date: dateLabel,
      open,
      close,
      high,
      low,
      volume: Math.max(10, Math.round(quote.volume / 10 + Math.random() * 200)),
      changePercent: chgPct,
    });
    curr = close;
  }

  for (let i = 0; i < list.length; i++) {
    if (i >= 4) {
      const slice5 = list.slice(i - 4, i + 1);
      list[i]!.ma5 = toNum(slice5.reduce((sum, item) => sum + item.close, 0) / 5);
    }
    if (i >= 9) {
      const slice10 = list.slice(i - 9, i + 1);
      list[i]!.ma10 = toNum(slice10.reduce((sum, item) => sum + item.close, 0) / 10);
    }
    if (i >= 19) {
      const slice20 = list.slice(i - 19, i + 1);
      list[i]!.ma20 = toNum(slice20.reduce((sum, item) => sum + item.close, 0) / 20);
    }
  }

  return list;
}
