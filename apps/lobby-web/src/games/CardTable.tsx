import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

/** 手牌目标宽度：在 844×390 横屏下保证点数与花色可辨认 */
const CARD_W = 78;
/** 单张牌最小可视宽度（重叠后仍要露出左上角点数） */
const MIN_STEP = 26;
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
  const rackRef = useRef<HTMLDivElement | null>(null);
  /** 手牌区可用宽度，用于动态计算重叠量，保证不溢出视口 */
  const [rackWidth, setRackWidth] = useState(0);
  /** 拖动刷选状态：一次按下后经过的牌统一置为同一模式 */
  const dragRef = useRef<{ mode: 'add' | 'remove'; seen: Set<string> } | null>(null);

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

  // 手牌区宽度自适应：牌数变化或屏幕旋转时重新计算重叠
  useEffect(() => {
    const el = rackRef.current;
    if (!el) return;
    const update = () => setRackWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hand.length]);

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

  // 手牌动态重叠：牌多时压缩步进，牌少时铺开，始终一屏可见
  // 注意：必须放在提前 return 之前，否则 hook 数量在不同渲染间不一致
  const cardStep = useMemo(() => {
    const count = hand.length;
    if (count <= 1) return CARD_W;
    const available = Math.max(260, rackWidth) - 12;
    const raw = (available - CARD_W) / (count - 1);
    return Math.max(MIN_STEP, Math.min(CARD_W, raw));
  }, [hand.length, rackWidth]);
  const cardOverlap = Math.max(0, CARD_W - cardStep);

  if (!data) {
    return <div className="board-placeholder">正在发牌…</div>;
  }

  const isMyTurn = data.turn === myId && status === 'playing';
  const canPass = Boolean(data.lastCombo) && data.lastPlayerId !== myId;
  const others = data.handCounts.filter((player) => player.playerId !== myId);
  const lastPlayer = data.handCounts.find((player) => player.playerId === data.lastPlayerId);

  const applyCard = (id: string, on: boolean): void => {
    setSelected((prev) => {
      if (on) return prev.includes(id) ? prev : [...prev, id];
      return prev.filter((x) => x !== id);
    });
  };

  /** 按下即选中/取消，并进入拖动刷选模式 */
  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!isMyTurn) return;
    const el = (event.target as HTMLElement).closest('[data-card-id]') as HTMLElement | null;
    const id = el?.dataset.cardId;
    if (!id) return;
    audio.play('click');
    const mode: 'add' | 'remove' = selected.includes(id) ? 'remove' : 'add';
    dragRef.current = { mode, seen: new Set([id]) };
    applyCard(id, mode === 'add');
    // 捕获指针：拖出牌面后仍能收到 move 事件，实现「划过即选」
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  /** 拖动经过其他牌时批量应用同一模式 */
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const id = hit?.closest('[data-card-id]')?.getAttribute('data-card-id');
    if (!id || drag.seen.has(id)) return;
    drag.seen.add(id);
    applyCard(id, drag.mode === 'add');
  };

  const handlePointerUp = (): void => {
    dragRef.current = null;
  };

  /** 双击选中同点数所有牌，避免一张张点 */
  const handleDoubleClick = (rank: number): void => {
    if (!isMyTurn) return;
    const same = hand.filter((card) => card.rank === rank).map((card) => card.id);
    audio.play('click');
    setSelected((prev) => Array.from(new Set([...prev, ...same])));
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
            <div
              className="hand-cards-rack"
              key={`round-${round}`}
              ref={rackRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              {hand.map((card, index) => {
                const isSelected = selected.includes(card.id);
                return (
                  <button
                    key={card.id}
                    type="button"
                    data-card-id={card.id}
                    style={
                      {
                        '--i': index,
                        marginLeft: index === 0 ? 0 : -cardOverlap,
                      } as CSSProperties
                    }
                    className={`pcard hand__card ${isRedCard(card) ? 'is-red' : ''} ${
                      isSelected ? 'is-selected' : ''
                    }`}
                    onDoubleClick={() => handleDoubleClick(card.rank)}
                    disabled={!isMyTurn}
                    title={`${cardLabel(card)}（双击选中同点数）`}
                  >
                    <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                  </button>
                );
              })}
              {hand.length === 0 && <span className="hand-finished-tag">🎉 手牌已全部出完！</span>}
            </div>

            {/* 黄金操作控制台 (居于手牌上方居中，绝不遮挡任何手牌) */}
            {isMyTurn && (
              <div className="hand-action-dock-center">
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
