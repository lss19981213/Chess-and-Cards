import { useMemo, useState } from 'react';
import { chipArt } from '../chips';
import { cardArt, cardBackArt, cardLabel, type CardView } from './cards';

interface NiuniuSnapshot {
  phase: string;
  round: number;
  remainMs: number;
  phaseDurationMs: number;
  cards: CardView[];
  niu: number | null;
  label: string;
  myBet: Record<string, number>;
  zoneTotals: Record<string, number>;
  results: Array<{ playerId: string; nickname: string; delta: number; detail: string }>;
  history: Array<{ round: number; cards: number[]; niu: number; label: string }>;
  limits: { min: number; max: number; total: number };
  areas: Array<{ area: string; label: string }>;
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  balance: number;
  onBet: (area: string, amount: number) => void;
  onClear: (area?: string) => void;
}

const PRESET = [10, 50, 100, 500, 1000];

export function Niuniu({ snapshot, myId, status, balance, onBet, onClear }: Props) {
  const data = snapshot as unknown as NiuniuSnapshot | undefined;
  const [amount, setAmount] = useState(100);

  const canBet = data?.phase === 'bet' && status === 'playing';
  const betting = useMemo(
    () => Object.values(data?.myBet ?? {}).reduce((sum, value) => sum + (value ?? 0), 0),
    [data?.myBet],
  );
  const canPlace = canBet && amount > 0 && amount <= balance;

  const rankedResults = useMemo(() => {
    const list = [...(data?.results ?? [])];
    list.sort((a, b) => {
      const aBot = a.playerId.startsWith('ambient:');
      const bBot = b.playerId.startsWith('ambient:');
      if (aBot !== bBot) return aBot ? 1 : -1;
      return b.delta - a.delta;
    });
    const mine = list.filter((row) => row.playerId === myId);
    const rest = list.filter((row) => row.playerId !== myId);
    return [...mine, ...rest].slice(0, 12);
  }, [data?.results, myId]);

  const left = Math.max(0, Math.ceil((data?.remainMs ?? 0) / 1000));
  const duration = Math.max(1, Math.round((data?.phaseDurationMs ?? 30000) / 1000));
  const progress = Math.min(100, Math.max(0, ((duration - left) / duration) * 100));

  if (!data) return <div className="board-placeholder">等待发牌…</div>;

  return (
    <div className="dice-stage">
      <div className="dice-stage__main">
        <div className="dice-stage__cards">
          {data.cards.length === 0 ? (
            <div className="dice-stage__dice-row">
              {[0, 1, 2].map((i) => (
                <span key={i} className="card">
                  <img src={cardBackArt()} alt="" />
                </span>
              ))}
            </div>
          ) : (
            <div className="dice-stage__dice-row">
              {data.cards.map((card) => (
                <span key={card.id} className="card">
                  <img src={cardArt(card.id)} alt={cardLabel(card)} />
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="dice-stage__sum">
          {data.label ? (
            <>
              <strong>{data.label}</strong>
              <span className={data.niu === 0 ? 'is-small' : data.niu === 10 ? 'is-triple' : 'is-big'}>
                {data.niu === 0 ? '无牛' : data.niu === 10 ? '牛牛' : `牛${data.niu}`}
              </span>
            </>
          ) : (
            <span className="muted">等待开牌</span>
          )}
        </div>
      </div>

      <div className="dice-zones">
        {(data.areas ?? []).map((zone) => {
          const bet = data.myBet[zone.area] ?? 0;
          return (
            <button
              key={zone.area}
              type="button"
              className={`dice-zone ${bet > 0 ? 'is-bet' : ''} ${zone.area === 'niu-n' ? 'is-triple' : ''}`}
              disabled={!canPlace}
              onClick={() => onBet(zone.area, amount)}
            >
              <span className="dice-zone__label">{zone.label}</span>
              <span className="dice-zone__odds">1:1</span>
              {(data.zoneTotals?.[zone.area] ?? 0) > 0 && (
                <span className="dice-zone__pool" key={`pool-${data.zoneTotals[zone.area]}`}>
                  共押 {data.zoneTotals[zone.area]}
                </span>
              )}
              {bet > 0 && (
                <span className="dice-zone__bet" key={bet}>
                  <img src={chipArt(bet)} alt="" />
                  {bet}
                  {canBet && (
                    <span
                      className="bet-cancel"
                      role="button"
                      tabIndex={0}
                      title="取消该区下注"
                      onClick={(event) => {
                        event.stopPropagation();
                        onClear(zone.area);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.stopPropagation();
                          onClear(zone.area);
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

      <div className="dice-stage__timer">
        <div className="dice-stage__timer-bar">
          <i style={{ width: `${progress}%` }} />
        </div>
        <span>
          第 {data.round} 局 · {canBet ? '下注中' : '开牌中'} {left}s
        </span>
      </div>

      <aside className="history">
        <div className="history__title">走势</div>
        <div className="history__legend history__legend--dice">
          <span>局</span>
          <span>牌</span>
          <span>和</span>
          <span>果</span>
        </div>
        <div className="history__list">
          {data.history.length === 0 && <p className="history__empty">暂无记录</p>}
          {[...data.history].reverse().map((item) => (
            <div key={item.round} className="history__row history__row--dice">
              <span className="history__no">{item.round}</span>
              <span className="history__dice">{item.cards.join(' ')}</span>
              <span className="history__banker">{item.niu === 10 ? '牛牛' : item.niu === 0 ? '无牛' : item.niu}</span>
              <span className={item.niu === 0 ? 'is-small' : item.niu === 10 ? 'is-triple' : 'is-big'}>
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
