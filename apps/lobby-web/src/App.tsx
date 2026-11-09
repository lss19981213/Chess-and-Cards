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
import { AssistantView } from './components/AssistantView';
import { AuthView } from './components/AuthView';
import { FriendsView } from './components/FriendsView';
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
  | 'friends'
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
  /** 邀请链接携带的房间号，连上 WebSocket 后优先入座 */
  const pendingInviteRef = useRef<{ game: GameMeta; roomId: string } | null>(null);
  const autoStartRef = useRef<boolean>(false);

  useEffect(() => {
    const bootstrap = async (): Promise<void> => {
      try {
        const gamesRes = await api.games();
        setGames(gamesRes.games);

        // 邀请链接：?join=<roomId>&game=<gameId>，连接建立后自动入座
        const params = new URLSearchParams(window.location.search);
        const joinRoomId = params.get('join');
        const joinGameId = params.get('game');
        if (joinRoomId && joinGameId) {
          const invited = gamesRes.games.find((game) => game.gameId === joinGameId);
          if (invited) {
            pendingInviteRef.current = { game: invited, roomId: joinRoomId };
            setSelectedGame(invited);
            // 消费掉参数，避免刷新后重复入座
            window.history.replaceState({}, '', window.location.pathname);
          }
        }

        let token = getToken();
        if (token) {
          try {
            const me = await api.me();
            setUser(me.user);
            userIdRef.current = me.user.id;
            connectWs(token);
          } catch {
            token = null;
          }
        }
        // 如果未登录或 token 失效，自动无感接入游客账号，确保立刻能开玩
        if (!token) {
          try {
            const guestRes = await api.guest();
            setToken(guestRes.token);
            setUser(guestRes.user);
            userIdRef.current = guestRes.user.id;
            connectWs(guestRes.token);
          } catch (e) {
            console.error('Guest init error:', e);
          }
        }
      } catch {
        /* 容错 */
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

      // 邀请链接优先：直接进指定房间
      const invite = pendingInviteRef.current;
      if (invite) {
        pendingInviteRef.current = null;
        autoStartRef.current = false;
        s.send(ClientMsg.JoinRoom, { gameId: invite.game.gameId, roomId: invite.roomId });
        return;
      }

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

      // 极速开局：若在等待中，自动准备并自动加满 AI
      if (payload.room.status === 'waiting' && autoStartRef.current) {
        autoStartRef.current = false;
        s.send(ClientMsg.Ready, { ready: true });
        if (payload.room.hostId === userIdRef.current) {
          const need = payload.room.maxPlayers - payload.room.players.length;
          for (let i = 0; i < need; i++) {
            window.setTimeout(() => {
              s.send(ClientMsg.AddBot, {});
            }, (i + 1) * 80);
          }
        }
      }
    });

    s.on(ServerMsg.Snapshot, (data) => {
      const payload = data as SnapshotEnvelope;
      setSnapshot(payload);
      if (payload.status === 'playing') setSettlement(null);
    });

    s.on(ServerMsg.Settlement, (data) => {
      // 容错解构：兼容 { settlement: Settlement } 与直接 Settlement 对象
      const env = data as { settlement?: Settlement } | Settlement;
      const actual = (env && typeof env === 'object' && 'settlement' in env && env.settlement) 
        ? env.settlement 
        : (env as Settlement);
      if (!actual) return;

      setSettlement(actual);
      audio.play('win');
      if (userIdRef.current && Array.isArray(actual.entries)) {
        const myEntry = actual.entries.find((e) => e.playerId === userIdRef.current);
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

  const handleQuickPlay = (game: GameMeta): void => {
    setSelectedGame(game);
    setJoinError(null);
    autoStartRef.current = !game.persistent;

    // 如果之前已有房间状态，先离开旧房间
    if (room) {
      socketRef.current?.send(ClientMsg.LeaveRoom, {});
      setRoom(null);
    }

    const doJoin = () => {
      socketRef.current?.send(ClientMsg.JoinRoom, { gameId: game.gameId, create: false });
    };

    if (!user || !socketRef.current) {
      void api.guest().then((res) => {
        setToken(res.token);
        setUser(res.user);
        userIdRef.current = res.user.id;
        connectWs(res.token);
        window.setTimeout(doJoin, 200);
      }).catch(() => {
        showToast('网络连接中，请稍后再试');
      });
      return;
    }

    doJoin();
  };

  const handleEnter = (game: GameMeta): void => {
    setSelectedGame(game);
    setJoinError(null);

    if (room) {
      socketRef.current?.send(ClientMsg.LeaveRoom, {});
      setRoom(null);
    }

    // 百人常驻玩法：直接极速入座
    if (game.persistent || ['tuizhuanzi', 'dice', 'baccarat', 'niuniu', 'blackjack'].includes(game.gameId)) {
      handleQuickPlay(game);
      return;
    }

    // 房间制游戏：进入全屏选台界面
    setView('game_rooms');
  };

  const handleJoinRoom = (roomId: string | null, create = false): void => {
    if (!selectedGame) return;
    autoStartRef.current = !selectedGame.persistent;

    const doJoin = () => {
      socketRef.current?.send(ClientMsg.JoinRoom, {
        gameId: selectedGame.gameId,
        roomId: roomId ?? undefined,
        create,
      });
    };

    if (!user || !socketRef.current) {
      void api.guest().then((res) => {
        setToken(res.token);
        setUser(res.user);
        userIdRef.current = res.user.id;
        connectWs(res.token);
        window.setTimeout(doJoin, 200);
      });
      return;
    }

    doJoin();
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
          onBalanceChange={handleBalanceChange}
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

    if (view === 'friends') {
      return <FriendsView onBack={() => setView('lobby')} />;
    }

    if (view === 'profile' && user) {
      return (
        <ProfileView
          user={user}
          onLogout={handleLogout}
          onGoTasks={() => setView('tasks')}
          onGoFriends={() => setView('friends')}
          onProfileChange={(patch) =>
            setUser((prev) => (prev ? { ...prev, nickname: patch.nickname ?? prev.nickname } : prev))
          }
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
        onQuickPlay={handleQuickPlay}
        onLogin={() => setView('auth')}
        onTasks={() => setView('tasks')}
        onFriends={() => setView('friends')}
        onLeaderboard={() => setView('leaderboard')}
        onProfile={() => (user ? setView('profile') : setView('auth'))}
        onNotices={() => setView('notices')}
        onAssistant={() => setView('assistant')}
        onRules={() => setView('rules')}
        onBalanceChange={handleBalanceChange}
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
