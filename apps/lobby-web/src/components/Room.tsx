import { useMemo, useState } from 'react';
import { BOT_DIFFICULTY_LABEL, EMOTES, type BotDifficulty, type EmotePayload, type RoomView, type Settlement } from '@cc/protocol';
import type { SnapshotEnvelope } from '../App';
import { audio } from '../audio';
import { DEALER_MAIN, GAME_ART } from '../assets';
import { Chip } from './Chip';
import { InviteFriendsModal } from './InviteFriendsModal';
import { RulesModal } from './RulesModal';
import { SettleBubble, type ResultRow } from './SettleBubble';
import { SettlementFx } from './SettlementFx';
import { DealerTipWidget } from './DealerTipWidget';
import { lazy, Suspense } from 'react';

// 各玩法界面按需加载：首屏只解析大厅，进房后再拉对应模块
const Baccarat = lazy(() => import('../games/Baccarat').then((m) => ({ default: m.Baccarat })));
const Blackjack = lazy(() => import('../games/Blackjack').then((m) => ({ default: m.Blackjack })));
const BoardGame = lazy(() => import('../games/BoardGame').then((m) => ({ default: m.BoardGame })));
const CardTable = lazy(() => import('../games/CardTable').then((m) => ({ default: m.CardTable })));
const Dice = lazy(() => import('../games/Dice').then((m) => ({ default: m.Dice })));
const Gomoku = lazy(() => import('../games/Gomoku').then((m) => ({ default: m.Gomoku })));
const Niuniu = lazy(() => import('../games/Niuniu').then((m) => ({ default: m.Niuniu })));
const ShowdownTable = lazy(() =>
  import('../games/ShowdownTable').then((m) => ({ default: m.ShowdownTable })),
);
const Texas = lazy(() => import('../games/Texas').then((m) => ({ default: m.Texas })));
const Tuizhuanzi = lazy(() =>
  import('../games/Tuizhuanzi').then((m) => ({ default: m.Tuizhuanzi })),
);
const CsMahjong = lazy(() =>
  import('../games/CsMahjong').then((m) => ({ default: m.CsMahjong })),
);
const Slots = lazy(() =>
  import('../games/Slots').then((m) => ({ default: m.Slots })),
);

interface Props {
  room: RoomView;
  snapshot: SnapshotEnvelope | null;
  settlement: Settlement | null;
  myId: string;
  balance: number;
  onReady: (ready: boolean) => void;
  onLeave: () => void;
  onIntent: (cmd: string, payload: Record<string, unknown>) => void;
  onAddBot: (difficulty?: BotDifficulty) => void;
  botDifficulty: BotDifficulty;
  onChangeBotDifficulty: (difficulty: BotDifficulty) => void;
  emotes: EmotePayload[];
  onEmote: (key: string) => void;
  /** 平台坐庄的常驻玩法 */
  persistent: boolean;
  onBalanceChange?: (newBalance: number) => void;
}

const STATUS_TEXT: Record<string, string> = {
  waiting: '等待就绪',
  playing: '对决中',
  settled: '开奖结算',
  closed: '房间关闭',
};

const GAME_TITLE: Record<string, string> = {
  gomoku: '五子棋',
  doudizhu: '斗地主',
  paodekuai: '跑得快',
  tuizhuanzi: '推筒子',
  texas: '德州扑克',
  dice: '骰宝',
  baccarat: '百家乐',
  niuniu: '斗牛',
  blackjack: '21点',
  stud: '梭哈',
  goldenflower: '翻金花',
  chess: '国际象棋',
  xiangqi: '中国象棋',
  'cs-mahjong': '长沙麻将',
  slots: '疯狂老虎机',
};

