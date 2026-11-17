import { useEffect, useRef, useState } from 'react';
import type { User } from '../api';
import { audio } from '../audio';
import { Chip } from './Chip';

interface Props {
  user: User;
  onBalanceChange: (newBalance: number) => void;
  onClose: () => void;
}

interface SymbolDef {
  id: string;
  name: string;
  icon: string;
  payout5: number;
  payout4: number;
  payout3: number;
  isWild?: boolean;
  isScatter?: boolean;
}

const SYMBOLS: SymbolDef[] = [
  { id: '777', name: '777至尊大奖', icon: '🎰', payout5: 500, payout4: 150, payout3: 50 },
  { id: 'wild', name: '钻石百搭', icon: '💎', payout5: 300, payout4: 100, payout3: 30, isWild: true },
  { id: 'scatter', name: '免费夺宝星', icon: '⭐', payout5: 200, payout4: 50, payout3: 20, isScatter: true },
  { id: 'gold', name: '金条金砖', icon: '🪙', payout5: 150, payout4: 40, payout3: 15 },
  { id: 'bell', name: '自由之钟', icon: '🔔', payout5: 100, payout4: 30, payout3: 10 },
  { id: 'watermelon', name: '好运西瓜', icon: '🍉', payout5: 60, payout4: 20, payout3: 8 },
  { id: 'grape', name: '幸运葡萄', icon: '🍇', payout5: 40, payout4: 15, payout3: 5 },
  { id: 'cherry', name: '红火樱桃', icon: '🍒', payout5: 25, payout4: 10, payout3: 3 },
  { id: 'horseshoe', name: '幸运马蹄', icon: '🧲', payout5: 15, payout4: 6, payout3: 2 },
];

const PAYLINES = [
  [1, 1, 1, 1, 1], // 中线
  [0, 0, 0, 0, 0], // 顶线
  [2, 2, 2, 2, 2], // 底线
  [0, 1, 2, 1, 0], // V字
  [2, 1, 0, 1, 2], // 倒V字
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1],
  [0, 0, 2, 0, 0],
  [2, 2, 0, 2, 2],
  [0, 2, 0, 2, 0],
  [2, 0, 2, 0, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 2, 2, 2, 0],
  [2, 0, 0, 0, 2],
  [0, 1, 2, 2, 2],
  [2, 1, 0, 0, 0],
];

const BET_OPTIONS = [10, 50, 100, 500, 1000, 5000];

