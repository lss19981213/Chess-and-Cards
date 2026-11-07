import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { SeatPanel, TableStage } from '../components/TableStage';
import { cardArt, cardBackArt, cardLabel, comboLabel, isRedCard, type CardView } from './cards';

interface HandCount {
  playerId: string;
  nickname: string;
  seat: number;
  count: number;
  isLandlord?: boolean;
  isBot?: boolean;
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

/** 用牌背竖条表现对手手牌数量，最多画 14 张 */
function CardBacks({ count }: { count: number }) {
  const shown = Math.min(count, 14);
  const mid = (shown - 1) / 2;
  return (
    <div className="cardbacks">
      {Array.from({ length: shown }, (_, index) => (
        <span
          key={index}
          className="cardbacks__item"
          style={{ '--r': `${(index - mid) * 3}deg` } as CSSProperties}
        >
          <img src={cardBackArt()} alt="" draggable={false} />
        </span>
      ))}
      {count > 0 && <em className="cardbacks__num">{count}</em>}
    </div>
  );
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

  if (!data) {
    return <div className="board-placeholder">正在发牌…</div>;
  }

  const isMyTurn = data.turn === myId && status === 'playing';
  const canPass = Boolean(data.lastCombo) && data.lastPlayerId !== myId;
  const others = data.handCounts.filter((player) => player.playerId !== myId);
  const lastPlayer = data.handCounts.find((player) => player.playerId === data.lastPlayerId);

  const toggle = (id: string): void => {
    if (!isMyTurn) return;
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  return (
    <TableStage
      watermark={variant === 'doudizhu' ? 'DOU DI ZHU' : 'PAO DE KUAI'}
      seats={others.map((player) => ({
        key: player.playerId,
        active: data.turn === player.playerId,
        dim: player.count === 0,
        node: (
          <SeatPanel
            nickname={player.nickname}
            initial={player.nickname.replace(/^🤖\s*/, '').slice(0, 1)}
            isBot={player.isBot}
            badge={player.isLandlord ? <em className="badge-landlord">地主</em> : null}
            active={data.turn === player.playerId}
            meta={player.count === 0 ? '已出完' : `${player.count} 张`}
            cards={player.count > 0 ? <CardBacks count={player.count} /> : null}
          />
        ),
      }))}
      center={
        data.lastCombo ? (
          <div className="center-play">
            <div className="center-play__label">
              {lastPlayer?.nickname ?? '上家'} 出
              <span>{comboLabel(data.lastCombo.kind)}</span>
            </div>
            <div className="center-play__cards">
              {data.lastCombo.cards.map((card) => (
                <div key={card.id} className={`pcard pcard--sm ${isRedCard(card) ? 'is-red' : ''}`}>
                  <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <span className={`center-hint ${isMyTurn ? 'is-on' : ''}`}>
            {isMyTurn ? '由你领出' : '等待出牌…'}
          </span>
        )
      }
      bottom={
        <div className="hand-area">
          <div className="hand">
            {hand.map((card, index) => (
              <button
                key={card.id}
                type="button"
                style={{ '--i': index } as CSSProperties}
                className={`pcard hand__card ${isRedCard(card) ? 'is-red' : ''} ${
                  selected.includes(card.id) ? 'is-selected' : ''
                }`}
                onClick={() => toggle(card.id)}
                disabled={!isMyTurn}
                title={cardLabel(card)}
              >
                <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
              </button>
            ))}
            {hand.length === 0 && <span className="hint">本局已结束</span>}
          </div>

          <div className="hand-actions">
            <span className={`turn-hint ${isMyTurn ? 'is-on' : ''}`}>
              {isMyTurn ? '该你出牌了' : '等待其他玩家…'}
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
              出牌
            </button>
          </div>
        </div>
      }
    />
  );
}
