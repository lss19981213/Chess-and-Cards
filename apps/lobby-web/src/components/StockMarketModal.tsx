import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { StockHolding, StockMeta, StockOrder, StockQuote, StockTrendPoint } from '@cc/protocol';
import { api, type User } from '../api';
import { audio } from '../audio';

interface Props {
  user: User;
  onBalanceChange?: (newBalance: number) => void;
  onUserUpdate?: (patch: Partial<User>) => void;
  onClose: () => void;
}

type TabType = 'market' | 'holdings' | 'orders';
type TradeMode = 'buy' | 'sell';

export function StockMarketModal({ user, onBalanceChange, onUserUpdate, onClose }: Props) {
  // 基础数据状态
  const [quotes, setQuotes] = useState<StockQuote[]>([]);
  const [definitions, setDefinitions] = useState<StockMeta[]>([]);
  const [holdings, setHoldings] = useState<StockHolding[]>([]);
  const [orders, setOrders] = useState<StockOrder[]>([]);
  const [summary, setSummary] = useState({
    totalAssets: user.balance,
    availableBalance: user.balance,
    totalMarketValue: 0,
    totalFloatingPnl: 0,
    totalFloatingPercent: 0,
    totalTodayPnl: 0,
  });

  // 界面状态
  const [activeTab, setActiveTab] = useState<TabType>('market');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('600519'); // 默认贵州茅台
  const [trends, setTrends] = useState<StockTrendPoint[]>([]);
  const [loadingTrends, setLoadingTrends] = useState<boolean>(false);

  // 交易面板状态
  const [tradeMode, setTradeMode] = useState<TradeMode>('buy');
  const [tradeShares, setTradeShares] = useState<number>(100);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  // 倒计时与刷新状态
  const [countdown, setCountdown] = useState<number>(4);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const showToast = (msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 3000);
  };

  // 获取行情与标的
  const fetchQuotes = async (silent = false) => {
    if (!silent) setIsRefreshing(true);
    try {
      const res = await api.getStockQuotes();
      if (res && res.quotes) {
        setQuotes(res.quotes);
        setDefinitions(res.definitions);
      }
    } catch {
      // 容灾忽略
    } finally {
      if (!silent) setIsRefreshing(false);
    }
  };

  // 获取持仓与资产
  const fetchHoldings = async () => {
    try {
      const res = await api.getStockHoldings();
      if (res) {
        setHoldings(res.holdings || []);
        if (res.summary) {
          setSummary(res.summary);
          if (res.summary.availableBalance !== undefined && res.summary.availableBalance !== user.balance) {
            onBalanceChange?.(res.summary.availableBalance);
            onUserUpdate?.({ balance: res.summary.availableBalance });
          }
        }
      }
    } catch {
      // 容灾忽略
    }
  };

  // 获取历史订单
  const fetchOrders = async () => {
    try {
      const res = await api.getStockOrders(50);
      if (res && res.orders) {
        setOrders(res.orders);
      }
    } catch {
      // 容灾忽略
    }
  };

  // 获取选中标的分时走势
  const fetchTrends = async (symbol: string) => {
    setLoadingTrends(true);
    try {
      const res = await api.getStockTrends(symbol);
      if (res && res.trends) {
        setTrends(res.trends);
      }
    } catch {
      // 容灾忽略
    } finally {
      setLoadingTrends(false);
    }
  };

  // 初始化加载与定时 4 秒刷新
  useEffect(() => {
    void fetchQuotes();
    void fetchHoldings();
    void fetchOrders();

    const interval = window.setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          void fetchQuotes(true);
          void fetchHoldings();
          return 4;
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  // 当选中的标的改变时，重新拉取分时走势
  useEffect(() => {
    if (selectedSymbol) {
      void fetchTrends(selectedSymbol);
    }
  }, [selectedSymbol]);

  // 当前选中的股票定义与行情快照
  const currentMeta = useMemo(() => {
    return definitions.find((d) => d.symbol === selectedSymbol) || definitions[0];
  }, [definitions, selectedSymbol]);

  const currentQuote = useMemo(() => {
    return quotes.find((q) => q.symbol === selectedSymbol);
  }, [quotes, selectedSymbol]);

  const currentHolding = useMemo(() => {
    return holdings.find((h) => h.symbol === selectedSymbol);
  }, [holdings, selectedSymbol]);

  // 标的分类过滤
  const filteredDefinitions = useMemo(() => {
    if (categoryFilter === 'all') return definitions;
    return definitions.filter((d) => d.category === categoryFilter);
  }, [definitions, categoryFilter]);

  // 绘制专业分时走势图 (Canvas)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || trends.length === 0 || !currentQuote) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;

    // 清空背景
    ctx.clearRect(0, 0, w, h);

    const yClose = currentQuote.yesterdayClose || currentQuote.todayOpen || 100;
    const prices = trends.map((t) => t.price);
    const minP = Math.min(yClose * 0.99, ...prices);
    const maxP = Math.max(yClose * 1.01, ...prices);
    const range = Math.max(maxP - minP, yClose * 0.02);

    const getY = (val: number) => {
      return h - 30 - ((val - minP) / range) * (h - 50);
    };

    // 绘制昨收基准参考线
    const zeroY = getY(yClose);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, zeroY);
    ctx.lineTo(w - 10, zeroY);
    ctx.stroke();

    // 标注昨收价
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(yClose.toFixed(2), 35, zeroY + 3);
    ctx.restore();

    // 绘制分时折线与下方向渐变填充
    const isUp = (currentQuote.changePercent ?? 0) >= 0;
    const lineColor = isUp ? '#ff4d4f' : '#52c41a';
    const gradColor = isUp ? 'rgba(255, 77, 79, 0.25)' : 'rgba(82, 196, 26, 0.25)';

    const stepX = (w - 55) / Math.max(1, trends.length - 1);

    ctx.save();
    ctx.beginPath();
    trends.forEach((t, i) => {
      const x = 45 + i * stepX;
      const y = getY(t.price);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    // 渐变填充背景
    const fillPath = new Path2D();
    fillPath.moveTo(45, getY(trends[0]!.price));
    trends.forEach((t, i) => {
      fillPath.lineTo(45 + i * stepX, getY(t.price));
    });
    fillPath.lineTo(45 + (trends.length - 1) * stepX, h - 25);
    fillPath.lineTo(45, h - 25);
    fillPath.closePath();

    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, gradColor);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.fill(fillPath);

    // 描画主折线
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // 最后一个点绘制脉冲高亮呼吸圆
    const lastX = 45 + (trends.length - 1) * stepX;
    const lastY = getY(trends[trends.length - 1]!.price);

    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
    ctx.stroke();

    // 绘制底部时间刻度
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('09:30', 45, h - 8);
    ctx.textAlign = 'center';
    ctx.fillText('11:30 / 13:00', w / 2, h - 8);
    ctx.textAlign = 'right';
    ctx.fillText('15:00', w - 12, h - 8);

    ctx.restore();
  }, [trends, currentQuote]);

  // 计算交易金额预估
  const estimatedPrice = currentQuote?.price || 100;
  const rawTotalCost = Math.round(tradeShares * estimatedPrice);
  const buyFee = Math.max(1, Math.floor(rawTotalCost * 0.0003));
  const estimatedBuyTotal = rawTotalCost + buyFee;

  const sellFee = Math.max(1, Math.floor(rawTotalCost * 0.001));
  const estimatedSellNet = Math.max(0, rawTotalCost - sellFee);

  // 快捷设置买入/卖出数量
  const handleQuickRatio = (ratio: number) => {
    if (tradeMode === 'buy') {
      const maxCanBuy = Math.floor(summary.availableBalance / (estimatedPrice * 1.0003));
      const amount = Math.max(1, Math.floor(maxCanBuy * ratio));
      setTradeShares(amount);
    } else {
      const maxShares = currentHolding?.shares || 0;
      const amount = Math.max(1, Math.floor(maxShares * ratio));
      setTradeShares(amount);
    }
  };

  // 执行市价买入
  const handleBuy = async () => {
    if (!currentMeta) return;
    if (tradeShares <= 0) {
      showToast('⚠️ 买入数量必须大于 0！');
      return;
    }
    if (summary.availableBalance < estimatedBuyTotal) {
      showToast('❌ 可用欢乐豆不足，请调整买入数量或补充筹码！');
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.buyStock(currentMeta.symbol, tradeShares);
      if (res && res.ok) {
        audio.play('coin');
        showToast(res.message);
        onBalanceChange?.(res.balanceAfter);
        onUserUpdate?.({ balance: res.balanceAfter });
        void fetchHoldings();
        void fetchOrders();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '买入失败';
      showToast(`❌ ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  // 执行市价卖出
  const handleSell = async () => {
    if (!currentMeta) return;
    const holdShares = currentHolding?.shares || 0;
    if (holdShares <= 0) {
      showToast(`⚠️ 您尚未持有【${currentMeta.name}】，无法卖出！`);
      return;
    }
    if (tradeShares <= 0 || tradeShares > holdShares) {
      showToast(`⚠️ 卖出数量超出持仓（当前最多可卖 ${holdShares} 股/手）！`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.sellStock(currentMeta.symbol, tradeShares);
      if (res && res.ok) {
        audio.play('win');
        showToast(res.message);
        onBalanceChange?.(res.balanceAfter);
        onUserUpdate?.({ balance: res.balanceAfter });
        void fetchHoldings();
        void fetchOrders();
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '卖出失败';
      showToast(`❌ ${msg}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="stock-modal-backdrop" onClick={onClose}>
      <div className="stock-modal-window" onClick={(e) => e.stopPropagation()}>
        {/* 顶部标题与资产总览卡片群 */}
        <header className="stock-modal-header">
          <div className="stock-header-title-box">
            <div className="stock-title-badge">
              <span className="stock-pulse-dot" />
              <span>真实行情实盘交割</span>
            </div>
            <h2 className="stock-modal-title">📈 改命股市 · 财富重构交易中心</h2>
            <p className="stock-modal-subtitle">
              前期精选 10 支大宗黄金白银铂金与核心白酒消费龙头 · 真实股市实时数据 · T+0随时买卖改命
            </p>
          </div>

          <div className="stock-header-tools">
            <button
              type="button"
              className={`stock-refresh-btn ${isRefreshing ? 'is-spinning' : ''}`}
              onClick={() => {
                void fetchQuotes();
                void fetchHoldings();
              }}
              title="点击立即强制同步最新行情"
            >
              <span className="refresh-icon">🔄</span>
              <span>{countdown}s 后同步</span>
            </button>
            <button type="button" className="stock-close-btn" onClick={onClose} title="返回大厅">
              ✕
            </button>
          </div>
        </header>

        {/* 玩家资产四维全景卡片 */}
        <section className="stock-portfolio-strip">
          <div className="portfolio-card portfolio-card--primary">
            <div className="card-label">改命总资产 (筹码)</div>
            <div className="card-value card-value--gold">
              {summary.totalAssets.toLocaleString()}
            </div>
            <div className="card-sub">可用余额 + 股票持仓总市值</div>
          </div>

          <div className="portfolio-card">
            <div className="card-label">持仓总市值</div>
            <div className="card-value">
              {summary.totalMarketValue.toLocaleString()}
            </div>
            <div className="card-sub">共持有 {holdings.length} 支标的</div>
          </div>

          <div className="portfolio-card">
            <div className="card-label">可用欢乐豆</div>
            <div className="card-value card-value--cyan">
              {summary.availableBalance.toLocaleString()}
            </div>
            <div className="card-sub">随时可下注或建仓买入</div>
          </div>

          <div className="portfolio-card">
            <div className="card-label">持仓浮动总盈亏</div>
            <div
              className={`card-value ${
                summary.totalFloatingPnl >= 0 ? 'text-gain' : 'text-loss'
              }`}
            >
              {summary.totalFloatingPnl >= 0 ? `+${summary.totalFloatingPnl.toLocaleString()}` : summary.totalFloatingPnl.toLocaleString()}
              <span className="card-percent">
                ({summary.totalFloatingPercent >= 0 ? `+${summary.totalFloatingPercent}%` : `${summary.totalFloatingPercent}%`})
              </span>
            </div>
            <div className="card-sub">
              今日变动: {summary.totalTodayPnl >= 0 ? `+${summary.totalTodayPnl.toLocaleString()}` : summary.totalTodayPnl.toLocaleString()} 豆
            </div>
          </div>
        </section>

        {/* 顶部标签页切换导航 */}
        <nav className="stock-nav-tabs">
          <button
            type="button"
            className={`stock-tab-btn ${activeTab === 'market' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('market')}
          >
            📊 标的行情与交易
          </button>
          <button
            type="button"
            className={`stock-tab-btn ${activeTab === 'holdings' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('holdings')}
          >
            💼 我的持仓 ({holdings.length})
          </button>
          <button
            type="button"
            className={`stock-tab-btn ${activeTab === 'orders' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            📜 交易明细流水
          </button>
        </nav>

        {/* 主体内容区 */}
        <div className="stock-modal-body">
          {activeTab === 'market' && (
            <div className="stock-market-layout">
              {/* 左侧：标的分类过滤与列表 */}
              <aside className="stock-sidebar">
                <div className="category-filter-bar">
                  {[
                    { id: 'all', label: '全部(10)' },
                    { id: 'metal', label: '贵金属' },
                    { id: 'liquor', label: '白酒消费' },
                    { id: 'ev', label: '新能源' },
                    { id: 'finance', label: '金融' },
                    { id: 'tech', label: '硬科技' },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className={`cat-pill ${categoryFilter === cat.id ? 'is-active' : ''}`}
                      onClick={() => setCategoryFilter(cat.id)}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                <div className="stock-items-scroll">
                  {filteredDefinitions.map((item) => {
                    const q = quotes.find((quote) => quote.symbol === item.symbol);
                    const isSelected = item.symbol === selectedSymbol;
                    const price = q ? q.price : 100;
                    const chgPct = q ? q.changePercent : 0;
                    const isUp = chgPct >= 0;
                    const holding = holdings.find((h) => h.symbol === item.symbol);

                    return (
                      <div
                        key={item.symbol}
                        className={`stock-list-item ${isSelected ? 'is-selected' : ''}`}
                        onClick={() => setSelectedSymbol(item.symbol)}
                      >
                        <div className="item-header">
                          <span className="item-name">{item.name}</span>
                          <span className="item-code">{item.displayCode}</span>
                        </div>
                        <div className="item-body">
                          <span className="item-price">{price.toFixed(2)}</span>
                          <span className={`item-badge ${isUp ? 'is-up' : 'is-down'}`}>
                            {isUp ? `+${chgPct.toFixed(2)}%` : `${chgPct.toFixed(2)}%`}
                          </span>
                        </div>
                        {holding && holding.shares > 0 && (
                          <div className="item-holding-tag">
                            持仓: {holding.shares} {item.unitName}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </aside>

              {/* 中间：行情走势大图与盘口五档 */}
              <main className="stock-chart-panel">
                <div className="chart-header">
                  <div className="stock-spotlight-title">
                    <span className="spotlight-name">{currentMeta?.name}</span>
                    <span className="spotlight-code">{currentMeta?.displayCode}</span>
                    <span className="spotlight-cat-tag">{currentMeta?.categoryLabel}</span>
                  </div>

                  <div className="stock-metrics-row">
                    <div className="metric-box">
                      <span className="lbl">最新价</span>
                      <span
                        className={`val val--large ${
                          (currentQuote?.changePercent ?? 0) >= 0 ? 'text-gain' : 'text-loss'
                        }`}
                      >
                        {currentQuote?.price?.toFixed(2) ?? '--'}
                      </span>
                    </div>
                    <div className="metric-box">
                      <span className="lbl">涨跌额</span>
                      <span
                        className={`val ${
                          (currentQuote?.changeAmount ?? 0) >= 0 ? 'text-gain' : 'text-loss'
                        }`}
                      >
                        {(currentQuote?.changeAmount ?? 0) >= 0
                          ? `+${currentQuote?.changeAmount?.toFixed(2)}`
                          : currentQuote?.changeAmount?.toFixed(2)}
                      </span>
                    </div>
                    <div className="metric-box">
                      <span className="lbl">最高</span>
                      <span className="val text-gain">{currentQuote?.high?.toFixed(2) ?? '--'}</span>
                    </div>
                    <div className="metric-box">
                      <span className="lbl">最低</span>
                      <span className="val text-loss">{currentQuote?.low?.toFixed(2) ?? '--'}</span>
                    </div>
                    <div className="metric-box">
                      <span className="lbl">成交量</span>
                      <span className="val">{currentQuote?.volume?.toLocaleString() ?? '--'} 手</span>
                    </div>
                  </div>
                </div>

                <div className="chart-canvas-container">
                  <div className="chart-overlay-info">
                    <span>分时走势 · T+0 实盘交割</span>
                    {loadingTrends && <span className="loading-tag">加载分时中…</span>}
                  </div>
                  <canvas ref={canvasRef} className="stock-time-canvas" />
                </div>

                {/* 五档盘口明细 */}
                <div className="order-book-strip">
                  <div className="book-col book-col--ask">
                    <span className="book-lbl">卖一</span>
                    <span className="book-price text-loss">
                      {currentQuote?.ask1Price?.toFixed(2) || (currentQuote?.price ? (currentQuote.price + 0.05).toFixed(2) : '--')}
                    </span>
                    <span className="book-vol">{currentQuote?.ask1Volume || 50} 手</span>
                  </div>
                  <div className="book-divider">⚡ 实时撮合</div>
                  <div className="book-col book-col--bid">
                    <span className="book-lbl">买一</span>
                    <span className="book-price text-gain">
                      {currentQuote?.bid1Price?.toFixed(2) || currentQuote?.price?.toFixed(2) || '--'}
                    </span>
                    <span className="book-vol">{currentQuote?.bid1Volume || 50} 手</span>
                  </div>
                </div>

                {/* 标的背景介绍 */}
                <div className="stock-desc-banner">
                  <span className="desc-icon">💡</span>
                  <span className="desc-text">{currentMeta?.description}</span>
                </div>
              </main>

              {/* 右侧：买入/卖出下单柜台 */}
              <aside className="stock-trade-panel">
                <div className="trade-mode-toggle">
                  <button
                    type="button"
                    className={`mode-btn mode-btn--buy ${tradeMode === 'buy' ? 'is-active' : ''}`}
                    onClick={() => {
                      setTradeMode('buy');
                      setTradeShares(100);
                    }}
                  >
                    市价买入 (做多)
                  </button>
                  <button
                    type="button"
                    className={`mode-btn mode-btn--sell ${tradeMode === 'sell' ? 'is-active' : ''}`}
                    onClick={() => {
                      setTradeMode('sell');
                      setTradeShares(currentHolding?.shares || 100);
                    }}
                  >
                    市价卖出 (平仓)
                  </button>
                </div>

                <div className="trade-form-box">
                  <div className="form-row">
                    <span className="form-lbl">标的名称</span>
                    <span className="form-val">{currentMeta?.shortName}</span>
                  </div>

                  <div className="form-row">
                    <span className="form-lbl">当前成交价</span>
                    <span className="form-val form-val--price">
                      {estimatedPrice.toFixed(2)} 豆/{currentMeta?.unitName}
                    </span>
                  </div>

                  <div className="form-row">
                    <span className="form-lbl">
                      {tradeMode === 'buy' ? '可用欢乐豆' : '当前持有量'}
                    </span>
                    <span className="form-val form-val--highlight">
                      {tradeMode === 'buy'
                        ? `${summary.availableBalance.toLocaleString()} 豆`
                        : `${currentHolding?.shares || 0} ${currentMeta?.unitName}`}
                    </span>
                  </div>

                  {/* 数量输入控件 */}
                  <div className="shares-input-group">
                    <span className="group-lbl">
                      {tradeMode === 'buy' ? '买入数量' : '卖出数量'} ({currentMeta?.unitName})
                    </span>
                    <div className="input-spinner">
                      <button
                        type="button"
                        className="spin-btn"
                        onClick={() => setTradeShares((prev) => Math.max(1, prev - 100))}
                      >
                        -100
                      </button>
                      <button
                        type="button"
                        className="spin-btn"
                        onClick={() => setTradeShares((prev) => Math.max(1, prev - 10))}
                      >
                        -10
                      </button>
                      <input
                        type="number"
                        className="shares-num-input"
                        value={tradeShares}
                        min={1}
                        onChange={(e) => setTradeShares(Math.max(1, parseInt(e.target.value) || 0))}
                      />
                      <button
                        type="button"
                        className="spin-btn"
                        onClick={() => setTradeShares((prev) => prev + 10)}
                      >
                        +10
                      </button>
                      <button
                        type="button"
                        className="spin-btn"
                        onClick={() => setTradeShares((prev) => prev + 100)}
                      >
                        +100
                      </button>
                    </div>
                  </div>

                  {/* 快捷仓位按钮 */}
                  <div className="ratio-quick-btns">
                    <button type="button" onClick={() => handleQuickRatio(0.25)}>
                      1/4 仓
                    </button>
                    <button type="button" onClick={() => handleQuickRatio(0.5)}>
                      半仓
                    </button>
                    <button type="button" onClick={() => handleQuickRatio(0.75)}>
                      3/4 仓
                    </button>
                    <button
                      type="button"
                      className="btn-full-cargo"
                      onClick={() => handleQuickRatio(1.0)}
                    >
                      {tradeMode === 'buy' ? '全仓满进' : '清仓卖出'}
                    </button>
                  </div>

                  {/* 费用明细预估 */}
                  <div className="trade-estimate-box">
                    <div className="est-row">
                      <span>成交货款</span>
                      <span>{rawTotalCost.toLocaleString()} 豆</span>
                    </div>
                    <div className="est-row">
                      <span>{tradeMode === 'buy' ? '交易佣金 (0.03%)' : '印花印费 (0.1%)'}</span>
                      <span>{tradeMode === 'buy' ? buyFee : sellFee} 豆</span>
                    </div>
                    <div className="est-divider" />
                    <div className="est-row est-row--final">
                      <span>{tradeMode === 'buy' ? '预计实扣' : '预计净收'}</span>
                      <span className={tradeMode === 'buy' ? 'text-warn' : 'text-gain'}>
                        {tradeMode === 'buy'
                          ? `${estimatedBuyTotal.toLocaleString()} 豆`
                          : `${estimatedSellNet.toLocaleString()} 豆`}
                      </span>
                    </div>
                  </div>

                  {/* 提交大按钮 */}
                  {tradeMode === 'buy' ? (
                    <button
                      type="button"
                      className="btn-stock-action btn-stock-action--buy"
                      disabled={submitting || tradeShares <= 0 || summary.availableBalance < estimatedBuyTotal}
                      onClick={handleBuy}
                    >
                      {submitting ? '提交买入中…' : `立即买入 · ${estimatedBuyTotal.toLocaleString()} 豆`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-stock-action btn-stock-action--sell"
                      disabled={submitting || tradeShares <= 0 || (currentHolding?.shares || 0) < tradeShares}
                      onClick={handleSell}
                    >
                      {submitting ? '提交卖出中…' : `立即卖出 · 净收 ${estimatedSellNet.toLocaleString()} 豆`}
                    </button>
                  )}
                </div>
              </aside>
            </div>
          )}

          {/* 持仓列表标签页 */}
          {activeTab === 'holdings' && (
            <div className="stock-holdings-view">
              {holdings.length === 0 ? (
                <div className="stock-empty-box">
                  <div className="empty-icon">💼</div>
                  <div className="empty-title">当前尚无任何股票持仓</div>
                  <div className="empty-sub">
                    前往「标的行情」选购黄金、白银、茅台或新能源龙头，开启您的改命之旅！
                  </div>
                  <button
                    type="button"
                    className="btn-go-trade"
                    onClick={() => setActiveTab('market')}
                  >
                    立即去选股建仓
                  </button>
                </div>
              ) : (
                <div className="stock-table-card">
                  <table className="stock-data-table">
                    <thead>
                      <tr>
                        <th>标的代码 / 名称</th>
                        <th>持仓数量</th>
                        <th>成本均价</th>
                        <th>当前市价</th>
                        <th>持仓市值</th>
                        <th>浮动盈亏</th>
                        <th>盈亏率</th>
                        <th>快捷操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdings.map((h) => {
                        const isUp = h.floatingPnl >= 0;
                        return (
                          <tr key={h.symbol}>
                            <td>
                              <div className="td-stock-cell">
                                <span className="cell-name">{h.stockMeta.name}</span>
                                <span className="cell-code">{h.stockMeta.displayCode}</span>
                              </div>
                            </td>
                            <td>
                              <strong className="cell-shares">
                                {h.shares} {h.stockMeta.unitName}
                              </strong>
                            </td>
                            <td>{h.avgCost.toFixed(2)}</td>
                            <td>{h.currentPrice.toFixed(2)}</td>
                            <td>
                              <strong>{h.marketValue.toLocaleString()} 豆</strong>
                            </td>
                            <td className={isUp ? 'text-gain' : 'text-loss'}>
                              {isUp ? `+${h.floatingPnl.toLocaleString()}` : h.floatingPnl.toLocaleString()} 豆
                            </td>
                            <td className={isUp ? 'text-gain' : 'text-loss'}>
                              {isUp ? `+${h.floatingPnlPercent}%` : `${h.floatingPnlPercent}%`}
                            </td>
                            <td>
                              <div className="td-actions-group">
                                <button
                                  type="button"
                                  className="btn-table-action btn-table-action--add"
                                  onClick={() => {
                                    setSelectedSymbol(h.symbol);
                                    setTradeMode('buy');
                                    setActiveTab('market');
                                  }}
                                >
                                  加仓
                                </button>
                                <button
                                  type="button"
                                  className="btn-table-action btn-table-action--sell"
                                  onClick={() => {
                                    setSelectedSymbol(h.symbol);
                                    setTradeMode('sell');
                                    setTradeShares(h.shares);
                                    setActiveTab('market');
                                  }}
                                >
                                  平仓
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 订单历史明细标签页 */}
          {activeTab === 'orders' && (
            <div className="stock-orders-view">
              {orders.length === 0 ? (
                <div className="stock-empty-box">
                  <div className="empty-icon">📜</div>
                  <div className="empty-title">暂无交易订单记录</div>
                  <div className="empty-sub">您的买入与平仓流水将会详细保存在此，供随时对账。</div>
                </div>
              ) : (
                <div className="stock-table-card">
                  <table className="stock-data-table">
                    <thead>
                      <tr>
                        <th>成交时间</th>
                        <th>标的名称</th>
                        <th>交易方向</th>
                        <th>成交股数</th>
                        <th>成交价格</th>
                        <th>成交金额</th>
                        <th>手续费</th>
                        <th>实现盈亏</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => {
                        const isBuy = o.action === 'buy';
                        const isProfit = o.realizedPnl >= 0;
                        return (
                          <tr key={o.id}>
                            <td className="text-muted">
                              {new Date(o.createdAt).toLocaleString()}
                            </td>
                            <td>
                              <strong>{o.stockName}</strong> ({o.symbol})
                            </td>
                            <td>
                              <span className={`trade-dir-tag ${isBuy ? 'dir-buy' : 'dir-sell'}`}>
                                {isBuy ? '🔴 买入建仓' : '🟢 卖出平仓'}
                              </span>
                            </td>
                            <td>{o.shares}</td>
                            <td>{o.price.toFixed(2)}</td>
                            <td>{o.totalAmount.toLocaleString()} 豆</td>
                            <td>{o.fee} 豆</td>
                            <td>
                              {isBuy ? (
                                <span className="text-muted">--</span>
                              ) : (
                                <span className={isProfit ? 'text-gain' : 'text-loss'}>
                                  {isProfit ? `+${o.realizedPnl.toLocaleString()}` : o.realizedPnl.toLocaleString()} 豆
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部悬浮提示浮层 */}
        {toastMsg && <div className="stock-toast-float">{toastMsg}</div>}
      </div>
    </div>
  );
}
