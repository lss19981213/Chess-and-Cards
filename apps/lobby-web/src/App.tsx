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
import { Assistant } from './components/Assistant';
import { AuthModal } from './components/AuthModal';
import { GameRooms } from './components/GameRooms';
import { Lobby } from './components/Lobby';
import { LeaderboardModal } from './components/LeaderboardModal';
import { Room } from './components/Room';
import { TasksModal } from './components/TasksModal';

export interface SnapshotEnvelope {
  roomId: string;
  gameId: string;
  status: string;
  round: number;
  seq: number;
  snapshot: Record<string, unknown>;
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
  const [authOpen, setAuthOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [rankOpen, setRankOpen] = useState(false);

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

  // 浏览器要求音频必须在用户手势后启动
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
      socket.setRoomRef({ roomId: payload.room.roomId, playerId: userIdRef.current ?? '' });
    });

    socket.on(ServerMsg.Snapshot, (data) => {
      setSnapshot(data as SnapshotEnvelope);
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
        setAuthOpen(true);
        return;
      }
      setSelectedGame(game);
      setJoinError(null);
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
    setAuthOpen(false);
    // 登录前点了某款游戏，登录后直接进入选台
    const pending = pendingJoinRef.current;
    if (pending) {
      pendingJoinRef.current = null;
      setSelectedGame(pending);
    }
  }, []);

  const handleLeave = useCallback(() => {
    socketRef.current?.send(ClientMsg.LeaveRoom, {});
    socketRef.current?.setRoomRef(null);
    setRoom(null);
    setSnapshot(null);
    setSettlement(null);
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
  }, []);

  const handleBalanceChange = useCallback((balance: number) => {
    setUser((prev) => (prev ? { ...prev, balance } : prev));
  }, []);

  if (window.location.hash === '#/admin') {
    return <AdminPanel />;
  }

  if (booting) {
    return (
      <div className="boot">
        <div className="spinner" />
        <p>正在进入大厅…</p>
      </div>
    );
  }

  return (
    <>
      {room && user ? (
        <Room
          room={room}
          snapshot={snapshot}
          settlement={settlement}
          myId={user.id}
          balance={user.balance}
          onReady={handleReady}
          onLeave={handleLeave}
          onIntent={handleIntent}
          onAddBot={handleAddBot}
          emotes={emotes}
          onEmote={handleEmote}
          persistent={games.find((g) => g.gameId === room.gameId)?.persistent === true}
        />
      ) : selectedGame && user ? (
        <GameRooms
          game={selectedGame}
          onBack={() => {
            setSelectedGame(null);
            setJoinError(null);
          }}
          onJoin={handleJoinRoom}
          joinError={joinError}
        />
      ) : (
        <Lobby
          user={user}
          games={games}
          onEnter={handleEnter}
          onLogin={() => setAuthOpen(true)}
          onLogout={handleLogout}
          onTasks={() => setTasksOpen(true)}
          onLeaderboard={() => setRankOpen(true)}
        />
      )}

      {authOpen && (
        <AuthModal onSuccess={handleAuthSuccess} onClose={() => setAuthOpen(false)} />
      )}
      {tasksOpen && (
        <TasksModal onBalanceChange={handleBalanceChange} onClose={() => setTasksOpen(false)} />
      )}
      {rankOpen && <LeaderboardModal myUserId={user?.id ?? null} onClose={() => setRankOpen(false)} />}
      {!room && user && <Assistant onBalanceChange={handleBalanceChange} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
