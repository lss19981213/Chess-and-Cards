import { useEffect, useMemo, useState } from 'react';
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

type CategoryTab = 'all' | 'live' | 'table' | 'board';

const TABS: Array<{ key: CategoryTab; label: string; icon: string }> = [
  { key: 'all', label: '全部热门', icon: '🔥' },
  { key: 'live', label: '百人坐庄', icon: '🎰' },
  { key: 'table', label: '经典牌桌', icon: '♠️' },
  { key: 'board', label: '棋艺对弈', icon: '♟️' },
];

const KIND_LABEL: Record<Announcement['kind'], string> = {
  notice: '公告',
  event: '活动',
  maintenance: '维护',
};

export function Lobby({ user, games, onEnter, onLogin, onLogout, onTasks, onLeaderboard }: Props) {
  const [activeTab, setActiveTab] = useState<CategoryTab>('all');
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

  const ticker = useMemo(() => {
    if (announcements.length > 0) {
      return announcements.map((item) => `${item.title}：${item.content}`).join('　　✦　　');
    }
    return '尊贵牌友欢迎光临，虚拟筹码仅供娱乐竞技，公平可信·畅享巅峰对决';
  }, [announcements]);

  const filteredGames = useMemo(() => {
    if (activeTab === 'all') return games;
    if (activeTab === 'live') {
      return games.filter((g) => g.persistent === true || g.category === 'live');
    }
    if (activeTab === 'board') {
      return games.filter((g) => g.category === 'board');
    }
    return games.filter((g) => (g.category ?? 'table') === 'table' && g.persistent !== true);
  }, [games, activeTab]);

  const enter = (game: GameMeta) => {
    audio.play('click');
    onEnter(game);
  };

  return (
    <div className="lobby lobby--luxury" style={{ ['--lobby-bg' as string]: `url(${HERO_BG})` }}>
      {/* 奢华流光顶部导航 */}
      <header className="app-top">
        <div className="app-top__left">
          <div
            className="app-top__user"
            onClick={() => (user ? setProfileOpen(true) : onLogin())}
            role="button"
            tabIndex={0}
            title={user ? '查看个人中心' : '点击登录'}
          >
            <div className="app-avatar-wrapper">
              <span className="app-avatar">{user ? user.nickname.slice(0, 1) : '游'}</span>
              <span className="app-avatar-badge">{user ? 'VIP' : 'GUEST'}</span>
            </div>
            <div className="app-top__id">
              <div className="app-top__name-row">
                <strong>{user?.nickname ?? '游客身份'}</strong>
                {!user && <span className="login-pill">点此登录</span>}
              </div>
              <small>{user ? `ID: ${user.id.slice(0, 8)}` : '尚未登录账号'}</small>
            </div>
          </div>

          {/* 筹码钱包 */}
          <div
            className="app-top__wallet"
            onClick={onTasks}
            role="button"
            tabIndex={0}
            title="筹码钱包 · 点击领取福利"
          >
            <div className="wallet-chip-icon">
              <Chip size={22} />
            </div>
            <div className="wallet-amount">
              <span className="wallet-label">筹码余额</span>
              <strong>{user ? user.balance.toLocaleString() : '—'}</strong>
            </div>
            <span className="wallet-plus" title="每日福利">+</span>
          </div>
        </div>

        {/* 顶部中央微胶囊跑马灯 */}
        <div className="app-top__marquee" onClick={() => setNoticeOpen(true)} role="button" tabIndex={0}>
          <span className="marquee-icon">📢</span>
          <div className="marquee-viewport">
            <span className="marquee-text">{ticker}</span>
          </div>
          <span className="marquee-arrow">›</span>
        </div>

        {/* 顶部右侧系统控制 */}
        <div className="app-top__tools">
          <button
            type="button"
            className={`tool-btn ${musicOn ? 'is-active' : ''}`}
            title={musicOn ? '关闭背景音乐' : '开启背景音乐'}
            onClick={() => setMusicOn(audio.toggleMusic())}
          >
            <span className="tool-btn__icon">{musicOn ? '🎵' : '🎼'}</span>
          </button>
          <button
            type="button"
            className={`tool-btn ${sfxOn ? 'is-active' : ''}`}
            title={sfxOn ? '关闭音效' : '开启音效'}
            onClick={() => setSfxOn(audio.toggleSfx())}
          >
            <span className="tool-btn__icon">{sfxOn ? '🔊' : '🔇'}</span>
          </button>
          <button
            type="button"
            className="tool-btn tool-btn--track"
            title={`切歌（当前：${trackName}）`}
            onClick={() => setTrackName(audio.nextTrack())}
          >
            <span className="tool-btn__icon">⏭</span>
          </button>
        </div>
      </header>

      {/* 主展台区域：横屏画卷式体验 */}
      <main className="app-main app-main--showcase">
        {/* 分类切换胶囊栏 */}
        <div className="category-capsule-bar">
          <div className="category-capsules">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                className={`category-capsule ${activeTab === tab.key ? 'is-active' : ''}`}
                onClick={() => {
                  audio.play('click');
                  setActiveTab(tab.key);
                }}
              >
                <span className="capsule-icon">{tab.icon}</span>
                <span className="capsule-label">{tab.label}</span>
                {activeTab === tab.key && <span className="capsule-glow" />}
              </button>
            ))}
          </div>
          <div className="category-counter">
            共 <strong>{filteredGames.length}</strong> 款经典游戏
          </div>
        </div>

        {/* 核心横向游戏画卷展示 */}
        <div className="games-carousel-track">
          {filteredGames.map((game) => {
            const isLive = game.persistent === true || game.category === 'live';
            const isBoard = game.category === 'board';
            const artUrl = GAME_ART[game.gameId];

            return (
              <div
                key={game.gameId}
                className={`showcase-card ${isLive ? 'is-live' : isBoard ? 'is-board' : 'is-table'}`}
                style={artUrl ? { ['--card-art' as string]: `url(${artUrl})` } : undefined}
                onClick={() => enter(game)}
                role="button"
                tabIndex={0}
              >
                {/* 装饰高光与边框 */}
                <div className="showcase-card__rim" />
                <div className="showcase-card__shimmer" />

                {/* 顶部标签 */}
                <div className="showcase-card__top">
                  <span className={`game-badge ${isLive ? 'badge--live' : isBoard ? 'badge--board' : 'badge--table'}`}>
                    {isLive ? '🎰 平台坐庄' : isBoard ? '♟️ 纯粹技术' : '♠️ 多人竞技'}
                  </span>
                  <span className="game-players-badge">
                    {isLive ? '极速轮转' : `${game.minPlayers}-${game.maxPlayers}人桌`}
                  </span>
                </div>

                {/* 卡片封面背景 */}
                <div className="showcase-card__poster">
                  {artUrl ? (
                    <img src={artUrl} alt={game.name} loading="lazy" draggable={false} />
                  ) : (
                    <div className="showcase-card__fallback-icon">{game.icon}</div>
                  )}
                  <div className="showcase-card__poster-gradient" />
                </div>

                {/* 卡片底部内容 */}
                <div className="showcase-card__content">
                  <div className="showcase-card__header">
                    <span className="showcase-card__icon">{game.icon}</span>
                    <h3 className="showcase-card__title">{game.name}</h3>
                  </div>
                  <p className="showcase-card__desc">{game.description}</p>
                  
                  <div className="showcase-card__action">
                    <button type="button" className="btn-enter-table">
                      <span>{user ? '进入选台' : '一键开玩'}</span>
                      <em className="btn-shine" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {filteredGames.length === 0 && (
            <div className="empty-showcase">
              <div className="empty-icon">🎴</div>
              <p>暂无此类游戏，请确认游戏服已正常启动</p>
            </div>
          )}
        </div>
      </main>

      {/* 底部悬浮奢华快捷坞 (Floating Luxury Dock) */}
      <footer className="floating-dock">
        <div className="floating-dock__inner">
          <button
            type="button"
            className="dock-item is-active"
            onClick={() => setActiveTab('all')}
          >
            <span className="dock-icon">🏰</span>
            <span className="dock-label">大厅展台</span>
          </button>
          <button type="button" className="dock-item" onClick={onTasks}>
            <span className="dock-icon">🎁</span>
            <span className="dock-label">每日福利</span>
            <span className="dock-badge">领</span>
          </button>
          <button type="button" className="dock-item" onClick={onLeaderboard}>
            <span className="dock-icon">🏆</span>
            <span className="dock-label">至尊榜单</span>
          </button>
          <button
            type="button"
            className="dock-item"
            onClick={() => (user ? setProfileOpen(true) : onLogin())}
          >
            <span className="dock-icon">👤</span>
            <span className="dock-label">{user ? '个人资产' : '立即登录'}</span>
          </button>
        </div>
        <div className="floating-dock__tip">
          <span>虚拟筹码仅供娱乐记分 · 严禁任何形式的资金流通</span>
        </div>
      </footer>

      {/* 公告弹窗 */}
      {noticeOpen && (
        <div className="modal-mask" onClick={() => setNoticeOpen(false)} role="presentation">
          <div className="modal luxury-modal app-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal__head">
              <div className="modal__title-group">
                <span className="modal-ornament">✦</span>
                <h2>官方公告</h2>
              </div>
              <button type="button" className="luxury-close-btn" onClick={() => setNoticeOpen(false)}>
                ✕
              </button>
            </div>
            <div className="notice-list">
              {announcements.map((item) => (
                <div key={item.id} className={`notice-item is-${item.kind}`}>
                  <div className="notice-item__head">
                    <em className="notice-kind-tag">{KIND_LABEL[item.kind]}</em>
                    <strong>{item.title}</strong>
                    <span>{new Date(item.createdAt).toLocaleDateString('zh-CN')}</span>
                  </div>
                  <p>{item.content}</p>
                </div>
              ))}
              {announcements.length === 0 && <p className="hint">暂无最新公告</p>}
            </div>
          </div>
        </div>
      )}

      {/* 个人中心弹窗 */}
      {profileOpen && user && (
        <div className="modal-mask" onClick={() => setProfileOpen(false)} role="presentation">
          <div className="modal luxury-modal app-modal profile-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal__head">
              <div className="modal__title-group">
                <span className="modal-ornament">✦</span>
                <h2>个人资产档案</h2>
              </div>
              <button type="button" className="luxury-close-btn" onClick={() => setProfileOpen(false)}>
                ✕
              </button>
            </div>
            <div className="profile-box">
              <div className="profile-hero">
                <div className="profile-avatar-outer">
                  <span className="app-avatar app-avatar--lg">{user.nickname.slice(0, 1)}</span>
                  <span className="profile-rank-crown">👑</span>
                </div>
                <div className="profile-info">
                  <strong>{user.nickname}</strong>
                  <span className="profile-id-tag">UID: {user.id}</span>
                </div>
              </div>

              <div className="profile-box__balance-card">
                <span className="card-sub">当前可用娱乐筹码</span>
                <div className="card-val">
                  <Chip size={26} />
                  <strong>{user.balance.toLocaleString()}</strong>
                </div>
              </div>

              <div className="profile-actions">
                <button type="button" className="luxury-btn luxury-btn--gold" onClick={onTasks}>
                  前往任务领取救济金
                </button>
                <button
                  type="button"
                  className="luxury-btn luxury-btn--outline"
                  onClick={() => {
                    setProfileOpen(false);
                    onLogout();
                  }}
                >
                  退出当前账号
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
