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
  waiting: '等待玩家',
  playing: '对局中',
  settled: '本局结算',
  closed: '已关闭',
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
      isBot: false,
    }));
  }, [settlement, room.players, liveResults]);

  const resultKey = settlement?.settlementId ?? `${room.roomId}:${room.round}`;
  const showPanel = resultRows.length > 0 && dismissedKey !== resultKey;

  /** 统一派发指令，并按动作类型播放音效 */
  const dispatch = (cmd: string, payload: Record<string, unknown> = {}): void => {
    if (cmd === 'play' || cmd === 'place') audio.play('play');
    else if (cmd === 'pass') audio.play('pass');
    else if (cmd === 'bet' || cmd === 'raise' || cmd === 'call') audio.play('bet');
    else audio.play('click');
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
            players={room.players.map((p) => ({
              playerId: p.playerId,
              nickname: p.nickname,
              seat: p.seat,
            }))}
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
            onPass={() => dispatch('pass', {})}
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
        return <div className="game-fallback">该游戏的客户端尚未接入</div>;
    }
  };

  return (
    <div className="room">
      <header className="topbar">
        <button type="button" className="ghost" onClick={onLeave}>
          ← 返回大厅
        </button>
        <div className="room__title">
          <h1>{GAME_TITLE[room.gameId] ?? room.gameId}</h1>
          <span className={`badge badge--${room.status}`}>{STATUS_TEXT[room.status] ?? room.status}</span>
        </div>
        <div className="room__meta">
          <span className="room__roomno">
            房间 {room.roomId.slice(0, 8)} · 第 {room.round} 局
          </span>
          <button type="button" className="ghost rules-trigger" onClick={() => setRulesOpen(true)}>
            ? 规则
          </button>
          <span className="wallet wallet--sm">
            <Chip size={17} />
            <strong>{balance.toLocaleString()}</strong>
          </span>
        </div>
      </header>

      {rulesOpen && <RulesModal gameId={room.gameId} onClose={() => setRulesOpen(false)} />}
      {settlement && myDelta > 0 && <CoinBurst key={`${room.roomId}-${room.round}`} />}

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
            // 服务端会把这次准备预约到结算结束，回到等待态即自动开局
            onReady(true);
          }}
          onClose={() => setDismissedKey(resultKey)}
        />
      )}

      <main className={`room__main ${room.round > 0 ? 'is-stage' : ''}`}>
        <section
          className="room__board"
          style={
            room.round === 0 && GAME_ART[room.gameId]
              ? {
                  backgroundImage: `linear-gradient(rgba(6,12,11,0.78), rgba(6,12,11,0.9)), url(${GAME_ART[room.gameId]})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }
              : undefined
          }
        >
          <div className="emote-stage">
            {emotes.map((emote) => (
              <div key={emote.at} className="emote-bubble">
                <span className="emote-bubble__who">{emote.nickname}</span>
                <span className="emote-bubble__text">{emote.text}</span>
              </div>
            ))}
          </div>

          {renderGame()}

          {room.status === 'playing' && (
            <div className="emote-bar">
              {EMOTES.map((emote) => (
                <button
                  key={emote.key}
                  type="button"
                  onClick={() => {
                    audio.play('click');
                    onEmote(emote.key);
                  }}
                >
                  {emote.text}
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="room__side">
          <div className="panel">
            <h2>玩家</h2>
            <ul className="player-list">
              {room.players.map((player) => (
                <li key={player.playerId} className={player.playerId === myId ? 'is-me' : ''}>
                  <span className={`player-list__avatar ${player.isBot ? 'is-bot' : ''}`}>
                    {player.nickname.replace(/^🤖\s*/, '').slice(0, 1)}
                  </span>
                  <span className="player-list__name">
                    {player.nickname}
                    {room.hostId === player.playerId && <em>房主</em>}
                    {player.isBot && <em className="bot-tag">AI</em>}
                  </span>
                  <span className={`player-list__state ${player.online ? '' : 'offline'}`}>
                    {player.online ? (player.ready ? '已准备' : '未准备') : '离线'}
                  </span>
                  <span className="player-list__score">{player.score}</span>
                </li>
              ))}
              {room.players.length === 0 && <li className="empty">等待玩家加入…</li>}
            </ul>
          </div>

          <div className="panel">
            <h2>操作</h2>
            {room.status === 'waiting' ? (
              <button
                type="button"
                className={me?.ready ? 'secondary' : 'primary'}
                onClick={() => {
                  audio.play('click');
                  onReady(!me?.ready);
                }}
              >
                {me?.ready ? '取消准备' : '准备'}
              </button>
            ) : (
              <p className="hint">{room.status === 'playing' ? '对局进行中' : '请等待本局结算完成'}</p>
            )}
            {isHost && room.status === 'waiting' && room.players.length < room.maxPlayers && (
              <button
                type="button"
                className="secondary bot-btn"
                onClick={() => {
                  audio.play('click');
                  onAddBot();
                }}
              >
                + 添加机器人陪玩
              </button>
            )}
            {isHost && room.players.length < room.maxPlayers && (
              <p className="hint">
                还差 {room.maxPlayers - room.players.length} 人，等待其他玩家加入…
              </p>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
