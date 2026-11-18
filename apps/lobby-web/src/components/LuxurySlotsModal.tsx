import { useEffect, useRef, useState } from 'react';
import { api, type SlotsSpinResponse, type User } from '../api';
import { audio } from '../audio';
import { Chip } from './Chip';

interface Props {
  user: User;
  onBalanceChange: (newBalance: number) => void;
  onUserUpdate?: (patch: Partial<User>) => void;
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
}

/** 与服务端 slots-engine.ts 保持完全一致（无免费旋转/Scatter 机制） */
const SYMBOLS: SymbolDef[] = [
  { id: '777', name: '777至尊大奖', icon: '🎰', payout5: 600, payout4: 185, payout3: 56 },
  { id: 'wild', name: '钻石百搭', icon: '💎', payout5: 420, payout4: 125, payout3: 40, isWild: true },
  { id: 'star', name: '黄金幸运星', icon: '⭐', payout5: 270, payout4: 80, payout3: 28 },
  { id: 'gold', name: '金条金砖', icon: '🪙', payout5: 200, payout4: 60, payout3: 22 },
  { id: 'bell', name: '自由之钟', icon: '🔔', payout5: 140, payout4: 45, payout3: 18 },
  { id: 'watermelon', name: '好运西瓜', icon: '🍉', payout5: 100, payout4: 32, payout3: 14 },
  { id: 'grape', name: '幸运葡萄', icon: '🍇', payout5: 75, payout4: 25, payout3: 11 },
  { id: 'cherry', name: '红火樱桃', icon: '🍒', payout5: 55, payout4: 20, payout3: 9 },
  { id: 'horseshoe', name: '幸运马蹄', icon: '🧲', payout5: 40, payout4: 15, payout3: 6 },
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

export function LuxurySlotsModal({ user, onBalanceChange, onUserUpdate, onClose }: Props) {
  const [reels, setReels] = useState<string[][]>([
    ['777', 'bell', 'cherry'],
    ['wild', 'gold', 'grape'],
    ['star', '777', 'bell'],
    ['gold', 'watermelon', 'cherry'],
    ['bell', 'horseshoe', '777'],
  ]);

  const [spinning, setSpinning] = useState(false);
  const [reelSpinState, setReelSpinState] = useState<boolean[]>([false, false, false, false, false]);
  const [betPerLine, setBetPerLine] = useState(50);
  const [activeLines, setActiveLines] = useState(25);
  const [lastWin, setLastWin] = useState(0);
  const [lastXpGain, setLastXpGain] = useState(0);
  const [levelUpBanner, setLevelUpBanner] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [winningLines, setWinningLines] = useState<number[]>([]);
  const [jackpotPool, setJackpotPool] = useState(888888);
  const [celebration, setCelebration] = useState<'normal' | 'big' | 'jackpot' | null>(null);
  const [coinParticles, setCoinParticles] = useState<{ id: number; left: number; delay: number }[]>([]);

  const timersRef = useRef<number[]>([]);
  const spinAudioTimerRef = useRef<number | null>(null);
  const pendingSettlementRef = useRef<SlotsSpinResponse | null>(null);
  const onBalanceChangeRef = useRef(onBalanceChange);
  const onUserUpdateRef = useRef(onUserUpdate);

  onBalanceChangeRef.current = onBalanceChange;
  onUserUpdateRef.current = onUserUpdate;

  const totalBet = betPerLine * activeLines;

  // 定时微涨 Jackpot 展示值
  useEffect(() => {
    const timer = window.setInterval(() => {
      setJackpotPool((prev) => prev + Math.floor(Math.random() * 8) + 1);
    }, 2000);
    return () => window.clearInterval(timer);
  }, []);

  // 组件卸载时清理定时器，并确保服务端已结算的数据立刻同步到主界面
  useEffect(() => {
    return () => {
      for (const id of timersRef.current) window.clearTimeout(id);
      timersRef.current = [];
      if (spinAudioTimerRef.current !== null) {
        window.clearInterval(spinAudioTimerRef.current);
        spinAudioTimerRef.current = null;
      }
      const pending = pendingSettlementRef.current;
      if (pending) {
        pendingSettlementRef.current = null;
        onBalanceChangeRef.current(pending.balance);
        onUserUpdateRef.current?.({
          balance: pending.balance,
          level: pending.level,
          xp: pending.xp,
          rewardedLevel: pending.rewardedLevel,
          totalTurnover: pending.totalTurnover,
        });
      }
    };
  }, []);

  const syncUserFromSpin = (res: SlotsSpinResponse) => {
    pendingSettlementRef.current = null;
    onBalanceChangeRef.current(res.balance);
    onUserUpdateRef.current?.({
      balance: res.balance,
      level: res.level,
      xp: res.xp,
      rewardedLevel: res.rewardedLevel,
      totalTurnover: res.totalTurnover,
    });
  };

  const handleSpin = async () => {
    if (spinning) return;
    if (user.balance < totalBet) {
      audio.play('alert');
      setErrorMsg('筹码不足，请先降低押注或前往福利中心领取救济金');
      return;
    }

    setErrorMsg(null);
    setLevelUpBanner(null);
    setSpinning(true);
    setCelebration(null);
    setWinningLines([]);
    setLastWin(0);
    setCoinParticles([]);
    setReelSpinState([true, true, true, true, true]);
    audio.play('chip_clack');

    // 先由后端权威扣款、计算开奖、入账流水、累计经验
    let res: SlotsSpinResponse;
    try {
      res = await api.spinSlots(betPerLine, activeLines);
    } catch (err) {
      setSpinning(false);
      setReelSpinState([false, false, false, false, false]);
      audio.play('alert');
      setErrorMsg(err instanceof Error ? err.message : '摇奖结算失败，请重试');
      return;
    }

    // 后端已原子结算，暂存并在动画结束后同步（若中途关闭弹窗也会在 unmount 时同步）
    pendingSettlementRef.current = res;
    // 动画期间先展示扣减押注后的筹码，待滚轮停稳后再弹出赢取派彩
    onBalanceChange(Math.max(0, res.balance - res.winAmount));

    // 播放滚轮声
    if (spinAudioTimerRef.current !== null) {
      window.clearInterval(spinAudioTimerRef.current);
    }
    spinAudioTimerRef.current = window.setInterval(() => {
      audio.play('slot_spin');
    }, 120);

    // 依次停止各列滚轮至服务端返回的最终网格
    for (let c = 0; c < 5; c++) {
      const stopTimer = window.setTimeout(() => {
        setReels((prev) => {
          const next = [...prev];
          next[c] = res.reels[c] ?? prev[c]!;
          return next;
        });
        setReelSpinState((prev) => {
          const next = [...prev];
          next[c] = false;
          return next;
        });
        audio.play('slot_stop');

        if (c === 4) {
          if (spinAudioTimerRef.current !== null) {
            window.clearInterval(spinAudioTimerRef.current);
            spinAudioTimerRef.current = null;
          }
          const revealTimer = window.setTimeout(() => {
            revealResult(res);
          }, 200);
          timersRef.current.push(revealTimer);
        }
      }, 550 + c * 230);
      timersRef.current.push(stopTimer);
    }
  };

  const revealResult = (res: SlotsSpinResponse) => {
    setSpinning(false);
    syncUserFromSpin(res);
    setLastXpGain(res.totalBet);

    if (res.levelsGained > 0) {
      setLevelUpBanner(`🎉 恭喜升级至 Lv.${res.level}！快去个人中心领取升级筹码奖励！`);
    }

    if (res.winAmount > 0) {
      setLastWin(res.winAmount);
      setWinningLines(res.winningLines);

      const particles = Array.from({ length: res.isJackpot ? 40 : 28 }).map((_, i) => ({
        id: Date.now() + i,
        left: Math.random() * 90 + 5,
        delay: Math.random() * 0.5,
      }));
      setCoinParticles(particles);

      if (res.isJackpot) {
        setCelebration('jackpot');
        audio.play('slot_jackpot');
      } else if (res.winAmount >= res.totalBet * 5) {
        setCelebration('big');
        audio.play('jackpot');
      } else {
        setCelebration('normal');
        audio.play('slot_win');
      }
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
            onClick={onClose}
            title="关闭老虎机"
          >
            ✕
          </button>
        </div>

        {/* 异常提示 / 升级横幅 */}
        {errorMsg && (
          <div className="free-spins-alert-bar" style={{ background: 'linear-gradient(90deg,#7f1d1d,#b91c1c)' }}>
            ⚠️ {errorMsg}
          </div>
        )}
        {levelUpBanner && (
          <div className="free-spins-alert-bar">
            {levelUpBanner}
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
                      winningLines.some((l) => PAYLINES[l]?.[colIdx] === rowIdx);
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
                  {celebration === 'jackpot'
                    ? '🎆 SUPER JACKPOT 🎆'
                    : celebration === 'big'
                      ? '🎉 BIG WIN 🎉'
                      : '✨ NICE WIN ✨'}
                </h2>
                <div className="win-coins-count">
                  +<b>{lastWin.toLocaleString()}</b>
                </div>
                <span className="win-congrats-sub">已实时入账并计入流水经验！</span>
              </div>
            </div>
          )}
        </div>

        {/* 状态指示栏：中奖金额、经验与实时筹码 */}
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
            <span className="metric-label">流水经验:</span>
            <span className="metric-val" style={{ color: '#fbbf24' }}>
              Lv.{user.level ?? 1}
              {lastXpGain > 0 ? ` (+${lastXpGain.toLocaleString()} XP)` : ''}
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

          {/* 核心拉霸摇杆/SPIN主按钮（纯手动点击，无免费摇奖，服务端权威结算） */}
          <button
            type="button"
            className={`btn-slots-spin ${spinning ? 'is-spinning' : ''}`}
            disabled={spinning || user.balance < totalBet}
            onClick={handleSpin}
          >
            <span className="spin-text">{spinning ? 'ROLLING…' : 'SPIN'}</span>
            <span className="spin-sub">手动摇奖 · 计入经验</span>
          </button>
        </div>

        {/* 金币喷涌动效 */}
        {coinParticles.length > 0 && (
          <div className="slots-coin-rain-fx">
            {coinParticles.map((p) => (
              <span
                key={p.id}
                className="slots-falling-coin"
                style={{ left: `${p.left}%`, animationDelay: `${p.delay}s` }}
              >
                🪙
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