export function LuxurySlotsModal({ user, onBalanceChange, onClose }: Props) {
  const [reels, setReels] = useState<string[][]>([
    ['777', 'bell', 'cherry'],
    ['wild', 'gold', 'grape'],
    ['scatter', '777', 'bell'],
    ['gold', 'watermelon', 'cherry'],
    ['bell', 'horseshoe', '777'],
  ]);

  const [spinning, setSpinning] = useState(false);
  const [reelSpinState, setReelSpinState] = useState<boolean[]>([false, false, false, false, false]);
  const [betPerLine, setBetPerLine] = useState(50);
  const [activeLines, setActiveLines] = useState(25);
  const [lastWin, setLastWin] = useState(0);
  const [winningLines, setWinningLines] = useState<number[]>([]);
  const [freeSpinsLeft, setFreeSpinsLeft] = useState(0);
  const [autoSpinCount, setAutoSpinCount] = useState(0);
  const [jackpotPool, setJackpotPool] = useState(888888);
  const [celebration, setCelebration] = useState<'normal' | 'big' | 'jackpot' | null>(null);

  const autoSpinRef = useRef(autoSpinCount);
  autoSpinRef.current = autoSpinCount;

  const totalBet = freeSpinsLeft > 0 ? 0 : betPerLine * activeLines;

  // 定时微涨 Jackpot
  useEffect(() => {
    const timer = window.setInterval(() => {
      setJackpotPool((prev) => prev + Math.floor(Math.random() * 8) + 1);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const getRandomSymbol = () => {
    const r = Math.random();
    if (r < 0.04) return '777';
    if (r < 0.09) return 'wild';
    if (r < 0.15) return 'scatter';
    if (r < 0.25) return 'gold';
    if (r < 0.38) return 'bell';
    if (r < 0.52) return 'watermelon';
    if (r < 0.67) return 'grape';
    if (r < 0.83) return 'cherry';
    return 'horseshoe';
  };

  const handleSpin = () => {
    if (spinning) return;
    if (freeSpinsLeft === 0 && user.balance < totalBet) {
      audio.play('alert');
      setAutoSpinCount(0);
      return;
    }

    // 扣除押注
    if (freeSpinsLeft === 0) {
      onBalanceChange(user.balance - totalBet);
      audio.play('chip_clack');
    }

    setSpinning(true);
    setCelebration(null);
    setWinningLines([]);
    setLastWin(0);
    setReelSpinState([true, true, true, true, true]);

    // 播放滚轮声
    const spinAudioTimer = window.setInterval(() => {
      audio.play('slot_spin');
    }, 120);

    // 预先生成最终 5x3 网格
    const finalGrid: string[][] = [];
    for (let col = 0; col < 5; col++) {
      finalGrid.push([getRandomSymbol(), getRandomSymbol(), getRandomSymbol()]);
    }

    // 依次停止各列滚轮
    for (let c = 0; c < 5; c++) {
      window.setTimeout(() => {
        setReels((prev) => {
          const next = [...prev];
          next[c] = finalGrid[c]!;
          return next;
        });
        setReelSpinState((prev) => {
          const next = [...prev];
          next[c] = false;
          return next;
        });
        audio.play('slot_stop');

        if (c === 4) {
          window.clearInterval(spinAudioTimer);
          window.setTimeout(() => {
            evaluateResult(finalGrid);
          }, 200);
        }
      }, 600 + c * 250);
    }
  };

  const evaluateResult = (grid: string[][]) => {
    setSpinning(false);

    let totalWin = 0;
    const hitLines: number[] = [];
    let scatterCount = 0;
    let hit777Count = 0;

    // 统计 Scatter
    for (let col = 0; col < 5; col++) {
      for (let row = 0; row < 3; row++) {
        if (grid[col]![row] === 'scatter') scatterCount++;
        if (grid[col]![row] === '777') hit777Count++;
      }
    }

    // 检查各条激活线
    for (let l = 0; l < activeLines; l++) {
      const linePattern = PAYLINES[l]!;
      const lineSymbols = [
        grid[0]![linePattern[0]!]!,
        grid[1]![linePattern[1]!]!,
        grid[2]![linePattern[2]!]!,
        grid[3]![linePattern[3]!]!,
        grid[4]![linePattern[4]!]!,
      ];

      // 计算匹配
      const firstNonWild = lineSymbols.find((s) => s !== 'wild' && s !== 'scatter') || 'wild';
      let matchCount = 0;
      for (const s of lineSymbols) {
        if (s === firstNonWild || s === 'wild') matchCount++;
        else break;
      }

      if (matchCount >= 3) {
        const symDef = SYMBOLS.find((s) => s.id === firstNonWild);
        if (symDef) {
          const mult =
            matchCount === 5 ? symDef.payout5 : matchCount === 4 ? symDef.payout4 : symDef.payout3;
          const lineWin = mult * betPerLine * (freeSpinsLeft > 0 ? 3 : 1);
          totalWin += lineWin;
          hitLines.push(l);
        }
      }
    }

    // Scatter 额外奖励
    if (scatterCount >= 3) {
      setFreeSpinsLeft((prev) => prev + 10);
      totalWin += betPerLine * activeLines * (scatterCount === 5 ? 50 : scatterCount === 4 ? 20 : 5);
      audio.play('shunzi');
    }

    // 结算加钱与庆典
    if (totalWin > 0) {
      setLastWin(totalWin);
      setWinningLines(hitLines);
      onBalanceChange(user.balance + totalWin);

      if (hit777Count >= 5 || totalWin >= totalBet * 50) {
        setCelebration('jackpot');
        audio.play('slot_jackpot');
      } else if (totalWin >= totalBet * 10) {
        setCelebration('big');
        audio.play('jackpot');
      } else {
        setCelebration('normal');
        audio.play('slot_win');
      }
    }

    if (freeSpinsLeft > 0) {
      setFreeSpinsLeft((prev) => Math.max(0, prev - 1));
    }

    // 自动旋转处理
    if (autoSpinRef.current > 0 || freeSpinsLeft > 0) {
      if (freeSpinsLeft === 0 && autoSpinRef.current > 0) {
        setAutoSpinCount((prev) => (prev > 100 ? prev : prev - 1));
      }
      window.setTimeout(() => {
        handleSpin();
      }, 1200);
    }
  };

  return (
    <div className="modal-mask slots-stage-mask" onClick={onClose} role="presentation">
      <div className="luxury-slots-cabinet" onClick={(e) => e.stopPropagation()}>
        {/* 顶部绚丽彩灯与大奖池 */}
        <div className="slots-marquee-header">
          <div className="slots-marquee-lights">
            <span className="light-bulb" />
            <span className="light-bulb" />
            <span className="light-bulb" />
            <span className="light-bulb" />
          </div>

          <div className="slots-jackpot-board">
            <span className="jackpot-neon-title">🔥 LAS VEGAS MEGA JACKPOT 🔥</span>
            <div className="jackpot-counter-digits">
              <span className="gold-coin-symbol">🪙</span>
              {jackpotPool.toLocaleString()}
            </div>
          </div>

          <button
            type="button"
            className="slots-close-btn"
            onClick={() => {
              setAutoSpinCount(0);
              onClose();
            }}
            title="关闭老虎机"
          >
            ✕
          </button>
        </div>

        {/* 免费旋转提示横幅 */}
        {freeSpinsLeft > 0 && (
          <div className="free-spins-alert-bar">
            🎉 豪华免费旋转模式中！剩余 <b>{freeSpinsLeft}</b> 次 (全线奖金 3 倍！)
          </div>
        )}

        {/* 老虎机主滚轮视窗 */}
        <div className="slots-reels-stage">
          <div className="slots-reels-frame">
            {reels.map((col, colIdx) => {
              const isColSpinning = reelSpinState[colIdx];
              return (
                <div
                  key={colIdx}
                  className={`slots-reel-column ${isColSpinning ? 'is-spinning' : ''}`}
                >
                  {col.map((symId, rowIdx) => {
                    const sym = SYMBOLS.find((s) => s.id === symId) || SYMBOLS[0]!;
                    const isWinCell =
                      winningLines.length > 0 &&
                      winningLines.some((l) => PAYLINES[l]![colIdx] === rowIdx);
                    return (
                      <div
                        key={rowIdx}
                        className={`slots-symbol-cell ${isWinCell ? 'is-win-pulse' : ''}`}
                      >
                        <span className="symbol-icon">{sym.icon}</span>
                        <span className="symbol-name">{sym.name}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* 大奖中奖浮动特效 */}
          {celebration && (
            <div className={`slots-win-overlay is-${celebration}`}>
              <div className="win-popup-card">
                <span className="win-stars">✨ 🌟 ✨</span>
                <h2 className="win-title-text">
                  {celebration === 'jackpot' ? '🎆 SUPER JACKPOT 🎆' : '🎉 BIG WIN 🎉'}
                </h2>
                <div className="win-coins-count">
                  +<b>{lastWin.toLocaleString()}</b>
                </div>
                <span className="win-congrats-sub">恭喜斩获巨额财富！</span>
              </div>
            </div>
          )}
        </div>

        {/* 状态指示栏：中奖金额与线数 */}
        <div className="slots-status-bar">
          <div className="status-metric">
            <span className="metric-label">激活中奖线:</span>
            <span className="metric-val">{activeLines} 线</span>
          </div>
          <div className="status-metric metric--win">
            <span className="metric-label">本轮赢得:</span>
            <span className="metric-val">
              {lastWin > 0 ? (
                <>
                  <Chip size={15} /> +{lastWin.toLocaleString()}
                </>
              ) : (
                '--'
              )}
            </span>
          </div>
          <div className="status-metric">
            <span className="metric-label">我的筹码:</span>
            <span className="metric-val">
              <Chip size={15} /> {user.balance.toLocaleString()}
            </span>
          </div>
        </div>

        {/* 控制台底座 */}
        <div className="slots-control-dashboard">
          {/* 单线押注调节 */}
          <div className="ctrl-group">
            <span className="ctrl-label">单线筹码</span>
            <div className="ctrl-btn-group">
              <button
                type="button"
                className="btn-ctrl-step"
                disabled={spinning}
                onClick={() => {
                  const idx = BET_OPTIONS.indexOf(betPerLine);
                  if (idx > 0) setBetPerLine(BET_OPTIONS[idx - 1]!);
                }}
              >
                -
              </button>
              <span className="ctrl-display-val">{betPerLine}</span>
              <button
                type="button"
                className="btn-ctrl-step"
                disabled={spinning}
                onClick={() => {
                  const idx = BET_OPTIONS.indexOf(betPerLine);
                  if (idx < BET_OPTIONS.length - 1) setBetPerLine(BET_OPTIONS[idx + 1]!);
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* 激活线数调节 */}
          <div className="ctrl-group">
            <span className="ctrl-label">中奖线数</span>
            <div className="ctrl-btn-group">
              {[1, 9, 15, 25].map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`btn-ctrl-pill ${activeLines === l ? 'is-active' : ''}`}
                  disabled={spinning}
                  onClick={() => setActiveLines(l)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* 总下注信息 */}
          <div className="ctrl-group ctrl-group--total">
            <span className="ctrl-label">总押注额</span>
            <div className="total-bet-val">
              <Chip size={16} />
              <b>{totalBet.toLocaleString()}</b>
            </div>
          </div>

          {/* 最大下注 */}
          <button
            type="button"
            className="btn-slots-secondary"
            disabled={spinning}
            onClick={() => {
              setBetPerLine(5000);
              setActiveLines(25);
            }}
          >
            🔥 最大下注
          </button>

          {/* 自动旋转 */}
          {autoSpinCount > 0 ? (
            <button
              type="button"
              className="btn-slots-autospin is-running"
              onClick={() => setAutoSpinCount(0)}
            >
              停止自动 ({autoSpinCount > 500 ? '∞' : autoSpinCount})
            </button>
          ) : (
            <button
              type="button"
              className="btn-slots-autospin"
              disabled={spinning}
              onClick={() => {
                setAutoSpinCount(25);
                handleSpin();
              }}
            >
              🔄 自动 25 次
            </button>
          )}

          {/* 核心拉霸摇杆/SPIN主按钮 */}
          <button
            type="button"
            className={`btn-slots-spin ${spinning ? 'is-spinning' : ''}`}
            disabled={spinning || (freeSpinsLeft === 0 && user.balance < totalBet)}
            onClick={handleSpin}
          >
            <span className="spin-text">{spinning ? 'ROLLING' : 'SPIN'}</span>
            <span className="spin-sub">单次旋转</span>
          </button>
        </div>
      </div>
    </div>
  );
}
