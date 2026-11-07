import { useCallback, useEffect, useRef, useState } from 'react';
import { ClientMsg, ServerMsg, type GameMeta, type RoomView, type Settlement } from '@cc/protocol';
import { api, getToken, setToken, type User } from './api';
import { audio } from './audio';
import { GameSocket } from './ws';
import { AuthModal } from './components/AuthModal';
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

    socket.on(ServerMsg.Error, (data) => {
      const payload = data as { message?: string };
      setToast(payload.message ?? '操作失败');
    });

    socket.connect();

    const pending = pendingJoinRef.current;
    if (pending) {
      pendingJoinRef.current = null;
      socket.send(ClientMsg.JoinRoom, {
        gameId: pending.gameId,
        mode: 'casual',
        maxPlayers: pending.maxPlayers,
      });
    }

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [user?.id]);

  const joinGame = useCallback((game: GameMeta) => {
    setSettlement(null);
    setSnapshot(null);
    socketRef.current?.send(ClientMsg.JoinRoom, {
      gameId: game.gameId,
      mode: 'casual',
      maxPlayers: game.maxPlayers,
    });
  }, []);

  const handleEnter = useCallback(
    (game: GameMeta) => {
      if (!user) {
        pendingJoinRef.current = game;
        setAuthOpen(true);
        return;
      }
      joinGame(game);
    },
    [user, joinGame],
  );

  const handleAuthSuccess = useCallback((token: string, nextUser: User) => {
    setToken(token);
    setUser(nextUser);
    setAuthOpen(false);
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
          onReady={handleReady}
          onLeave={handleLeave}
          onIntent={handleIntent}
          onAddBot={handleAddBot}
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
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
