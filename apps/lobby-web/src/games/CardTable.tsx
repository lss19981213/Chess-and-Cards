import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SeatPanel, TableStage } from '../components/TableStage';
import { TableEffects, type EffectTrigger } from '../components/TableEffects';
import { audio } from '../audio';
import { cardArt, cardBackArt, cardLabel, comboLabel, findSuggestedCardCombos, isRedCard, rankLabel, type CardView } from './cards';

/** 单张牌最小可视露出宽度（重叠后仍清晰露出左上角大号点数与花色） */
const MIN_STEP = 28;

/** 斗地主/跑得快记牌器各点数总张数模板 */
const DDZ_DECK_COUNTS: ReadonlyArray<[number, number]> = [
  [17, 1],
  [16, 1],
  [15, 4],
  [14, 4],
  [13, 4],
  [12, 4],
  [11, 4],
  [10, 4],
  [9, 4],
  [8, 4],
  [7, 4],
  [6, 4],
  [5, 4],
  [4, 4],
  [3, 4],
];

const PDK_DECK_COUNTS: ReadonlyArray<[number, number]> = [
  [15, 1],
  [14, 3],
  [13, 4],
  [12, 4],
  [11, 4],
  [10, 4],
  [9, 4],
  [8, 4],
  [7, 4],
  [6, 4],
  [5, 4],
  [4, 4],
  [3, 4],
];

interface HandCount {
  playerId: string;
  nickname: string;
  seat: number;
  count: number;
  isLandlord?: boolean;
  isBot?: boolean;
  bid?: number | null;
  doubled?: boolean;
}

interface LastCombo {
  kind: string;
  main: number;
  size: number;
  cards: CardView[];
}

