import { useMemo, useState } from 'react';
import { chipArt } from '../chips';
import { DEALER_MAIN } from '../assets';
import { audio } from '../audio';
import { cardArt, cardBackArt, cardLabel, type CardView } from './cards';

interface BlackjackSnapshot {
  phase: string;
  round: number;
  remainMs: number;
  phaseDurationMs: number;
  dealerCards: Array<CardView | null>;
  dealerPoints: number | null;
  myCards: CardView[];
  myPoints: number | null;
  myDone: boolean;
  others: Array<{ playerId: string; count: number; done: boolean }>;
  myBet: Record<string, number>;
  zoneTotals: Record<string, number>;
  results: Array<{ playerId: string; nickname: string; delta: number; detail: string }>;
  history: Array<{ round: number; playerPoints: number | null; dealerPoints: number; outcome: string }>;
  limits: { min: number; max: number; total: number };
  areas: Array<{ area: string; label: string; odds: number }>;
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  balance: number;
  onBet: (area: string, amount: number) => void;
  onClear: (area?: string) => void;
  onAction: (cmd: string, amount?: number) => void;
}

const PRESET = [10, 50, 100, 500, 1000];

export function Blackjack({ snapshot, myId, status, balance, onBet, onClear, onAction }: Props) {
  const data = snapshot as unknown as BlackjackSnapshot | undefined;
  const [amount, setAmount] = useState(100);

  const canBet = data?.phase === 'bet' && status === 'playing';
  const playing = data?.phase === 'play' && status === 'playing';
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
  const duration = Math.max(1, Math.round((data?.phaseDurationMs ?? 25000) / 1000));
  const progress = Math.min(100, Math.max(0, ((duration - left) / duration) * 100));

  if (!data) return <div className="board-placeholder">等待发牌…</div>;

  const handleHit = () => {
    audio.play('click');
    onAction('hit');
  };

  const handleStand = () => {
    audio.play('pass');
    onAction('stand');
  };

  const handleDouble = () => {
    audio.play('chip_clack');
    onAction('double');
  };

  return (
    <div className="lobby-game lobby-game--bj">
      <div className="lobby-game__main">
        {/* 顶部状态条 */}
        <div className="lobby-game__bar">
          <span className="lobby-game__round">第 {data.round} 局</span>
          <span className={`lobby-game__phase ${data.phase === 'bet' ? 'is-open' : 'is-reveal'}`}>
            {data.phase === 'bet' ? `下注阶段 · ${left}s` : data.phase === 'play' ? `要牌决战 · ${left}s` : `结算开牌`}
          </span>
          {betting > 0 && <span className="lobby-game__mine">已下注 {betting}</span>}
          <div className="phase-progress"><i style={{ width: `${progress}%` }} /></div>
        </div>

        {/* 动漫美女荷官专属席位 */}
        <div className="table-dealer-host">
          <div className="dealer-mini-portrait">
            <img src={DEALER_MAIN} alt="荷官艾莉丝" draggable={false} />
          </div>
          <div className="dealer-text-badge">
            <span className="dealer-title">荷官·艾莉丝</span>
            <span className="dealer-action">{playing ? '等待玩家要牌' : '发牌洗牌中'}</span>
          </div>
        </div>

        {/* 庄家手牌与我的手牌展台 */}
        <div className="dice-stage__cards bj-table-cards">
          <div className="bj-row">
            <span className="bj-row__tag">庄家手牌</span>
            <div className="bj-row__hand">
              {data.dealerCards.length === 0 ? (
                <span className="pcard pcard--back">
                  <img src={cardBackArt()} alt="" draggable={false} />
                </span>
              ) : (
                data.dealerCards.map((card, index) => (
                  <span key={card?.id ?? `hole-${index}`} className="pcard">
                    <img src={card ? cardArt(card.id) : cardBackArt()} alt={card ? cardLabel(card) : ''} draggable={false} />
                  </span>
                ))
              )}
            </div>
            {data.dealerPoints !== null && <strong className="bj-row__points">{data.dealerPoints} 点</strong>}
          </div>

          <div className="bj-row">
            <span className="bj-row__tag">我的手牌</span>
            <div className="bj-row__hand">
              {data.myCards.length === 0 ? (
                <span className="muted">下注后发牌</span>
              ) : (
                data.myCards.map((card) => (
                  <span key={card.id} className="pcard">
                    <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                  </span>
                ))
              )}
            </div>
            {data.myPoints !== null && (
              <strong className={`bj-row__points ${data.myPoints > 21 ? 'is-bust' : ''}`}>
                {data.myPoints > 21 ? `${data.myPoints} 点 (爆牌)` : `${data.myPoints} 点`}
              </strong>
            )}
          </div>
        </div>

        {/* 要牌 / 停牌 / 加倍 操作区 */}
        {playing && !data.myDone && (
          <div className="bj-actions hand-actions--luxury">
            <button type="button" className="action-btn action-btn--play" onClick={handleHit}>
              + 要牌 (Hit)
            </button>
            <button type="button" className="action-btn action-btn--hint" onClick={handleStand}>
              停牌 (Stand)
            </button>
            {data.myCards.length === 2 && balance >= betting && (
              <button type="button" className="action-btn action-btn--pass" onClick={handleDouble}>
                加倍 (Double)
              </button>
            )}
          </div>
        )}

        {/* 下注控制区 */}
        <div className="bet-controls">
          <div className="bet-controls__chips">
            {PRESET.map((value) => (
              <button
                key={value}
                type="button"
                className={`chip-btn ${amount === value ? 'is-active' : ''}`}
                onClick={() => {
                  audio.play('click');
                  setAmount(value);
                }}
              >
                <img src={chipArt(value)} alt="" />
                <span>{value}</span>
              </button>
            ))}
          </div>

          {canBet && (
            <div className="bj-bet-zones">
              {(data.areas ?? [{ area: 'main', label: '主注', odds: 1 }]).map((area) => (
                <button
                  key={area.area}
                  type="button"
                  className={`door ${data.myBet[area.area] ? 'is-bet' : ''}`}
                  disabled={!canPlace}
                  onClick={() => {
                    audio.play('chip_clack');
                    onBet(area.area, amount);
                  }}
                >
                  <span className="door__label">{area.label}</span>
                  <span className="door__points">1:{area.odds}</span>
                  {data.myBet[area.area] ? <span className="door__bet">我押 {data.myBet[area.area]}</span> : null}
                </button>
              ))}
            </div>
          )}

          {canBet && betting > 0 && (
            <button
              type="button"
              className="ghost clear-bet-btn"
              onClick={() => {
                audio.play('click');
                onClear();
              }}
            >
              清空下注
            </button>
          )}
        </div>

        {/* 结果栏 */}
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

      {/* 历史走势 */}
      <aside className="history">
        <div className="history__title">走势</div>
        <div className="history__legend">
          <span>局</span>
          <span>我</span>
          <span>庄</span>
          <span>果</span>
        </div>
        <div className="history__list">
          {data.history.length === 0 && <p className="history__empty">暂无记录</p>}
          {[...data.history].reverse().map((item) => (
            <div key={item.round} className="history__row">
              <span className="history__no">{item.round}</span>
              <span>{item.playerPoints ?? '—'}</span>
              <span>{item.dealerPoints}</span>
              <span className={item.outcome === 'win' ? 'is-hit' : ''}>
                {item.outcome === 'win' ? '胜' : item.outcome === 'lose' ? '负' : '平'}
              </span>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
