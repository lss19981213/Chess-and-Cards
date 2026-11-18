import { useEffect, useMemo, useRef, useState } from 'react';
import { BET_PRESET_CHIPS, chipArt, chipTierClass, formatChipLabel } from '../chips';
import { DEALER_MAIN } from '../assets';
import { audio } from '../audio';
import { cnPointText, speakDealerSequence, stopDealerSpeech } from '../speech';
import { usePhaseCountdown } from './usePhaseCountdown';

interface DiceSnapshot {
  phase: 'bet' | 'reveal' | 'idle';
  round: number;
  remainMs: number;
  dice: number[];
  sum: number | null;
  triple: boolean;
  big: boolean | null;
  myBet: Record<string, number>;
  zoneTotals: Record<string, number>;
  myStreak: number;
  phaseDurationMs: number;
  results: Array<{ playerId: string; nickname: string; delta: number; detail: string }>;
  history: Array<{ round: number; dice: number[]; sum: number; triple: boolean; big: boolean }>;
  odds: { big: number; small: number; odd: number; even: number; triple: number; sums: Record<string, number> };
  limits: { min: number; max: number; total: number };
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  balance: number;
  onBet: (area: string, amount: number) => void;
  onClear: (area?: string) => void;
}

const PRESET = BET_PRESET_CHIPS;
const SUM_KEYS = ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17'];

function PhysicalDie({ value, rolling, focused }: { value: number; rolling?: boolean; focused?: boolean }) {
  const isHidden = value <= 0;
  return (
    <div className={`dice-3d-die ${rolling ? 'is-rolling' : ''} ${focused ? 'is-focus-reveal' : ''}`}>
      {isHidden ? (
        <span style={{ fontSize: '26px', color: 'rgba(255,255,255,0.3)', fontWeight: 800 }}>?</span>
      ) : (
        <svg viewBox="0 0 64 64" width="60" height="60">
          <defs>
            <radialGradient id={`redPip-${value}`} cx="40%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#ff4d4f" />
              <stop offset="100%" stopColor="#b30006" />
            </radialGradient>
            <radialGradient id={`darkPip-${value}`} cx="40%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#3d4e68" />
              <stop offset="100%" stopColor="#141a26" />
            </radialGradient>
          </defs>
          {value === 1 && <circle cx="32" cy="32" r="11" fill={`url(#redPip-${value})`} />}
          {value === 2 && (
            <>
              <circle cx="20" cy="20" r="5.5" fill={`url(#darkPip-${value})`} />
              <circle cx="44" cy="44" r="5.5" fill={`url(#darkPip-${value})`} />
            </>
          )}
          {value === 3 && (
            <>
              <circle cx="18" cy="18" r="5" fill={`url(#darkPip-${value})`} />
              <circle cx="32" cy="32" r="5" fill={`url(#darkPip-${value})`} />
              <circle cx="46" cy="46" r="5" fill={`url(#darkPip-${value})`} />
            </>
          )}
          {value === 4 && (
            <>
              <circle cx="20" cy="20" r="5.5" fill={`url(#redPip-${value})`} />
              <circle cx="44" cy="20" r="5.5" fill={`url(#redPip-${value})`} />
              <circle cx="20" cy="44" r="5.5" fill={`url(#redPip-${value})`} />
              <circle cx="44" cy="44" r="5.5" fill={`url(#redPip-${value})`} />
            </>
          )}
          {value === 5 && (
            <>
              <circle cx="18" cy="18" r="5" fill={`url(#darkPip-${value})`} />
              <circle cx="46" cy="18" r="5" fill={`url(#darkPip-${value})`} />
              <circle cx="32" cy="32" r="6" fill={`url(#redPip-${value})`} />
              <circle cx="18" cy="46" r="5" fill={`url(#darkPip-${value})`} />
              <circle cx="46" cy="46" r="5" fill={`url(#darkPip-${value})`} />
            </>
          )}
          {value === 6 && (
            <>
              <circle cx="20" cy="16" r="5" fill={`url(#darkPip-${value})`} />
              <circle cx="44" cy="16" r="5" fill={`url(#darkPip-${value})`} />
              <circle cx="20" cy="32" r="5" fill={`url(#darkPip-${value})`} />
              <circle cx="44" cy="32" r="5" fill={`url(#darkPip-${value})`} />
              <circle cx="20" cy="48" r="5" fill={`url(#darkPip-${value})`} />
              <circle cx="44" cy="48" r="5" fill={`url(#darkPip-${value})`} />
            </>
          )}
        </svg>
      )}
    </div>
  );
}

