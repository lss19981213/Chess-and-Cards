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
  tier: 'mythic' | 'epic' | 'rare' | 'common';
  isWild?: boolean;
}

/** 与服务端 slots-engine.ts 保持完全一致（无免费旋转/Scatter 机制） */
const SYMBOLS: SymbolDef[] = [
  { id: '777', name: '777至尊', icon: '🎰', payout5: 600, payout4: 185, payout3: 56, tier: 'mythic' },
  { id: 'wild', name: '钻石百搭', icon: '💎', payout5: 420, payout4: 125, payout3: 40, tier: 'mythic', isWild: true },
  { id: 'star', name: '黄金幸运星', icon: '⭐', payout5: 270, payout4: 80, payout3: 28, tier: 'epic' },
  { id: 'gold', name: '金条金砖', icon: '🪙', payout5: 200, payout4: 60, payout3: 22, tier: 'epic' },
  { id: 'bell', name: '自由之钟', icon: '🔔', payout5: 140, payout4: 45, payout3: 18, tier: 'rare' },
  { id: 'watermelon', name: '好运西瓜', icon: '🍉', payout5: 100, payout4: 32, payout3: 14, tier: 'rare' },
  { id: 'grape', name: '幸运葡萄', icon: '🍇', payout5: 75, payout4: 25, payout3: 11, tier: 'common' },
  { id: 'cherry', name: '红火樱桃', icon: '🍒', payout5: 55, payout4: 20, payout3: 9, tier: 'common' },
  { id: 'horseshoe', name: '幸运马蹄', icon: '🧲', payout5: 40, payout4: 15, payout3: 6, tier: 'common' },
];

const PAYLINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
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

const PAYLINE_COLORS = ['#ffd700', '#38bdf8', '#f43f5e', '#4ade80', '#c084fc', '#fb923c'];
const BET_OPTIONS = [10, 50, 100, 500, 1000, 5000];
const PARTICLE_ICONS = ['🪙', '✨', '💎', '🌟', '💰'];

