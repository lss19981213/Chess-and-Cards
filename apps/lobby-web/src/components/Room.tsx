import { useMemo, useState } from 'react';
import { EMOTES, type EmotePayload, type RoomView, type Settlement } from '@cc/protocol';
import type { SnapshotEnvelope } from '../App';
import { audio } from '../audio';
import { GAME_ART } from '../assets';
import { Chip } from './Chip';
import { CoinBurst } from './CoinBurst';
import { RulesModal } from './RulesModal';
import { SettlePanel, type ResultRow } from './SettlePanel';
import { Baccarat } from '../games/Baccarat';
import { Blackjack } from '../games/Blackjack';
import { BoardGame } from '../games/BoardGame';
import { CardTable } from '../games/CardTable';
import { Dice } from '../games/Dice';
import { Gomoku } from '../games/Gomoku';
import { Niuniu } from '../games/Niuniu';
import { ShowdownTable } from '../games/ShowdownTable';
import { Texas } from '../games/Texas';
import { Tuizhuanzi } from '../games/Tuizhuanzi';

interface Props {
  room: RoomView;
  snapshot: SnapshotEnvelope | null;
  settlement: Settlement | null;
  myId: string;
  balance: number;
  onReady: (ready: boolean) => void;
  onLeave: () => void;
  onIntent: (cmd: string, payload: Record<string, unknown>) => void;
  onAddBot: () => void;
  emotes: EmotePayload[];
  onEmote: (key: string) => void;
  /** 平台坐庄的常驻玩法 */
  persistent: boolean;
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
  emotes,
  onEmote,
  persistent,
}: Props) {
  const me = room.players.find((p) => p.playerId === myId);
  const isHost = room.hostId === myId;
  const myDelta = settlement?.entries.find((e) => e.playerId === myId)?.delta ?? 0;

  const [dismissedKey, setDismissedKey] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const [emoteOpen, setEmoteOpen] = useState(false);
  const [playersDrawerOpen, setPlayersDrawerOpen] = useState(false);

  // 结果有两个来源：对战类用结算单，常驻类直接用快照里的本局明细
  const liveResults = (
    snapshot?.snapshot as
      | { results?: Array<{ playerId: string; nickname: string; delta: number }> }
      | undefined
  )?.results;

  const resultRows: ResultRow[] = useMemo(() => {
    if (settlement?.entries.length) {
      return settlement.entries.map((entry) => {
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
      default:
        return <div className="game-fallback">该游戏客户端正在接入中…</div>;
    }
  };

  return (
    <div className="room room--luxury">
      {/* 极简流光牌桌顶栏 */}
      <header className="room-topbar">
        <div className="room-topbar__left">
          <button type="button" className="room-leave-btn" onClick={onLeave}>
            <span>‹</span> 退出
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
      {settlement && myDelta > 0 && <CoinBurst key={`${room.roomId}-${room.round}`} />}

      {/* 胜利/局结弹窗 */}
      {showPanel && (
        <SettlePanel
          gameId={room.gameId}
          round={room.round}
          rows={resultRows}
          myId={myId}
          balance={balance}
          persistent={persistent}
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

          {/* 渲染游戏牌桌 */}
          {renderGame()}

          {/* 等待开局专属悬浮就绪控制台（沉浸式牌桌中心，彻底取代旧侧栏） */}
          {room.status === 'waiting' && !persistent && (
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
                    </div>
                  ))}
                  {Array.from({ length: Math.max(0, room.maxPlayers - room.players.length) }).map((_, idx) => (
                    <div key={`empty-${idx}`} className="waiting-player-avatar is-empty">
                      <div className="avatar-disc empty-disc">
                        {isHost ? (
                          <button
                            type="button"
                            className="btn-add-bot-circle"
                            onClick={onAddBot}
                            title="添加AI机器人入座"
                          >
                            +AI
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
                        onAddBot();
                      }}
                    >
                      🤖 添加AI陪玩
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
                      {p.isBot && <em className="tag-bot">AI</em>}
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
