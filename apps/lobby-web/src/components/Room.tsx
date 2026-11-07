import type { RoomView, Settlement } from '@cc/protocol';
import type { SnapshotEnvelope } from '../App';
import { Gomoku } from '../games/Gomoku';

interface Props {
  room: RoomView;
  snapshot: SnapshotEnvelope | null;
  settlement: Settlement | null;
  myId: string;
  onReady: (ready: boolean) => void;
  onLeave: () => void;
  onIntent: (cmd: string, payload: Record<string, unknown>) => void;
}

const STATUS_TEXT: Record<string, string> = {
  waiting: '等待玩家',
  playing: '对局中',
  settled: '本局结算',
  closed: '已关闭',
};

const GAME_TITLE: Record<string, string> = {
  gomoku: '五子棋',
};

export function Room({ room, snapshot, settlement, myId, onReady, onLeave, onIntent }: Props) {
  const me = room.players.find((p) => p.playerId === myId);
  const isHost = room.hostId === myId;
  const myDelta = settlement?.entries.find((e) => e.playerId === myId)?.delta ?? 0;
  const iWon = settlement?.winners.includes(myId) ?? false;

  const renderGame = () => {
    if (room.gameId === 'gomoku') {
      return <Gomoku snapshot={snapshot} status={room.status} onPlace={(x, y) => onIntent('place', { x, y })} />;
    }
    return <div className="game-fallback">该游戏的客户端尚未接入</div>;
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
          房间 {room.roomId.slice(0, 8)} · 第 {room.round} 局
        </div>
      </header>

      <main className="room__main">
        <section className="room__board">
          {renderGame()}
          {settlement && (
            <div className="result">
              <h3>{iWon ? '本局胜利' : myDelta < 0 ? '本局失利' : '本局结束'}</h3>
              <p className={myDelta > 0 ? 'up' : myDelta < 0 ? 'down' : ''}>
                {myDelta > 0 ? `+${myDelta}` : myDelta < 0 ? `${myDelta}` : '±0'} 积分
              </p>
              <span>5 秒后自动回到准备状态</span>
            </div>
          )}
        </section>

        <aside className="room__side">
          <div className="panel">
            <h2>玩家</h2>
            <ul className="player-list">
              {room.players.map((player) => (
                <li key={player.playerId} className={player.playerId === myId ? 'is-me' : ''}>
                  <span className="player-list__avatar">{player.nickname.slice(0, 1)}</span>
                  <span className="player-list__name">
                    {player.nickname}
                    {room.hostId === player.playerId && <em>房主</em>}
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
                onClick={() => onReady(!me?.ready)}
              >
                {me?.ready ? '取消准备' : '准备'}
              </button>
            ) : (
              <p className="hint">
                {room.status === 'playing' ? '对局进行中' : '请等待本局结算完成'}
              </p>
            )}
            {isHost && room.players.length < 2 && <p className="hint">等待另一位玩家加入…</p>}
          </div>
        </aside>
      </main>
    </div>
  );
}
