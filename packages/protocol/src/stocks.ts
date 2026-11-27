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

/** 玩家持仓记录（支持做多与做空双向持仓） */
export interface StockHolding {
  symbol: string;
  side?: 'long' | 'short'; // 默认 'long' 做多，'short' 为融券做空
  shares: number;         // 持股数量（股/手）
  avgCost: number;        // 持仓成本均价 / 开空均价
  currentPrice: number;   // 当前最新市价
  marketValue: number;    // 持仓市值 / 空单保证金含浮盈净值
  floatingPnl: number;    // 浮动盈亏额
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
  action: 'buy' | 'sell' | 'short_open' | 'short_close';
  shares: number;
  price: number;
  totalAmount: number;    // 成交总额（筹码）
  fee: number;            // 手续费/印花税（筹码）
  realizedPnl: number;    // 平仓时的实现盈亏（筹码，开仓时为0）
  createdAt: number;
}

/** 买入/卖出请求入参 */
export interface StockTradeInput {
  symbol: string;
  shares: number;         // 买入或卖出的股数/手数（必须为正整数）
  side?: 'long' | 'short';
}

/** 交易结果响应 */
export interface StockTradeResult {
  ok: boolean;
  orderId: string;
  symbol: string;
  stockName: string;
  action: 'buy' | 'sell' | 'short_open' | 'short_close';
  shares: number;
  price: number;
  totalAmount: number;
  fee: number;
  realizedPnl: number;
  balanceAfter: number;   // 交易后玩家可用欢乐豆余额
  message: string;
}

/** 股神收益排行榜单行 */
export interface StockLeaderboardEntry {
  rank: number;
  userId: string;
  nickname: string;
  avatar: string | null;
  equippedFrame: string;
  totalMarketValue: number;
  totalFloatingPnl: number;
  totalRealizedPnl: number;
  totalStockScore: number;
}

/** 标的走势分时点 */
export interface StockTrendPoint {
  time: string;           // '09:30'
  price: number;
  avgPrice: number;
  volume: number;
}

export type KlinePeriod = 'day' | 'week' | 'month' | 'year';

