import { useEffect, useState } from 'react';
import type { Announcement, GameMeta } from '@cc/protocol';
import { api, type User } from '../api';
import { audio } from '../audio';
import { GAME_ART, HERO_BG } from '../assets';
import { Chip } from './Chip';

interface Props {
  user: User | null;
  games: GameMeta[];
  onEnter: (game: GameMeta) => void;
  onLogin: () => void;
  onLogout: () => void;
  onTasks: () => void;
  onLeaderboard: () => void;
}

const MINI_CATEGORIES = [
  { key: 'board', title: '棋类对弈', desc: '一对一，纯技术' },
  { key: 'table', title: '牌桌对战', desc: '多人竞技，凭牌技取胜' },
] as const;

const KIND_LABEL: Record<Announcement['kind'], string> = {
  notice: '公告',
  event: '活动',
  maintenance: '维护',
};

export function Lobby({ user, games, onEnter, onLogin, onLogout, onTasks, onLeaderboard }: Props) {
  const [musicOn, setMusicOn] = useState(audio.musicOn);
  const [sfxOn, setSfxOn] = useState(audio.sfxOn);
  const [trackName, setTrackName] = useState(audio.trackName);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  useEffect(() => {
    const load = () => {
      void api
        .announcements()
        .then((data) => setAnnouncements(data.announcements ?? []))
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const liveGames = games.filter((game) => game.persistent === true || game.category === 'live');
  const ticker =
    announcements.length > 0
      ? announcements.map((item) => `${item.title}｜${item.content}`).join('　　✦　　')
      : '欢迎来到棋牌娱乐大厅，虚拟筹码仅供娱乐记分，不可提现';

  const enter = (game: GameMeta) => {
    audio.play('click');
    onEnter(game);
  };

  return (
    <div className="lobby" style={{ ['--lobby-bg' as string]: `url(${HERO_BG})` }}>
      <header className="app-top">
        <div className="app-top__user">
          <span className="app-avatar">{user ? user.nickname.slice(0, 1) : '游'}</span>
          <span className="app-top__id">
            <strong>{user?.nickname ?? '游客'}</strong>
            <small>{user ? `ID ${user.id.slice(0, 6)}` : '未登录'}</small>
          </span>
        </div>

        <div className="app-top__wallet">
          <Chip size={18} />
          <strong>{user ? user.balance.toLocaleString() : '—'}</strong>
        </div>

        <div className="app-top__tools">
          <button
            type="button"
            className={`icon-btn ${musicOn ? '' : 'is-off'}`}
            title={musicOn ? '关闭背景音乐' : '开启背景音乐'}
            onClick={() => setMusicOn(audio.toggleMusic())}
          >
            {musicOn ? '🎵' : '🎼'}
          </button>
          <button
            type="button"
            className={`icon-btn ${sfxOn ? '' : 'is-off'}`}
            title={sfxOn ? '关闭音效' : '开启音效'}
            onClick={() => setSfxOn(audio.toggleSfx())}
          >
            {sfxOn ? '🔊' : '🔇'}
          </button>
          <button
            type="button"
            className="icon-btn"
            title={`切换音乐（当前：${trackName}）`}
            onClick={() => setTrackName(audio.nextTrack())}
          >
            ⏭
          </button>
        </div>
      </header>

      <button type="button" className="notice-bar" onClick={() => setNoticeOpen(true)}>
        <span className="notice-bar__icon">📢</span>
        <span className="notice-bar__viewport">
          <span className="notice-bar__ticker">{ticker}</span>
        </span>
        <span className="notice-bar__more">更多 ›</span>
      </button>

      <main className="app-main">
        {liveGames.length > 0 && (
          <section className="app-section app-section--live">
            <div className="app-section__head">
              <div className="app-section__title">
                <em />
                <h2>平台坐庄</h2>
              </div>
              <span>每 38 秒一局 · 多台同时进行</span>
            </div>
            <div className="live-grid">
              {liveGames.map((game) => (
                <button
                  key={game.gameId}
                  type="button"
                  className="live-card"
                  style={
                    GAME_ART[game.gameId]
                      ? { backgroundImage: `url(${GAME_ART[game.gameId]})` }
                      : undefined
                  }
                  onClick={() => enter(game)}
                >
                  {/* 区块标题已说明坐庄类型，卡片不再重复标签 */}
                  <span className="live-card__body">
                    <span className="live-card__icon">{game.icon}</span>
                    <strong>{game.name}</strong>
                    <small>{game.description}</small>
                    <span className="live-card__cta">{user ? '选台' : '登录开玩'}</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {MINI_CATEGORIES.map((category) => {
          const list = games.filter((game) => (game.category ?? 'table') === category.key);
          if (list.length === 0) return null;
          return (
            <section key={category.key} className="app-section">
              <div className="app-section__head">
                <div className="app-section__title">
                  <em />
                  <h2>{category.title}</h2>
                </div>
                <span>{category.desc}</span>
              </div>
              <div className="mini-grid">
                {list.map((game) => (
                  <button key={game.gameId} type="button" className="mini-card" onClick={() => enter(game)}>
                    <span className="mini-card__thumb">
                      {GAME_ART[game.gameId] ? (
                        <img src={GAME_ART[game.gameId]} alt={game.name} loading="lazy" draggable={false} />
                      ) : (
                        <span>{game.icon}</span>
                      )}
                    </span>
                    <strong>{game.name}</strong>
                    <small>
                      {game.minPlayers}-{game.maxPlayers} 人
                    </small>
                  </button>
                ))}
              </div>
            </section>
          );
        })}

        {games.length === 0 && <p className="empty">暂无可用游戏，请确认游戏服已启动。</p>}

        <p className="app-footnote">虚拟筹码不可提现、不可转让，仅用于记分娱乐。</p>
      </main>

      <nav className="app-tabbar">
        <button type="button" className="is-active">
          <span>🎮</span>大厅
        </button>
        <button type="button" onClick={onTasks}>
          <span>🎁</span>任务
        </button>
        <button type="button" onClick={onLeaderboard}>
          <span>🏆</span>排行
        </button>
        <button type="button" onClick={() => (user ? setProfileOpen(true) : onLogin())}>
          <span>👤</span>我的
        </button>
      </nav>

      {noticeOpen && (
        <div className="modal-mask" onClick={() => setNoticeOpen(false)} role="presentation">
          <div className="modal app-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal__head">
              <h2>公告</h2>
              <button type="button" className="ghost" onClick={() => setNoticeOpen(false)}>
                关闭
              </button>
            </div>
            <div className="notice-list">
              {announcements.map((item) => (
                <div key={item.id} className={`notice-item is-${item.kind}`}>
                  <div className="notice-item__head">
                    <em>{KIND_LABEL[item.kind]}</em>
                    <strong>{item.title}</strong>
                    <span>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                  <p>{item.content}</p>
                </div>
              ))}
              {announcements.length === 0 && <p className="hint">暂无公告</p>}
            </div>
          </div>
        </div>
      )}

      {profileOpen && user && (
        <div className="modal-mask" onClick={() => setProfileOpen(false)} role="presentation">
          <div className="modal app-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal__head">
              <h2>我的</h2>
              <button type="button" className="ghost" onClick={() => setProfileOpen(false)}>
                关闭
              </button>
            </div>
            <div className="profile-box">
              <span className="app-avatar app-avatar--lg">{user.nickname.slice(0, 1)}</span>
              <strong>{user.nickname}</strong>
              <div className="profile-box__balance">
                <Chip size={18} />
                {user.balance.toLocaleString()}
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setProfileOpen(false);
                  onLogout();
                }}
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