export function Dice({ snapshot, myId, status, balance, onBet, onClear }: Props) {
  const data = snapshot as unknown as DiceSnapshot | undefined;
  /** 开盅进度：0=未开, 1=第1颗, 2=第2颗, 3=第3颗, 4=总点数揭晓 */
  const [revealStep, setRevealStep] = useState<number>(0);
  const [centerBanner, setCenterBanner] = useState<{ id: number; kind: string; text: string; sub?: string } | null>(
    null,
  );
  const lastPhaseKeyRef = useRef<string>('');
  const cancelSeqRef = useRef<(() => void) | null>(null);
  const bannerIdRef = useRef<number>(1);
  const bannerTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      cancelSeqRef.current?.();
      stopDealerSpeech();
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // 下注阶段持续循环播放真实写实摇骰盅音效
  useEffect(() => {
    if (data?.phase !== 'bet' || status !== 'playing') return;
    audio.play('dice_shake');
    const timer = window.setInterval(() => {
      audio.play('dice_shake');
    }, 1250);
    return () => window.clearInterval(timer);
  }, [data?.phase, data?.round, status]);

  // 开牌阶段：依次揭晓并语音播报每颗骰子点数 → 最后播报总点数（大/小/豹子）
  useEffect(() => {
    if (!data) return;
    const key = `${data.round}:${data.phase}`;
    if (key === lastPhaseKeyRef.current) return;
    lastPhaseKeyRef.current = key;

    const showBanner = (kind: string, text: string, sub?: string, ms = 1800) => {
      const id = bannerIdRef.current++;
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
      setCenterBanner({ id, kind, text, sub });
      bannerTimerRef.current = window.setTimeout(() => {
        setCenterBanner((cur) => (cur?.id === id ? null : cur));
      }, ms);
    };

    if (data.phase === 'bet') {
      cancelSeqRef.current?.();
      cancelSeqRef.current = null;
      setRevealStep(0);
      return;
    }

    if (data.phase === 'idle') {
      setRevealStep(4);
      return;
    }

    if (data.phase === 'reveal' && data.dice.length >= 3) {
      cancelSeqRef.current?.();
      setRevealStep(0);
      audio.play('dice_open');

      const d0 = data.dice[0] ?? 1;
      const d1 = data.dice[1] ?? 1;
      const d2 = data.dice[2] ?? 1;
      const sum = data.sum ?? d0 + d1 + d2;
      const tag = data.triple ? '豹子' : data.big ? '大' : '小';
      const myRow = data.results.find((r) => r.playerId === myId);

      cancelSeqRef.current = speakDealerSequence(
        [
          {
            text: `${cnPointText(d0)}点`,
            onStart: () => {
              setRevealStep(1);
              audio.play('chip_clack');
            },
            delayAfterMs: 220,
          },
          {
            text: `${cnPointText(d1)}点`,
            onStart: () => {
              setRevealStep(2);
              audio.play('chip_clack');
            },
            delayAfterMs: 220,
          },
          {
            text: `${cnPointText(d2)}点`,
            onStart: () => {
              setRevealStep(3);
              audio.play('chip_clack');
            },
            delayAfterMs: 320,
          },
          {
            text: `总计${cnPointText(sum)}点，${tag}！`,
            onStart: () => {
              setRevealStep(4);
              if (data.triple) audio.play('jackpot');
              else if (myRow && myRow.delta > 0) audio.play('win');
              else if (myRow && myRow.delta < 0) audio.play('lose');
              else audio.play('dice_open');
              showBanner(
                data.triple ? 'allin' : 'showdown',
                `🎲 ${d0} · ${d1} · ${d2} ＝ 总计 ${sum} 点（${tag}）`,
                myRow && myRow.delta !== 0
                  ? myRow.delta > 0
                    ? `恭喜赢取 +${myRow.delta.toLocaleString()} 欢乐豆`
                    : `本局结算 ${myRow.delta.toLocaleString()}`
                  : undefined,
                2300,
              );
            },
            delayAfterMs: 0,
          },
        ],
        { gapMs: 220, mutedStepMs: 800 },
      );
    }
  }, [data?.round, data?.phase, data?.dice, data?.sum, data?.triple, data?.big, data?.results, myId]);

  const rankedResults = useMemo(() => {
    const list = [...(data?.results ?? [])];
    list.sort((a, b) => {
      if (a.playerId === myId) return -1;
      if (b.playerId === myId) return 1;
      return Math.abs(b.delta) - Math.abs(a.delta);
    });
    return list;
  }, [data?.results, myId]);

  const [amount, setAmount] = useState<number>(100);
  const { leftSec: left, progressPct: progress } = usePhaseCountdown(
    data?.remainMs,
    data?.phaseDurationMs,
    data?.phase,
    data?.round,
    30_000,
  );

  if (!data) return <div className="board-placeholder">正在连接牌桌…</div>;

  const phaseLabel = data?.phase === 'reveal' ? '开盅报点中' : data?.phase === 'idle' ? '准备下一局' : '摇骰下注中';
  const phaseClass =
    data?.phase === 'bet' ? (left <= 5 ? 'is-urgent' : 'is-open') : data?.phase === 'reveal' ? 'is-reveal' : 'is-idle';

  const canBet = data.phase === 'bet' && status === 'playing';
  const canPlace = canBet && amount > 0 && amount <= balance;
  const revealed = data.phase !== 'bet';
  const sumRevealed = revealed && revealStep >= 4;
  const betting = Object.values(data.myBet).reduce((sum, value) => sum + (value ?? 0), 0);

  const zones: Array<{ key: string; label: string; odds: number }> = [
    { key: 'small', label: '小', odds: data.odds.small },
    { key: 'big', label: '大', odds: data.odds.big },
    { key: 'odd', label: '单', odds: data.odds.odd },
    { key: 'even', label: '双', odds: data.odds.even },
    { key: 'triple', label: '豹子', odds: data.odds.triple },
  ];

  return (
    <div className="lobby-game lobby-game--poker-pro">
      {centerBanner && (
        <div key={centerBanner.id} className={`texas-fx-banner is-${centerBanner.kind}`} role="status" aria-live="polite">
          <strong>{centerBanner.text}</strong>
          {centerBanner.sub && <span>{centerBanner.sub}</span>}
        </div>
      )}

      <div className="lobby-game__main">
        <div className="lobby-game__bar">
          <span className="lobby-game__round">第 {data.round} 局</span>
          <span className={`lobby-game__phase ${phaseClass}`}>
            {phaseLabel} · {left}s
          </span>
          {betting > 0 && <span className="lobby-game__mine">我押了 {betting.toLocaleString()}</span>}
          {data.myStreak >= 2 && <span className="streak-badge">🔥 连续命中 {data.myStreak}</span>}
          <div className="phase-progress"><i style={{ width: `${progress}%` }} /></div>
        </div>

        {/* 动漫美女荷官专属席位 */}
        <div className="table-dealer-host table-dealer-host--dice">
          <div className="dealer-mini-portrait">
            <img src={DEALER_MAIN} alt="荷官艾莉丝" draggable={false} />
          </div>
          <div className="dealer-text-badge">
            <span className="dealer-title">荷官·艾莉丝</span>
            <span className="dealer-action">
              {!revealed ? '摇骰封盅中 · 请下注' : sumRevealed ? '开盅结算完毕' : '逐颗开骰报点中…'}
            </span>
          </div>
        </div>

        <div className="dice-stage">
          <div className="dice-real-tray">
            {revealed ? (
              [0, 1, 2].map((index) => (
                <PhysicalDie
                  key={index}
                  value={revealStep >= index + 1 ? (data.dice[index] ?? 1) : 0}
                  rolling={data.phase === 'reveal' && revealStep === index + 1}
                  focused={revealStep === index + 1}
                />
              ))
            ) : (
              <div className="dice-cup-shaker">
                <span className="dice-cup-icon">🎲</span>
                <span className="dice-cup-text">摇骰封盅中 · 请下注</span>
              </div>
            )}
          </div>
          <div className="dice-stage__sum">
            {sumRevealed && data.sum !== null ? (
              <>
                <strong>{data.sum} 点</strong>
                <span className={data.triple ? 'is-triple' : data.big ? 'is-big' : 'is-small'}>
                  {data.triple ? '豹子通吃' : data.big ? '大 (11~17)' : '小 (4~10)'}
                </span>
              </>
            ) : (
              <span className="muted">
                {revealed ? '正在依次揭晓 3 颗骰子点数…' : '开盅后依次揭晓 3 颗骰子点数'}
              </span>
            )}
          </div>
        </div>

        <div className="dice-zones">
          {zones.map((zone) => {
            const bet = data.myBet[zone.key] ?? 0;
            const won =
              sumRevealed &&
              data.sum !== null &&
              ((zone.key === 'triple' && data.triple) ||
                (!data.triple && zone.key === 'big' && data.big === true) ||
                (!data.triple && zone.key === 'small' && data.big === false) ||
                (!data.triple && zone.key === 'odd' && data.sum % 2 === 1) ||
                (!data.triple && zone.key === 'even' && data.sum % 2 === 0));
            return (
              <button
                key={zone.key}
                type="button"
                className={`dice-zone ${bet > 0 ? 'is-bet' : ''} ${zone.key === 'triple' ? 'is-triple' : ''} ${
                  won ? 'is-win' : ''
                }`}
                disabled={!canPlace}
                onClick={() => {
                  audio.play('poker_chip_bet');
                  onBet(zone.key, amount);
                }}
              >
                <span className="dice-zone__label">{zone.label}</span>
                <span className="dice-zone__odds">1:{zone.odds}</span>
                {(data.zoneTotals?.[zone.key] ?? 0) > 0 && (
                  <span className="dice-zone__pool" key={`pool-${data.zoneTotals[zone.key]}`}>
                    全台 {data.zoneTotals[zone.key]?.toLocaleString()}
                  </span>
                )}
                {bet > 0 ? (
                  <span className="dice-zone__bet" key={bet}>
                    <img src={chipArt(bet)} alt="" />
                    <span>我押 {bet.toLocaleString()}</span>
                    {canBet && (
                      <span
                        className="bet-cancel"
                        role="button"
                        tabIndex={0}
                        title="取消该区下注"
                        onClick={(event) => {
                          event.stopPropagation();
                          audio.play('poker_fold');
                          onClear(zone.key);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.stopPropagation();
                            audio.play('poker_fold');
                            onClear(zone.key);
                          }
                        }}
                      >
                        ×
                      </span>
                    )}
                  </span>
                ) : (
                  <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.3)' }}>未下注</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="dice-sums">
          {SUM_KEYS.map((key) => {
            const bet = data.myBet[`sum-${key}`] ?? 0;
            const pool = data.zoneTotals?.[`sum-${key}`] ?? 0;
            const won = sumRevealed && data.sum !== null && String(data.sum) === key;
            return (
              <button
                key={key}
                type="button"
                className={`dice-sum ${bet > 0 ? 'is-bet' : ''} ${won ? 'is-win' : ''}`}
                disabled={!canPlace}
                onClick={() => {
                  audio.play('poker_chip_bet');
                  onBet(`sum-${key}`, amount);
                }}
                title={`押和值 ${key}，赔率 1:${data.odds.sums[key]}${pool > 0 ? `，全台已押 ${pool}` : ''}`}
              >
                <strong>{key}</strong>
                <span>1:{data.odds.sums[key]}</span>
                {bet > 0 ? (
                  <span className="dice-sum__mybet">已押 {bet}</span>
                ) : pool > 0 ? (
                  <span style={{ fontSize: '9px', color: 'rgba(255,255,255,0.4)' }}>台{pool}</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="bet-controls">
          <div className="bet-controls__chips">
            {PRESET.map((value) => (
              <button
                key={value}
                type="button"
                className={`chip-btn ${chipTierClass(value)} ${amount === value ? 'is-active' : ''}`}
                onClick={() => {
                  audio.play('click');
                  setAmount(value);
                }}
              >
                <img src={chipArt(value)} alt="" />
                <span>{formatChipLabel(value)}</span>
              </button>
            ))}
          </div>
          {canBet && betting > 0 && (
            <button
              type="button"
              className="ghost clear-bet-btn"
              onClick={() => {
                audio.play('poker_fold');
                onClear();
              }}
            >
              清空下注
            </button>
          )}
          <div className="bet-controls__custom">
            <span>自定义</span>
            <input
              type="number"
              min={data.limits.min}
              step={10}
              value={amount}
              onChange={(event) => {
                const next = Number(event.target.value);
                setAmount(Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0);
              }}
            />
            <span className="bet-controls__hint">
              底注 {data.limits.min} · 无上限自由下注
            </span>
          </div>
        </div>

        {sumRevealed && data.results.length > 0 && (
          <div className="lobby-results">
            {rankedResults.map((row) => (
              <span
                key={row.playerId}
                className={`${row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'muted'} ${
                  row.playerId === myId ? 'is-me' : ''
                }`}
              >
                {row.playerId === myId ? '我' : row.nickname}{' '}
                {row.delta > 0 ? `+${row.delta.toLocaleString()}` : row.delta.toLocaleString()}
              </span>
            ))}
          </div>
        )}
      </div>

      <aside className="history">
        <div className="history__title">走势</div>
        <div className="history__legend history__legend--dice">
          <span>局</span>
          <span>骰</span>
          <span>和</span>
          <span>果</span>
        </div>
        <div className="history__list">
          {data.history.length === 0 && <p className="history__empty">暂无记录</p>}
          {[...data.history].reverse().map((item) => (
            <div key={item.round} className="history__row history__row--dice">
              <span className="history__no">{item.round}</span>
              <span className="history__dice">{item.dice.join(' ')}</span>
              <span className="history__banker">{item.sum}</span>
              <span className={item.triple ? 'is-triple' : item.big ? 'is-big' : 'is-small'}>
                {item.triple ? '豹' : item.big ? '大' : '小'}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