interface HandSnapshot {
  phase?: 'bidding' | 'doubling' | 'playing' | 'settled';
  turn: string | null;
  myHand: CardView[];
  landlordId?: string | null;
  bottomCards?: CardView[];
  highestBid?: number;
  multiplier?: number;
  playedCards?: CardView[];
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
  playerMedia?: Record<string, { avatar?: string | null; equippedFrame?: string }>;
  onPlay: (cards: string[]) => void;
  onPass: () => void;
  onBid?: (score: 0 | 1 | 2 | 3) => void;
  onDouble?: (factor: 1 | 2) => void;
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

export function CardTable({
  variant,
  snapshot,
  myId,
  status,
  round,
  playerMedia,
  onPlay,
  onPass,
  onBid,
  onDouble,
}: Props) {
  const data = snapshot as unknown as HandSnapshot | undefined;
  const [selected, setSelected] = useState<string[]>([]);
  const [sortMode, setSortMode] = useState<'rank' | 'bomb'>('rank');
  const [counterOpen, setCounterOpen] = useState(false);
  const [hintIdx, setHintIdx] = useState(0);
  const [fxTrigger, setFxTrigger] = useState<EffectTrigger | null>(null);
  const [centerBanner, setCenterBanner] = useState<{ id: number; kind: string; text: string; sub?: string } | null>(
    null,
  );
  const rackRef = useRef<HTMLDivElement | null>(null);
  const [rackWidth, setRackWidth] = useState(0);
  const [cardWidth, setCardWidth] = useState(88);
  const dragRef = useRef<{ mode: 'add' | 'remove'; seen: Set<string> } | null>(null);
  const lastComboSigRef = useRef<string>('');
  const localPlayedAtRef = useRef<number>(0);
  const bannerIdRef = useRef<number>(1);
  const bannerTimerRef = useRef<number | null>(null);

  const showBanner = (kind: string, text: string, sub?: string, ms = 1350) => {
    const id = bannerIdRef.current++;
    if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
    setCenterBanner({ id, kind, text, sub });
    bannerTimerRef.current = window.setTimeout(() => {
      setCenterBanner((cur) => (cur?.id === id ? null : cur));
    }, ms);
  };

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
    };
  }, []);

  // 开局清脆发牌声
  useEffect(() => {
    if (round === 0) return;
    lastComboSigRef.current = '';
    const timers = [60, 210, 360, 510].map((delay) =>
      window.setTimeout(() => audio.play('poker_deal'), delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [round]);

  const hand = useMemo(() => {
    const cards = data?.myHand ?? [];
    if (sortMode === 'bomb') {
      const rankCount = new Map<number, number>();
      for (const c of cards) rankCount.set(c.rank, (rankCount.get(c.rank) ?? 0) + 1);
      const hasRocket = (rankCount.get(16) ?? 0) > 0 && (rankCount.get(17) ?? 0) > 0;
      return [...cards].sort((a, b) => {
        const aBomb = (rankCount.get(a.rank) ?? 0) === 4 || (hasRocket && a.rank >= 16) ? 1 : 0;
        const bBomb = (rankCount.get(b.rank) ?? 0) === 4 || (hasRocket && b.rank >= 16) ? 1 : 0;
        if (aBomb !== bBomb) return bBomb - aBomb;
        const aCnt = rankCount.get(a.rank) ?? 0;
        const bCnt = rankCount.get(b.rank) ?? 0;
        if (aCnt !== bCnt) return bCnt - aCnt;
        return b.rank - a.rank || (a.suit ?? '').localeCompare(b.suit ?? '');
      });
    }
    return [...cards].sort((a, b) => b.rank - a.rank || (a.suit ?? '').localeCompare(b.suit ?? ''));
  }, [data?.myHand, sortMode]);

  // 记牌器：统计除自己手牌与已打出的牌外，场外还剩多少张对应点数
  const remainingRankCounts = useMemo(() => {
    const seen = new Map<number, number>();
    for (const c of data?.myHand ?? []) seen.set(c.rank, (seen.get(c.rank) ?? 0) + 1);
    for (const c of data?.playedCards ?? []) seen.set(c.rank, (seen.get(c.rank) ?? 0) + 1);
    const tpl = variant === 'doudizhu' ? DDZ_DECK_COUNTS : PDK_DECK_COUNTS;
    return tpl.map(([rank, total]) => ({
      rank,
      label: rankLabel(rank),
      left: Math.max(0, total - (seen.get(rank) ?? 0)),
    }));
  }, [data?.myHand, data?.playedCards, variant]);

  useEffect(() => {
    setHintIdx(0);
  }, [data?.turn, data?.lastPlayerId, hand.length]);

  useEffect(() => {
    setSelected((prev) => prev.filter((id) => hand.some((card) => card.id === id)));
  }, [hand]);

  // 手牌区宽度与实际单卡宽度自适应测量：大牌面也能完整铺开不溢出
  useEffect(() => {
    const el = rackRef.current;
    if (!el) return;
    const update = () => {
      setRackWidth(el.clientWidth);
      const firstCard = el.querySelector<HTMLElement>('.hand__card');
      if (firstCard && firstCard.offsetWidth >= 56) {
        setCardWidth(firstCard.offsetWidth);
      }
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hand.length]);

  // 实时监听牌桌出牌事件：播放对应音效 + 视觉播报
  useEffect(() => {
    if (!data?.lastCombo) return;
    const sig = `${round}:${data.lastPlayerId ?? ''}:${data.lastCombo.cards.map((c) => c.id).join(',')}`;
    if (sig === lastComboSigRef.current) return;
    lastComboSigRef.current = sig;

    const kind = data.lastCombo.kind;
    const actor = data.handCounts.find((p) => p.playerId === data.lastPlayerId)?.nickname ?? '牌友';
    const isJustLocal = data.lastPlayerId === myId && Date.now() - localPlayedAtRef.current < 900;

    if (kind === 'rocket') {
      if (!isJustLocal) audio.play('rocket');
      setFxTrigger({ id: String(Date.now()), type: 'rocket' });
      showBanner('allin', `🚀 ${actor} 王炸！`, '全场翻倍震慑', 1800);
    } else if (kind === 'bomb') {
      if (!isJustLocal) audio.play('bomb');
      setFxTrigger({ id: String(Date.now()), type: 'bomb' });
      showBanner('allin', `💣 ${actor} 炸弹！`, '火力全开', 1650);
    } else if (kind === 'straight' || kind === 'straight_pairs' || kind === 'airplane') {
      if (!isJustLocal) audio.play('shunzi');
      setFxTrigger({ id: String(Date.now()), type: 'shunzi', text: comboLabel(kind) });
      showBanner('raise', `${actor} · ${comboLabel(kind)}`, undefined, 1300);
    } else {
      if (!isJustLocal) {
        audio.play('poker_deal');
        window.setTimeout(() => audio.play('play'), 45);
      }
    }
  }, [data?.lastCombo, data?.lastPlayerId, data?.handCounts, myId, round]);

  const cardStep = useMemo(() => {
    const count = hand.length;
    if (count <= 1) return cardWidth;
    const available = Math.max(280, rackWidth) - 16;
    const raw = (available - cardWidth) / (count - 1);
    return Math.max(MIN_STEP, Math.min(cardWidth * 0.85, raw));
  }, [hand.length, rackWidth, cardWidth]);
  const cardOverlap = Math.max(0, cardWidth - cardStep);

  if (!data) {
    return <div className="board-placeholder">正在发牌…</div>;
  }

  const phase = data.phase ?? 'playing';
  const isMyTurn = data.turn === myId && status === 'playing' && phase !== 'settled';
  const canPass = phase === 'playing' && Boolean(data.lastCombo) && data.lastPlayerId !== myId;
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
    audio.play('click');
    applyCard(id, drag.mode === 'add');
  };

  const handlePointerUp = (): void => {
    dragRef.current = null;
  };

  /** 双击选中同点数所有牌 */
  const handleDoubleClick = (rank: number): void => {
    if (!isMyTurn) return;
    const same = hand.filter((card) => card.rank === rank).map((card) => card.id);
    audio.play('click');
    setSelected((prev) => Array.from(new Set([...prev, ...same])));
  };

  const handlePlayCards = () => {
    if (selected.length === 0) return;
    localPlayedAtRef.current = Date.now();
    const picked = hand.filter((c) => selected.includes(c.id));
    const isRocket = picked.length === 2 && picked.every((c) => c.rank >= 16);
    const isBomb = picked.length === 4 && picked.every((c) => c.rank === picked[0]!.rank);
    if (isRocket) {
      audio.play('rocket');
      setFxTrigger({ id: String(Date.now()), type: 'rocket' });
    } else if (isBomb) {
      audio.play('bomb');
      setFxTrigger({ id: String(Date.now()), type: 'bomb' });
    } else if (picked.length >= 5) {
      audio.play('shunzi');
      setFxTrigger({ id: String(Date.now()), type: 'shunzi' });
    } else {
      audio.play('poker_deal');
      window.setTimeout(() => audio.play('play'), 40);
    }
    onPlay(selected);
    setSelected([]);
  };

  const handlePassTurn = () => {
    audio.play('poker_check');
    showBanner('fold', '不出 / 过牌', undefined, 950);
    setSelected([]);
    onPass();
  };

  const handleSmartHint = () => {
    const prevCombo =
      data.lastCombo && data.lastPlayerId !== myId ? data.lastCombo : null;
    const combos = findSuggestedCardCombos(hand, prevCombo, variant);
    if (combos.length === 0) {
      audio.play('poker_fold');
      showBanner('fold', '要不起，建议点「不出」', undefined, 1100);
      return;
    }
    audio.play('click');
    const pick = combos[hintIdx % combos.length]!;
    setSelected(pick);
    setHintIdx((prev) => prev + 1);
  };

  return (
    <div className="card-game-viewport card-game-viewport--pro">
      {/* 牌桌特效层 */}
      <TableEffects trigger={fxTrigger} onComplete={() => setFxTrigger(null)} />

      {/* 居中动作特效横幅 */}
      {centerBanner && (
        <div key={centerBanner.id} className={`texas-fx-banner is-${centerBanner.kind}`} role="status" aria-live="polite">
          <strong>{centerBanner.text}</strong>
          {centerBanner.sub && <span>{centerBanner.sub}</span>}
        </div>
      )}

      <TableStage
        watermark={variant === 'doudizhu' ? '斗地主 · 豪华牌桌' : '跑得快 · 争先出牌'}
        seats={others.map((player) => ({
          key: player.playerId,
          active: data.turn === player.playerId,
          dim: player.count === 0,
          node: (
            <div className="texas-seat-wrap">
              <SeatPanel
                nickname={player.nickname}
                initial={player.nickname.replace(/^🤖\s*/, '').slice(0, 1)}
                avatar={playerMedia?.[player.playerId]?.avatar}
                frameId={playerMedia?.[player.playerId]?.equippedFrame}
                isBot={player.isBot}
                badge={player.isLandlord ? <em className="badge-landlord">地主</em> : null}
                active={data.turn === player.playerId}
                meta={player.count === 0 ? '已出完' : `余 ${player.count} 张`}
                cards={player.count > 0 ? <CardBacks count={player.count} /> : null}
              />
              {player.count > 0 && player.count <= 2 && (
                <span className="texas-action-pill is-allin">
                  ⚠️ {player.count === 1 ? '报单！' : '报双！'}
                </span>
              )}
            </div>
          ),
        }))}
        center={
          phase === 'bidding' || phase === 'doubling' ? (
            <div className={`center-hint-box ${isMyTurn ? 'is-my-turn' : ''}`}>
              <span className="turn-sparkle">✦</span>
              <span>
                {phase === 'bidding'
                  ? isMyTurn
                    ? `请叫分抢地主（当前最高 ${data.highestBid ?? 0} 分）`
                    : '正在叫分抢地主…'
                  : isMyTurn
                    ? '是否选择加倍？（×2 收益翻倍）'
                    : '正在等待加倍选择…'}
              </span>
              <span className="turn-sparkle">✦</span>
            </div>
          ) : data.lastCombo ? (
            <div className="center-play center-play--pro">
              <div className="center-play__label">
                <span className="last-player-name">{lastPlayer?.nickname ?? '上家'}</span>
                <span className="last-combo-pill">{comboLabel(data.lastCombo.kind)}</span>
              </div>
              <div className="center-play__cards center-play__cards--pro">
                {data.lastCombo.cards.map((card, index) => (
                  <div
                    key={card.id}
                    className={`pcard center-play__card-lg ${isRedCard(card) ? 'is-red' : ''}`}
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
          <div className="hand-super-area hand-super-area--pro">
            {/* 斗牌工具栏：底牌、倍率、理牌模式、记牌器 */}
            <div className="card-table-toolbar">
              {variant === 'doudizhu' && (
                <div className="ddz-bottom-cards" title="三张地主底牌">
                  <span className="ddz-meta-lbl">底牌:</span>
                  {(data.bottomCards && data.bottomCards.length > 0
                    ? data.bottomCards
                    : [0, 1, 2]
                  ).map((item, idx) =>
                    typeof item === 'number' ? (
                      <span key={`back-${idx}`} className="ddz-mini-card is-back">
                        <img src={cardBackArt()} alt="底牌" draggable={false} />
                      </span>
                    ) : (
                      <span key={item.id} className="ddz-mini-card">
                        <img src={cardArt(item.id)} alt={cardLabel(item)} draggable={false} />
                      </span>
                    ),
                  )}
                  <span className="ddz-mult-badge">×{data.multiplier ?? 1} 倍</span>
                </div>
              )}
              <div className="card-toolbar-btns">
                <button
                  type="button"
                  className={`btn-card-tool ${sortMode === 'bomb' ? 'is-active' : ''}`}
                  onClick={() => {
                    audio.play('click');
                    setSortMode((m) => (m === 'rank' ? 'bomb' : 'rank'));
                  }}
                >
                  {sortMode === 'rank' ? '🔀 炸弹优先' : '🔀 按点数'}
                </button>
                <button
                  type="button"
                  className={`btn-card-tool ${counterOpen ? 'is-active' : ''}`}
                  onClick={() => {
                    audio.play('click');
                    setCounterOpen((v) => !v);
                  }}
                >
                  📊 记牌器 {counterOpen ? '▲' : '▼'}
                </button>
              </div>
            </div>

            {counterOpen && (
              <div className="card-counter-bar" aria-label="剩余牌统计">
                {remainingRankCounts.map((entry) => (
                  <div key={entry.rank} className={`counter-cell ${entry.left === 0 ? 'is-empty' : ''}`}>
                    <span className="counter-rank">{entry.label}</span>
                    <strong className="counter-left">{entry.left}</strong>
                  </div>
                ))}
              </div>
            )}

            {/* 玩家大号高清手牌展台 */}
            <div
              className="hand-cards-rack hand-cards-rack--pro"
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
                    disabled={!isMyTurn || phase !== 'playing'}
                    title={`${cardLabel(card)}（拖动滑选 / 双击选中同点数）`}
                  >
                    <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                  </button>
                );
              })}
              {hand.length === 0 && <span className="hand-finished-tag">🎉 手牌已全部出完！</span>}
            </div>

            {/* 斗地主叫分抢地主控制台 */}
            {isMyTurn && phase === 'bidding' && onBid && (
              <div className="hand-action-dock-center hand-action-dock-center--pro ddz-bid-dock">
                <button
                  type="button"
                  className="action-btn texas-btn-fold"
                  onClick={() => {
                    audio.play('poker_check');
                    onBid(0);
                  }}
                >
                  不叫
                </button>
                {([1, 2, 3] as const).map((score) => (
                  <button
                    key={score}
                    type="button"
                    className="action-btn texas-btn-raise"
                    disabled={(data.highestBid ?? 0) >= score}
                    onClick={() => {
                      audio.play('poker_raise');
                      onBid(score);
                    }}
                  >
                    {score} 分
                  </button>
                ))}
              </div>
            )}

            {/* 斗地主加倍控制台 */}
            {isMyTurn && phase === 'doubling' && onDouble && (
              <div className="hand-action-dock-center hand-action-dock-center--pro ddz-bid-dock">
                <button
                  type="button"
                  className="action-btn texas-btn-fold"
                  onClick={() => {
                    audio.play('poker_check');
                    onDouble(1);
                  }}
                >
                  不加倍
                </button>
                <button
                  type="button"
                  className="action-btn texas-btn-allin"
                  onClick={() => {
                    audio.play('poker_allin');
                    onDouble(2);
                  }}
                >
                  🔥 加倍 ×2
                </button>
              </div>
            )}

            {/* 黄金操作控制台 */}
            {isMyTurn && phase === 'playing' && (
              <div className="hand-action-dock-center hand-action-dock-center--pro">
                {canPass && (
                  <button type="button" className="action-btn texas-btn-fold" onClick={handlePassTurn}>
                    不出
                  </button>
                )}
                {selected.length > 0 && (
                  <button
                    type="button"
                    className="action-btn action-btn--hint"
                    onClick={() => {
                      audio.play('click');
                      setSelected([]);
                    }}
                  >
                    重选
                  </button>
                )}
                <button type="button" className="action-btn texas-btn-check" onClick={handleSmartHint}>
                  提示
                </button>
                <button
                  type="button"
                  className="action-btn texas-btn-raise"
                  disabled={selected.length === 0}
                  onClick={handlePlayCards}
                >
                  <span>出牌 ({selected.length})</span>
                </button>
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
