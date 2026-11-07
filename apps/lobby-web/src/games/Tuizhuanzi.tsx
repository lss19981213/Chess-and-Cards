import { useEffect, useMemo, useState } from 'react';
import { chipArt } from '../chips';
import { cardBackArt, dotArt } from './cards';

interface DoorView {
  label: string;
  points: number | null;
  cards: Array<{ id: string; rank: number }>;
}

interface TuiSnapshot {
  phase: 'bet' | 'reveal' | 'idle';
  round: number;
  remainMs: number;
  banker: { points: number | null; cards: Array<{ id: string; rank: number }> };
  doors: { heaven: DoorView; earth: DoorView; human: DoorView };
  myBet: { heaven: number; earth: number; human: number };
  doorTotals: { heaven: number; earth: number; human: number };
  myStreak: number;
  results: Array<{ playerId: string; nickname: string; delta: number; detail: string }>;
  history: Array<{
    round: number;
    banker: number;
    heaven: number;
    earth: number;
    human: number;
    winningDoors: string[];
  }>;
  limits: { min: number; max: number; total: number };
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  onBet: (area: string, amount: number) => void;
}

const DOOR_KEYS = ['heaven', 'earth', 'human'] as const;

const PRESET = [10, 50, 100, 500, 1000];

function DoorCards({ cards, revealed }: { cards: Array<{ id: string; rank: number }>; revealed: boolean }) {
  const list = revealed && cards.length > 0 ? cards : [null, null];
  return (
    <div className="tui-cards">
      {list.map((card, index) => (
        <span key={card?.id ?? `back-${index}`} className="tui-card tui-card--md">
          <img src={card ? dotArt(card.rank) : cardBackArt()} alt="" draggable={false} />
        </span>
      ))}
    </div>
  );
}

export function Tuizhuanzi({ snapshot, myId: _myId, status, onBet }: Props) {
  const data = snapshot as unknown as TuiSnapshot | undefined;
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

  const left = Math.max(0, Math.ceil((deadline - now) / 1000));

  const canBet = Boolean(data) && data!.phase === 'bet' && status === 'playing';
  const revealed = Boolean(data) && data!.phase !== 'bet';

  const history = data?.history ?? [];
  const totals = useMemo(() => {
    const bet = data?.myBet ?? { heaven: 0, earth: 0, human: 0 };
    return bet.heaven + bet.earth + bet.human;
  }, [data?.myBet]);

  if (!data) return <div className="board-placeholder">正在连接牌桌…</div>;

  return (
    <div className="lobby-game">
      <div className="lobby-game__main">
        <div className="lobby-game__bar">
          <span className="lobby-game__round">第 {data.round} 局</span>
          <span className={`lobby-game__phase ${data.phase === 'bet' ? 'is-open' : ''}`}>
            {data.phase === 'bet' ? `下注中 · ${left}s` : '已封盘'}
          </span>
          {totals > 0 && <span className="lobby-game__mine">我押了 {totals}</span>}
          {data.myStreak >= 2 && <span className="streak-badge">🔥 连续命中 {data.myStreak}</span>}
        </div>

        <div className="banker-box">
          <div className="banker-box__label">庄家</div>
          <DoorCards cards={data.banker.cards} revealed={revealed} />
          <div className="banker-box__points">
            {revealed && data.banker.points !== null ? `${data.banker.points} 点` : '—'}
          </div>
        </div>

        <div className="doors">
          {DOOR_KEYS.map((key) => {
            const door = data.doors[key];
            const bet = data.myBet[key] ?? 0;
            const won = revealed && door.points !== null && data.banker.points !== null && door.points > data.banker.points;
            return (
              <button
                key={key}
                type="button"
                className={`door ${bet > 0 ? 'is-bet' : ''} ${won ? 'is-win' : ''}`}
                disabled={!canBet}
                onClick={() => onBet(key, amount)}
              >
                <span className="door__label">{door.label}</span>
                <DoorCards cards={door.cards} revealed={revealed} />
                <span className="door__points">
                  {revealed && door.points !== null ? `${door.points} 点` : '待开牌'}
                </span>
                {(data.doorTotals?.[key] ?? 0) > 0 && (
                  <span className="door__pool" key={`pool-${data.doorTotals[key]}`}>
                    <img src={chipArt(data.doorTotals[key])} alt="" />
                    共押 {data.doorTotals[key]}
                  </span>
                )}
                {bet > 0 && (
                  <span className="door__bet" key={bet}>
                    <img src={chipArt(bet)} alt="" />
                    我 {bet}
                  </span>
                )}
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
              {data.limits.min}–{data.limits.max} / 门
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
          <span>庄</span>
          <span>天</span>
          <span>地</span>
          <span>人</span>
        </div>
        <div className="history__list">
          {history.length === 0 && <p className="history__empty">暂无记录</p>}
          {[...history].reverse().map((item) => (
            <div key={item.round} className="history__row">
              <span className="history__no">{item.round}</span>
              <span className="history__banker">{item.banker}</span>
              <span className={item.winningDoors.includes('heaven') ? 'is-hit' : ''}>{item.heaven}</span>
              <span className={item.winningDoors.includes('earth') ? 'is-hit' : ''}>{item.earth}</span>
              <span className={item.winningDoors.includes('human') ? 'is-hit' : ''}>{item.human}</span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
