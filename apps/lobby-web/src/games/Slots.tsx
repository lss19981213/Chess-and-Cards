import { useState, useEffect } from 'react';
import { audio } from '../audio';
import { DEALER_MAIN } from '../assets';

type SlotSymbol =
  | 'WILD'
  | 'SEVEN'
  | 'DIAMOND'
  | 'BELL'
  | 'BAR'
  | 'MELON'
  | 'GRAPE'
  | 'ORANGE'
  | 'CHERRY'
  | 'SCATTER';

interface PaylineWin {
  lineIndex: number;
  symbol: SlotSymbol;
  count: number;
  payout: number;
}

interface SpinResult {
  playerId: string;
  grid: SlotSymbol[][];
  totalBet: number;
  totalWin: number;
  wins: PaylineWin[];
  scatterCount: number;
  jackpotHit: boolean;
}

interface SlotsSnapshot {
  phase: string;
  grid: SlotSymbol[][];
  lastSpin: SpinResult | null;
  jackpot: number;
  history: SpinResult[];
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  balance: number;
  onSpin: (betPerLine: number, lines: number) => void;
}

const SYMBOL_DISPLAY: Record<SlotSymbol, { icon: string; label: string; color: string }> = {
  WILD: { icon: '👑', label: '百搭皇冠', color: '#f59e0b' },
  SEVEN: { icon: '7️⃣', label: '幸运红七', color: '#ef4444' },
  DIAMOND: { icon: '💎', label: '璀璨钻石', color: '#06b6d4' },
  BELL: { icon: '🔔', label: '黄金铃铛', color: '#eab308' },
  BAR: { icon: '🍫', label: '金条BAR', color: '#854d0e' },
  MELON: { icon: '🍉', label: '西瓜', color: '#10b981' },
  GRAPE: { icon: '🍇', label: '葡萄', color: '#8b5cf6' },
  ORANGE: { icon: '🍊', label: '橙子', color: '#f97316' },
  CHERRY: { icon: '🍒', label: '樱桃', color: '#ec4899' },
  SCATTER: { icon: '🪙', label: '财神金币', color: '#fbbf24' },
};

const BET_PRESETS = [10, 50, 100, 500, 1000, 5000, 10000];

