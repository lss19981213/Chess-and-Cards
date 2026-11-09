import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type FriendRequestView, type PlayerProfile } from '../api';
import { audio } from '../audio';
import { IconBack, IconUser } from './Icons';

interface Props {
  onBack: () => void;
}

/** 头像：有自定义图则显示图片，否则用昵称首字 */
export function PlayerAvatar({ player, size = 44 }: { player: PlayerProfile; size?: number }) {
  const initial = player.nickname?.slice(0, 1) ?? '牌';
  return (
    <div className="player-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {player.avatar ? (
        <img src={player.avatar} alt={player.nickname} draggable={false} />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}

export function FriendsView({ onBack }: Props) {
  const [friends, setFriends] = useState<PlayerProfile[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestView[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestView[]>([]);
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<PlayerProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [hint, setHint] = useState<{ text: string; tone: 'ok' | 'err' } | null>(null);
  const searchTimer = useRef<number | null>(null);

  const notify = useCallback((text: string, tone: 'ok' | 'err' = 'ok') => {
    setHint({ text, tone });
    window.setTimeout(() => setHint(null), 2600);
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await api.friends();
      setFriends(data.friends);
      setIncoming(data.incoming);
      setOutgoing(data.outgoing);
    } catch (error) {
      notify(error instanceof Error ? error.message : '好友列表加载失败', 'err');
    }
  }, [notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // 搜索防抖：输入停止 300ms 后请求
  useEffect(() => {
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    if (!keyword.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    searchTimer.current = window.setTimeout(() => {
      api
        .searchUsers(keyword.trim())
        .then((data) => setResults(data.users))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => {
      if (searchTimer.current) window.clearTimeout(searchTimer.current);
    };
  }, [keyword]);

  const addFriend = async (player: PlayerProfile): Promise<void> => {
    audio.play('click');
    setBusy(player.userId);
    try {
      await api.requestFriend(player.userId, '一起打牌吧');
      audio.play('coin');
      notify(`已向 ${player.nickname} 发送好友申请`);
      setResults((prev) =>
        prev.map((item) => (item.userId === player.userId ? { ...item, requestPending: true } : item)),
      );
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : '发送失败', 'err');
    } finally {
      setBusy(null);
    }
  };

  const respond = async (request: FriendRequestView, accept: boolean): Promise<void> => {
    audio.play('click');
    setBusy(request.id);
    try {
      if (accept) {
        await api.acceptFriend(request.id);
        notify(`你和 ${request.fromNickname} 已成为好友`);
        audio.play('shunzi');
      } else {
        await api.rejectFriend(request.id);
        notify('已忽略该申请');
      }
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : '操作失败', 'err');
    } finally {
      setBusy(null);
    }
  };

  const dropFriend = async (player: PlayerProfile): Promise<void> => {
    audio.play('click');
    setBusy(player.userId);
    try {
      await api.removeFriend(player.userId);
      notify(`已删除好友 ${player.nickname}`);
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : '删除失败', 'err');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="full-screen-view friends-view">
      <header className="view-topbar">
        <button type="button" className="view-back-btn" onClick={onBack}>
          <IconBack size={18} />
          <span>返回大厅</span>
        </button>
        <div className="view-title">
          <IconUser size={22} />
          <h2>好友与牌局邀请</h2>
          <span className="view-sub">牌桌内可直接邀请好友入座，非好友可发送邀请链接</span>
        </div>
        <div className="view-topbar__placeholder" />
      </header>

      {hint && <div className={`friends-hint is-${hint.tone}`}>{hint.text}</div>}

      <main className="friends-layout">
        {/* 好友列表 */}
        <section className="friends-col">
          <div className="friends-col__head">
            <h3>我的好友</h3>
            <span>{friends.length} 位</span>
          </div>
          <div className="friends-list">
            {friends.length === 0 && (
              <div className="friends-empty">
                <p>还没有好友</p>
                <small>在中间搜索昵称或账号，发送好友申请</small>
              </div>
            )}
            {friends.map((player) => (
              <div className="friend-card" key={player.userId}>
                <PlayerAvatar player={player} size={44} />
                <div className="friend-card__info">
                  <strong>{player.nickname}</strong>
                  <small>{player.bio || `账号 ${player.username ?? '—'}`}</small>
                </div>
                <button
                  type="button"
                  className="friend-card__drop"
                  disabled={busy === player.userId}
                  onClick={() => dropFriend(player)}
                  title="删除好友"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* 搜索添加 */}
        <section className="friends-col friends-col--wide">
          <div className="friends-col__head">
            <h3>添加好友</h3>
            <span>按昵称或账号搜索</span>
          </div>
          <div className="friends-search">
            <input
              type="search"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="输入昵称或账号…"
              aria-label="搜索玩家"
              spellCheck={false}
              autoComplete="off"
            />
            {searching && <span className="friends-search__spin">搜索中…</span>}
          </div>
          <div className="friends-list">
            {!keyword.trim() && (
              <div className="friends-empty">
                <p>输入关键字开始搜索</p>
                <small>支持昵称模糊匹配与账号精确匹配</small>
              </div>
            )}
            {keyword.trim() && !searching && results.length === 0 && (
              <div className="friends-empty">
                <p>没有找到匹配的玩家</p>
                <small>换个昵称或账号再试试</small>
              </div>
            )}
            {results.map((player) => (
              <div className="friend-card" key={player.userId}>
                <PlayerAvatar player={player} size={44} />
                <div className="friend-card__info">
                  <strong>{player.nickname}</strong>
                  <small>{player.bio || `账号 ${player.username ?? '—'}`}</small>
                </div>
                {player.isFriend ? (
                  <span className="friend-card__badge">已是好友</span>
                ) : player.requestPending ? (
                  <span className="friend-card__badge">待通过</span>
                ) : (
                  <button
                    type="button"
                    className="friend-card__add"
                    disabled={busy === player.userId}
                    onClick={() => addFriend(player)}
                  >
                    {busy === player.userId ? '发送中…' : '加好友'}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* 申请 */}
        <section className="friends-col">
          <div className="friends-col__head">
            <h3>好友申请</h3>
            <span>{incoming.length} 条待处理</span>
          </div>
          <div className="friends-list">
            {incoming.length === 0 && (
              <div className="friends-empty">
                <p>暂无新申请</p>
                <small>收到申请后会出现在这里</small>
              </div>
            )}
            {incoming.map((request) => (
              <div className="friend-card friend-card--request" key={request.id}>
                <PlayerAvatar
                  player={{
                    userId: request.fromId,
                    nickname: request.fromNickname,
                    username: null,
                    bio: request.message ?? '',
                    avatar: request.fromAvatar,
                  }}
                  size={44}
                />
                <div className="friend-card__info">
                  <strong>{request.fromNickname}</strong>
                  <small>{request.message || '想加你为好友'}</small>
                </div>
                <div className="friend-card__actions">
                  <button
                    type="button"
                    className="friend-card__accept"
                    disabled={busy === request.id}
                    onClick={() => respond(request, true)}
                  >
                    接受
                  </button>
                  <button
                    type="button"
                    className="friend-card__reject"
                    disabled={busy === request.id}
                    onClick={() => respond(request, false)}
                  >
                    忽略
                  </button>
                </div>
              </div>
            ))}

            {outgoing.length > 0 && (
              <>
                <div className="friends-subhead">我发出的申请</div>
                {outgoing.map((request) => (
                  <div className="friend-card is-muted" key={request.id}>
                    <PlayerAvatar
                      player={{
                        userId: request.toId,
                        nickname: request.toNickname,
                        username: null,
                        bio: '',
                        avatar: request.toAvatar,
                      }}
                      size={40}
                    />
                    <div className="friend-card__info">
                      <strong>{request.toNickname}</strong>
                      <small>等待对方处理</small>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
