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
        <small>旋转横置设备体验最佳黄金画幅视效</small>
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
        const gamesRes = await api.games();
        setGames(gamesRes.games);
        const token = getToken();
        if (token) {
          const me = await api.me();
          setUser(me.user);
          userIdRef.current = me.user.id;
          connectWs(token);
        }
      } catch {
        /* 未登录也可以匿名游玩 */
      } finally {
        setBooting(false);
      }
    };
    void bootstrap();
    return () => socketRef.current?.close();
  }, []);

  const connectWs = (token: string): void => {
    socketRef.current?.close();
    const s = new GameSocket(token);
    socketRef.current = s;

    s.on(ServerMsg.Hello, (data) => {
      const payload = data as { playerId: string };
      userIdRef.current = payload.playerId;
      const pending = pendingJoinRef.current;
      if (pending) {
        pendingJoinRef.current = null;
        s.send(ClientMsg.JoinRoom, { gameId: pending.gameId });
      }
    });

    s.on(ServerMsg.RoomView, (data) => {
      const payload = data as { room: RoomView };
      setRoom(payload.room);
      setView('room');
      setJoinError(null);
    });

    s.on(ServerMsg.Snapshot, (data) => {
      const payload = data as SnapshotEnvelope;
      setSnapshot(payload);
      if (payload.status === 'playing') setSettlement(null);
    });

    s.on(ServerMsg.Settlement, (data) => {
      const payload = data as Settlement;
      setSettlement(payload);
      audio.play('win');
      if (userIdRef.current) {
        const myEntry = payload.entries.find((e) => e.playerId === userIdRef.current);
        if (myEntry) {
          setUser((prev) => (prev ? { ...prev, balance: prev.balance + myEntry.delta } : prev));
        }
      }
    });

    s.on(ServerMsg.Wallet, (data) => {
      const payload = data as { balance: number };
      setUser((prev) => (prev ? { ...prev, balance: payload.balance } : prev));
    });

    s.on(ServerMsg.Emote, (data) => {
      const payload = data as EmotePayload;
      setEmotes((prev) => [...prev.slice(-9), payload]);
    });

    s.on(ServerMsg.Error, (data) => {
      const payload = data as { code: string; message: string };
      setJoinError(payload.message || '操作失败');
      showToast(payload.message || '操作失败');
    });

    s.connect();
  };

  const showToast = (message: string): void => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const handleAuthSuccess = (token: string, loggedUser: User): void => {
    setToken(token);
    setUser(loggedUser);
    userIdRef.current = loggedUser.id;
    connectWs(token);
    setView('lobby');
    showToast(`欢迎回来，尊贵的 ${loggedUser.nickname}`);
  };

  const handleLogout = (): void => {
    setToken(null);
    setUser(null);
    userIdRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    setView('lobby');
    showToast('已安全退出账号');
  };

  const handleEnter = (game: GameMeta): void => {
    setSelectedGame(game);
    setJoinError(null);

    // 百人常驻玩法或一键快速游戏：直接加入
    if (game.persistent) {
      if (!user) {
        setView('auth');
        return;
      }
      socketRef.current?.send(ClientMsg.JoinRoom, { gameId: game.gameId });
      return;
    }

    // 房间制游戏：进入全屏选台界面
    setView('game_rooms');
  };

  const handleJoinRoom = (roomId: string | null, create = false): void => {
    if (!selectedGame) return;
    if (!user) {
      setView('auth');
      return;
    }
    socketRef.current?.send(ClientMsg.JoinRoom, {
      gameId: selectedGame.gameId,
      roomId: roomId ?? undefined,
      create,
    });
  };

  const handleLeaveRoom = (): void => {
    socketRef.current?.send(ClientMsg.LeaveRoom, {});
    setRoom(null);
    setSnapshot(null);
    setSettlement(null);
    setView('lobby');
  };

  const handleReady = (ready: boolean): void => {
    socketRef.current?.send(ClientMsg.Ready, { ready });
  };

  const handleIntent = (cmd: string, payload: Record<string, unknown> = {}): void => {
    socketRef.current?.send(ClientMsg.Intent, { cmd, payload });
  };

  const handleAddBot = (): void => {
    socketRef.current?.send(ClientMsg.AddBot, {});
  };

  const handleEmote = (key: string): void => {
    socketRef.current?.send(ClientMsg.Emote, { key });
  };

  const handleBalanceChange = useCallback((newBalance: number) => {
    setUser((prev) => (prev ? { ...prev, balance: newBalance } : prev));
  }, []);

  if (booting) {
    return (
      <div className="boot">
        <div className="boot__spinner" />
        <p>正在连接殿堂级娱乐大厅…</p>
      </div>
    );
  }

  const renderCurrentView = () => {
    if (view === 'room' && room) {
      return (
        <Room
          room={room}
          snapshot={snapshot}
          settlement={settlement}
          myId={userIdRef.current ?? ''}
          balance={user?.balance ?? 0}
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
          onBack={() => setView('lobby')}
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
      {/* 真正自适应所有横屏移动端视口，100% 弹性充满，绝无黑边与留白 */}
      <div className="landscape-stage-container">
        {renderCurrentView()}
      </div>
      {toast && <div className="toast luxury-toast">{toast}</div>}
    </div>
  );
}
