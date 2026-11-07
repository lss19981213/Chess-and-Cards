import { useEffect, useMemo, useState } from 'react';
import { cardLabel, comboLabel, isRedCard, type CardView } from './cards';

interface HandCount {
  playerId: string;
  nickname: string;
  seat: number;
  count: number;
  isLandlord?: boolean;
}

interface LastCombo {
  kind: string;
  main: number;
  size: number;
  cards: CardView[];
}

interface HandSnapshot {
  turn: string | null;
  myHand: CardView[];
  landlordId?: string | null;
  handCounts: HandCount[];
  lastCombo: LastCombo | null;
  lastPlayerId: string | null;
  finished: string[];
}

interface Props {
  variant: 'doudizhu' | 'paodekuai';
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  onPlay: (cards: string[]) => void;
  onPass: () => void;
}

export function CardTable({ variant, snapshot, myId, status, onPlay, onPass }: Props) {
  const data = snapshot as unknown as HandSnapshot | undefined;
  const [selected, setSelected] = useState<string[]>([]);

  const hand = useMemo(() => {
    const cards = data?.myHand ?? [];
    return [...cards].sort((a, b) => b.rank - a.rank || (a.suit ?? '').localeCompare(b.suit ?? ''));
  }, [data?.myHand]);

  useEffect(() => {
    setSelected((prev) => prev.filter((id) => hand.some((card) => card.id === id)));
  }, [hand]);

  if (!data) return <div className="board-placeholder">等待发牌…</div>;

  const isMyTurn = data.turn === myId && status === 'playing';
  const canPass = Boolean(data.lastCombo) && data.lastPlayerId !== myId;

  const toggle = (id: string): void => {
    if (!isMyTurn) return;
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const others = data.handCounts.filter((p) => p.playerId !== myId);

  return (
    <div className="card-table">
      <div className="card-table__opponents">
        {others.map((player) => (
          <div
            key={player.playerId}
            className={`opponent ${data.turn === player.playerId ? 'is-active' : ''}`}
          >
            <span className="opponent__name">
              {player.nickname}
              {player.isLandlord && <em className="badge-landlord">地主</em>}
            </span>
            <span className="opponent__count">{player.count} 张</span>
          </div>
        ))}
      </div>

      <div className="card-table__center">
        {data.lastCombo ? (
          <div className="played">
            <div className="played__label">
              {data.handCounts.find((p) => p.playerId === data.lastPlayerId)?.nickname ?? '上家'} 出
              <span>{comboLabel(data.lastCombo.kind)}</span>
            </div>
            <div className="card-row">
              {data.lastCombo.cards.map((card) => (
                <div key={card.id} className={`pcard pcard--sm ${isRedCard(card) ? 'is-red' : ''}`}>
                  {cardLabel(card)}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="played__empty">{isMyTurn ? '由你领出' : '等待出牌…'}</div>
        )}
      </div>

      <div className="card-table__mine">
        <div className="card-row card-row--hand">
          {hand.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`pcard ${isRedCard(card) ? 'is-red' : ''} ${selected.includes(card.id) ? 'is-selected' : ''}`}
              onClick={() => toggle(card.id)}
              disabled={!isMyTurn}
            >
              {cardLabel(card)}
            </button>
          ))}
          {hand.length === 0 && <span className="hint">本局已结束</span>}
        </div>

        <div className="card-actions">
          <span className={`turn-hint ${isMyTurn ? 'is-on' : ''}`}>
            {isMyTurn ? '轮到你出牌' : '等待其他玩家…'}
          </span>
          <button type="button" className="secondary" disabled={!isMyTurn || !canPass} onClick={onPass}>
            不出
          </button>
          <button
            type="button"
            className="primary"
            disabled={!isMyTurn || selected.length === 0}
            onClick={() => {
              onPlay(selected);
              setSelected([]);
            }}
          >
            出牌{variant === 'doudizhu' ? '' : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
