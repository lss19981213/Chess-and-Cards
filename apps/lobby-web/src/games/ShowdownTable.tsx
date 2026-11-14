import { useState } from 'react';
import { cardArt, cardLabel, isRedCard, type CardView } from './cards';
import { audio } from '../audio';

interface ShowdownSnapshot {
  phase: string;
  round: number;
  turn: string | null;
  currentBet: number;
  pot: number;
  myCards: CardView[];
  myTotalBet: number;
  toCall: number;
  raiseUnit: number;
  maxRaiseAdd: number;
  players: Array<{
    playerId: string;
    nickname: string;
    seat: number;
    isBot: boolean;
    folded: boolean;
    cards: CardView[];
    cardCount: number;
    totalBet: number;
  }>;
  results: Array<{
    playerId: string;
    nickname: string;
    delta: number;
    handLabel: string;
    folded: boolean;
    cards: CardView[];
  }>;
  handSize: number;
  looked?: boolean;
  lookedPlayers?: string[];
  street?: number;
  allIn?: string[];
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  balance: number;
  onAction: (cmd: string, amount?: number) => void;
}

export function ShowdownTable({ snapshot, myId, status, balance, onAction }: Props) {
  const data = snapshot as unknown as ShowdownSnapshot | undefined;
  const [raiseAdd, setRaiseAdd] = useState(100);

  if (!data) return <div className="board-placeholder">等待发牌…</div>;

  const isMyTurn = data.turn === myId && status === 'playing' && !data.players.find((p) => p.playerId === myId)?.folded;
  const canCheck = data.toCall <= 0;
  const showResults = data.results.length > 0;
  const me = data.players.find((p) => p.playerId === myId);
  const need = data.toCall + raiseAdd;

  const handleFold = () => {
    audio.play('pass');
    onAction('fold');
  };

  const handleCheck = () => {
    audio.play('click');
    onAction('check');
  };

  const handleCall = () => {
    audio.play('chip_clack');
    onAction('call');
  };

  const handleRaise = () => {
    audio.play('chip_clack');
    onAction('raise', raiseAdd);
  };

  return (
    <div className="showdown">
      <div className="showdown__bar">
        <span className="pot-display__label">底池</span>
        <span className="pot-display__value">
          <strong>{data.pot}</strong>
        </span>
        <span className="pot-display__meta">
          {data.street ? `第 ${data.street} 轮(${data.street === 1 ? "1底1明" : data.street + 1 + "张"}) · ` : ""}当前注 {data.currentBet} · 我的投入 {data.myTotalBet}
        </span>
      </div>

      <div className="showdown__seats">
        {data.players.map((player) => (
          <div
            key={player.playerId}
            className={`showdown__seat${data.turn === player.playerId ? ' is-turn' : ''}${
              player.playerId === myId ? ' is-me' : ''
            }${player.folded ? ' is-folded' : ''}`}
          >
            <span className="showdown__name">{player.nickname}</span>
            <div className="showdown__cards">
              {player.cards.length > 0
                ? player.cards.map((card) => (
                    <span key={card.id} className={`pcard ${isRedCard(card) ? 'is-red' : ''}`}>
                      <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                    </span>
                  ))
                : Array.from({ length: player.cardCount }).map((_, index) => (
                    <span key={`back-${index}`} className="pcard pcard--back">
                      <img src={cardArt('back')} alt="" draggable={false} />
                    </span>
                  ))}
            </div>
            <span className="showdown__bet">投入 {player.totalBet}</span>
            {player.folded ? <span className="muted">已弃牌</span> : data.lookedPlayers?.includes(player.playerId) ? <span style={{ color: "#d4af37", fontSize: "11px" }}>[明注]</span> : <span style={{ color: "rgba(255,255,255,0.4)", fontSize: "11px" }}>[暗注]</span>}
          </div>
        ))}
      </div>

      <div className="showdown__hand-wrap">
        <div className="showdown__hand">
          {data.myCards.length > 0 ? (
            data.myCards.map((card) => (
              <span key={card.id} className={`pcard pcard--lg ${isRedCard(card) ? 'is-red' : ''}`}>
                <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
              </span>
            ))
          ) : (
            Array.from({ length: data.handSize || 3 }).map((_, index) => (
              <span key={`back-${index}`} className="pcard pcard--lg pcard--back">
                <img src={cardArt('back')} alt="" draggable={false} />
              </span>
            ))
          )}
        </div>
        {!showResults && !me?.folded && (
          <div className="showdown__look-bar">
            {data.looked ? (
              <span className="looked-badge">👁️ 已看牌 (明注 2 倍)</span>
            ) : (
              <button
                type="button"
                className="action-btn action-btn--hint"
                style={{ padding: '6px 18px', fontSize: '14px', background: 'linear-gradient(135deg, #d4af37, #aa7c11)', color: '#000', fontWeight: 800 }}
                onClick={() => {
                  audio.play('click');
                  onAction('look');
                }}
              >
                👁️ 翻开看牌 (当前为暗注)
              </button>
            )}
          </div>
        )}
      </div>

      {showResults ? (
        <div className="reveal-list">
          {data.results.map((row) => (
            <div key={row.playerId} className="reveal-row">
              <span className="reveal-row__name">{row.nickname}</span>
              <span className="reveal-row__pt muted">{row.folded ? '弃牌' : row.handLabel}</span>
              <span className={row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'muted'}>
                {row.delta > 0 ? `+${row.delta}` : row.delta}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="showdown__actions hand-actions--luxury">
          <span className={`turn-hint ${isMyTurn ? 'is-on' : ''}`}>
            {isMyTurn ? '★ 该你行动 ★' : '等待其他玩家…'}
          </span>
          <button type="button" className="action-btn action-btn--pass" disabled={!isMyTurn} onClick={handleFold}>
            弃牌
          </button>
          <button type="button" className="action-btn action-btn--hint" disabled={!isMyTurn || !canCheck} onClick={handleCheck}>
            过牌
          </button>
          <button
            type="button"
            className="action-btn action-btn--play"
            disabled={!isMyTurn || canCheck || data.toCall > balance}
            onClick={handleCall}
          >
            跟注 {data.toCall}
          </button>
          <div className="raise-group">
            <input
              type="number"
              min={data.raiseUnit}
              max={data.maxRaiseAdd}
              step={data.raiseUnit}
              value={raiseAdd}
              onChange={(event) => {
                const next = Number(event.target.value);
                setRaiseAdd(Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0);
              }}
            />
            <button
              type="button"
              className="action-btn action-btn--play"
              disabled={!isMyTurn || raiseAdd < data.raiseUnit || need > balance}
              onClick={handleRaise}
            >
              加注 +{raiseAdd}
            </button>
          </div>
          <button
            type="button"
            className="action-btn action-btn--play"
            style={{ background: 'linear-gradient(135deg, #ff416c, #ff4b2b)', color: '#fff', fontWeight: 800, border: '1px solid #ff416c', boxShadow: '0 0 12px rgba(255, 65, 108, 0.4)' }}
            disabled={!isMyTurn}
            onClick={() => {
              audio.play('chip_clack');
              onAction('allin');
            }}
          >
            ⚡ 梭哈 (All-In)
          </button>
        </div>
      )}

      {me?.folded && !showResults && <p className="hint">你已弃牌，等待本局结束。</p>}
    </div>
  );
}
