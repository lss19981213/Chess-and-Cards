import { useEffect, useMemo, useRef, useState } from 'react';
import { cardArt, cardLabel, isRedCard, type CardView } from './cards';
import { audio } from '../audio';
import { AvatarWithFrame } from '../components/AvatarWithFrame';
import { Chip, ChipStack } from '../components/Chip';

interface ShowdownActionTag {
  type: 'look' | 'fold' | 'check' | 'call' | 'raise' | 'allin';
  label: string;
  amount?: number;
}

interface ShowdownActionEvent {
  seq: number;
  type: 'deal' | 'look' | 'fold' | 'check' | 'call' | 'raise' | 'allin' | 'street' | 'showdown';
  playerId: string;
  nickname: string;
  amount?: number;
  detail?: string;
}

interface ShowdownSnapshot {
  gameVariant?: 'goldenflower' | 'stud';
  canLook?: boolean;
  phase: string;
  round: number;
  turn: string | null;
  currentBet: number;
  pot: number;
  myCards: CardView[];
  myHandLabel?: string;
  myTotalBet: number;
  toCall: number;
  raiseUnit: number;
  maxRaiseAdd: number;
  lastAction?: ShowdownActionEvent | null;
  players: Array<{
    playerId: string;
    nickname: string;
    seat: number;
    isBot: boolean;
    folded: boolean;
    isAllIn?: boolean;
    actionTag?: ShowdownActionTag | null;
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
  playerMedia?: Record<string, { avatar?: string | null; equippedFrame?: string }>;
  onAction: (cmd: string, amount?: number) => void;
}

const STUD_STREETS: ReadonlyArray<{ step: number; label: string }> = [
  { step: 1, label: '第1轮 · 1底1明' },
  { step: 2, label: '第2轮 · 3张' },
  { step: 3, label: '第3轮 · 4张' },
  { step: 4, label: '第4轮 · 5张决战' },
];

export function ShowdownTable({ snapshot, myId, status, balance, playerMedia, onAction }: Props) {
  const data = snapshot as unknown as ShowdownSnapshot | undefined;
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

  // 实时监听全桌动作事件，驱动真实发牌 / 看牌 / 筹码 / 过牌 / 弃牌 / 加注 / 梭哈全压音效与视觉播报
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
        setCenterBanner((cur) => (cur?.id === id ? null : cur));
      }, ms);
    };

    const isJustPlayedLocally =
      act.playerId === myId &&
      localCmdRef.current !== null &&
      localCmdRef.current.cmd === act.type &&
      Date.now() - localCmdRef.current.at < 900;

    switch (act.type) {
      case 'deal':
        audio.play('poker_deal');
        window.setTimeout(() => audio.play('poker_deal'), 140);
        window.setTimeout(() => audio.play('poker_chip_bet'), 280);
        showBanner('deal', '新局发牌', act.detail ?? '各下底注', 1350);
        break;
      case 'street':
        audio.play('poker_deal');
        window.setTimeout(() => audio.play('poker_deal'), 130);
        showBanner('street', act.detail ?? '派发明牌', undefined, 1400);
        break;
      case 'look':
        if (!isJustPlayedLocally) audio.play('poker_deal');
        showBanner('street', `${act.nickname} 翻牌看牌`, '转为明注 2 倍', 1200);
        break;
      case 'fold':
        if (!isJustPlayedLocally) audio.play('poker_fold');
        showBanner('fold', `${act.nickname} 弃牌`, undefined, 1150);
        break;
      case 'check':
        if (!isJustPlayedLocally) audio.play('poker_check');
        showBanner('check', `${act.nickname} 过牌`, undefined, 1100);
        break;
      case 'call':
        if (!isJustPlayedLocally) audio.play('poker_chip_bet');
        showBanner('call', `${act.nickname} 跟注`, act.amount ? `+${act.amount.toLocaleString()}` : undefined, 1200);
        break;
      case 'raise':
        if (!isJustPlayedLocally) audio.play('poker_raise');
        showBanner('raise', `${act.nickname} 加注`, act.detail ?? (act.amount ? `+${act.amount.toLocaleString()}` : undefined), 1350);
        break;
      case 'allin':
        if (!isJustPlayedLocally) audio.play('poker_allin');
        showBanner(
          'allin',
          `🔥 ${act.nickname} ALL-IN 全压！`,
          act.amount ? `推入 ${act.amount.toLocaleString()} 筹码` : '孤注一掷',
          1900,
        );
        break;
      case 'showdown': {
        const myRow = data.results?.find((r) => r.playerId === myId);
        if (myRow && myRow.delta > 0) {
          audio.play('win');
        } else if (myRow && myRow.delta < 0) {
          audio.play('lose');
        } else {
          audio.play('poker_deal');
        }
        showBanner('showdown', '开牌比大小', act.nickname || '结算完成', 2100);
        break;
      }
    }
  }, [data?.lastAction, data?.round, data?.results, myId]);

  const raiseUnit = Math.max(10, data?.raiseUnit ?? 100);
  const maxAllowedRaise = useMemo(() => {
    if (!data) return raiseUnit;
    const cap = Math.min(data.maxRaiseAdd ?? 1_000_000, Math.max(0, balance - data.toCall));
    return Math.max(0, cap);
  }, [data, balance, raiseUnit]);

  const clampedRaise = Math.min(Math.max(raiseUnit, raiseAdd), Math.max(raiseUnit, maxAllowedRaise));

  const presets = useMemo(() => {
    const pot = Math.max(raiseUnit, data?.pot ?? 0);
    const snap = (v: number) => Math.max(raiseUnit, Math.round(v / raiseUnit) * raiseUnit);
    return [
      { label: '最小', value: raiseUnit },
      { label: '半池', value: snap(pot * 0.5) },
      { label: '满池', value: snap(pot) },
      { label: '2倍池', value: snap(pot * 2) },
    ];
  }, [data?.pot, raiseUnit]);

  if (!data) return <div className="board-placeholder">等待发牌…</div>;

  const isStud = data.gameVariant === 'stud' || Boolean(data.street);
  const canLookMode = data.canLook === true || !isStud;
  const me = data.players.find((p) => p.playerId === myId);
  const isMyTurn = data.turn === myId && status === 'playing' && !me?.folded && !me?.isAllIn;
  const canCheck = data.toCall <= 0;
  const showResults = data.results.length > 0;
  const mult = canLookMode && data.looked ? 2 : 1;
  const need = data.toCall + clampedRaise * mult;
  const canRaiseNow = isMyTurn && maxAllowedRaise >= raiseUnit && need <= balance;
  const allInAmount = Math.min(balance, data.maxRaiseAdd ?? 1_000_000);
  const canAllIn = isMyTurn && allInAmount > 0;

  const fireCmd = (cmd: string, amount?: number) => {
    localCmdRef.current = { cmd, at: Date.now() };
    switch (cmd) {
      case 'fold':
        audio.play('poker_fold');
        break;
      case 'check':
        audio.play('poker_check');
        break;
      case 'call':
        audio.play('poker_chip_bet');
        break;
      case 'raise':
        audio.play('poker_raise');
        break;
      case 'allin':
        audio.play('poker_allin');
        break;
      case 'look':
        audio.play('poker_deal');
        break;
      default:
        audio.play('click');
    }
    onAction(cmd, amount);
  };

  return (
    <div className="showdown showdown--pro">
      {/* 居中动作特效横幅 */}
      {centerBanner && (
        <div key={centerBanner.id} className={`texas-fx-banner is-${centerBanner.kind}`} role="status" aria-live="polite">
          <strong>{centerBanner.text}</strong>
          {centerBanner.sub && <span>{centerBanner.sub}</span>}
        </div>
      )}

      {/* 顶部进程 + 底池豪华仪表栏 */}
      <div className="showdown-top-hub">
        {isStud ? (
          <div className="texas-streets" aria-label="发牌轮次">
            {STUD_STREETS.map((st) => {
              const cur = data.street ?? 1;
              const isCur = !showResults && cur === st.step;
              const isPast = showResults || cur > st.step;
              return (
                <span key={st.step} className={`texas-street ${isCur ? 'is-active' : ''} ${isPast ? 'is-done' : ''}`}>
                  {st.label}
                </span>
              );
            })}
          </div>
        ) : (
          <div className="texas-streets" aria-label="金花牌局状态">
            <span className="texas-street is-active">🌸 三张金花 · 豹子通杀</span>
            <span className={`texas-street ${data.looked ? 'is-done' : ''}`}>
              {data.looked ? '👁️ 当前明注 (2倍)' : '🃏 当前暗注 (1倍)'}
            </span>
          </div>
        )}

        <div className="showdown__bar showdown__bar--pro">
          <Chip size={20} />
          <span className="pot-display__label">总底池</span>
          <span className="pot-display__value">
            <strong>{data.pot.toLocaleString()}</strong>
          </span>
          <span className="pot-display__meta">
            当前注 {data.currentBet.toLocaleString()} · 我的投入 {data.myTotalBet.toLocaleString()}
          </span>
        </div>
      </div>

      {/* 全桌玩家座位区 */}
      <div className="showdown__seats">
        {data.players.map((player) => {
          const isTurn = data.turn === player.playerId && !showResults;
          const isAllIn = Boolean(player.isAllIn || data.allIn?.includes(player.playerId));
          const isLooked = Boolean(data.lookedPlayers?.includes(player.playerId));
          return (
            <div
              key={player.playerId}
              className={`showdown__seat${isTurn ? ' is-turn' : ''}${
                player.playerId === myId ? ' is-me' : ''
              }${player.folded ? ' is-folded' : ''}${isAllIn ? ' is-allin' : ''}`}
            >
              <div className="showdown__head">
                <AvatarWithFrame
                  nickname={player.nickname}
                  avatar={playerMedia?.[player.playerId]?.avatar}
                  frameId={playerMedia?.[player.playerId]?.equippedFrame}
                  size={40}
                />
                <div className="showdown__identity">
                  <span className="showdown__name">{player.nickname}</span>
                  <div className="showdown__tags-inline">
                    {canLookMode && !player.folded && (
                      <span className={`showdown-look-tag ${isLooked ? 'is-looked' : ''}`}>
                        {isLooked ? '明注' : '暗注'}
                      </span>
                    )}
                    {isAllIn && <span className="showdown-allin-tag">ALL-IN</span>}
                  </div>
                </div>
              </div>

              <div className="showdown__cards showdown__cards--pro">
                {player.cards.length > 0
                  ? player.cards.map((card, idx) =>
                      card.id === 'back' ? (
                        <span key={`back-${idx}`} className="pcard pcard--back showdown-seat-card">
                          <img src={cardArt('back')} alt="" draggable={false} />
                        </span>
                      ) : (
                        <span key={card.id} className={`pcard showdown-seat-card ${isRedCard(card) ? 'is-red' : ''}`}>
                          <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                        </span>
                      ),
                    )
                  : Array.from({ length: player.cardCount }).map((_, index) => (
                      <span key={`back-${index}`} className="pcard pcard--back showdown-seat-card">
                        <img src={cardArt('back')} alt="" draggable={false} />
                      </span>
                    ))}
              </div>

              <div className="showdown__seat-foot">
                <ChipStack amount={player.totalBet} />
                <span className="showdown__bet">投入 {player.totalBet.toLocaleString()}</span>
                {player.actionTag && (
                  <span className={`texas-action-pill is-${player.actionTag.type === 'look' ? 'check' : player.actionTag.type}`}>
                    {player.actionTag.label}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 底部自家超大清晰手牌 + 实时牌力 + 看牌按钮 */}
      <div className="showdown__hand-wrap showdown__hand-wrap--pro">
        <div className="showdown__hand-header">
          {data.myHandLabel && (
            <div className="texas-strength-pill">
              <span>当前牌力</span>
              <strong>{data.myHandLabel}</strong>
            </div>
          )}
          {canLookMode && !showResults && !me?.folded && (
            <div className="showdown__look-bar">
              {data.looked ? (
                <span className="looked-badge">👁️ 已看牌（明注 2 倍）</span>
              ) : (
                <button
                  type="button"
                  className="action-btn showdown-look-btn"
                  onClick={() => fireCmd('look')}
                >
                  👁️ 翻开看牌（当前暗注 1 倍）
                </button>
              )}
            </div>
          )}
        </div>

        <div className="showdown__hand showdown__hand--pro">
          {data.myCards.length > 0
            ? data.myCards.map((card, idx) => (
                <span
                  key={card.id}
                  className={`pcard showdown-my-card ${isRedCard(card) ? 'is-red' : ''} ${
                    me?.folded ? 'is-folded' : ''
                  }`}
                  style={{ ['--i' as string]: idx }}
                >
                  <img src={cardArt(card.id)} alt={cardLabel(card)} draggable={false} />
                </span>
              ))
            : Array.from({ length: data.handSize || 3 }).map((_, index) => (
                <span
                  key={`back-${index}`}
                  className={`pcard pcard--back showdown-my-card ${me?.folded ? 'is-folded' : ''}`}
                >
                  <img src={cardArt('back')} alt="" draggable={false} />
                </span>
              ))}
        </div>
      </div>

      {/* 结算卡片 或 专业下注操作台 */}
      {showResults ? (
        <div className="reveal-list texas-reveal-card">
          {data.results.map((row) => (
            <div key={row.playerId} className={`reveal-row ${row.delta > 0 ? 'is-winner' : ''}`}>
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
      ) : (
        <div className="texas-controls-panel showdown-controls-panel">
          <div className="texas-controls-top">
            <span className={`turn-hint ${isMyTurn ? 'is-on' : ''}`}>
              {isMyTurn ? '★ 轮到你行动 ★' : me?.folded ? '你已弃牌，等待结算…' : me?.isAllIn ? '🔥 已全压，等待开牌…' : '等待其他玩家行动…'}
            </span>
            {isMyTurn && (
              <div className="texas-preset-row">
                {presets.map((p) => {
                  const disabled = p.value > maxAllowedRaise || data.toCall + p.value * mult > balance;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      className={`texas-preset-btn ${clampedRaise === p.value ? 'is-active' : ''}`}
                      disabled={disabled}
                      onClick={() => {
                        audio.play('click');
                        setRaiseAdd(p.value);
                      }}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="texas-action-row hand-actions--luxury">
            <button
              type="button"
              className="action-btn texas-btn-fold"
              disabled={!isMyTurn}
              onClick={() => fireCmd('fold')}
            >
              弃牌
            </button>

            {canCheck ? (
              <button
                type="button"
                className="action-btn texas-btn-check"
                disabled={!isMyTurn}
                onClick={() => fireCmd('check')}
              >
                过牌
              </button>
            ) : (
              <button
                type="button"
                className="action-btn texas-btn-call"
                disabled={!isMyTurn || data.toCall > balance}
                onClick={() => fireCmd('call')}
              >
                跟注 {data.toCall.toLocaleString()}
              </button>
            )}

            <div className="raise-group texas-raise-group">
              <input
                type="range"
                className="texas-raise-slider"
                min={raiseUnit}
                max={Math.max(raiseUnit, Math.min(maxAllowedRaise, Math.max(raiseUnit * 10, data.pot * 3)))}
                step={raiseUnit}
                value={Math.min(clampedRaise, Math.max(raiseUnit, Math.min(maxAllowedRaise, Math.max(raiseUnit * 10, data.pot * 3))))}
                disabled={!isMyTurn || maxAllowedRaise < raiseUnit}
                onChange={(e) => setRaiseAdd(Number(e.target.value))}
                aria-label="加注滑块"
              />
              <input
                type="number"
                min={raiseUnit}
                max={Math.max(raiseUnit, maxAllowedRaise)}
                step={raiseUnit}
                value={raiseAdd}
                disabled={!isMyTurn}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setRaiseAdd(Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0);
                }}
              />
              <button
                type="button"
                className="action-btn texas-btn-raise"
                disabled={!canRaiseNow}
                onClick={() => fireCmd('raise', clampedRaise)}
              >
                加注 +{clampedRaise.toLocaleString()}
              </button>
            </div>

            <button
              type="button"
              className="action-btn texas-btn-allin"
              disabled={!canAllIn}
              onClick={() => fireCmd('allin', allInAmount)}
            >
              🔥 {isStud ? '梭哈' : '全压'} {canAllIn ? allInAmount.toLocaleString() : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
