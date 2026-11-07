import type { RoomView, Settlement } from '@cc/protocol';
import type { SnapshotEnvelope } from '../App';
import { audio } from '../audio';
import { GAME_ART } from '../assets';
import { Chip } from './Chip';
import { CoinBurst } from './CoinBurst';
import { CardTable } from '../games/CardTable';
import { Gomoku } from '../games/Gomoku';
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
}: Props) {
  const me = room.players.find((p) => p.playerId === myId);
  const isHost = room.hostId === myId;
  const myDelta = settlement?.entries.find((e) => e.playerId === myId)?.delta ?? 0;

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
            onBet={(amount) => dispatch('bet', { amount })}
          />
        );
      case 'texas':
        return (
          <Texas
            snapshot={snapshot?.snapshot ?? null}
            myId={myId}
            status={room.status}
            onAction={(cmd) => dispatch(cmd, {})}
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
          <span className="wallet wallet--sm">
            <Chip size={17} />
            <strong>{balance.toLocaleString()}</strong>
          </span>
        </div>
      </header>

      {settlement && myDelta > 0 && <CoinBurst key={`${room.roomId}-${room.round}`} />}

      {settlement && (
        <div className={`settle-bar ${myDelta > 0 ? 'is-win' : myDelta < 0 ? 'is-lose' : ''}`}>
          本局结算：
          <Chip size={18} />
          <strong>{myDelta > 0 ? `+${myDelta}` : myDelta}</strong>
          <span>筹码，5 秒后自动回到准备状态</span>
        </div>
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
          {renderGame()}
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