/** 专业蜡烛图 K 线单柱数据结构（日K、周K、月K、年K） */
export interface StockKlineItem {
  date: string;           // '2026-11-20' 或 '2026-W46' 或 '2026-11' 或 '2026'
  open: number;           // 开盘价
  close: number;          // 收盘价
  high: number;           // 最高价
  low: number;            // 最低价
  volume: number;         // 成交量（手）
  changePercent: number;  // 涨跌幅（%）
  ma5?: number;           // 5周期均线
  ma10?: number;          // 10周期均线
  ma20?: number;          // 20周期均线
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
  // ---------- 20 支新增全行业精选标的（涵盖大宗能源、消费食品、锂电光伏、AI芯片科技与金融基石） ----------
  {
    symbol: 'XPD',
    displayCode: 'XPD/USD',
    name: '现货钯金（纽约钯金）',
    shortName: '现货钯金',
    category: 'metal',
    categoryLabel: '贵金属',
    market: 'COMMODITY',
    querySymbol: 'hf_XPD',
    unitName: '手',
    lotSize: 1,
    priceScale: 1,
    description: '工业维他命与高端汽车尾气净化催化剂核心金属，稀缺度远超黄金，弹性极大。',
  },
  {
    symbol: 'CL',
    displayCode: 'WTI/USD',
    name: '纽约原油（WTI轻质原油）',
    shortName: 'WTI原油',
    category: 'metal',
    categoryLabel: '贵金属',
    market: 'COMMODITY',
    querySymbol: 'hf_CL',
    unitName: '桶',
    lotSize: 1,
    priceScale: 10,
    description: '全球工业血液与大宗商品之母，地缘政治与宏观经济风向标，波动剧烈。',
  },
  {
    symbol: '601899',
    displayCode: '601899.SH',
    name: '紫金矿业（铜金巨头）',
    shortName: '紫金矿业',
    category: 'metal',
    categoryLabel: '贵金属',
    market: 'SH',
    querySymbol: 'sh601899',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '中国规模最大的跨国矿业巨头，坐拥海内外顶级金、铜、锂矿山核心资源。',
  },
  {
    symbol: '000568',
    displayCode: '000568.SZ',
    name: '泸州老窖（浓香国窖）',
    shortName: '泸州老窖',
    category: 'liquor',
    categoryLabel: '白酒消费',
    market: 'SZ',
    querySymbol: 'sz000568',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '浓香鼻祖与活态双国宝，国窖1573驰名中外，高端商务宴请顶流首选。',
  },
  {
    symbol: '600809',
    displayCode: '600809.SH',
    name: '山西汾酒（清香鼻祖）',
    shortName: '山西汾酒',
    category: 'liquor',
    categoryLabel: '白酒消费',
    market: 'SH',
    querySymbol: 'sh600809',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '清香型白酒龙头代表，青花系列全国化扩张势头强劲，千年底蕴深厚。',
  },
  {
    symbol: '603288',
    displayCode: '603288.SH',
    name: '海天味业（调味之王）',
    shortName: '海天味业',
    category: 'liquor',
    categoryLabel: '白酒消费',
    market: 'SH',
    querySymbol: 'sh603288',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '中国调味品行业绝对巨擘，老字号酱油酿造，渗透全国千家万户餐桌。',
  },
  {
    symbol: '600887',
    displayCode: '600887.SH',
    name: '伊利股份（乳业霸主）',
    shortName: '伊利股份',
    category: 'liquor',
    categoryLabel: '白酒消费',
    market: 'SH',
    querySymbol: 'sh600887',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '亚洲乳业第一霸主，稳居全球乳业第一阵营，全品类全渠道深度护城河。',
  },
  {
    symbol: '601012',
    displayCode: '601012.SH',
    name: '隆基绿能（光伏硅片）',
    shortName: '隆基绿能',
    category: 'ev',
    categoryLabel: '新能源',
    market: 'SH',
    querySymbol: 'sh601012',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '全球单晶硅片与高效光伏电池组件领军企业，致力于绿电与零碳转型。',
  },
  {
    symbol: '600438',
    displayCode: '600438.SH',
    name: '通威股份（高纯晶硅）',
    shortName: '通威股份',
    category: 'ev',
    categoryLabel: '新能源',
    market: 'SH',
    querySymbol: 'sh600438',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '高纯晶硅与太阳能电池双龙头，“农业+光伏”双轮驱动，全球出货名列前茅。',
  },
  {
    symbol: '002466',
    displayCode: '002466.SZ',
    name: '天齐锂业（锂能先锋）',
    shortName: '天齐锂业',
    category: 'ev',
    categoryLabel: '新能源',
    market: 'SZ',
    querySymbol: 'sz002466',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '全球领先的以锂为核心的新能源材料企业，布局全球最优质格林布什锂矿。',
  },
  {
    symbol: '601127',
    displayCode: '601127.SH',
    name: '赛力斯（智能新能源）',
    shortName: '赛力斯',
    category: 'ev',
    categoryLabel: '新能源',
    market: 'SH',
    querySymbol: 'sh601127',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '深度携手华为联合打造问界系列智选豪华SUV，智能座舱与智驾领跑行业。',
  },
  {
    symbol: '600941',
    displayCode: '600941.SH',
    name: '中国移动（通信航母）',
    shortName: '中国移动',
    category: 'tech',
    categoryLabel: '硬科技',
    market: 'SH',
    querySymbol: 'sh600941',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '全球网络规模与客户规模最大的电信运营商，算力网络与数字经济中枢基石。',
  },
  {
    symbol: '002230',
    displayCode: '002230.SZ',
    name: '科大讯飞（AI智能）',
    shortName: '科大讯飞',
    category: 'tech',
    categoryLabel: '硬科技',
    market: 'SZ',
    querySymbol: 'sz002230',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '亚太地区知名的智能语音与通用人工智能龙头，星火大模型赋能千行百业。',
  },
  {
    symbol: '300059',
    displayCode: '300059.SZ',
    name: '东方财富（金融科技）',
    shortName: '东方财富',
    category: 'tech',
    categoryLabel: '硬科技',
    market: 'SZ',
    querySymbol: 'sz300059',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '中国领先的互联网财富管理与证券经纪平台，“牛市旗手”核心风向标。',
  },
  {
    symbol: '000725',
    displayCode: '000725.SZ',
    name: '京东方A（半导体显示）',
    shortName: '京东方A',
    category: 'tech',
    categoryLabel: '硬科技',
    market: 'SZ',
    querySymbol: 'sz000725',
    unitName: '股',
    lotSize: 1,
    priceScale: 10,
    description: '全球半导体显示器件绝对霸主，每四块显示屏就有一块来自京东方。',
  },
  {
    symbol: '600584',
    displayCode: '600584.SH',
    name: '长电科技（先进封测）',
    shortName: '长电科技',
    category: 'tech',
    categoryLabel: '硬科技',
    market: 'SH',
    querySymbol: 'sh600584',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '全球排名前列的集成电路封装测试巨头，Chiplet与高密度封装核心支撑。',
  },
  {
    symbol: '300418',
    displayCode: '300418.SZ',
    name: '昆仑万维（AGI全栈）',
    shortName: '昆仑万维',
    category: 'tech',
    categoryLabel: '硬科技',
    market: 'SZ',
    querySymbol: 'sz300418',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '全栈布局AGI大模型、AI音乐、AI搜索及海外社交娱乐的全球化科技平台。',
  },
  {
    symbol: '600030',
    displayCode: '600030.SH',
    name: '中信证券（券商一哥）',
    shortName: '中信证券',
    category: 'finance',
    categoryLabel: '金融蓝筹',
    market: 'SH',
    querySymbol: 'sh600030',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '中国投资银行与证券行业绝对领头羊，资本金雄厚，全面领跑大投行业务。',
  },
  {
    symbol: '601398',
    displayCode: '601398.SH',
    name: '工商银行（宇宙大行）',
    shortName: '工商银行',
    category: 'finance',
    categoryLabel: '金融蓝筹',
    market: 'SH',
    querySymbol: 'sh601398',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '全球资产规模第一商业银行，高股息与万亿资本坚不可摧，经济定海神针。',
  },
  {
    symbol: '601857',
    displayCode: '601857.SH',
    name: '中国石油（能源基石）',
    shortName: '中国石油',
    category: 'finance',
    categoryLabel: '金融蓝筹',
    market: 'SH',
    querySymbol: 'sh601857',
    unitName: '股',
    lotSize: 1,
    priceScale: 1,
    description: '中国油气行业龙头与特大型央企，上游勘探与天然气业务盈利能力强劲。',
  },
];
