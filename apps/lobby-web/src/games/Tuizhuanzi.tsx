import { useEffect, useMemo, useState } from 'react';
import { chipArt } from '../chips';
import { DEALER_MAIN } from '../assets';
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
  phaseDurationMs: number;
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
  balance: number;
  onBet: (area: string, amount: number) => void;
  onClear: (area?: string) => void;
}

const DOOR_KEYS = ['heaven', 'earth', 'human'] as const;

const PRESET = [10, 50, 100, 500, 1000, 2000, 5000, 10000, 100000];

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

export function Tuizhuanzi({ snapshot, myId, status, balance, onBet, onClear }: Props) {
  const data = snapshot as unknown as TuiSnapshot | undefined;
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
    const timer = setInterval(() => setNow(Date.now()), 200);
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
  const totals = data.myBet.heaven + data.myBet.earth + data.myBet.human;
  const history = data.history ?? [];

  return (
    <div className="lobby-game">
      <div className="lobby-game__main">
        <div className="lobby-game__bar">
          <span className="lobby-game__round">第 {data.round} 局</span>
          <span className={`lobby-game__phase ${phaseClass}`}>
            {phaseLabel} · {left}s
          </span>
          {totals > 0 && <span className="lobby-game__mine">我押了 {totals}</span>}
          {data.myStreak >= 2 && <span className="streak-badge">🔥 连续命中 {data.myStreak}</span>}
          <div className="phase-progress"><i style={{ width: `${progress}%` }} /></div>
        </div>

        {/* 动漫美女荷官专属席位 */}
        <div className="table-dealer-host">
          <div className="dealer-mini-portrait">
            <img src={DEALER_MAIN} alt="荷官艾莉丝" draggable={false} />
          </div>
          <div className="dealer-text-badge">
            <span className="dealer-title">荷官·艾莉丝</span>
            <span className="dealer-action">{revealed ? '开牌核验' : '洗牌发牌中'}</span>
          </div>
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
                disabled={!canPlace}
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
                    {canBet && (
                      <span
                        className="bet-cancel"
                        role="button"
                        tabIndex={0}
                        title="取消该区下注"
                        onClick={(event) => {
                          event.stopPropagation();
                          onClear(key);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.stopPropagation();
                            onClear(key);
                          }
                        }}
                      >
                        ×
                      </span>
                    )}
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
          {canBet && totals > 0 && (
            <button type="button" className="ghost clear-bet-btn" onClick={() => onClear()}>
              清空下注
            </button>
          )}
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
