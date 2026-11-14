import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClientMsg,
  ErrorCode,
  ServerMsg,
  type BotDifficulty,
  type EmotePayload,
  type GameMeta,
  type RoomView,
  type Settlement,
} from '@cc/protocol';
import { api, getToken, setToken, type User } from './api';
import { audio } from './audio';
import { GameSocket } from './ws';
import { AuthView } from './components/AuthView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FriendsView } from './components/FriendsView';
import { GameRooms } from './components/GameRooms';
import { LeaderboardView } from './components/LeaderboardView';
import { Lobby } from './components/Lobby';
import { MailView } from './components/MailView';
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
  | 'rules'
  | 'mail'
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
  const [bootError, setBootError] = useState<string | null>(null);
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
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>(() => {
    try {
      const saved = window.localStorage.getItem('cc:bot-difficulty');
      return saved === 'low' || saved === 'medium' || saved === 'high' ? saved : 'medium';
    } catch {
      return 'medium';
    }
  });
  const botDifficultyRef = useRef<BotDifficulty>(botDifficulty);
  const updateBotDifficulty = useCallback((diff: BotDifficulty) => {
    setBotDifficulty(diff);
    botDifficultyRef.current = diff;
    try {
      window.localStorage.setItem('cc:bot-difficulty', diff);
    } catch {
      /* ignore */
    }
  }, []);

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
      } catch (error) {
        console.error('[boot] 初始化失败', error);
        setBootError('无法连接服务器，请检查网络后重试');
      } finally {
        setBooting(false);
      }
    };
    void bootstrap();
    return () => socketRef.current?.close();
  }, []);

  // 键盘可达性：role="button" 的 div 支持 Enter / 空格触发点击
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const target = event.target as HTMLElement | null;
      if (!target || target.getAttribute('role') !== 'button') return;
      if (target.tagName === 'BUTTON' || target.tagName === 'A') return;
      event.preventDefault();
      target.click();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
      // 记住当前房间：断线重连后会自动 client:reconnect 回到同一张桌子
      if (userIdRef.current) {
        s.setRoomRef({ roomId: payload.room.roomId, playerId: userIdRef.current });
      }

      // 极速开局：若在等待中，自动准备并按所选难度自动加满机器人
      if (payload.room.status === 'waiting' && autoStartRef.current) {
        autoStartRef.current = false;
        s.send(ClientMsg.Ready, { ready: true });
        if (payload.room.hostId === userIdRef.current) {
          const need = payload.room.maxPlayers - payload.room.players.length;
          for (let i = 0; i < need; i++) {
            window.setTimeout(() => {
              s.send(ClientMsg.AddBot, { difficulty: botDifficultyRef.current });
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
      if (userIdRef.current && Array.isArray(actual.entries)) {
        const myEntry = actual.entries.find((e) => e.playerId === userIdRef.current);
        if (myEntry) {
          // 按净盈亏播放胜负音效，别赢了也放、输了也放
          audio.play(myEntry.delta >= 0 ? 'win' : 'lose');
        }
      }

      // 结算后主动与服务端对账刷新，彻底杜绝下注游戏重复扣款及产生负数金额
      window.setTimeout(() => {
        void api.me().then((res) => {
          setUser((prev) => (prev ? { ...prev, balance: Math.max(0, res.user.balance) } : res.user));
        }).catch(() => {});
      }, 100);
    });

    s.on(ServerMsg.Wallet, (data) => {
      const payload = data as { balance: number };
      setUser((prev) => (prev ? { ...prev, balance: Math.max(0, payload.balance) } : prev));
    });

    s.on(ServerMsg.Emote, (data) => {
      const payload = data as EmotePayload;
      setEmotes((prev) => [...prev.slice(-9), payload]);
      // 气泡 3.5 秒后自动消失，否则会一直叠在牌桌上
      window.setTimeout(() => {
        setEmotes((prev) =>
          prev.filter((item) => !(item.playerId === payload.playerId && item.at === payload.at)),
        );
      }, 3500);
    });

    s.on(ServerMsg.Error, (data) => {
      const payload = data as { code: string; message: string };
      setJoinError(payload.message || '操作失败');
      showToast(payload.message || '操作失败');
      // 重连时房间已解散：清掉恢复引用并退回大厅，避免停在一张冻结的牌桌上
      if (payload.code === ErrorCode.RoomNotFound) {
        s.setRoomRef(null);
        setRoom(null);
        setSnapshot(null);
        setSettlement(null);
        setView('lobby');
      }
    });

    s.connect();
  };

  const toastTimerRef = useRef<number | null>(null);
  const showToast = (message: string): void => {
    setToast(message);
    // 连续提示时先清掉旧定时器，避免旧定时器提前把新提示收掉
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 3000);
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
      socketRef.current?.setRoomRef(null);
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
      socketRef.current?.setRoomRef(null);
      setRoom(null);
    }

    // 百人常驻玩法：直接极速入座
    if (game.persistent || ['tuizhuanzi', 'dice', 'baccarat', 'niuniu', 'blackjack', 'slots'].includes(game.gameId)) {
      handleQuickPlay(game);
      return;
    }

    // 房间制游戏：进入全屏选台界面
    setView('game_rooms');
  };

  const handleJoinRoom = (roomId: string | null, create = false): void => {
    if (!selectedGame) return;
    autoStartRef.current = !selectedGame.persistent && !create && !roomId;

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
    // 主动离开后不再自动回到该房间
    socketRef.current?.setRoomRef(null);
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

  const handleAddBot = (difficulty?: BotDifficulty): void => {
    const chosen = difficulty ?? botDifficultyRef.current;
    if (difficulty && difficulty !== botDifficultyRef.current) updateBotDifficulty(difficulty);
    socketRef.current?.send(ClientMsg.AddBot, { difficulty: chosen });
  };

  const handleEmote = (key: string): void => {
    socketRef.current?.send(ClientMsg.Emote, { key });
  };

  const handleBalanceChange = useCallback((newBalance: number) => {
    setUser((prev) => (prev ? { ...prev, balance: Math.max(0, Math.floor(newBalance)) } : prev));
  }, []);

  if (booting) {
    return (
      <div className="boot">
        <div className="boot__spinner" />
        <p>正在连接殿堂级娱乐大厅…</p>
      </div>
    );
  }

  if (bootError && games.length === 0) {
    return (
      <div className="boot" role="alert">
        <p>{bootError}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            marginTop: 16,
            padding: '10px 24px',
            borderRadius: 10,
            border: '1px solid rgba(240,180,41,0.6)',
            background: 'rgba(240,180,41,0.14)',
            color: '#f0b429',
            fontSize: 15,
            cursor: 'pointer',
          }}
        >
          重新加载
        </button>
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
          botDifficulty={botDifficulty}
          onChangeBotDifficulty={updateBotDifficulty}
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
          botDifficulty={botDifficulty}
          onChangeBotDifficulty={updateBotDifficulty}
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
            setUser((prev) =>
              prev
                ? {
                    ...prev,
                    nickname: patch.nickname ?? prev.nickname,
                    avatar: patch.avatar !== undefined ? patch.avatar : prev.avatar,
                  }
                : prev,
            )
          }
          onBack={() => setView('lobby')}
        />
      );
    }

    if (view === 'notices') {
      return <NoticesView onBack={() => setView('lobby')} />;
    }

    if (view === 'mail') {
      return (
        <MailView
          onBack={() => setView('lobby')}
          onBalanceChange={handleBalanceChange}
        />
      );
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
        onMail={() => setView('mail')}
        onRules={() => setView('rules')}
        botDifficulty={botDifficulty}
        onChangeBotDifficulty={updateBotDifficulty}
        onBalanceChange={handleBalanceChange}
      />
    );
  };

  return (
    <div className="landscape-app-root">
      <PortraitPrompt />
      {/* 真正自适应所有横屏移动端视口，100% 弹性充满，绝无黑边与留白 */}
      <div className="landscape-stage-container">
        <ErrorBoundary onReset={() => setView('lobby')}>{renderCurrentView()}</ErrorBoundary>
      </div>
      {toast && <div className="toast luxury-toast">{toast}</div>}
    </div>
  );
}
