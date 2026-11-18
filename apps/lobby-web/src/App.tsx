import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ClientMsg,
  ErrorCode,
  ServerMsg,
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
  const [authInitialTab, setAuthInitialTab] = useState<'login' | 'register'>('login');

  const socketRef = useRef<GameSocket | null>(null);
  const userIdRef = useRef<string | null>(null);
  const userRef = useRef<User | null>(null);
  userRef.current = user;
  const pendingJoinRef = useRef<GameMeta | null>(null);
  /** 邀请链接携带的房间号，连上 WebSocket 后优先入座 */
  const pendingInviteRef = useRef<{ game: GameMeta; roomId: string } | null>(null);
  const autoStartRef = useRef<boolean>(false);

  const playerAppearance = () => ({
    avatar: userRef.current?.avatar ?? null,
    equippedFrame: userRef.current?.equippedFrame ?? 'frame_default',
  });

  useEffect(() => {
    const bootstrap = async (): Promise<void> => {
      try {
        const gamesRes = await api.games();
        setGames(gamesRes.games);

        // 邀请链接：?join=<roomId>&game=<gameId>，连接建立后自动入座
        const params = new URLSearchParams(window.location.search);
        const joinRoomId = params.get('join');
        const joinGameId = params.get('game');
        const oauthToken = params.get('oauth_token');
        const oauthError = params.get('oauth_error');
        const oauthBindOk = params.get('oauth_bind_ok');
        const oauthBindError = params.get('oauth_bind_error');
        const gotoView = params.get('goto');

        if (joinRoomId && joinGameId) {
          const invited = gamesRes.games.find((game) => game.gameId === joinGameId);
          if (invited) {
            pendingInviteRef.current = { game: invited, roomId: joinRoomId };
            setSelectedGame(invited);
          }
        }
        if (joinRoomId || joinGameId || oauthToken || oauthError || oauthBindOk || oauthBindError || gotoView) {
          window.history.replaceState({}, '', window.location.pathname);
        }

        if (oauthError) {
          setAuthInitialTab('login');
          setView('auth');
          window.setTimeout(() => showToast(oauthError), 150);
        }

        let token = oauthToken || getToken();
        if (oauthToken) {
          setToken(oauthToken);
        }
        if (token) {
          try {
            const me = await api.me();
            setUser(me.user);
            userIdRef.current = me.user.id;
            connectWs(token);
            if (gotoView === 'profile' || oauthBindOk || oauthBindError) {
              setView('profile');
            }
            if (oauthToken) {
              window.setTimeout(
                () => showToast(`🌌 奇幻维度账号登录成功，欢迎 ${me.user.nickname}！`),
                120,
              );
            } else if (oauthBindOk) {
              window.setTimeout(() => showToast(`🌌 ${oauthBindOk}`), 120);
            } else if (oauthBindError) {
              window.setTimeout(() => showToast(`⚠️ ${oauthBindError}`), 120);
            }
          } catch {
            setToken(null);
            token = null;
          }
        } else if (oauthBindError) {
          window.setTimeout(() => showToast(`⚠️ ${oauthBindError}`), 150);
        }
        // 未登录时不自动创建游客新号，保持未登录态并在大厅清晰指引玩家登录或创建账号
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
        s.send(ClientMsg.JoinRoom, {
          gameId: invite.game.gameId,
          roomId: invite.roomId,
          ...playerAppearance(),
        });
        return;
      }

      const pending = pendingJoinRef.current;
      if (pending) {
        pendingJoinRef.current = null;
        s.send(ClientMsg.JoinRoom, { gameId: pending.gameId, ...playerAppearance() });
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

      // 极速开局：若在等待中且非机器人观战桌且我已入座，自动准备并加满最高智慧机器人
      const amSeated = payload.room.players.some((p) => p.playerId === userIdRef.current);
      if (payload.room.status === 'waiting' && autoStartRef.current && !payload.room.botHosted && amSeated) {
        autoStartRef.current = false;
        s.send(ClientMsg.Ready, { ready: true });
        if (payload.room.hostId === userIdRef.current) {
          const need = payload.room.maxPlayers - payload.room.players.length;
          for (let i = 0; i < need; i++) {
            window.setTimeout(() => {
              s.send(ClientMsg.AddBot, { difficulty: 'high' });
            }, (i + 1) * 80);
          }
        }
      } else if (payload.room.botHosted) {
        autoStartRef.current = false;
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

      // 结算后主动与服务端对账刷新，同步筹码余额、账号等级与经验进度
      window.setTimeout(() => {
        void api.me().then((res) => {
          setUser((prev) => {
            if (!prev) return res.user;
            const prevLv = prev.level ?? 1;
            const nextLv = res.user.level ?? prevLv;
            if (nextLv > prevLv) {
              audio.play('jackpot');
              showToast(`🎉 恭喜升级至 Lv.${nextLv}！快前往个人中心领取升级筹码奖励！`);
            }
            return {
              ...prev,
              balance: Math.max(0, res.user.balance),
              level: res.user.level ?? prev.level,
              xp: res.user.xp ?? prev.xp,
              rewardedLevel: res.user.rewardedLevel ?? prev.rewardedLevel,
              totalTurnover: res.user.totalTurnover ?? prev.totalTurnover,
            };
          });
        }).catch(() => {});
      }, 160);
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

  const requireLogin = (tab: 'login' | 'register' = 'login', reason?: string): void => {
    setAuthInitialTab(tab);
    setView('auth');
    if (reason) showToast(reason);
  };

  const handleQuickPlay = (game: GameMeta): void => {
    setSelectedGame(game);
    setJoinError(null);
    autoStartRef.current = !game.persistent;

    if (!user || !socketRef.current) {
      pendingJoinRef.current = game;
      requireLogin('register', '请先登录或创建账号，或使用奇幻维度账号一键登录！');
      return;
    }

    // 如果之前已有房间状态，先离开旧房间
    if (room) {
      socketRef.current?.send(ClientMsg.LeaveRoom, {});
      socketRef.current?.setRoomRef(null);
      setRoom(null);
    }

    socketRef.current.send(ClientMsg.JoinRoom, {
      gameId: game.gameId,
      create: false,
      ...playerAppearance(),
    });
  };

  const handleEnter = (game: GameMeta): void => {
    setSelectedGame(game);
    setJoinError(null);

    if (!user) {
      pendingJoinRef.current = game;
      requireLogin('register', '请先登录或创建账号后再进入游戏！');
      return;
    }

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
    if (!user || !socketRef.current) {
      pendingJoinRef.current = selectedGame;
      requireLogin('register', '请先登录或创建账号后再入座对局！');
      return;
    }
    autoStartRef.current = !selectedGame.persistent && !create && !roomId;

    socketRef.current.send(ClientMsg.JoinRoom, {
      gameId: selectedGame.gameId,
      roomId: roomId ?? undefined,
      create,
      ...playerAppearance(),
    });
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

  const handleAddBot = (): void => {
    socketRef.current?.send(ClientMsg.AddBot, { difficulty: 'high' });
  };

  const handleEmote = (key: string): void => {
    socketRef.current?.send(ClientMsg.Emote, { key });
  };

  const handleSitDown = (): void => {
    audio.play('join');
    socketRef.current?.send(ClientMsg.SitDown, {});
  };

  const handleStandUp = (): void => {
    audio.play('click');
    socketRef.current?.send(ClientMsg.StandUp, {});
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
          user={user}
          onUserUpdate={(patch) => {
            setUser((prev) => (prev ? { ...prev, ...patch } : prev));
          }}
          onReady={handleReady}
          onLeave={handleLeaveRoom}
          onIntent={handleIntent}
          onAddBot={handleAddBot}
          onSitDown={handleSitDown}
          onStandUp={handleStandUp}
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
      return (
        <LeaderboardView
          myUserId={user?.id ?? null}
          onBalanceChange={handleBalanceChange}
          onBack={() => setView('lobby')}
        />
      );
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
          onUserUpdate={(patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev))}
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
      return (
        <AuthView
          initialTab={authInitialTab}
          onSuccess={handleAuthSuccess}
          onBack={() => setView('lobby')}
        />
      );
    }

    // 默认展示大厅
    return (
      <Lobby
        user={user}
        games={games}
        onEnter={handleEnter}
        onQuickPlay={handleQuickPlay}
        onLogin={() => requireLogin('login')}
        onRegister={() => requireLogin('register')}
        onTasks={() => (user ? setView('tasks') : requireLogin('register', '请先登录或创建账号再领取福利任务！'))}
        onFriends={() => (user ? setView('friends') : requireLogin('register', '请先登录或创建账号再管理好友！'))}
        onLeaderboard={() => setView('leaderboard')}
        onProfile={() => (user ? setView('profile') : requireLogin('login', '请先登录或创建账号！'))}
        onNotices={() => setView('notices')}
        onMail={() => (user ? setView('mail') : requireLogin('register', '请先登录或创建账号再查看信箱！'))}
        onRules={() => setView('rules')}
        onBalanceChange={handleBalanceChange}
        onUserUpdate={(patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev))}
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
