import { useMemo, useState } from 'react';
import {
  DEALER_VOICES,
  EMOTES,
  type EmotePayload,
  type RoomView,
  type Settlement,
} from '@cc/protocol';
import type { SnapshotEnvelope } from '../App';
import type { User } from '../api';
import { audio } from '../audio';
import { speakDealerQuote } from '../speech';
import { DEALER_MAIN, DEALER_SKINS_ASSETS } from '../assets';
import { GAME_ART, gameTitleOf } from '../game-registry';
import { AvatarWithFrame } from './AvatarWithFrame';
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
  user?: User | null;
  onUserUpdate?: (patch: Partial<User>) => void;
  onReady: (ready: boolean) => void;
  onLeave: () => void;
  onIntent: (cmd: string, payload: Record<string, unknown>) => void;
  onAddBot: () => void;
  onSitDown?: () => void;
  onStandUp?: () => void;
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

export function Room({
  room,
  snapshot,
  settlement,
  myId,
  balance,
  user,
  onUserUpdate,
  onReady,
  onLeave,
  onIntent,
  onAddBot,
  onSitDown,
  onStandUp,
  emotes,
  onEmote,
  persistent,
  onBalanceChange,
}: Props) {
  const me = room.players.find((p) => p.playerId === myId);
  const spectatorMe = room.spectators?.find((s) => s.playerId === myId);
  const isSpectator = !me && Boolean(spectatorMe);
  const isQueuedToSit = Boolean(spectatorMe?.queuedToSit);
  const isHost = room.hostId === myId;
  const playerMedia = useMemo(() => {
    const map: Record<string, { avatar?: string | null; equippedFrame?: string }> = {};
    for (const p of room.players) {
      map[p.playerId] = {
        avatar: p.playerId === myId ? (user?.avatar ?? p.avatar ?? null) : (p.avatar ?? null),
        equippedFrame:
          p.playerId === myId
            ? (user?.equippedFrame ?? p.equippedFrame ?? 'frame_default')
            : (p.equippedFrame ?? 'frame_default'),
      };
    }
    if (myId && user && !map[myId]) {
      map[myId] = { avatar: user.avatar ?? null, equippedFrame: user.equippedFrame ?? 'frame_default' };
    }
    return map;
  }, [room.players, myId, user]);
  const dealerAvatarSrc = DEALER_SKINS_ASSETS[user?.dealerSkin || 'classic'] || DEALER_MAIN;
  const activeVoice = useMemo(() => {
    const voiceId = user?.dealerVoice || 'classic';
    return DEALER_VOICES.find((v) => v.id === voiceId) || DEALER_VOICES[0]!;
  }, [user?.dealerVoice]);
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
    const quotes = activeVoice.quotes.cheer.length > 0 ? activeVoice.quotes.cheer : activeVoice.quotes.idle;
    const picked = quotes[Math.floor(Math.random() * quotes.length)]!;
    setCustomDealerTip(picked);
    speakDealerQuote(picked, activeVoice.id);
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
            playerMedia={playerMedia}
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
            playerMedia={playerMedia}
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
            playerMedia={playerMedia}
            onAction={(cmd, amount) => dispatch(cmd, amount === undefined ? {} : { amount })}
          />
        );
      case 'cs-mahjong':
      case 'sc-mahjong':
      case 'gd-mahjong':
      case 'guobiao-mahjong':
      case 'hz-mahjong':
        return (
          <CsMahjong
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            balance={balance}
            playerMedia={playerMedia}
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
            <strong>{gameTitleOf(room.gameId)}</strong>
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

          {/* 机器人自建桌：已入座玩家可随时切换回观战，观战玩家显示顶栏快捷入座 */}
          {room.botHosted && !isSpectator && onStandUp && (
            <button
              type="button"
              className="room-standup-top-btn"
              onClick={onStandUp}
              title="离开当前座位，切换为观战模式"
            >
              👁️ 离座观战
            </button>
          )}

          {/* 非 1对1 游戏允许随时快捷呼叫机器人陪玩（观战模式下隐藏） */}
          {!isSpectator && room.maxPlayers > 2 && room.players.length < room.maxPlayers && (
            <button
              type="button"
              className="room-add-bot-top-btn"
              onClick={() => {
                audio.play('click');
                onAddBot();
              }}
              title="呼叫机器人陪玩入座"
            >
              🤖 +机器人
            </button>
          )}

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

          {user && (
            <div className="room-self-avatar-chip" title={`${user.nickname}`}>
              <AvatarWithFrame
                nickname={user.nickname}
                avatar={user.avatar}
                frameId={user.equippedFrame}
                size={34}
              />
            </div>
          )}

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
          roomName={gameTitleOf(room.gameId)}
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
          persistent={isPersistentGame || isSpectator}
          onContinue={() => {
            setDismissedKey(resultKey);
            if (isSpectator) {
              onSitDown?.();
            } else {
              onReady(true);
            }
          }}
          onClose={() => {
            setDismissedKey(resultKey);
            onLeave();
          }}
          onAutoDismiss={() => setDismissedKey(resultKey)}
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
              <img src={dealerAvatarSrc} alt="荷官艾莉丝" draggable={false} />
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
              onAffectionChange={(newAffection) => onUserUpdate?.({ dealerAffection: newAffection })}
              onAliceSpeak={(txt) => {
                setCustomDealerTip(txt);
                speakDealerQuote(txt, activeVoice.id);
              }}
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

          {/* 观战模式底部悬浮控制条（机器人自建房默认观看，点击「入座」随时加入游戏） */}
          {isSpectator && (
            <div className="spectator-hud-bar" role="region" aria-label="观战控制栏">
              <div className="spectator-hud-bar__info">
                <span className="spectator-live-pill">👁️ 观战模式</span>
                <div className="spectator-hud-bar__text">
                  <strong>
                    {isQueuedToSit
                      ? '已预约入座，本局结束后将自动为您安排座位！'
                      : '当前为实时观战视角，机器人正在激战对局中'}
                  </strong>
                  <span>
                    桌上玩家 {room.players.length}/{room.maxPlayers} · 当前观战 {room.spectators?.length ?? 1} 人
                  </span>
                </div>
              </div>
              <div className="spectator-hud-bar__actions">
                {isQueuedToSit ? (
                  <>
                    <span className="spectator-queued-badge">⏳ 等待本局结束自动上桌…</span>
                    {onStandUp && (
                      <button type="button" className="btn-spectator-cancel" onClick={onStandUp}>
                        取消预约
                      </button>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-spectator-sitdown"
                    onClick={() => onSitDown?.()}
                  >
                    🪑 立即入座加入游戏
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 等待开局专属悬浮就绪控制台（沉浸式牌桌中心，彻底取代旧侧栏） */}
          {room.status === 'waiting' && !isPersistentGame && !isSpectator && (
            <div className="table-waiting-overlay">
              <div className="waiting-card">
                <div className="waiting-card__title">
                  <span className="sparkle">✦</span>
                  <h3>等待各位牌友准备就绪</h3>
                  <span className="sparkle">✦</span>
                </div>

                <div className="waiting-players-row">
                  {room.players.map((p) => {
                    const media = playerMedia[p.playerId];
                    return (
                      <div key={p.playerId} className={`waiting-player-avatar ${p.ready ? 'is-ready' : ''}`}>
                        <div className="avatar-disc avatar-disc--framed">
                          <AvatarWithFrame
                            nickname={p.nickname}
                            avatar={media?.avatar}
                            frameId={media?.equippedFrame}
                            size={58}
                          />
                          {p.ready && <span className="ready-badge">✓</span>}
                        </div>
                        <span className="avatar-name">{p.nickname}</span>
                        {p.isBot && (
                          <em className="waiting-bot-badge is-high">
                            大师AI
                          </em>
                        )}
                      </div>
                    );
                  })}
                  {Array.from({ length: Math.max(0, room.maxPlayers - room.players.length) }).map((_, idx) => (
                    <div key={`empty-${idx}`} className="waiting-player-avatar is-empty">
                      <div className="avatar-disc empty-disc">
                        {isHost || room.maxPlayers > 2 ? (
                          <button
                            type="button"
                            className="btn-add-bot-circle"
                            onClick={() => onAddBot()}
                            title="添加高智商陪玩机器人入座"
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

                <div className="waiting-actions-row">
                  {(isHost || room.maxPlayers > 2) && room.players.length < room.maxPlayers && (
                    <button
                      type="button"
                      className="btn-ready-action btn-ready-action--instant"
                      onClick={() => {
                        audio.play('click');
                        if (!me?.ready) onReady(true);
                        const need = room.maxPlayers - room.players.length;
                        for (let i = 0; i < need; i++) {
                          window.setTimeout(() => onAddBot(), i * 60);
                        }
                      }}
                      title="自动补满大师级机器人并立即开始"
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

                  {(isHost || room.maxPlayers > 2) && room.players.length < room.maxPlayers && (
                    <button
                      type="button"
                      className="btn-bot-quick"
                      onClick={() => {
                        audio.play('click');
                        onAddBot();
                      }}
                      title="加入1名大师级机器人"
                    >
                      🤖 +1陪玩
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
              {room.players.map((p) => {
                const media = playerMedia[p.playerId];
                return (
                  <li key={p.playerId} className={`drawer-player-item ${p.playerId === myId ? 'is-me' : ''}`}>
                    <AvatarWithFrame
                      nickname={p.nickname}
                      avatar={media?.avatar}
                      frameId={media?.equippedFrame}
                      size={38}
                    />
                    <div className="drawer-meta">
                      <span className="drawer-name">
                        {p.nickname}
                        {p.playerId === room.hostId && <em className="tag-host">房主</em>}
                        {p.isBot && (
                          <em className="tag-bot tag-bot--high">
                            大师AI
                          </em>
                        )}
                      </span>
                      <span className="drawer-score">积分: {p.score}</span>
                    </div>
                    <span className={`drawer-status ${p.ready ? 'is-ready' : ''}`}>
                      {p.ready ? '已准备' : '等待中'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </main>
    </div>
  );
}