export function Room({
  room,
  snapshot,
  settlement,
  myId,
  balance,
  onReady,
  onLeave,
  onIntent,
  onAddBot,
  botDifficulty,
  onChangeBotDifficulty,
  emotes,
  onEmote,
  persistent,
  onBalanceChange,
}: Props) {
  const me = room.players.find((p) => p.playerId === myId);
  const isHost = room.hostId === myId;
  const myDelta = useMemo(() => {
    const entries = Array.isArray(settlement?.entries) ? settlement.entries : [];
    return entries.find((e) => e.playerId === myId)?.delta ?? 0;
  }, [settlement, myId]);
  const isPersistentGame = persistent || ['tuizhuanzi', 'dice', 'baccarat', 'niuniu', 'blackjack', 'slots'].includes(room.gameId);

  const [dismissedKey, setDismissedKey] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [playersDrawerOpen, setPlayersDrawerOpen] = useState(false);
  const [cheerEffect, setCheerEffect] = useState(false);
  const [customDealerTip, setCustomDealerTip] = useState<string | null>(null);

  const dealerTip = useMemo(() => {
    if (customDealerTip) return customDealerTip;
    if (myDelta > 0 && (room.status === 'settled' || !persistent)) {
      return `哇！恭喜主人大获全胜～赢了 +${myDelta.toLocaleString()} 筹码！🎉`;
    }
    if (myDelta < 0 && (room.status === 'settled' || !persistent)) {
      return '主人别灰心，下一局一定通天大顺翻倍赢回来！💪';
    }
    if (room.status === 'waiting') return '各位牌友请就绪，精彩马上开启～';
    if (room.status === 'playing') return '艾莉丝发牌中，祝主人好运连连！';
    if (room.status === 'settled') return '本局结算完毕，手气真棒～';
    return '艾莉丝陪伴为您服务';
  }, [customDealerTip, myDelta, room.status, persistent]);

  const handleDealerCheer = () => {
    audio.play('shunzi');
    setCheerEffect(true);
    window.setTimeout(() => setCheerEffect(false), 800);
  };

  // 结果有两个来源：对战类用结算单，常驻类直接用快照里的本局明细
  const liveResults = (
    snapshot?.snapshot as
      | { results?: Array<{ playerId: string; nickname: string; delta: number }> }
      | undefined
  )?.results;

  const resultRows: ResultRow[] = useMemo(() => {
    const entries = Array.isArray(settlement?.entries) ? settlement.entries : [];
    if (entries.length > 0) {
      return entries.map((entry) => {
        const player = room.players.find((p) => p.playerId === entry.playerId);
        return {
          playerId: entry.playerId,
          nickname: player?.nickname ?? '玩家',
          delta: entry.delta,
          isBot: player?.isBot,
        };
      });
    }
    return (liveResults ?? []).map((row) => ({
      playerId: row.playerId,
      nickname: row.nickname,
      delta: row.delta,
    }));
  }, [settlement, liveResults, room.players]);

  const resultKey = settlement
    ? `settle-${room.round}`
    : liveResults && liveResults.length > 0
      ? `live-${room.round}`
      : '';

  const showPanel =
    resultKey !== '' &&
    resultKey !== dismissedKey &&
    resultRows.length > 0 &&
    (room.status === 'settled' || !persistent);

  const dispatch = (cmd: string, payload: Record<string, unknown> = {}) => {
    onIntent(cmd, payload);
  };

  const renderGame = () => {
    switch (room.gameId) {
      case 'gomoku':
        return (
          <Gomoku
            snapshot={snapshot}
            status={room.status}
            myId={myId}
            players={room.players}
            onPlace={(x, y) => dispatch('place', { x, y })}
          />
        );
      case 'doudizhu':
      case 'paodekuai':
        return (
          <CardTable
            variant={room.gameId}
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            round={room.round}
            onPlay={(cards) => dispatch('play', { cards })}
            onPass={() => dispatch('pass')}
          />
        );
      case 'tuizhuanzi':
        return (
          <Tuizhuanzi
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            balance={balance}
            onBet={(area, amount) => dispatch('bet', { area, amount })}
            onClear={(area) => dispatch('clear', area ? { area } : {})}
          />
        );
      case 'dice':
        return (
          <Dice
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            balance={balance}
            onBet={(area, amount) => dispatch('bet', { area, amount })}
            onClear={(area) => dispatch('clear', area ? { area } : {})}
          />
        );
      case 'baccarat':
        return (
          <Baccarat
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            balance={balance}
            onBet={(area, amount) => dispatch('bet', { area, amount })}
            onClear={(area) => dispatch('clear', area ? { area } : {})}
          />
        );
      case 'niuniu':
        return (
          <Niuniu
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            balance={balance}
            onBet={(area, amount) => dispatch('bet', { area, amount })}
            onClear={(area) => dispatch('clear', area ? { area } : {})}
          />
        );
      case 'blackjack':
        return (
          <Blackjack
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            balance={balance}
            onBet={(area, amount) => dispatch('bet', { area, amount })}
            onClear={(area) => dispatch('clear', area ? { area } : {})}
            onAction={(cmd) => dispatch(cmd, {})}
          />
        );
      case 'chess':
      case 'xiangqi':
        return (
          <BoardGame
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            variant={room.gameId === 'chess' ? 'chess' : 'xiangqi'}
            onAction={(cmd, payload) => dispatch(cmd, payload ?? {})}
          />
        );
      case 'stud':
      case 'goldenflower':
        return (
          <ShowdownTable
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            balance={balance}
            onAction={(cmd, amount) => dispatch(cmd, amount === undefined ? {} : { amount })}
          />
        );
      case 'texas':
        return (
          <Texas
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            balance={balance}
            onAction={(cmd, amount) => dispatch(cmd, amount === undefined ? {} : { amount })}
          />
        );
      case 'cs-mahjong':
        return (
          <CsMahjong
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            balance={balance}
            onAction={(cmd, payload) => dispatch(cmd, payload ?? {})}
          />
        );
      case 'slots':
        return (
          <Slots
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            balance={balance}
            onSpin={(betPerLine, lines) => dispatch('spin', { betPerLine, lines })}
          />
        );
      default:
        return <div className="game-fallback">该游戏客户端正在接入中…</div>;
    }
  };

  return (
    <div className="room room--luxury">
      {/* 极简流光牌桌顶栏 */}
      <header className="room-topbar">
        <div className="room-topbar__left">
          <button
            type="button"
            className="luxury-back-btn"
            onClick={() => {
              audio.play('click');
              onLeave();
            }}
            title="返回游戏大厅"
          >
            <span className="back-arrow">‹</span>
            <span>返回大厅</span>
          </button>
          <div className="room-info-pill">
            <strong>{GAME_TITLE[room.gameId] ?? room.gameId}</strong>
            <span className="room-no">#{room.roomId.slice(0, 6)}</span>
            <span className={`room-status-dot is-${room.status}`} />
            <span className="room-status-label">{STATUS_TEXT[room.status] ?? room.status}</span>
          </div>
        </div>

        <div className="room-topbar__center">
          <span className="round-badge">第 <strong>{room.round}</strong> 局</span>
        </div>

        <div className="room-topbar__right">
          <button
            type="button"
            className="room-players-btn"
            onClick={() => setPlayersDrawerOpen(!playersDrawerOpen)}
            title="查看本桌玩家"
          >
            👥 {room.players.length}/{room.maxPlayers}
          </button>

          <button
            type="button"
            className="room-invite-btn"
            onClick={() => setInviteOpen(true)}
            title="邀请好友入座"
          >
            ＋ 邀请
          </button>

          <button type="button" className="room-rules-btn" onClick={() => setRulesOpen(true)}>
            ? 规则
          </button>

          <div className="room-wallet-badge">
            <Chip size={18} />
            <strong>{balance.toLocaleString()}</strong>
          </div>
        </div>
      </header>

      {rulesOpen && <RulesModal gameId={room.gameId} onClose={() => setRulesOpen(false)} />}
      {inviteOpen && (
        <InviteFriendsModal
          roomId={room.roomId}
          gameId={room.gameId}
          roomName={GAME_TITLE[room.gameId] ?? room.gameId}
          onClose={() => setInviteOpen(false)}
        />
      )}
      {settlement && myDelta !== 0 && (
        <SettlementFx
          key={`settle-fx-${room.roomId}-${room.round}-${myDelta}`}
          delta={myDelta}
          onDismiss={() => {}}
        />
      )}

      {/* 战报气泡 HUD (轻量浮动，零遮挡，非阻断) */}
      {showPanel && (
        <SettleBubble
          gameId={room.gameId}
          round={room.round}
          rows={resultRows}
          myId={myId}
          balance={balance}
          persistent={isPersistentGame}
          onContinue={() => {
            setDismissedKey(resultKey);
            onReady(true);
          }}
          onClose={() => setDismissedKey(resultKey)}
        />
      )}

      {/* 牌桌主体核心 */}
      <main className="room-viewport">
        <section
          className="room-stage-container"
          style={
            room.round === 0 && GAME_ART[room.gameId]
              ? {
                  backgroundImage: `radial-gradient(ellipse at center, rgba(10,35,28,0.85) 0%, rgba(6,12,18,0.96) 80%), url(${GAME_ART[room.gameId]})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : undefined
          }
        >
          {/* 表情弹幕/气泡层 */}
          <div className="emote-stage">
            {emotes.map((emote) => (
              <div key={emote.at} className="emote-bubble">
                <span className="emote-bubble__who">{emote.nickname}</span>
                <span className="emote-bubble__text">{emote.text}</span>
              </div>
            ))}
          </div>

          {/* 动漫美女荷官专属牌桌陪伴席 (常驻显式展示) */}
          <aside
            className="room-dealer-companion"
            onClick={handleDealerCheer}
            role="button"
            tabIndex={0}
            title="点击与荷官艾莉丝互动"
          >
            <div className="room-dealer-avatar">
              <img src={DEALER_MAIN} alt="荷官艾莉丝" draggable={false} />
              <span className="room-dealer-live-dot" />
            </div>
            <div className="room-dealer-speech">
              <div className="room-dealer-header">
                <span className="room-dealer-name">荷官 · 艾莉丝</span>
                {cheerEffect && <span className="dealer-heart-float">💖</span>}
              </div>
              <span className="room-dealer-text">{dealerTip}</span>
            </div>

            {/* 玩家打赏荷官组件 */}
            <DealerTipWidget
              balance={balance}
              onBalanceChange={onBalanceChange ?? (() => {})}
              onAliceSpeak={(txt) => setCustomDealerTip(txt)}
              className="room-dealer-tip-slot"
            />
          </aside>

          {/* 渲染游戏牌桌 */}
          <Suspense
            fallback={
              <div className="room-view__loading" style={{ padding: 24, opacity: 0.6 }}>
                正在载入牌桌…
              </div>
            }
          >
            {renderGame()}
          </Suspense>

          {/* 等待开局专属悬浮就绪控制台（沉浸式牌桌中心，彻底取代旧侧栏） */}
          {room.status === 'waiting' && !isPersistentGame && (
            <div className="table-waiting-overlay">
              <div className="waiting-card">
                <div className="waiting-card__title">
                  <span className="sparkle">✦</span>
                  <h3>等待各位牌友准备就绪</h3>
                  <span className="sparkle">✦</span>
                </div>

                <div className="waiting-players-row">
                  {room.players.map((p) => (
                    <div key={p.playerId} className={`waiting-player-avatar ${p.ready ? 'is-ready' : ''}`}>
                      <div className="avatar-disc">
                        {p.nickname.slice(0, 1)}
                        {p.ready && <span className="ready-badge">✓</span>}
                      </div>
                      <span className="avatar-name">{p.nickname}</span>
                      {p.isBot && (
                        <em className={`waiting-bot-badge is-${p.botDifficulty ?? 'medium'}`}>
                          {BOT_DIFFICULTY_LABEL[p.botDifficulty ?? 'medium']}
                        </em>
                      )}
                    </div>
                  ))}
                  {Array.from({ length: Math.max(0, room.maxPlayers - room.players.length) }).map((_, idx) => (
                    <div key={`empty-${idx}`} className="waiting-player-avatar is-empty">
                      <div className="avatar-disc empty-disc">
                        {isHost ? (
                          <button
                            type="button"
                            className="btn-add-bot-circle"
                            onClick={() => onAddBot(botDifficulty)}
                            title={`添加${BOT_DIFFICULTY_LABEL[botDifficulty]}难度机器人入座`}
                          >
                            +🤖
                          </button>
                        ) : (
                          '...'
                        )}
                      </div>
                      <span className="avatar-name">待加入</span>
                    </div>
                  ))}
                </div>

                {isHost && room.players.length < room.maxPlayers && (
                  <div className="waiting-diff-bar">
                    <span className="waiting-diff-label">陪玩难度</span>
                    <div className="bot-diff-switch">
                      {(['low', 'medium', 'high'] as const).map((d) => (
                        <button
                          key={d}
                          type="button"
                          className={`bot-diff-btn is-${d} ${botDifficulty === d ? 'is-active' : ''}`}
                          onClick={() => {
                            audio.play('click');
                            onChangeBotDifficulty(d);
                          }}
                        >
                          {d === 'low' ? '初级 · 低' : d === 'medium' ? '中级 · 中' : '高级 · 高'}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="waiting-actions-row">
                  {isHost && room.players.length < room.maxPlayers && (
                    <button
                      type="button"
                      className="btn-ready-action btn-ready-action--instant"
                      onClick={() => {
                        audio.play('click');
                        if (!me?.ready) onReady(true);
                        const need = room.maxPlayers - room.players.length;
                        for (let i = 0; i < need; i++) {
                          window.setTimeout(() => onAddBot(botDifficulty), i * 60);
                        }
                      }}
                      title="自动按当前难度补满机器人并立即开始"
                    >
                      <span>⚡ 补满机器人秒开对决</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className={`btn-ready-action ${me?.ready ? 'is-cancel' : 'is-ready'}`}
                    onClick={() => {
                      audio.play('click');
                      onReady(!me?.ready);
                    }}
                  >
                    <span>{me?.ready ? '取消准备' : '✦ 立即准备 ✦'}</span>
                    <em className="btn-light" />
                  </button>

                  {isHost && room.players.length < room.maxPlayers && (
                    <button
                      type="button"
                      className="btn-bot-quick"
                      onClick={() => {
                        audio.play('click');
                        onAddBot(botDifficulty);
                      }}
                      title={`加入1名${BOT_DIFFICULTY_LABEL[botDifficulty]}机器人`}
                    >
                      🤖 +1{BOT_DIFFICULTY_LABEL[botDifficulty]}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 局内快捷表情按钮与抽屉 */}
          {room.status === 'playing' && (
            <div className="table-emote-trigger-container">
              <button
                type="button"
                className={`emote-trigger-btn ${emoteOpen ? 'is-open' : ''}`}
                onClick={() => setEmoteOpen(!emoteOpen)}
                title="快捷互动表情"
              >
                💬
              </button>
              {emoteOpen && (
                <div className="floating-emote-bar">
                  {EMOTES.map((emote) => (
                    <button
                      key={emote.key}
                      type="button"
                      className="emote-pill"
                      onClick={() => {
                        audio.play('click');
                        onEmote(emote.key);
                        setEmoteOpen(false);
                      }}
                    >
                      {emote.text}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {/* 侧滑玩家抽屉（可折叠） */}
        {playersDrawerOpen && (
          <aside className="room-players-drawer">
            <div className="drawer-header">
              <h4>本桌牌友 ({room.players.length}/{room.maxPlayers})</h4>
              <button type="button" className="drawer-close" onClick={() => setPlayersDrawerOpen(false)}>
                ✕
              </button>
            </div>
            <ul className="drawer-player-list">
              {room.players.map((p) => (
                <li key={p.playerId} className={`drawer-player-item ${p.playerId === myId ? 'is-me' : ''}`}>
                  <span className={`drawer-avatar ${p.isBot ? 'is-bot' : ''}`}>
                    {p.nickname.slice(0, 1)}
                  </span>
                  <div className="drawer-meta">
                    <span className="drawer-name">
                      {p.nickname}
                      {p.playerId === room.hostId && <em className="tag-host">房主</em>}
                      {p.isBot && (
  <em className={`tag-bot tag-bot--${p.botDifficulty ?? 'medium'}`}>
    {p.botDifficulty === 'low' ? '初级' : p.botDifficulty === 'high' ? '高级' : '中级'}
  </em>
)}
                    </span>
                    <span className="drawer-score">积分: {p.score}</span>
                  </div>
                  <span className={`drawer-status ${p.ready ? 'is-ready' : ''}`}>
                    {p.ready ? '已准备' : '等待中'}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        )}
      </main>
    </div>
  );
}
