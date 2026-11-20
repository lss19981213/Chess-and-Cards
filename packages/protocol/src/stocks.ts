/**
 * 改命股市 — 股票标的元数据、行情与交易协议定义
 */

export type StockCategory = 'metal' | 'liquor' | 'ev' | 'tech' | 'finance';

export interface StockMeta {
  symbol: string;         // 系统内部标识代码，如 'XAU', 'XAG', 'XPT', '600519', '000858', '002594', '300750', '601318', '600036', '688981'
  displayCode: string;    // 展示代码，如 'XAU/USD', '600519.SH'
  name: string;           // 标的名称，如 '现货黄金', '贵州茅台'
  shortName: string;      // 简短名称
  category: StockCategory;// 类别
  categoryLabel: string;  // 类别文案
  market: 'COMMODITY' | 'SH' | 'SZ';
  querySymbol: string;    // 外部行情 API 标的代码，如 'hf_XAU', 'sh600519'
  unitName: string;       // 交易单位名：'手' 或 '股'
  lotSize: number;        // 1手包含的基础单位数，如 1手=100股 或 1手=1盎司
  priceScale: number;     // 价格对欢乐豆的折算乘数（1点报价对应多少欢乐豆，默认 1:1，让股价直观对应筹码）
  description: string;    // 标的介绍
}

/** 实时行情快照 */
export interface StockQuote {
  symbol: string;
  name: string;
  price: number;          // 当前最新成交价
  yesterdayClose: number; // 昨收价
  todayOpen: number;      // 今开价
  high: number;           // 最高价
  low: number;            // 最低价
  changeAmount: number;   // 涨跌额
  changePercent: number;  // 涨跌幅（百分比，如 +2.35 或 -1.45）
  volume: number;         // 成交量（手）
  turnover: number;       // 成交金额（万元）
  updatedAt: number;      // 行情更新时间戳
  bid1Price?: number;     // 买一价
  bid1Volume?: number;    // 买一量
  ask1Price?: number;     // 卖一价
  ask1Volume?: number;    // 卖一量
  isTrading: boolean;     // 是否在交易时段
}

/** 玩家持仓记录 */
export interface StockHolding {
  symbol: string;
  shares: number;         // 持股数量（股/手）
  avgCost: number;        // 持仓成本均价
  currentPrice: number;   // 当前最新市价
  marketValue: number;    // 持仓市值（shares * currentPrice）
  floatingPnl: number;    // 浮动盈亏额（marketValue - shares * avgCost）
  floatingPnlPercent: number; // 浮动盈亏率（%）
  todayPnl: number;       // 今日盈亏额（基于昨收价变动）
  stockMeta: StockMeta;   // 标的元数据
}

/** 股市交易订单流水记录 */
export interface StockOrder {
  id: string;
  userId: string;
  symbol: string;
  stockName: string;
  action: 'buy' | 'sell';
  shares: number;
  price: number;
  totalAmount: number;    // 成交总额（筹码）
  fee: number;            // 手续费/印花税（筹码）
  realizedPnl: number;    // 卖出时的实现盈亏（筹码，买入时为0）
  createdAt: number;
}

/** 买入/卖出请求入参 */
export interface StockTradeInput {
  symbol: string;
  shares: number;         // 买入或卖出的股数/手数（必须为正整数）
}

/** 交易结果响应 */
export interface StockTradeResult {
  ok: boolean;
  orderId: string;
  symbol: string;
  stockName: string;
  action: 'buy' | 'sell';
  shares: number;
  price: number;
  totalAmount: number;
  fee: number;
  realizedPnl: number;
  balanceAfter: number;   // 交易后玩家可用欢乐豆余额
  message: string;
}

/** 标的走势分时点 */
export interface StockTrendPoint {
  time: string;           // '09:30'
  price: number;
  avgPrice: number;
  volume: number;
}

/**
 * 前期精选 10 支核心标的配置：
 * 涵盖：黄金、白银、铂金（大宗贵金属避险）；贵州茅台、五粮液（白酒双雄消费）；
 * 比亚迪、宁德时代（新能源核心）；中国平安、招商银行（金融蓝筹）；中芯国际（硬科技芯片）。
 */
