import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { SeatPanel, TableStage } from '../components/TableStage';
import { TableEffects, type EffectTrigger } from '../components/TableEffects';
import { audio } from '../audio';
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
  round: number;
  onPlay: (cards: string[]) => void;
  onPass: () => void;
}

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

export function CardTable({ variant, snapshot, myId, status, round, onPlay, onPass }: Props) {
  const data = snapshot as unknown as HandSnapshot | undefined;
  const [selected, setSelected] = useState<string[]>([]);
  const [fxTrigger, setFxTrigger] = useState<EffectTrigger | null>(null);

  // 发牌音效
  useEffect(() => {
    if (round === 0) return;
    const timers = [60, 240, 420, 600].map((delay) =>
      window.setTimeout(() => audio.play('deal'), delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [round]);

  const hand = useMemo(() => {
    const cards = data?.myHand ?? [];
    return [...cards].sort((a, b) => b.rank - a.rank || (a.suit ?? '').localeCompare(b.suit ?? ''));
  }, [data?.myHand]);

  useEffect(() => {
    setSelected((prev) => prev.filter((id) => hand.some((card) => card.id === id)));
  }, [hand]);

  // 监听上家出牌特效 (炸弹、火箭、顺子)
  useEffect(() => {
    if (!data?.lastCombo) return;
    const kind = data.lastCombo.kind;
    if (kind === 'rocket') {
      audio.play('rocket');
      setFxTrigger({ id: String(Date.now()), type: 'rocket' });
    } else if (kind === 'bomb') {
      audio.play('bomb');
      setFxTrigger({ id: String(Date.now()), type: 'bomb' });
    } else if (kind === 'straight' || kind === 'straight_pairs' || kind === 'airplane') {
      audio.play('shunzi');
      setFxTrigger({ id: String(Date.now()), type: 'shunzi', text: comboLabel(kind) });
    }
  }, [data?.lastCombo]);

  if (!data) {
    return <div className="board-placeholder">正在发牌…</div>;
  }

  const isMyTurn = data.turn === myId && status === 'playing';
  const canPass = Boolean(data.lastCombo) && data.lastPlayerId !== myId;
  const others = data.handCounts.filter((player) => player.playerId !== myId);
  const lastPlayer = data.handCounts.find((player) => player.playerId === data.lastPlayerId);

  const toggle = (id: string): void => {
    if (!isMyTurn) return;
    audio.play('click');
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handlePlayCards = () => {
    if (selected.length === 0) return;
    // 粗略检测本地出牌特效
    if (selected.length === 4) {
      // 可能是炸弹
      audio.play('bomb');
      setFxTrigger({ id: String(Date.now()), type: 'bomb' });
    } else if (selected.length >= 5) {
      audio.play('shunzi');
      setFxTrigger({ id: String(Date.now()), type: 'shunzi' });
    } else {
      audio.play('play');
    }
    onPlay(selected);
    setSelected([]);
  };

  const handleSmartHint = () => {
    audio.play('click');
    if (!data.lastCombo) {
      // 领出：选最小单张
      if (hand.length > 0) {
        setSelected([hand[hand.length - 1]!.id]);
      }
      return;
    }
    // 简单贪心匹配：选最小的单张比上家大
    const targetRank = data.lastCombo.main;
    const bigger = [...hand].reverse().find((c) => c.rank > targetRank);
    if (bigger) {
      setSelected([bigger.id]);
    } else {
      audio.play('pass');
    }
  };

  return (
    <div className="card-game-viewport">
      {/* 牌桌特效层 */}
      <TableEffects trigger={fxTrigger} onComplete={() => setFxTrigger(null)} />

      <TableStage
        watermark={variant === 'doudizhu' ? '斗地主 · 经典牌局' : '跑得快 · 争先出牌'}
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
              meta={player.count === 0 ? '已出完' : `余 ${player.count} 张`}
              cards={player.count > 0 ? <CardBacks count={player.count} /> : null}
            />
          ),
        }))}
        center={
          data.lastCombo ? (
            <div className="center-play">
              <div className="center-play__label">
                <span className="last-player-name">{lastPlayer?.nickname ?? '上家'}</span>
                <span className="last-combo-pill">{comboLabel(data.lastCombo.kind)}</span>
              </div>
              <div className="center-play__cards">
                {data.lastCombo.cards.map((card, index) => (
                  <div
                    key={card.id}
                    className={`pcard pcard--sm ${isRedCard(card) ? 'is-red' : ''}`}
                    style={{ ['--i' as string]: index }}
                  >
                    <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className={`center-hint-box ${isMyTurn ? 'is-my-turn' : ''}`}>
              <span className="turn-sparkle">✦</span>
              <span>{isMyTurn ? '请您领出任意合法牌型' : '等待其他牌友出牌…'}</span>
              <span className="turn-sparkle">✦</span>
            </div>
          )
        }
        bottom={
          <div className="hand-super-area">
            {/* 玩家当前手牌展台 */}
            <div className="hand-cards-rack" key={`round-${round}`}>
              {hand.map((card, index) => {
                const isSelected = selected.includes(card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    style={{ '--i': index } as CSSProperties}
                    className={`pcard hand__card ${isRedCard(card) ? 'is-red' : ''} ${
                      isSelected ? 'is-selected' : ''
                    }`}
                    onClick={() => toggle(card.id)}
                    disabled={!isMyTurn}
                    title={cardLabel(card)}
                  >
                    <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                  </button>
                );
              })}
              {hand.length === 0 && <span className="hand-finished-tag">🎉 手牌已全部出完！</span>}
            </div>

            {/* 右下黄金操作控制台 */}
            {isMyTurn && (
              <div className="hand-action-dock">
                {canPass && (
                  <button
                    type="button"
                    className="action-btn action-btn--pass"
                    onClick={() => {
                      audio.play('pass');
                      onPass();
                    }}
                  >
                    不出
                  </button>
                )}
                <button type="button" className="action-btn action-btn--hint" onClick={handleSmartHint}>
                  提示
                </button>
                <button
                  type="button"
                  className="action-btn action-btn--play"
                  disabled={selected.length === 0}
                  onClick={handlePlayCards}
                >
                  <span>出牌 ({selected.length})</span>
                  <em className="btn-light-sweep" />
                </button>
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
