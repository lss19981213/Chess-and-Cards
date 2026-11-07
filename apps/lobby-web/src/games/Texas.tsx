import { useEffect, useState } from 'react';
import { cardArt, cardLabel, isRedCard, type CardView } from './cards';
import { Chip, ChipStack } from '../components/Chip';
import { SeatPanel, TableStage } from '../components/TableStage';

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
  maxRaiseAdd: number;
  results: TexasResult[];
  players: TexasPlayer[];
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  balance: number;
  onAction: (cmd: string, amount?: number) => void;
}

export function Texas({ snapshot, myId, status, balance, onAction }: Props) {
  const data = snapshot as unknown as TexasSnapshot | undefined;
  const [raiseAdd, setRaiseAdd] = useState(100);

  useEffect(() => {
    if (data?.raiseUnit) setRaiseAdd(data.raiseUnit);
  }, [data?.raiseUnit]);

  if (!data) return <div className="board-placeholder">等待发牌…</div>;

  const me = data.players.find((p) => p.playerId === myId);
  const others = data.players.filter((p) => p.playerId !== myId);
  const isMyTurn = data.turn === myId && status === 'playing' && !me?.folded;
  const canCheck = data.toCall === 0;
  const showResults = data.results.length > 0;

  return (
    <TableStage
      watermark="TEXAS HOLD'EM"
      seats={others.map((player) => ({
        key: player.playerId,
        active: data.turn === player.playerId,
        dim: player.folded,
        node: (
          <SeatPanel
            nickname={player.nickname}
            initial={player.nickname.replace(/^🤖\s*/, '').slice(0, 1)}
            isBot={player.nickname.startsWith('🤖')}
            badge={player.isDealer ? <em className="badge-dealer">D</em> : null}
            active={data.turn === player.playerId}
            meta={player.folded ? '已弃牌' : `投入 ${player.totalBet}`}
            cards={
              player.cards.length > 0 ? (
                <div className="mini-cards">
                  {player.cards.map((card) => (
                    <span key={card.id} className={`mini-card ${isRedCard(card) ? 'is-red' : ''}`}>
                      {cardLabel(card)}
                    </span>
                  ))}
                </div>
              ) : null
            }
          />
        ),
      }))}
      center={
        showResults ? (
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
          <div className="texas-center">
            <div className="texas-center__phase">{data.phaseLabel}</div>
            <div className="texas-center__board">
              {data.community.map((card) => (
                <div key={card.id} className={`pcard pcard--lg ${isRedCard(card) ? 'is-red' : ''}`}>
                  <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                </div>
              ))}
              {Array.from({ length: 5 - data.community.length }).map((_, index) => (
                <div key={`empty-${index}`} className="pcard pcard--lg pcard--back">
                  <img src={cardArt('back')} alt="" draggable={false} />
                </div>
              ))}
            </div>
            <div className="pot-display pot-display--inline">
              <span className="pot-display__label">底池</span>
              <span className="pot-display__value">
                <Chip size={18} />
                <strong>{data.pot}</strong>
              </span>
              <ChipStack amount={data.pot} />
              <span className="pot-display__meta">
                当前注 {data.currentBet} · 我的投入 {data.myTotalBet}
              </span>
            </div>
          </div>
        )
      }
      bottom={
        <div className="hand-area">
          <div className="hand hand--texas">
            {data.myHand.map((card, index) => (
              <div
                key={card.id}
                className={`pcard hand__card pcard--lg ${isRedCard(card) ? 'is-red' : ''}`}
                style={{ ['--i' as string]: index }}
                title={cardLabel(card)}
              >
                <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
              </div>
            ))}
          </div>

          <div className="hand-actions">
            <span className={`turn-hint ${isMyTurn ? 'is-on' : ''}`}>
              {isMyTurn ? '该你行动' : '等待其他玩家…'}
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
              disabled={!isMyTurn || canCheck || data.toCall > balance}
              onClick={() => onAction('call')}
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
                className="primary"
                disabled={!isMyTurn || raiseAdd < data.raiseUnit || data.toCall + raiseAdd > balance}
                onClick={() => onAction('raise', raiseAdd)}
              >
                加注 +{raiseAdd}
              </button>
            </div>
          </div>
        </div>
      }
    />
  );
}
