import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClientMsg,
  ServerMsg,
  type EmotePayload,
  type GameMeta,
  type RoomView,
  type Settlement,
} from '@cc/protocol';
import { api, getToken, setToken, type User } from './api';
import { audio } from './audio';
import { GameSocket } from './ws';
import { AdminPanel } from './components/AdminPanel';
import { AssistantView } from './components/AssistantView';
import { AuthView } from './components/AuthView';
import { GameRooms } from './components/GameRooms';
import { LeaderboardView } from './components/LeaderboardView';
import { Lobby } from './components/Lobby';
import { NoticesView } from './components/NoticesView';
import { ProfileView } from './components/ProfileView';
import { Room } from './components/Room';
import { RulesView } from './components/RulesView';
import { TasksView } from './components/TasksView';

export interface SnapshotEnvelope {
  roomId: string;
  gameId: string;
  status: string;
  round: number;
  seq: number;
  snapshot: Record<string, unknown>;
}

export type AppView =
  | 'lobby'
  | 'game_rooms'
  | 'room'
  | 'tasks'
  | 'leaderboard'
  | 'profile'
  | 'notices'
  | 'assistant'
  | 'rules'
  | 'auth';

function PortraitPrompt() {
  const [dismissed, setDismissed] = useState(false);
  const [isPortrait, setIsPortrait] = useState(false);

  useEffect(() => {
    const check = () => {
      const portrait = window.innerHeight > window.innerWidth && window.innerWidth < 900;
      setIsPortrait(portrait);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, []);

  if (!isPortrait || dismissed) return null;

  return (
    <div className="portrait-notice-bar" role="alert">
      <div className="rotate-phone-icon">📱↻</div>
      <div className="portrait-notice-text">
        <strong>建议横屏游玩</strong>
        <small>旋转横置设备体验最佳黄金 16:9 画幅视效</small>
      </div>
      <button type="button" className="portrait-notice-close" onClick={() => setDismissed(true)}>
        知道了
      </button>
    </div>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [games, setGames] = useState<GameMeta[]>([]);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotEnvelope | null>(null);
  const [settlement, setSettlement] = useState<Settlement | null>(null);
  const [emotes, setEmotes] = useState<EmotePayload[]>([]);
  const [selectedGame, setSelectedGame] = useState<GameMeta | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // 全屏视图状态流转 (彻底消除弹窗)
  const [view, setView] = useState<AppView>('lobby');

  const socketRef = useRef<GameSocket | null>(null);
  const userIdRef = useRef<string | null>(null);
  const pendingJoinRef = useRef<GameMeta | null>(null);

  useEffect(() => {
    const bootstrap = async (): Promise<void> => {
      try {
        const { games: list } = await api.games();
        setGames(list);
      } catch {
        /* 大厅列表失败不阻塞浏览 */
      }

      const token = getToken();
      if (token) {
        try {
          const { user: me } = await api.me();
          setUser(me);
        } catch {
          setToken(null);
        }
      }
      setBooting(false);
    };
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const handler = (): void => audio.unlock();
    window.addEventListener('pointerdown', handler, { once: true });
    return () => window.removeEventListener('pointerdown', handler);
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!user || !token) return;

    userIdRef.current = user.id;
    const socket = new GameSocket(token);
    socketRef.current = socket;

    socket.on(ServerMsg.RoomView, (data) => {
      const payload = data as { room: RoomView };
      setRoom(payload.room);
      setView('room');
      socket.setRoomRef({ roomId: payload.room.roomId, playerId: userIdRef.current ?? '' });
    });

    socket.on(ServerMsg.Snapshot, (data) => {
      setSnapshot(data as SnapshotEnvelope);
    });

    socket.on(ServerMsg.Wallet, (data) => {
      const payload = data as { balance?: number };
      if (Number.isFinite(payload.balance)) {
        setUser((prev) => (prev ? { ...prev, balance: payload.balance as number } : prev));
      }
    });

    socket.on(ServerMsg.Settlement, (data) => {
      const payload = data as { settlement: Settlement };
      setSettlement(payload.settlement);
      const mine = payload.settlement.entries.find((entry) => entry.playerId === userIdRef.current);
      if (mine && mine.delta > 0) audio.play('win');
      else if (mine && mine.delta < 0) audio.play('lose');
      window.setTimeout(() => {
        void api.me().then(({ user: me }) => setUser(me)).catch(() => undefined);
      }, 600);
    });

    socket.on(ServerMsg.Emote, (data) => {
      const emote = data as EmotePayload;
      setEmotes((prev) => [...prev.slice(-3), emote]);
      window.setTimeout(() => {
        setEmotes((prev) => prev.filter((item) => item.at !== emote.at));
      }, 3400);
    });

    socket.on(ServerMsg.Error, (data) => {
      const payload = data as { message?: string };
      setToast(payload.message ?? '操作失败');
      setJoinError(payload.message ?? '操作失败');
    });

    socket.connect();

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [user?.id]);

  const joinGame = useCallback((game: GameMeta, roomId: string | null, create: boolean) => {
    setSettlement(null);
    setSnapshot(null);
    setJoinError(null);
    socketRef.current?.send(ClientMsg.JoinRoom, {
      gameId: game.gameId,
      mode: 'casual',
      maxPlayers: game.maxPlayers,
      ...(roomId ? { roomId } : {}),
      ...(create ? { create: true } : {}),
    });
  }, []);

  const handleEnter = useCallback(
    (game: GameMeta) => {
      if (!user) {
        pendingJoinRef.current = game;
        setView('auth');
        return;
      }
      setSelectedGame(game);
      setJoinError(null);
      setView('game_rooms');
    },
    [user],
  );

  const handleJoinRoom = useCallback(
    (roomId: string | null, create: boolean) => {
      if (!selectedGame) return;
      joinGame(selectedGame, roomId, create);
    },
    [selectedGame, joinGame],
  );

  const handleAuthSuccess = useCallback((token: string, nextUser: User) => {
    setToken(token);
    setUser(nextUser);
    const pending = pendingJoinRef.current;
    if (pending) {
      pendingJoinRef.current = null;
      setSelectedGame(pending);
      setView('game_rooms');
    } else {
      setView('lobby');
    }
  }, []);

  const handleLeaveRoom = useCallback(() => {
    socketRef.current?.send(ClientMsg.LeaveRoom, {});
    socketRef.current?.setRoomRef(null);
    setRoom(null);
    setSnapshot(null);
    setSettlement(null);
    setView('lobby');
  }, []);

  const handleReady = useCallback((ready: boolean) => {
    socketRef.current?.send(ClientMsg.Ready, { ready });
  }, []);

  const handleIntent = useCallback((cmd: string, payload: Record<string, unknown>) => {
    socketRef.current?.send(ClientMsg.Intent, { cmd, payload });
  }, []);

  const handleAddBot = useCallback(() => {
    socketRef.current?.send(ClientMsg.AddBot, {});
  }, []);

  const handleEmote = useCallback((key: string) => {
    socketRef.current?.send(ClientMsg.Emote, { key });
  }, []);

  const handleLogout = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setToken(null);
    setUser(null);
    setRoom(null);
    setSnapshot(null);
    setSettlement(null);
    setView('lobby');
  }, []);

  const handleBalanceChange = useCallback((balance: number) => {
    setUser((prev) => (prev ? { ...prev, balance } : prev));
  }, []);

  if (window.location.hash === '#/admin') {
    return <AdminPanel />;
  }

  if (booting) {
    return (
      <div className="boot luxury-boot">
        <div className="spinner luxury-spinner" />
        <p className="luxury-boot-text">✦ 尊贵牌友 · 正在进入巅峰娱乐殿堂 ✦</p>
      </div>
    );
  }

  // 渲染当前全屏主视图
  const renderCurrentView = () => {
    if (view === 'room' && room && user) {
      return (
        <Room
          room={room}
          snapshot={snapshot}
          settlement={settlement}
          myId={user.id}
          balance={user.balance}
          onReady={handleReady}
          onLeave={handleLeaveRoom}
          onIntent={handleIntent}
          onAddBot={handleAddBot}
          emotes={emotes}
          onEmote={handleEmote}
          persistent={games.find((g) => g.gameId === room.gameId)?.persistent === true}
        />
      );
    }

    if (view === 'game_rooms' && selectedGame) {
      return (
        <GameRooms
          game={selectedGame}
          onBack={() => {
            setSelectedGame(null);
            setJoinError(null);
            setView('lobby');
          }}
          onJoin={handleJoinRoom}
          joinError={joinError}
        />
      );
    }

    if (view === 'tasks') {
      return <TasksView onBalanceChange={handleBalanceChange} onBack={() => setView('lobby')} />;
    }

    if (view === 'leaderboard') {
      return <LeaderboardView myUserId={user?.id ?? null} onBack={() => setView('lobby')} />;
    }

    if (view === 'profile' && user) {
      return (
        <ProfileView
          user={user}
          onLogout={handleLogout}
          onGoTasks={() => setView('tasks')}
          onBack={() => setView('lobby')}
        />
      );
    }

    if (view === 'notices') {
      return <NoticesView onBack={() => setView('lobby')} />;
    }

    if (view === 'assistant') {
      return <AssistantView onBalanceChange={handleBalanceChange} onBack={() => setView('lobby')} />;
    }

    if (view === 'rules') {
      return (
        <RulesView
          initialGameId={selectedGame?.gameId ?? 'doudizhu'}
          onBack={() => setView(selectedGame ? 'game_rooms' : 'lobby')}
        />
      );
    }

    if (view === 'auth') {
      return <AuthView onSuccess={handleAuthSuccess} onBack={() => setView('lobby')} />;
    }

    // 默认展示大厅
    return (
      <Lobby
        user={user}
        games={games}
        onEnter={handleEnter}
        onLogin={() => setView('auth')}
        onTasks={() => setView('tasks')}
        onLeaderboard={() => setView('leaderboard')}
        onProfile={() => (user ? setView('profile') : setView('auth'))}
        onNotices={() => setView('notices')}
        onAssistant={() => setView('assistant')}
        onRules={() => setView('rules')}
      />
    );
  };

  return (
    <div className="landscape-app-root">
      <PortraitPrompt />
      {/* 核心横屏舞台 */}
      <div className="landscape-stage-container">
        {renderCurrentView()}
      </div>
      {toast && <div className="toast luxury-toast">{toast}</div>}
    </div>
  );
}
