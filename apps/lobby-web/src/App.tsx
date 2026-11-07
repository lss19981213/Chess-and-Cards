import { useCallback, useEffect, useRef, useState } from 'react';
import { ClientMsg, ServerMsg, type GameMeta, type RoomView, type Settlement } from '@cc/protocol';
import { api, getToken, setToken, type User } from './api';
import { GameSocket } from './ws';
import { Login } from './components/Login';
import { Lobby } from './components/Lobby';
import { Room } from './components/Room';

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
  const socketRef = useRef<GameSocket | null>(null);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setBooting(false);
      return;
    }
    api
      .me()
      .then(({ user: me }) => setUser(me))
      .catch(() => setToken(null))
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const loadGames = useCallback(async () => {
    try {
      const { games: list } = await api.games();
      setGames(list);
    } catch (error) {
      setToast(error instanceof Error ? error.message : '加载游戏列表失败');
    }
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
      window.setTimeout(() => {
        void api.me().then(({ user: me }) => setUser(me)).catch(() => undefined);
      }, 600);
    });

    socket.on(ServerMsg.Error, (data) => {
      const payload = data as { message?: string };
      setToast(payload.message ?? '操作失败');
    });

    socket.connect();
    void loadGames();

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [user?.id, loadGames]);

  const handleLogin = useCallback(
    async (nickname: string) => {
      const result = await api.login(nickname);
      setToken(result.token);
      setUser(result.user);
      await loadGames();
    },
    [loadGames],
  );

  const handleEnter = useCallback(
    (game: GameMeta) => {
      setSettlement(null);
      setSnapshot(null);
      socketRef.current?.send(ClientMsg.JoinRoom, {
        gameId: game.gameId,
        mode: 'casual',
        maxPlayers: game.maxPlayers,
      });
    },
    [],
  );

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

  const handleLogout = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    setToken(null);
    setUser(null);
    setRoom(null);
    setSnapshot(null);
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
      {!user ? (
        <Login onLogin={handleLogin} />
      ) : room ? (
        <Room
          room={room}
          snapshot={snapshot}
          settlement={settlement}
          myId={user.id}
          onReady={handleReady}
          onLeave={handleLeave}
          onIntent={handleIntent}
        />
      ) : (
        <Lobby user={user} games={games} onEnter={handleEnter} onLogout={handleLogout} />
      )}
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
