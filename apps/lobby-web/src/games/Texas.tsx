import { useEffect, useMemo, useRef, useState } from 'react';
import { cardArt, cardLabel, isRedCard, type CardView } from './cards';
import { Chip, ChipStack } from '../components/Chip';
import { SeatPanel, TableStage } from '../components/TableStage';
import { audio } from '../audio';

interface PlayerActionTag {
  type: 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'raise' | 'allin';
  label: string;
  amount?: number;
}

interface TexasActionEvent {
  seq: number;
  type: 'deal' | 'fold' | 'check' | 'call' | 'raise' | 'allin' | 'street' | 'showdown';
  playerId: string;
  nickname: string;
  amount?: number;
  detail?: string;
}

interface TexasPlayer {
  playerId: string;
  nickname: string;
  seat: number;
  folded: boolean;
  isAllIn?: boolean;
  totalBet: number;
  roundBet?: number;
  isDealer: boolean;
  isSmallBlind?: boolean;
  isBigBlind?: boolean;
  actionTag?: PlayerActionTag | null;
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
  round?: number;
  phase: 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | string;
  phaseLabel: string;
  community: CardView[];
  pot: number;
  currentBet: number;
  toCall: number;
  turn: string | null;
  dealerId: string | null;
  myHand: CardView[];
  myHandLabel?: string;
  myTotalBet: number;
  myRoundBet?: number;
  smallBlind?: number;
  bigBlind?: number;
  raiseUnit: number;
  maxRaiseAdd: number;
  lastAction?: TexasActionEvent | null;
  results: TexasResult[];
  players: TexasPlayer[];
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  balance: number;
  playerMedia?: Record<string, { avatar?: string | null; equippedFrame?: string }>;
  onAction: (cmd: string, amount?: number) => void;
}

const STREETS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'preflop', label: '翻牌前' },
  { key: 'flop', label: '翻牌' },
  { key: 'turn', label: '转牌' },
  { key: 'river', label: '河牌' },
  { key: 'showdown', label: '摊牌' },
];