export const STOCK_DEFINITIONS: StockMeta[] = [
  {
    symbol: 'XAU',
    displayCode: 'XAU/USD',
    name: '现货黄金（伦敦金）',
    shortName: '现货黄金',
    category: 'metal',
    categoryLabel: '贵金属',
    market: 'COMMODITY',
    querySymbol: 'hf_XAU',
    unitName: '手',
    lotSize: 1,
    priceScale: 1,
    description: '全球公认终极硬通货与避险之王，抗通胀核心资产，国际现货24小时连续交易。',
  },
  {
    symbol: 'XAG',
    displayCode: 'XAG/USD',
    name: '现货白银（伦敦银）',
    shortName: '现货白银',
    category: 'metal',
    categoryLabel: '贵金属',
    market: 'COMMODITY',
    querySymbol: 'hf_XAG',
    unitName: '手',
    lotSize: 1,
    priceScale: 10, // 白银点位适中，乘数微调让筹码感知更强
    description: '兼具金融避险与工业制造双重属性，弹性充沛，素有贵金属杠杆精灵之称。',
  },
  {
    symbol: 'XPT',
    displayCode: 'XPT/USD',
    name: '现货铂金（纽约铂金）',
    shortName: '现货铂金',
    category: 'metal',
    categoryLabel: '贵金属',
    market: 'COMMODITY',
    querySymbol: 'hf_XPT',
    unitName: '手',
    lotSize: 1,
    priceScale: 1,
    description: '自然界极为稀有的贵重金属，广泛用于尖端氢能电解槽与高端工业催化。',
  },
  {
    symbol: '600519',
    displayCode: '600519.SH',
    name: '贵州茅台（白酒之王）',
    shortName: '贵州茅台',
    category: 'liquor',
    categoryLabel: '白酒消费',
    market: 'SH',
    querySymbol: 'sh600519',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: 'A股长牛信仰与终极护城河龙头，酱香型白酒独门霸主，现金流与品牌价值登峰造极。',
  },
  {
    symbol: '000858',
    displayCode: '000858.SZ',
    name: '五粮液（浓香泰斗）',
    shortName: '五粮液',
    category: 'liquor',
    categoryLabel: '白酒消费',
    market: 'SZ',
    querySymbol: 'sz000858',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '浓香型白酒开山鼻祖，名列高端白酒双雄，集五粮精华之大成，历久弥香。',
  },
  {
    symbol: '002594',
    displayCode: '002594.SZ',
    name: '比亚迪（新能源龙头）',
    shortName: '比亚迪',
    category: 'ev',
    categoryLabel: '新能源',
    market: 'SZ',
    querySymbol: 'sz002594',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '全球新能源汽车销量冠军，掌握刀片电池与超级混动核心全产业链自主技术。',
  },
  {
    symbol: '300750',
    displayCode: '300750.SZ',
    name: '宁德时代（电池霸主）',
    shortName: '宁德时代',
    category: 'ev',
    categoryLabel: '新能源',
    market: 'SZ',
    querySymbol: 'sz300750',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '全球动力电池与储能系统绝对霸主，“宁王”出征，提供全球绿色动力心脏。',
  },
  {
    symbol: '601318',
    displayCode: '601318.SH',
    name: '中国平安（综合金融）',
    shortName: '中国平安',
    category: 'finance',
    categoryLabel: '金融蓝筹',
    market: 'SH',
    querySymbol: 'sh601318',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '中国领先的综合金融服务航母，保险、银行、资产管理协同驱动，分红丰厚稳健。',
  },
  {
    symbol: '600036',
    displayCode: '600036.SH',
    name: '招商银行（零售之王）',
    shortName: '招商银行',
    category: 'finance',
    categoryLabel: '金融蓝筹',
    market: 'SH',
    querySymbol: 'sh600036',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '国内零售银行无冕之王，财富管理与客群粘性首屈一指，资产质量穿越牛熊。',
  },
  {
    symbol: '688981',
    displayCode: '688981.SH',
    name: '中芯国际（晶圆代工）',
    shortName: '中芯国际',
    category: 'tech',
    categoryLabel: '硬科技',
    market: 'SH',
    querySymbol: 'sh688981',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '中国内地规模最大、技术最先进的半导体晶圆代工龙头，自主可控核心支柱。',
  },
];
