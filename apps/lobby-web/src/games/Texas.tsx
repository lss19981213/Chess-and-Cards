import { cardLabel, isRedCard, type CardView } from './cards';
import { Chip } from '../components/Chip';

interface TexasPlayer {
  playerId: string;
  nickname: string;
  seat: number;
  folded: boolean;
  totalBet: number;
  isDealer: boolean;
  cards: CardView[];
}

interface TexasResult {
  playerId: string;
  nickname: string;
  delta: number;
  folded: boolean;
  handLabel: string;
  cards: CardView[];
}

interface TexasSnapshot {
  phase: string;
  phaseLabel: string;
  community: CardView[];
  pot: number;
  currentBet: number;
  toCall: number;
  turn: string | null;
  dealerId: string | null;
  myHand: CardView[];
  myTotalBet: number;
  raiseUnit: number;
  results: TexasResult[];
  players: TexasPlayer[];
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  onAction: (cmd: string) => void;
}

export function Texas({ snapshot, myId, status, onAction }: Props) {
  const data = snapshot as unknown as TexasSnapshot | undefined;
  if (!data) return <div className="board-placeholder">等待发牌…</div>;

  const me = data.players.find((p) => p.playerId === myId);
  const isMyTurn = data.turn === myId && status === 'playing' && !me?.folded;
  const canCheck = data.toCall === 0;

  return (
    <div className="texas">
      <div className="texas__head">
        <span className="badge badge--playing">{data.phaseLabel}</span>
        <span className="texas__pot pot-chip">
          底池 <Chip size={15} /> <strong>{data.pot}</strong>
        </span>
        <span className="texas__meta">
          当前注 {data.currentBet} · 我的投入 {data.myTotalBet}
        </span>
      </div>

      <div className="texas__community">
        {data.community.map((card) => (
          <div key={card.id} className={`pcard pcard--lg ${isRedCard(card) ? 'is-red' : ''}`}>
            {cardLabel(card)}
          </div>
        ))}
        {Array.from({ length: 5 - data.community.length }).map((_, index) => (
          <div key={`empty-${index}`} className="pcard pcard--lg pcard--back">
            ?
          </div>
        ))}
      </div>

      <div className="texas__players">
        {data.players.map((player) => (
          <div
            key={player.playerId}
            className={`texas-seat ${player.folded ? 'is-folded' : ''} ${
              data.turn === player.playerId ? 'is-active' : ''
            } ${player.playerId === myId ? 'is-me' : ''}`}
          >
            <div className="texas-seat__name">
              {player.nickname}
              {player.isDealer && <em className="badge-dealer">D</em>}
            </div>
            <div className="texas-seat__bet">{player.folded ? '已弃牌' : `投入 ${player.totalBet}`}</div>
            {player.cards.length > 0 && (
              <div className="texas-seat__cards">
                {player.cards.map((card) => (
                  <span key={card.id} className={`mini-card ${isRedCard(card) ? 'is-red' : ''}`}>
                    {cardLabel(card)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="texas__mine">
        <div className="card-row">
          {data.myHand.map((card) => (
            <div key={card.id} className={`pcard pcard--lg ${isRedCard(card) ? 'is-red' : ''}`}>
              {cardLabel(card)}
            </div>
          ))}
        </div>

        <div className="card-actions">
          <span className={`turn-hint ${isMyTurn ? 'is-on' : ''}`}>
            {isMyTurn ? '轮到你行动' : '等待其他玩家…'}
          </span>
          <button type="button" className="secondary" disabled={!isMyTurn} onClick={() => onAction('fold')}>
            弃牌
          </button>
          <button type="button" className="secondary" disabled={!isMyTurn} onClick={() => onAction('check')}>
            过牌
          </button>
          <button
            type="button"
            className="primary"
            disabled={!isMyTurn || canCheck}
            onClick={() => onAction('call')}
          >
            跟注 {data.toCall}
          </button>
          <button type="button" className="primary" disabled={!isMyTurn} onClick={() => onAction('raise')}>
            加注 +{data.raiseUnit}
          </button>
        </div>
      </div>

      {data.results.length > 0 && (
        <div className="texas__results">
          {data.results.map((row) => (
            <div key={row.playerId} className="texas__result-row">
              <span>{row.nickname}</span>
              <span className="muted">{row.folded ? '弃牌' : row.handLabel}</span>
              <span className={row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : ''}>
                {row.delta > 0 ? `+${row.delta}` : row.delta}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