export function Slots({ snapshot, myId: _myId, status: _status, balance, onSpin }: Props) {
  const data = snapshot as unknown as SlotsSnapshot | undefined;
  const [betPerLine, setBetPerLine] = useState(10);
  const [lines, setLines] = useState(9);
  const [spinning, setSpinning] = useState(false);
  const [autoSpin, setAutoSpin] = useState(false);

  const totalBet = betPerLine * lines;
  const canSpin = balance >= totalBet && !spinning;

  const currentGrid: SlotSymbol[][] = data?.grid ?? [
    ['SEVEN', 'BAR', 'CHERRY'],
    ['DIAMOND', 'SEVEN', 'ORANGE'],
    ['WILD', 'BELL', 'GRAPE'],
    ['MELON', 'SEVEN', 'BELL'],
    ['CHERRY', 'DIAMOND', 'SEVEN'],
  ];

  const handleStartSpin = () => {
    if (!canSpin) return;
    setSpinning(true);
    audio.play('chip_clack');

    onSpin(betPerLine, lines);

    setTimeout(() => {
      setSpinning(false);
      if (data?.lastSpin && data.lastSpin.totalWin > 0) {
        audio.play('win');
      }
    }, 850);
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (autoSpin && !spinning && canSpin) {
      timer = setTimeout(() => {
        handleStartSpin();
      }, 1200);
    }
    return () => clearTimeout(timer);
  }, [autoSpin, spinning, canSpin]);

  return (
    <div className="lobby-game slots-game">
      <div className="lobby-game__main">
        {/* 顶部大奖池 LED 显示屏 */}
        <div className="slots-jackpot-header">
          <span className="jackpot-tag">MEGA JACKPOT 累积超级大奖池</span>
          <div className="jackpot-counter">
            🪙 {(data?.jackpot ?? 888888).toLocaleString()}
          </div>
        </div>

        {/* 美女荷官助手 */}
        <div className="table-dealer-host">
          <div className="dealer-mini-portrait">
            <img src={DEALER_MAIN} alt="荷官艾莉丝" draggable={false} />
          </div>
          <div className="dealer-text-badge">
            <span className="dealer-title">荷官·艾莉丝</span>
            <span className="dealer-action">{spinning ? '777 极速转动中！' : '拉动拉杆，赢取大奖'}</span>
          </div>
        </div>

        {/* 豪华拉斯维加斯老虎机机台 */}
        <div className="slots-cabinet">
          <div className="slots-marquee">
            <span className="marquee-bulb">●</span>
            <span className="marquee-bulb">●</span>
            <span className="marquee-bulb">●</span>
            <span className="marquee-title">★ 777 LUCKY VEGAS ★</span>
            <span className="marquee-bulb">●</span>
            <span className="marquee-bulb">●</span>
            <span className="marquee-bulb">●</span>
          </div>

          {/* 5 轴滚轮显示 */}
          <div className="slots-reels-container">
            {currentGrid.map((col, colIdx) => (
              <div key={colIdx} className={`slots-reel ${spinning ? 'is-spinning' : ''}`}>
                {col.map((sym, rowIdx) => {
                  const info = SYMBOL_DISPLAY[sym] ?? { icon: '❓', label: sym, color: '#fff' };
                  return (
                    <div key={rowIdx} className="slots-symbol-cell" style={{ borderColor: info.color }}>
                      <span className="symbol-icon">{info.icon}</span>
                      <span className="symbol-label" style={{ color: info.color }}>{info.label}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* 中奖提示栏 */}
          <div className="slots-win-bar">
            {data?.lastSpin && data.lastSpin.totalWin > 0 ? (
              <div className="slots-win-alert">
                🎉 恭喜中奖！赢得 <strong>+{data.lastSpin.totalWin}</strong> 筹码！
                {data.lastSpin.wins.map((w, i) => (
                  <span key={i} className="line-win-pill">
                    第{w.lineIndex + 1}线: {SYMBOL_DISPLAY[w.symbol]?.label}x{w.count} (+{w.payout})
                  </span>
                ))}
              </div>
            ) : (
              <span className="slots-prompt-text">
                选择线数与单线注额，点击「SPIN 旋转」即可畅赢！
              </span>
            )}
          </div>
        </div>

        {/* 控制区：下注、线数、旋转、自动 */}
        <div className="slots-controls">
          <div className="slots-chips-selector">
            <span className="controls-label">单线注额:</span>
            {BET_PRESETS.map((val) => (
              <button
                key={val}
                type="button"
                className={`chip-btn ${betPerLine === val ? 'is-active' : ''}`}
                onClick={() => {
                  audio.play('click');
                  setBetPerLine(val);
                }}
              >
                <span>{val}</span>
              </button>
            ))}
          </div>

          <div className="slots-lines-selector">
            <span className="controls-label">激活线数:</span>
            {[1, 3, 5, 9].map((l) => (
              <button
                key={l}
                type="button"
                className={`line-btn ${lines === l ? 'is-active' : ''}`}
                onClick={() => {
                  audio.play('click');
                  setLines(l);
                }}
              >
                {l} 线
              </button>
            ))}
          </div>

          <div className="slots-bet-summary">
            <span>总下注: <strong>{totalBet}</strong> 筹码</span>
            <span className="unlimited-hint">无上限自由旋转</span>
          </div>

          <div className="slots-actions-row">
            <button
              type="button"
              className={`auto-spin-btn ${autoSpin ? 'is-active' : ''}`}
              onClick={() => {
                audio.play('click');
                setAutoSpin(!autoSpin);
              }}
            >
              {autoSpin ? '⏹ 停止自动' : '⚡ 自动旋转'}
            </button>

            <button
              type="button"
              className={`spin-btn-lever ${spinning ? 'is-spinning' : ''}`}
              disabled={!canSpin}
              onClick={handleStartSpin}
            >
              {spinning ? '旋转中…' : '🎰 SPIN 旋转'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Slots;
