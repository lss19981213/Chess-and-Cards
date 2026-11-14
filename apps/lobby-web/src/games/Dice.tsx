import { useEffect, useState, useMemo } from 'react';
import { chipArt } from '../chips';
import { DEALER_MAIN } from '../assets';

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

const PRESET = [10, 50, 100, 500, 1000, 2000, 5000, 10000, 100000];
const SUM_KEYS = ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17'];

function PhysicalDie({ value, rolling }: { value: number; rolling?: boolean }) {
  const isHidden = value <= 0;
  return (
    <div className={`dice-3d-die ${rolling ? 'is-rolling' : ''}`}>
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
  // 真人优先展示，其后按输赢排序，避免机器人结果被真人挤掉
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
  const [deadline, setDeadline] = useState<number>(() => Date.now() + (data?.remainMs ?? 0));
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    // 倒计时以秒为单位，1s 刷新足够
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (data) setDeadline(Date.now() + data.remainMs);
  }, [data?.remainMs, data?.phase, data?.round]);

  if (!data) return <div className="board-placeholder">正在连接牌桌…</div>;

  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const durationSec = Math.max(1, Math.round((data?.phaseDurationMs ?? 30_000) / 1000));
  const progress = Math.min(100, Math.max(0, (left / durationSec) * 100));
  const phaseLabel = data?.phase === 'reveal' ? '开牌中' : data?.phase === 'idle' ? '准备下一局' : '下注中';
  const phaseClass = data?.phase === 'bet' ? (left <= 5 ? 'is-urgent' : 'is-open') : data?.phase === 'reveal' ? 'is-reveal' : 'is-idle';

  const canBet = data.phase === 'bet' && status === 'playing';
  // 余额在下注时已即时扣除，不允许超额下注
  const canPlace = canBet && amount > 0 && amount <= balance;
  const revealed = data.phase !== 'bet';
  const betting = Object.values(data.myBet).reduce((sum, value) => sum + (value ?? 0), 0);

  const zones: Array<{ key: string; label: string; odds: number }> = [
    { key: 'small', label: '小', odds: data.odds.small },
    { key: 'big', label: '大', odds: data.odds.big },
    { key: 'odd', label: '单', odds: data.odds.odd },
    { key: 'even', label: '双', odds: data.odds.even },
    { key: 'triple', label: '豹子', odds: data.odds.triple },
  ];

  return (
    <div className="lobby-game">
      <div className="lobby-game__main">
        <div className="lobby-game__bar">
          <span className="lobby-game__round">第 {data.round} 局</span>
          <span className={`lobby-game__phase ${phaseClass}`}>
            {phaseLabel} · {left}s
          </span>
          {betting > 0 && <span className="lobby-game__mine">我押了 {betting}</span>}
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
            <span className="dealer-action">{revealed ? '开盅见喜' : '摇骰封盅中'}</span>
          </div>
        </div>

        <div className="dice-stage">
          <div className="dice-real-tray">
            {revealed ? (
              [0, 1, 2].map((index) => (
                <PhysicalDie key={index} value={data.dice[index] ?? 1} rolling={data.phase === 'reveal'} />
              ))
            ) : (
              <div className="dice-cup-shaker">
                <span className="dice-cup-icon">🎲</span>
                <span className="dice-cup-text">摇骰封盅中 · 请下注</span>
              </div>
            )}
          </div>
          <div className="dice-stage__sum">
            {revealed && data.sum !== null ? (
              <>
                <strong>{data.sum} 点</strong>
                <span className={data.triple ? 'is-triple' : data.big ? 'is-big' : 'is-small'}>
                  {data.triple ? '豹子通吃' : data.big ? '大 (11~17)' : '小 (4~10)'}
                </span>
              </>
            ) : (
              <span className="muted">开盅后揭晓 3 颗骰子点数</span>
            )}
          </div>
        </div>

        <div className="dice-zones">
          {zones.map((zone) => {
            const bet = data.myBet[zone.key] ?? 0;
            return (
              <button
                key={zone.key}
                type="button"
                className={`dice-zone ${bet > 0 ? 'is-bet' : ''} ${zone.key === 'triple' ? 'is-triple' : ''}`}
                disabled={!canPlace}
                onClick={() => onBet(zone.key, amount)}
              >
                <span className="dice-zone__label">{zone.label}</span>
                <span className="dice-zone__odds">1:{zone.odds}</span>
                {(data.zoneTotals?.[zone.key] ?? 0) > 0 && (
                  <span className="dice-zone__pool" key={`pool-${data.zoneTotals[zone.key]}`}>
                    全台 {data.zoneTotals[zone.key]}
                  </span>
                )}
                {bet > 0 ? (
                  <span className="dice-zone__bet" key={bet}>
                    <img src={chipArt(bet)} alt="" />
                    <span>我押 {bet}</span>
                    {canBet && (
                      <span
                        className="bet-cancel"
                        role="button"
                        tabIndex={0}
                        title="取消该区下注"
                        onClick={(event) => {
                          event.stopPropagation();
                          onClear(zone.key);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.stopPropagation();
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
            return (
              <button
                key={key}
                type="button"
                className={`dice-sum ${bet > 0 ? 'is-bet' : ''}`}
                disabled={!canPlace}
                onClick={() => onBet(`sum-${key}`, amount)}
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
                className={`chip-btn ${amount === value ? 'is-active' : ''}`}
                onClick={() => setAmount(value)}
              >
                <img src={chipArt(value)} alt="" />
                <span>{value}</span>
              </button>
            ))}
          </div>
          {canBet && betting > 0 && (
            <button type="button" className="ghost clear-bet-btn" onClick={() => onClear()}>
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

        {data.results.length > 0 && (
          <div className="lobby-results">
            {rankedResults.map((row) => (
              <span
                key={row.playerId}
                className={`${row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'muted'} ${
                  row.playerId === myId ? 'is-me' : ''
                }`}
              >
                {row.playerId === myId ? '我' : row.nickname} {row.delta > 0 ? `+${row.delta}` : row.delta}
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