export function Texas({ snapshot, myId, status, balance, playerMedia, onAction }: Props) {
  const data = snapshot as unknown as TexasSnapshot | undefined;
  const [raiseAdd, setRaiseAdd] = useState(100);
  const [centerBanner, setCenterBanner] = useState<{ id: number; kind: string; text: string; sub?: string } | null>(
    null,
  );

  const lastActionKeyRef = useRef<string>('');
  const localCmdRef = useRef<{ cmd: string; at: number } | null>(null);
  const bannerIdRef = useRef<number>(1);
  const bannerTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (data?.raiseUnit) {
      setRaiseAdd((prev) => (prev < data.raiseUnit ? data.raiseUnit : prev));
    }
  }, [data?.raiseUnit, data?.round]);

  // 实时监听全桌动作事件，驱动真实发牌 / 筹码 / 过牌 / 弃牌 / 加注 / 全压音效与视觉提示
  useEffect(() => {
    if (!data?.lastAction) return;
    const act = data.lastAction;
    const key = `${data.round ?? 1}:${act.seq}`;
    if (key === lastActionKeyRef.current) return;
    lastActionKeyRef.current = key;

    const showBanner = (kind: string, text: string, sub?: string, ms = 1450) => {
      const id = bannerIdRef.current++;
      if (bannerTimerRef.current !== null) window.clearTimeout(bannerTimerRef.current);
      setCenterBanner({ id, kind, text, sub });
      bannerTimerRef.current = window.setTimeout(() => {
        setCenterBanner((curr) => (curr?.id === id ? null : curr));
      }, ms);
    };

    const isRecentLocalSelf =
      act.playerId === myId &&
      localCmdRef.current !== null &&
      localCmdRef.current.cmd === act.type &&
      Date.now() - localCmdRef.current.at < 1500;

    switch (act.type) {
      case 'deal':
        audio.play('card_shuffle');
        window.setTimeout(() => audio.play('poker_deal'), 180);
        window.setTimeout(() => audio.play('poker_deal'), 300);
        window.setTimeout(() => audio.play('poker_chip_bet'), 420);
        showBanner('deal', '新局发牌', act.detail, 1300);
        break;
      case 'street': {
        const count = data.phase === 'flop' ? 3 : 1;
        for (let i = 0; i < count; i++) {
          window.setTimeout(() => audio.play('poker_deal'), i * 110);
        }
        showBanner('street', act.detail || data.phaseLabel, undefined, 1050);
        break;
      }
      case 'check':
        if (!isRecentLocalSelf) audio.play('poker_check');
        break;
      case 'call':
        if (!isRecentLocalSelf) audio.play('poker_chip_bet');
        break;
      case 'raise':
        if (!isRecentLocalSelf) audio.play('poker_raise');
        showBanner('raise', `${act.nickname} 加注`, act.detail || `+${(act.amount ?? 0).toLocaleString()} 筹码`, 1150);
        break;
      case 'fold':
        if (!isRecentLocalSelf) audio.play('poker_fold');
        break;
      case 'allin':
        if (!isRecentLocalSelf) audio.play('poker_allin');
        showBanner('allin', '🔥 ALL-IN 全压！', `${act.nickname} · ${(act.amount ?? 0).toLocaleString()} 筹码`, 1850);
        break;
      case 'showdown': {
        const myRow = data.results.find((r) => r.playerId === myId);
        if (myRow && myRow.delta > 0) {
          audio.play('win');
          window.setTimeout(() => audio.play('coin_stream'), 260);
        } else if (myRow && myRow.delta < 0) {
          audio.play('lose');
        } else {
          audio.play('poker_chip_bet');
        }
        break;
      }
    }
  }, [data, myId]);

  const streetIndex = useMemo(() => {
    const idx = STREETS.findIndex((s) => s.key === data?.phase);
    return idx >= 0 ? idx : 0;
  }, [data?.phase]);

  if (!data) return <div className="board-placeholder">等待发牌…</div>;

  const me = data.players.find((p) => p.playerId === myId);
  const others = data.players.filter((p) => p.playerId !== myId);
  const isMyTurn = data.turn === myId && status === 'playing' && !me?.folded && !me?.isAllIn;
  const canCheck = data.toCall === 0;
  const showResults = data.results.length > 0;
  const raiseUnit = data.raiseUnit || 100;

  // 允许的最大加注增量（兼顾余额与单笔风控上限）
  const maxAllowedAdd = Math.max(
    0,
    Math.min(data.maxRaiseAdd || 1_000_000, Math.max(0, balance - data.toCall)),
  );
  const effectiveRaiseAdd =
    maxAllowedAdd >= raiseUnit ? Math.min(Math.max(raiseAdd, raiseUnit), maxAllowedAdd) : raiseUnit;
  const allInAmount = Math.min(1_000_000, Math.max(0, Math.floor(balance)));
  const canAllIn = isMyTurn && allInAmount > 0;

  const quickPresets = [
    { label: '最小', add: raiseUnit },
    { label: '半池', add: Math.max(raiseUnit, Math.round((data.pot * 0.5) / raiseUnit) * raiseUnit) },
    { label: '满池', add: Math.max(raiseUnit, Math.round(data.pot / raiseUnit) * raiseUnit) },
    { label: '2倍池', add: Math.max(raiseUnit, Math.round((data.pot * 2) / raiseUnit) * raiseUnit) },
  ];

  const handleFold = () => {
    if (!isMyTurn) return;
    localCmdRef.current = { cmd: 'fold', at: Date.now() };
    audio.play('poker_fold');
    onAction('fold');
  };

  const handleCheck = () => {
    if (!isMyTurn || !canCheck) return;
    localCmdRef.current = { cmd: 'check', at: Date.now() };
    audio.play('poker_check');
    onAction('check');
  };

  const handleCall = () => {
    if (!isMyTurn || canCheck) return;
    localCmdRef.current = { cmd: 'call', at: Date.now() };
    audio.play('poker_chip_bet');
    onAction('call');
  };

  const handleRaise = () => {
    if (!isMyTurn || effectiveRaiseAdd < raiseUnit || data.toCall + effectiveRaiseAdd > balance) return;
    localCmdRef.current = { cmd: 'raise', at: Date.now() };
    audio.play('poker_raise');
    onAction('raise', effectiveRaiseAdd);
  };

  const handleAllIn = () => {
    if (!canAllIn) return;
    localCmdRef.current = { cmd: 'allin', at: Date.now() };
    audio.play('poker_allin');
    onAction('allin', allInAmount);
  };

  const handleSelectPreset = (add: number) => {
    audio.play('poker_chip_bet');
    setRaiseAdd(Math.min(Math.max(raiseUnit, add), Math.max(raiseUnit, maxAllowedAdd)));
  };

  return (
    <TableStage
      watermark="TEXAS HOLD'EM"
      seats={others.map((player) => {
        const badgeNode = player.isDealer ? (
          <em className="badge-dealer" title="庄家按钮">
            D
          </em>
        ) : player.isSmallBlind ? (
          <em className="badge-blind is-sb" title="小盲注">
            SB
          </em>
        ) : player.isBigBlind ? (
          <em className="badge-blind is-bb" title="大盲注">
            BB
          </em>
        ) : null;

        const tag = player.actionTag;
        const metaText = player.folded
          ? '已弃牌'
          : player.isAllIn
            ? `🔥 ALL-IN · 投入 ${player.totalBet.toLocaleString()}`
            : `投入 ${player.totalBet.toLocaleString()}`;

        return {
          key: player.playerId,
          active: data.turn === player.playerId,
          dim: player.folded,
          node: (
            <div className="texas-seat-wrap">
              <SeatPanel
                nickname={player.nickname}
                initial={player.nickname.replace(/^🤖\s*/, '').slice(0, 1)}
                avatar={playerMedia?.[player.playerId]?.avatar}
                frameId={playerMedia?.[player.playerId]?.equippedFrame}
                isBot={player.nickname.startsWith('🤖')}
                badge={badgeNode}
                active={data.turn === player.playerId}
                meta={metaText}
                cards={
                  player.cards.length > 0 ? (
                    <div className="texas-opp-cards">
                      {player.cards.map((card) => (
                        <div key={card.id} className={`pcard texas-opp-card ${isRedCard(card) ? 'is-red' : ''}`}>
                          <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                        </div>
                      ))}
                    </div>
                  ) : !player.folded && status === 'playing' ? (
                    <div className="texas-opp-cards is-back">
                      <div className="pcard texas-opp-card pcard--back">
                        <img src={cardArt('back')} alt="" draggable={false} />
                      </div>
                      <div className="pcard texas-opp-card pcard--back">
                        <img src={cardArt('back')} alt="" draggable={false} />
                      </div>
                    </div>
                  ) : null
                }
              />
              {tag && (
                <span className={`texas-action-pill is-${tag.type}`}>
                  {tag.type === 'allin' ? '🔥 ' : ''}
                  {tag.label}
                </span>
              )}
            </div>
          ),
        };
      })}
      center={
        <div className="texas-center texas-center--pro">
          {/* 5 阶段街程指示条 */}
          <div className="texas-street-bar" aria-label="当前阶段">
            {STREETS.map((st, idx) => (
              <span
                key={st.key}
                className={`texas-street-step${idx === streetIndex ? ' is-current' : idx < streetIndex ? ' is-done' : ''}`}
              >
                {st.label}
              </span>
            ))}
          </div>

          {/* 5 张超大高清奢华公共牌 */}
          <div className="texas-center__board texas-center__board--pro">
            {data.community.map((card, i) => (
              <div
                key={card.id}
                className={`pcard texas-board-card ${isRedCard(card) ? 'is-red' : ''}`}
                style={{ animationDelay: `${i * 55}ms` }}
                title={cardLabel(card)}
              >
                <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
              </div>
            ))}
            {Array.from({ length: Math.max(0, 5 - data.community.length) }).map((_, index) => (
              <div key={`empty-${index}`} className="pcard texas-board-card texas-board-card--slot">
                <img src={cardArt('back')} alt="" draggable={false} />
              </div>
            ))}
          </div>

          {/* 中心底池与筹码堆 */}
          <div className="texas-pot-panel">
            <div className="texas-pot-main">
              <span className="texas-pot-tag">底池 POT</span>
              <span className="texas-pot-num">
                <Chip size={22} />
                <strong>{data.pot.toLocaleString()}</strong>
              </span>
              <ChipStack amount={data.pot} />
            </div>
            <div className="texas-pot-sub">
              <span>
                当前注 <b>{data.currentBet.toLocaleString()}</b>
              </span>
              <span>·</span>
              <span>
                我的投入 <b>{data.myTotalBet.toLocaleString()}</b>
              </span>
              {data.toCall > 0 && isMyTurn && (
                <>
                  <span>·</span>
                  <span className="texas-pot-tocall">需跟 {data.toCall.toLocaleString()}</span>
                </>
              )}
            </div>
          </div>

          {/* 中央实时动作提示 / ALL-IN 震撼横幅 */}
          {centerBanner && !showResults && (
            <div key={centerBanner.id} className={`texas-fx-banner is-${centerBanner.kind}`}>
              <strong>{centerBanner.text}</strong>
              {centerBanner.sub && <span>{centerBanner.sub}</span>}
            </div>
          )}

          {/* 摊牌结算卡片（公共牌保持可见，方便复盘对比） */}
          {showResults && (
            <div className="reveal-list texas-reveal-card">
              {data.results.map((row) => (
                <div key={row.playerId} className={`reveal-row${row.delta > 0 ? ' is-winner' : ''}`}>
                  <span className="reveal-row__name">
                    {row.delta > 0 ? '👑 ' : ''}
                    {row.nickname}
                  </span>
                  <span className="reveal-row__pt muted">{row.folded ? '弃牌' : row.handLabel}</span>
                  <span className={row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'muted'}>
                    {row.delta > 0 ? `+${row.delta.toLocaleString()}` : row.delta.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      }
      bottom={
        <div className="hand-area texas-bottom-dock">
          {/* 自家超大双底牌 + 实时牌力徽标 */}
          <div className="texas-my-hand-wrap">
            {data.myHandLabel && !me?.folded && (
              <div className="texas-strength-pill">
                <span>♠ 当前牌力：</span>
                <strong>{data.myHandLabel}</strong>
              </div>
            )}
            <div className="hand hand--texas hand--texas-pro">
              {data.myHand.map((card, index) => (
                <div
                  key={card.id}
                  className={`pcard hand__card texas-hole-card ${isRedCard(card) ? 'is-red' : ''}${
                    me?.folded ? ' is-folded' : ''
                  }`}
                  style={{ ['--i' as string]: index }}
                  title={cardLabel(card)}
                >
                  <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                </div>
              ))}
            </div>
          </div>

          {/* 专业赌场行动控制台：快捷加注池比例 + 弃牌 / 过牌 / 跟注 / 加注 / 全压 */}
          <div className="texas-controls-panel">
            <div className="texas-controls-top">
              <span className={`turn-hint ${isMyTurn ? 'is-on' : ''}`}>
                {me?.folded
                  ? '已弃牌 · 观战本手'
                  : me?.isAllIn
                    ? '🔥 已全压 · 等待摊牌'
                    : isMyTurn
                      ? '★ 轮到你行动 ★'
                      : '等待对手思考…'}
              </span>

              {isMyTurn && maxAllowedAdd >= raiseUnit && (
                <div className="texas-preset-row">
                  {quickPresets.map((p) => {
                    const disabled = p.add > maxAllowedAdd;
                    const active = effectiveRaiseAdd === Math.min(p.add, maxAllowedAdd) && !disabled;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        className={`texas-preset-btn${active ? ' is-active' : ''}`}
                        disabled={disabled}
                        onClick={() => handleSelectPreset(p.add)}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                  <input
                    type="range"
                    className="texas-raise-slider"
                    min={raiseUnit}
                    max={Math.max(raiseUnit, Math.min(maxAllowedAdd, Math.max(data.pot * 3, raiseUnit * 10)))}
                    step={raiseUnit}
                    value={Math.min(
                      effectiveRaiseAdd,
                      Math.max(raiseUnit, Math.min(maxAllowedAdd, Math.max(data.pot * 3, raiseUnit * 10))),
                    )}
                    onChange={(e) => setRaiseAdd(Number(e.target.value))}
                    aria-label="调整加注金额"
                  />
                </div>
              )}
            </div>

            <div className="hand-actions hand-actions--luxury texas-action-row">
              <button
                type="button"
                className="action-btn texas-btn-fold"
                disabled={!isMyTurn}
                onClick={handleFold}
              >
                弃牌
              </button>

              {canCheck ? (
                <button
                  type="button"
                  className="action-btn texas-btn-check"
                  disabled={!isMyTurn}
                  onClick={handleCheck}
                >
                  过牌
                </button>
              ) : (
                <button
                  type="button"
                  className="action-btn texas-btn-call"
                  disabled={!isMyTurn || data.toCall > balance}
                  onClick={handleCall}
                >
                  跟注 {data.toCall.toLocaleString()}
                </button>
              )}

              <div className="raise-group texas-raise-group">
                <input
                  type="number"
                  min={raiseUnit}
                  max={Math.max(raiseUnit, maxAllowedAdd)}
                  step={raiseUnit}
                  value={effectiveRaiseAdd}
                  disabled={!isMyTurn || maxAllowedAdd < raiseUnit}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setRaiseAdd(Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0);
                  }}
                />
                <button
                  type="button"
                  className="action-btn texas-btn-raise"
                  disabled={!isMyTurn || effectiveRaiseAdd < raiseUnit || data.toCall + effectiveRaiseAdd > balance}
                  onClick={handleRaise}
                >
                  加注 +{effectiveRaiseAdd.toLocaleString()}
                </button>
              </div>

              <button
                type="button"
                className="action-btn texas-btn-allin"
                disabled={!canAllIn}
                onClick={handleAllIn}
                title={`全压当前可用筹码 ${allInAmount.toLocaleString()}`}
              >
                🔥 全压 {allInAmount > 0 ? allInAmount.toLocaleString() : ''}
              </button>
            </div>
          </div>
        </div>
      }
    />
  );
}
