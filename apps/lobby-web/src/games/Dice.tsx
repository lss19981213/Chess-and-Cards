import { useEffect, useState } from 'react';
import { chipArt } from '../chips';

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
  onBet: (area: string, amount: number) => void;
}

const PRESET = [10, 50, 100, 500, 1000];
const SUM_KEYS = ['4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17'];

const FACE_DOTS: Record<number, number[][]> = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

function Die({ value, rolling }: { value: number; rolling: boolean }) {
  const dots = FACE_DOTS[value] ?? [];
  return (
    <div className={`die ${rolling ? 'is-rolling' : ''} ${value === 0 ? 'is-hidden' : ''}`}>
      {value === 0 ? (
        <span className="die__q">?</span>
      ) : (
        dots.map(([x = 0, y = 0], index) => (
          <span
            key={index}
            className="die__pip"
            style={{ left: `${50 + x * 26}%`, top: `${50 + y * 26}%` }}
          />
        ))
      )}
    </div>
  );
}

export function Dice({ snapshot, myId: _myId, status, onBet }: Props) {
  const data = snapshot as unknown as DiceSnapshot | undefined;
  const [amount, setAmount] = useState(100);
  const [now, setNow] = useState(Date.now());
  const [deadline, setDeadline] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (data) setDeadline(Date.now() + data.remainMs);
  }, [data?.remainMs, data?.phase, data?.round]);

  if (!data) return <div className="board-placeholder">正在连接骰桌…</div>;

  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  const durationSec = Math.max(1, Math.round((data?.phaseDurationMs ?? 30_000) / 1000));
  const progress = Math.min(100, Math.max(0, (left / durationSec) * 100));
  const phaseLabel = data?.phase === 'reveal' ? '开牌中' : data?.phase === 'idle' ? '准备下一局' : '下注中';
  const phaseClass = data?.phase === 'bet' ? (left <= 5 ? 'is-urgent' : 'is-open') : data?.phase === 'reveal' ? 'is-reveal' : 'is-idle';

  const canBet = data.phase === 'bet' && status === 'playing';
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

        <div className="dice-stage">
          <div className="dice-stage__tray">
            {[0, 1, 2].map((index) => (
              <Die key={index} value={revealed ? data.dice[index] ?? 0 : 0} rolling={revealed} />
            ))}
          </div>
          <div className="dice-stage__sum">
            {revealed && data.sum !== null ? (
              <>
                <strong>{data.sum}</strong>
                <span className={data.triple ? 'is-triple' : data.big ? 'is-big' : 'is-small'}>
                  {data.triple ? '豹子通吃' : data.big ? '大' : '小'}
                </span>
              </>
            ) : (
              <span className="muted">等待开盅</span>
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
                disabled={!canBet}
                onClick={() => onBet(zone.key, amount)}
              >
                <span className="dice-zone__label">{zone.label}</span>
                <span className="dice-zone__odds">1:{zone.odds}</span>
                {(data.zoneTotals?.[zone.key] ?? 0) > 0 && (
                  <span className="dice-zone__pool" key={`pool-${data.zoneTotals[zone.key]}`}>
                    共押 {data.zoneTotals[zone.key]}
                  </span>
                )}
                {bet > 0 && (
                  <span className="dice-zone__bet" key={bet}>
                    <img src={chipArt(bet)} alt="" />
                    {bet}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="dice-sums">
          {SUM_KEYS.map((key) => {
            const bet = data.myBet[`sum-${key}`] ?? 0;
            return (
              <button
                key={key}
                type="button"
                className={`dice-sum ${bet > 0 ? 'is-bet' : ''}`}
                disabled={!canBet}
                onClick={() => onBet(`sum-${key}`, amount)}
                title={`押和值 ${key}，赔率 1:${data.odds.sums[key]}`}
              >
                <strong>{key}</strong>
                <span>1:{data.odds.sums[key]}</span>
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
          <div className="bet-controls__custom">
            <span>自定义</span>
            <input
              type="number"
              min={data.limits.min}
              max={data.limits.max}
              step={10}
              value={amount}
              onChange={(event) => {
                const next = Number(event.target.value);
                setAmount(Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0);
              }}
            />
            <span className="bet-controls__hint">
              {data.limits.min}–{data.limits.max} / 区
            </span>
          </div>
        </div>

        {data.results.length > 0 && (
          <div className="lobby-results">
            {data.results.slice(0, 4).map((row) => (
              <span key={row.playerId} className={row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'muted'}>
                {row.nickname} {row.delta > 0 ? `+${row.delta}` : row.delta}
              </span>
            ))}
          </div>
        )}
      </div>

      <aside className="history">
        <div className="history__title">走势</div>
        <div className="history__legend">
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
