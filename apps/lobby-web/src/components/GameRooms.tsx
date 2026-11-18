import { useCallback, useEffect, useState } from 'react';
import type { GameMeta } from '@cc/protocol';
import { api } from '../api';
import { audio } from '../audio';
import { GAME_ART } from '../assets';
import { gameStatusBadge, gameUnavailableToast, isGameJoinable } from '../gameAvailability';

interface TrendMark {
  round: number;
  text: string;
  tone: 'red' | 'blue' | 'green' | 'neutral';
}

interface RoomItem {
  roomId: string;
  roomName: string;
  hostName: string;
  players: number;
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'settled';
  persistent: boolean;
  botHosted?: boolean;
  spectators?: number;
  joinable: boolean;
  recent: TrendMark[];
}

interface Props {
  game: GameMeta;
  onBack: () => void;
  onJoin: (roomId: string | null, create: boolean) => void;
  joinError: string | null;
}

const STATUS_TEXT: Record<string, string> = {
  waiting: '空闲可加入',
  playing: '激战正酣',
  settled: '开奖结算中',
};

const PERSISTENT_GAME_IDS = new Set(['tuizhuanzi', 'dice', 'baccarat', 'niuniu', 'blackjack']);

export function GameRooms({ game, onBack, onJoin, joinError }: Props) {
  const [rooms, setRooms] = useState<RoomItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const isLive = game.persistent === true || PERSISTENT_GAME_IDS.has(game.gameId);

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

  const joinable = isGameJoinable(game);
  const maintBadge = gameStatusBadge(game);

  const handleQuickJoin = () => {
    if (!joinable) {
      audio.play('alert');
      return;
    }
    audio.play('click');
    onJoin(null, false);
  };

  const handleCreate = () => {
    if (!joinable) {
      audio.play('alert');
      return;
    }
    audio.play('click');
    onJoin(null, true);
  };

  const handleSelectRoom = (roomId: string) => {
    if (!joinable) {
      audio.play('alert');
      return;
    }
    audio.play('click');
    onJoin(roomId, false);
  };

  return (
    <div className="rooms-stage lobby--luxury">
      {/* 极简流光顶栏 */}
      <header className="app-top rooms-topbar">
        <button type="button" className="luxury-back-btn" onClick={onBack}>
          <span className="back-arrow">‹</span>
          <span>返回大厅</span>
        </button>
        <div className="rooms-title-bar">
          <span className="rooms-title-icon">{game.icon}</span>
          <h2>{game.name}</h2>
          <span className="rooms-title-sub">
            {!joinable
              ? maintBadge || gameUnavailableToast(game)
              : isLive
                ? '平台坐庄 · 极速轮播'
                : game.minPlayers === game.maxPlayers
                  ? `${game.minPlayers}人经典桌`
                  : `${game.minPlayers}-${game.maxPlayers}人经典桌`}
          </span>
        </div>
        <div className="rooms-top-actions">
          <button
            type="button"
            className="luxury-btn luxury-btn--gold-sm"
            onClick={handleQuickJoin}
            disabled={!joinable}
            title={joinable ? undefined : gameUnavailableToast(game)}
          >
            {joinable ? '⚡ 极速入座' : '🛠️ 维护中'}
          </button>
        </div>
      </header>

      {/* 主体横向分栏 */}
      <main className="rooms-layout">
        {/* 左侧游戏海报名片 */}
        <aside
          className="rooms-poster-card"
          style={GAME_ART[game.gameId] ? { backgroundImage: `url(${GAME_ART[game.gameId]})` } : undefined}
        >
          <div className="poster-card__overlay" />
          <div className="poster-card__content">
            <span className="poster-tag">{isLive ? '🎰 平台轮流开局' : '♠️ 多人博弈'}</span>
            <h3>{game.name}</h3>
            <p>{game.description}</p>
            <div className="poster-stats">
              <div className="stat-item">
                <span className="stat-label">当前活跃台</span>
                <strong className="stat-val">{rooms.length}</strong>
              </div>
              <div className="stat-item">
                <span className="stat-label">单桌上限</span>
                <strong className="stat-val">{game.maxPlayers}人</strong>
              </div>
            </div>
            {!isLive && (
              <button
                type="button"
                className="btn-create-room"
                onClick={handleCreate}
                disabled={!joinable}
                title={joinable ? undefined : gameUnavailableToast(game)}
              >
                {joinable ? '+ 创建专属房间' : '维护中不可建房'}
              </button>
            )}
          </div>
        </aside>

        {/* 右侧房间选择画卷 */}
        <section className="rooms-selector-panel">
          {joinError && <div className="luxury-alert is-error">{joinError}</div>}
          {error && <div className="luxury-alert is-error">{error}</div>}

          <div className="rooms-grid-header">
            <span className="rooms-count-hint">
              实时桌台列表 · <strong>{rooms.length}</strong> 台已开放
            </span>
            <button type="button" className="refresh-pill" onClick={() => void load()}>
              ↻ 刷新
            </button>
          </div>

          <div className="rooms-table-grid">
            {rooms.map((room) => {
              const marks = (room.recent ?? []).slice(-4);
              const canEnter =
                room.joinable ||
                Boolean(room.botHosted) ||
                (room.persistent && room.players < room.maxPlayers);
              return (
                <div
                  key={room.roomId}
                  className={`room-table-card ${room.status === 'playing' ? 'is-playing' : 'is-waiting'} ${room.botHosted ? 'is-bot-hosted' : ''} ${!canEnter ? 'is-full' : ''}`}
                  onClick={() => canEnter && handleSelectRoom(room.roomId)}
                  role="button"
                  tabIndex={0}
                >
                  <div className="room-card__header">
                    <div className="room-card__id">
                      <span className="table-badge">桌</span>
                      <strong>{room.roomName || room.roomId.slice(0, 6)}</strong>
                    </div>
                    <span className={`status-pill is-${room.status}`}>
                      {STATUS_TEXT[room.status] ?? room.status}
                    </span>
                  </div>

                  {/* 中间拟真桌面缩影 */}
                  <div className="room-card__felt">
                    <div className="felt-ring-mini" />
                    <div className="felt-host-info">
                      <span className="host-icon">{room.persistent ? '👑' : room.botHosted ? '🤖' : '👤'}</span>
                      <span className="host-name">
                        {room.hostName || (room.botHosted ? '机器人牌桌' : '系统坐庄')}
                      </span>
                    </div>
                    {room.botHosted && (
                      <div className="bot-hosted-pill">
                        <span>👁️ 进房默认观战 · 可随时入座</span>
                      </div>
                    )}

                    {/* 近期走势路单小彩灯 */}
                    {marks.length > 0 && (
                      <div className="trend-dots-row">
                        {marks.map((m, idx) => (
                          <span
                            key={idx}
                            className={`trend-dot tone--${m.tone}`}
                            title={`第${m.round}局：${m.text}`}
                          >
                            {/^\d{2}/.test(m.text) ? m.text.slice(0, 2) : m.text.slice(0, 1)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="room-card__footer">
                    <div className="occupancy-info">
                      <span className="occupancy-icon">👥</span>
                      <span>
                        {room.players}/{room.maxPlayers}
                      </span>
                      {room.botHosted && (room.spectators ?? 0) > 0 && (
                        <span className="spectator-count-tag">👁️ {room.spectators}观战</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className={`btn-table-join ${canEnter ? 'is-ready' : 'is-disabled'}`}
                      disabled={!canEnter}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (canEnter) handleSelectRoom(room.roomId);
                      }}
                    >
                      {room.botHosted ? '👁️ 观战入座' : canEnter ? '立即入座' : '已满员'}
                    </button>
                  </div>
                </div>
              );
            })}

            {rooms.length === 0 && !loading && (
              <div className="rooms-empty-state">
                <div className="empty-felt-icon">🪑</div>
                <h4>当前暂无空闲桌台</h4>
                <p>您可以极速匹配，或创建属于您自己的房间邀请好友</p>
                <button type="button" className="luxury-btn luxury-btn--gold" onClick={handleQuickJoin}>
                  ⚡ 立即创建并入座
                </button>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