interface ParticleItem {
  id: number;
  left: number;
  delay: number;
  duration: number;
  size: number;
  icon: string;
}

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
  const [reelSlamState, setReelSlamState] = useState<boolean[]>([false, false, false, false, false]);
  const [betPerLine, setBetPerLine] = useState(50);
  const [activeLines, setActiveLines] = useState(25);
  const [lastWin, setLastWin] = useState(0);
  const [displayWin, setDisplayWin] = useState(0);
  const [lastXpGain, setLastXpGain] = useState(0);
  const [levelUpBanner, setLevelUpBanner] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [winningLines, setWinningLines] = useState<number[]>([]);
  const [jackpotPool, setJackpotPool] = useState(1888888);
  const [celebration, setCelebration] = useState<'normal' | 'big' | 'jackpot' | null>(null);
  const [cabinetShake, setCabinetShake] = useState(false);
  const [showPaytable, setShowPaytable] = useState(false);
  const [coinParticles, setCoinParticles] = useState<ParticleItem[]>([]);

  const timersRef = useRef<number[]>([]);
  const spinAudioTimerRef = useRef<number | null>(null);
  const countRafRef = useRef<number | null>(null);
  const pendingSettlementRef = useRef<SlotsSpinResponse | null>(null);
  const onBalanceChangeRef = useRef(onBalanceChange);
  const onUserUpdateRef = useRef(onUserUpdate);

  onBalanceChangeRef.current = onBalanceChange;
  onUserUpdateRef.current = onUserUpdate;

  const totalBet = betPerLine * activeLines;

  // 定时微涨 Jackpot 霓虹数字池
  useEffect(() => {
    const timer = window.setInterval(() => {
      setJackpotPool((prev) => prev + Math.floor(Math.random() * 15) + 3);
    }, 1800);
    return () => window.clearInterval(timer);
  }, []);

  // 组件卸载时清理定时器与动画帧，并确保服务端已结算的数据立刻同步到主界面
  useEffect(() => {
    return () => {
      for (const id of timersRef.current) window.clearTimeout(id);
      timersRef.current = [];
      if (spinAudioTimerRef.current !== null) {
        window.clearInterval(spinAudioTimerRef.current);
        spinAudioTimerRef.current = null;
      }
      if (countRafRef.current !== null) {
        window.cancelAnimationFrame(countRafRef.current);
        countRafRef.current = null;
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

  useEffect(() => {
    audio.setInGame(true);
    return () => audio.setInGame(false);
  }, []);

  const animateWinCounter = (target: number) => {
    if (countRafRef.current !== null) window.cancelAnimationFrame(countRafRef.current);
    if (target <= 0) {
      setDisplayWin(0);
      return;
    }
    const startAt = performance.now();
    const duration = Math.min(1200, Math.max(450, target > 10000 ? 1100 : 650));
    const step = (now: number) => {
      const progress = Math.min(1, (now - startAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayWin(Math.round(target * eased));
      if (progress < 1) {
        countRafRef.current = window.requestAnimationFrame(step);
      } else {
        setDisplayWin(target);
        countRafRef.current = null;
      }
    };
    countRafRef.current = window.requestAnimationFrame(step);
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
    setShowPaytable(false);
    setSpinning(true);
    setCelebration(null);
    setCabinetShake(false);
    setWinningLines([]);
    setLastWin(0);
    setDisplayWin(0);
    setCoinParticles([]);
    setReelSlamState([false, false, false, false, false]);
    setReelSpinState([true, true, true, true, true]);
    audio.play('chip_clack');

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

    pendingSettlementRef.current = res;
    onBalanceChange(Math.max(0, res.balance - res.winAmount));

    if (spinAudioTimerRef.current !== null) {
      window.clearInterval(spinAudioTimerRef.current);
    }
    spinAudioTimerRef.current = window.setInterval(() => {
      audio.play('slot_spin');
    }, 115);

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
        setReelSlamState((prev) => {
          const next = [...prev];
          next[c] = true;
          return next;
        });
        const clearSlam = window.setTimeout(() => {
          setReelSlamState((prev) => {
            const next = [...prev];
            next[c] = false;
            return next;
          });
        }, 280);
        timersRef.current.push(clearSlam);
        audio.play('slot_stop');

        if (c === 4) {
          if (spinAudioTimerRef.current !== null) {
            window.clearInterval(spinAudioTimerRef.current);
            spinAudioTimerRef.current = null;
          }
          const revealTimer = window.setTimeout(() => {
            revealResult(res);
          }, 220);
          timersRef.current.push(revealTimer);
        }
      }, 520 + c * 220);
      timersRef.current.push(stopTimer);
    }
  };

  const revealResult = (res: SlotsSpinResponse) => {
    setSpinning(false);
    syncUserFromSpin(res);
    setLastXpGain(res.totalBet);

    if (res.levelsGained > 0) {
      setLevelUpBanner(`🎉 恭喜升级至 Lv.${res.level}！可前往个人中心领取升级筹码！`);
    }

    if (res.winAmount > 0) {
      setLastWin(res.winAmount);
      setWinningLines(res.winningLines);
      animateWinCounter(res.winAmount);

      const isBigOrJackpot = res.isJackpot || res.winAmount >= res.totalBet * 5;
      const particleCount = res.isJackpot ? 64 : isBigOrJackpot ? 44 : 26;
      const particles: ParticleItem[] = Array.from({ length: particleCount }).map((_, i) => ({
        id: Date.now() + i,
        left: Math.random() * 94 + 3,
        delay: Math.random() * 0.65,
        duration: 1.4 + Math.random() * 1.1,
        size: 20 + Math.floor(Math.random() * 16),
        icon: PARTICLE_ICONS[i % PARTICLE_ICONS.length]!,
      }));
      setCoinParticles(particles);

      if (res.isJackpot) {
        setCelebration('jackpot');
        setCabinetShake(true);
        audio.play('slot_jackpot');
      } else if (res.winAmount >= res.totalBet * 5) {
        setCelebration('big');
        setCabinetShake(true);
        audio.play('jackpot');
      } else {
        setCelebration('normal');
        audio.play('slot_win');
      }

      if (isBigOrJackpot) {
        const stopShake = window.setTimeout(() => setCabinetShake(false), 750);
        timersRef.current.push(stopShake);
      }
    }
  };

  // 计算 SVG 激光连线坐标（viewBox: 1000 x 360，5 列 x 3 行精准中心点）
  const visibleWinLines = winningLines.slice(0, 6);

  return (
    <div className="modal-mask slots-stage-mask" onClick={onClose} role="presentation">
      <div
        className={`luxury-slots-cabinet ${spinning ? 'is-cabinet-spinning' : ''} ${celebration ? `has-win is-win-${celebration}` : ''} ${cabinetShake ? 'is-cabinet-shake' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部鎏金霓虹皇冠跑马灯 */}
        <div className="slots-marquee-header">
          <div className="slots-marquee-lights" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className="light-bulb" style={{ animationDelay: `${i * 0.14}s` }} />
            ))}
          </div>

          <div className="slots-jackpot-board">
            <span className="jackpot-neon-title">👑 ROYAL VEGAS · MEGA JACKPOT 👑</span>
            <div className="jackpot-counter-digits">
              <span className="gold-coin-symbol">🪙</span>
              <span>{jackpotPool.toLocaleString()}</span>
            </div>
          </div>

          <div className="slots-header-actions">
            <button
              type="button"
              className={`slots-paytable-btn ${showPaytable ? 'is-active' : ''}`}
              onClick={() => {
                audio.play('click');
                setShowPaytable((v) => !v);
              }}
              title="查看 9 大豪华图标中奖赔率表"
            >
              📊 赔率表
            </button>
            <button
              type="button"
              className="slots-close-btn"
              onClick={onClose}
              title="关闭老虎机"
            >
              ✕
            </button>
          </div>
        </div>

        {/* 顶部彩灯分隔条 */}
        <div className="slots-bulb-strip" aria-hidden="true">
          {Array.from({ length: 18 }).map((_, i) => (
            <span key={i} className="strip-led" style={{ animationDelay: `${(i % 6) * 0.15}s` }} />
          ))}
        </div>

        {/* 异常提示 / 升级横幅 */}
        {errorMsg && (
          <div className="slots-banner slots-banner--error">⚠️ {errorMsg}</div>
        )}
        {levelUpBanner && (
          <div className="slots-banner slots-banner--levelup">{levelUpBanner}</div>
        )}

        {/* 老虎机主滚轮视窗 */}
        <div className="slots-reels-stage">
          <div className="slots-stage-ambient" aria-hidden="true" />

          <div className="slots-reels-frame-wrap">
            <div className="slots-reels-frame">
              {reels.map((col, colIdx) => {
                const isColSpinning = reelSpinState[colIdx];
                const isColSlam = reelSlamState[colIdx];
                return (
                  <div
                    key={colIdx}
                    className={`slots-reel-column ${isColSpinning ? 'is-spinning' : ''} ${isColSlam ? 'is-just-stopped' : ''}`}
                  >
                    {col.map((symId, rowIdx) => {
                      const sym = SYMBOLS.find((s) => s.id === symId) || SYMBOLS[0]!;
                      const isWinCell =
                        winningLines.length > 0 &&
                        winningLines.some((l) => PAYLINES[l]?.[colIdx] === rowIdx);
                      return (
                        <div
                          key={rowIdx}
                          className={`slots-symbol-cell tier-${sym.tier} ${isWinCell ? 'is-win-pulse' : ''}`}
                        >
                          <div className="symbol-halo" />
                          <span className="symbol-icon">{sym.icon}</span>
                          <span className="symbol-name">{sym.name}</span>
                          {sym.isWild && <span className="symbol-badge-wild">WILD</span>}
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {/* SVG 霓虹激光中奖连线层 */}
              {visibleWinLines.length > 0 && !spinning && (
                <svg
                  className="slots-paylines-svg"
                  viewBox="0 0 1000 360"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <filter id="slotsNeonGlow" x="-20%" y="-20%" width="140%" height="140%">
                      <feGaussianBlur stdDeviation="4.5" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  {visibleWinLines.map((lineIdx, idx) => {
                    const pattern = PAYLINES[lineIdx];
                    if (!pattern) return null;
                    const color = PAYLINE_COLORS[idx % PAYLINE_COLORS.length]!;
                    const points = pattern
                      .map((row, col) => `${col * 200 + 100},${row * 120 + 60}`)
                      .join(' ');
                    return (
                      <g key={lineIdx} filter="url(#slotsNeonGlow)">
                        <polyline
                          points={points}
                          fill="none"
                          stroke={color}
                          strokeWidth="7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="slots-payline-beam"
                        />
                        {pattern.map((row, col) => (
                          <circle
                            key={col}
                            cx={col * 200 + 100}
                            cy={row * 120 + 60}
                            r="10"
                            fill="#fff"
                            stroke={color}
                            strokeWidth="4"
                          />
                        ))}
                      </g>
                    );
                  })}
                </svg>
              )}
            </div>

            {/* 滚轮上下 3D 圆柱暗角玻璃罩 */}
            <div className="slots-drum-gloss" aria-hidden="true" />
          </div>

          {/* 赔率表抽屉浮层 */}
          {showPaytable && (
            <div className="slots-paytable-overlay" onClick={() => setShowPaytable(false)}>
              <div className="slots-paytable-card" onClick={(e) => e.stopPropagation()}>
                <div className="paytable-head">
                  <h3>👑 豪华老虎机 · 图标赔率表（按单线注额倍乘）</h3>
                  <button type="button" onClick={() => setShowPaytable(false)}>✕</button>
                </div>
                <div className="paytable-grid">
                  {SYMBOLS.map((s) => (
                    <div key={s.id} className={`paytable-item tier-${s.tier}`}>
                      <span className="paytable-icon">{s.icon}</span>
                      <div className="paytable-info">
                        <strong>{s.name}</strong>
                        <span>
                          5连 <b>×{s.payout5}</b> · 4连 <b>×{s.payout4}</b> · 3连 <b>×{s.payout3}</b>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="paytable-foot">
                  💎 钻石百搭 (WILD) 可替代任意图标连线 · 每次投注 1:1 累计账号有效流水与升级经验！
                </p>
              </div>
            </div>
          )}

          {/* 多阶绚丽中奖庆典浮层（点击可立即关闭继续摇奖） */}
          {celebration && (
            <div
              className={`slots-win-overlay is-${celebration}`}
              onClick={() => setCelebration(null)}
              role="button"
              tabIndex={0}
              title="点击关闭庆典弹窗"
            >
              <div className="win-sunburst-rays" aria-hidden="true" />
              <div className="win-popup-card">
                <span className="win-stars">✨ 🌟 👑 🌟 ✨</span>
                <h2 className="win-title-text">
                  {celebration === 'jackpot'
                    ? '🎆 SUPER JACKPOT 🎆'
                    : celebration === 'big'
                      ? '🔥 MEGA BIG WIN 🔥'
                      : '✨ LUCKY WIN ✨'}
                </h2>
                <div className="win-coins-count">
                  +<b>{displayWin.toLocaleString()}</b>
                </div>
                <div className="win-meta-pills">
                  <span>命中 {winningLines.length} 条赔付线</span>
                  <span>+{lastXpGain.toLocaleString()} 流水经验</span>
                </div>
                <span className="win-congrats-sub">已实时入账 · 点击任意处继续畅玩</span>
              </div>
            </div>
          )}
        </div>

        {/* 状态指示栏：中奖线、本轮赢得、等级经验与实时筹码 */}
        <div className="slots-status-bar">
          <div className="status-metric">
            <span className="metric-label">激活中奖线</span>
            <span className="metric-val">{activeLines} 线</span>
          </div>
          <div className="status-metric metric--win">
            <span className="metric-label">本轮赢得</span>
            <span className="metric-val">
              {lastWin > 0 ? (
                <>
                  <Chip size={15} /> +{displayWin.toLocaleString()}
                </>
              ) : (
                '--'
              )}
            </span>
          </div>
          <div className="status-metric">
            <span className="metric-label">流水经验</span>
            <span className="metric-val metric-val--xp">
              Lv.{user.level ?? 1}
              {lastXpGain > 0 ? ` (+${lastXpGain.toLocaleString()} XP)` : ''}
            </span>
          </div>
          <div className="status-metric">
            <span className="metric-label">我的筹码</span>
            <span className="metric-val metric-val--balance">
              <Chip size={15} /> {user.balance.toLocaleString()}
            </span>
          </div>
        </div>

        {/* 控制台底座 */}
        <div className="slots-control-dashboard">
          <div className="ctrl-group">
            <span className="ctrl-label">单线筹码</span>
            <div className="ctrl-btn-group">
              <button
                type="button"
                className="btn-ctrl-step"
                disabled={spinning}
                onClick={() => {
                  const idx = BET_OPTIONS.indexOf(betPerLine);
                  if (idx > 0) {
                    audio.play('click');
                    setBetPerLine(BET_OPTIONS[idx - 1]!);
                  }
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
                  if (idx < BET_OPTIONS.length - 1) {
                    audio.play('click');
                    setBetPerLine(BET_OPTIONS[idx + 1]!);
                  }
                }}
              >
                +
              </button>
            </div>
          </div>

          <div className="ctrl-group">
            <span className="ctrl-label">中奖线数</span>
            <div className="ctrl-btn-group">
              {[1, 9, 15, 25].map((l) => (
                <button
                  key={l}
                  type="button"
                  className={`btn-ctrl-pill ${activeLines === l ? 'is-active' : ''}`}
                  disabled={spinning}
                  onClick={() => {
                    audio.play('click');
                    setActiveLines(l);
                  }}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="ctrl-group ctrl-group--total">
            <span className="ctrl-label">总押注额</span>
            <div className="total-bet-val">
              <Chip size={16} />
              <b>{totalBet.toLocaleString()}</b>
            </div>
          </div>

          <button
            type="button"
            className="btn-slots-secondary"
            disabled={spinning}
            onClick={() => {
              audio.play('click');
              setBetPerLine(5000);
              setActiveLines(25);
            }}
          >
            🔥 最大下注
          </button>

          <button
            type="button"
            className={`btn-slots-spin ${spinning ? 'is-spinning' : ''}`}
            disabled={spinning || user.balance < totalBet}
            onClick={handleSpin}
          >
            <span className="spin-sheen" aria-hidden="true" />
            <span className="spin-text">{spinning ? 'ROLLING…' : '🎰 SPIN'}</span>
            <span className="spin-sub">手动摇奖 · 1:1 计经验</span>
          </button>
        </div>

        {/* 缤纷金币宝石喷涌粒子特效 */}
        {coinParticles.length > 0 && (
          <div className="slots-coin-rain-fx">
            {coinParticles.map((p) => (
              <span
                key={p.id}
                className="slots-falling-coin"
                style={{
                  left: `${p.left}%`,
                  animationDelay: `${p.delay}s`,
                  animationDuration: `${p.duration}s`,
                  fontSize: `${p.size}px`,
                }}
              >
                {p.icon}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
