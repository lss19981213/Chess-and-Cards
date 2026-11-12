import { useEffect, useState, useMemo } from 'react';
import { chipArt } from '../chips';
import { DEALER_MAIN } from '../assets';
import { cardArt, cardLabel, isRedCard, type CardView } from './cards';

interface SideView {
  points: number | null;
  cards: CardView[];
}

interface BacSnapshot {
  phase: 'bet' | 'reveal' | 'idle';
  round: number;
  remainMs: number;
  player: SideView;
  banker: SideView;
  outcome: 'player' | 'banker' | 'tie' | null;
  myBet: { player: number; banker: number; tie: number };
  zoneTotals: Record<string, number>;
  myStreak: number;
  phaseDurationMs: number;
  results: Array<{ playerId: string; nickname: string; delta: number; detail: string }>;
  history: Array<{ round: number; playerPoints: number; bankerPoints: number; outcome: string }>;
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

const ZONES: Array<{ key: 'player' | 'banker' | 'tie'; label: string; odds: string }> = [
  { key: 'player', label: '闲', odds: '1 : 1' },
  { key: 'banker', label: '庄', odds: '1 : 0.95' },
  { key: 'tie', label: '和', odds: '1 : 8' },
];

const OUTCOME_TEXT: Record<string, string> = { player: '闲赢', banker: '庄赢', tie: '和局' };

function Hand({ side, revealed }: { side: SideView; revealed: boolean }) {
  const cards = revealed ? side.cards : [];
  return (
    <div className="bac-hand">
      <div className="bac-hand__cards">
        {revealed ? (
          cards.map((card) => (
            <div key={card.id} className={`pcard pcard--lg ${isRedCard(card) ? 'is-red' : ''}`}>
              <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
            </div>
          ))
        ) : (
          <>
            <div className="pcard pcard--lg pcard--back">
              <img src={cardArt('back')} alt="" draggable={false} />
            </div>
            <div className="pcard pcard--lg pcard--back">
              <img src={cardArt('back')} alt="" draggable={false} />
            </div>
          </>
        )}
      </div>
      <div className="bac-hand__points">{revealed && side.points !== null ? `${side.points} 点` : '—'}</div>
    </div>
  );
}

export function Baccarat({ snapshot, myId, status, balance, onBet, onClear }: Props) {
  const data = snapshot as unknown as BacSnapshot | undefined;
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
    // 倒计时以秒为单位，1s 刷新足够；200ms 会让整张牌桌每秒重建 5 次
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
  const betting = data.myBet.player + data.myBet.banker + data.myBet.tie;

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
        <div className="table-dealer-host">
          <div className="dealer-mini-portrait">
            <img src={DEALER_MAIN} alt="荷官艾莉丝" draggable={false} />
          </div>
          <div className="dealer-text-badge">
            <span className="dealer-title">荷官·艾莉丝</span>
            <span className="dealer-action">{revealed ? '验牌开奖' : '派牌中 (闲/庄)'}</span>
          </div>
        </div>

        <div className="bac-table">
          <div className="bac-side">
            <span className="bac-side__label">闲</span>
            <Hand side={data.player} revealed={revealed} />
          </div>

          <div className="bac-center">
            {revealed && data.outcome ? (
              <span className={`bac-outcome is-${data.outcome}`}>{OUTCOME_TEXT[data.outcome]}</span>
            ) : (
              <span className="muted">VS</span>
            )}
          </div>

          <div className="bac-side">
            <span className="bac-side__label">庄</span>
            <Hand side={data.banker} revealed={revealed} />
          </div>
        </div>

        <div className="bac-zones">
          {ZONES.map((zone) => {
            const bet = data.myBet[zone.key] ?? 0;
            const won = revealed && data.outcome === zone.key;
            return (
              <button
                key={zone.key}
                type="button"
                className={`bac-zone ${bet > 0 ? 'is-bet' : ''} ${won ? 'is-win' : ''}`}
                disabled={!canPlace}
                onClick={() => onBet(zone.key, amount)}
              >
                <span className="bac-zone__label">{zone.label}</span>
                <span className="bac-zone__odds">{zone.odds}</span>
                {(data.zoneTotals?.[zone.key] ?? 0) > 0 && (
                  <span className="bac-zone__pool" key={`pool-${data.zoneTotals[zone.key]}`}>
                    共押 {data.zoneTotals[zone.key]}
                  </span>
                )}
                {bet > 0 && (
                  <span className="bac-zone__bet" key={bet}>
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
      </div>

      <aside className="history">
        <div className="history__title">走势</div>
        <div className="history__legend history__legend--dice">
          <span>局</span>
          <span>闲</span>
          <span>庄</span>
          <span>果</span>
        </div>
        <div className="history__list">
          {data.history.length === 0 && <p className="history__empty">暂无记录</p>}
          {[...data.history].reverse().map((item) => (
            <div key={item.round} className="history__row history__row--dice">
              <span className="history__no">{item.round}</span>
              <span className="history__banker">{item.playerPoints}</span>
              <span>{item.bankerPoints}</span>
              <span
                className={
                  item.outcome === 'player' ? 'is-small' : item.outcome === 'banker' ? 'is-big' : 'is-triple'
                }
              >
                {item.outcome === 'player' ? '闲' : item.outcome === 'banker' ? '庄' : '和'}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
