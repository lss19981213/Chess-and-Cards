import { useCallback, useEffect, useState } from 'react';
import type { GameMeta } from '@cc/protocol';
import { api } from '../api';
import { audio } from '../audio';
import { GAME_ART } from '../assets';

interface RoomItem {
  roomId: string;
  roomName: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'settled';
  persistent: boolean;
  joinable: boolean;
}

interface Props {
  game: GameMeta;
  onBack: () => void;
  onJoin: (roomId: string | null, create: boolean) => void;
  joinError: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  waiting: '等待加入',
  playing: '对局中',
  settled: '结算中',
};

export function GameRooms({ game, onBack, onJoin, joinError }: Props) {
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isLive = game.persistent === true;

  const load = useCallback(async () => {
    try {
      const data = await api.rooms(game.gameId);
      setRooms(data.rooms);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载房间失败');
    } finally {
      setLoading(false);
    }
  }, [game.gameId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 4000);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <div className="lobby">
      <header className="topbar">
        <div className="brand brand--sm">
          <button type="button" className="ghost back-btn" onClick={onBack}>
            ← 大厅
          </button>
          <h1>{game.name}</h1>
        </div>
        <span className="rooms-hint">
          {isLive ? '平台坐庄 · 全场共用一张台' : `${game.minPlayers}-${game.maxPlayers} 人一桌`}
        </span>
      </header>

      <main className="lobby__main">
        <section className="rooms-hero" style={{ backgroundImage: `url(${GAME_ART[game.gameId] ?? ''})` }}>
          <div className="rooms-hero__body">
            <h2>{game.name}</h2>
            <p>{game.description}</p>
          </div>
        </section>

        {joinError && <p className="form-error">{joinError}</p>}
        {error && <p className="form-error">{error}</p>}

        <div className="section-title">
          <h2>{isLive ? '平台台子' : '可加入的房间'}</h2>
          {!loading && <span>{rooms.length} 个</span>}
        </div>

        <div className="room-grid">
          {rooms.map((room) => (
            <button
              key={room.roomId}
              type="button"
              className={`room-tile ${room.persistent ? 'is-platform' : ''} ${
                room.joinable ? '' : 'is-locked'
              }`}
              disabled={!room.joinable}
              onClick={() => {
                audio.play('click');
                onJoin(room.roomId, false);
              }}
            >
              <div className="room-tile__head">
                <span className="room-tile__name">{room.roomName}</span>
                {room.persistent && <em className="room-tile__badge">平台庄</em>}
              </div>
              <div className="room-tile__meta">
                <span>
                  {room.players}/{room.maxPlayers} 人
                </span>
                <span className={room.status === 'waiting' ? 'is-open' : ''}>
                  {STATUS_TEXT[room.status] ?? room.status}
                </span>
              </div>
              <div className="room-tile__cta">{room.joinable ? '进入牌桌 →' : '已满 / 已开局'}</div>
            </button>
          ))}

          {!isLive && (
            <button
              type="button"
              className="room-tile room-tile--new"
              onClick={() => {
                audio.play('click');
                onJoin(null, true);
              }}
            >
              <div className="room-tile__plus">+</div>
              <div className="room-tile__name">创建新房间</div>
              <div className="room-tile__meta">你将成为房主</div>
            </button>
          )}

          {rooms.length === 0 && !loading && isLive && (
            <p className="empty">平台台子正在准备，稍后刷新</p>
          )}
        </div>

        {isLive && (
          <p className="lobby__footnote">
            该玩法由平台坐庄，每分钟一局，所有玩家共用同一张台，无需等待人数。
          </p>
        )}
      </main>
    </div>
  );
}
