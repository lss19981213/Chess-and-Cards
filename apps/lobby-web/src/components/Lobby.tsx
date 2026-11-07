import { useEffect, useMemo, useState } from 'react';
import type { Announcement, GameMeta } from '@cc/protocol';
import { api, type User } from '../api';
import { audio } from '../audio';
import { GAME_ART, HERO_BG } from '../assets';
import { Chip } from './Chip';
import {
  IconAssistant,
  IconChess,
  IconDice,
  IconFlame,
  IconGift,
  IconMusic,
  IconNext,
  IconNotice,
  IconRules,
  IconSound,
  IconSpade,
  IconTrophy,
} from './Icons';

interface Props {
  user: User | null;
  games: GameMeta[];
  onEnter: (game: GameMeta) => void;
  onLogin: () => void;
  onTasks: () => void;
  onLeaderboard: () => void;
  onProfile: () => void;
  onNotices: () => void;
  onAssistant: () => void;
  onRules: () => void;
}

type CategoryTab = 'all' | 'live' | 'table' | 'board';

const TABS: Array<{ key: CategoryTab; label: string; icon: typeof IconFlame }> = [
  { key: 'all', label: '全部热门', icon: IconFlame },
  { key: 'live', label: '百人坐庄', icon: IconDice },
  { key: 'table', label: '经典牌桌', icon: IconSpade },
  { key: 'board', label: '棋艺对弈', icon: IconChess },
];

export function Lobby({
  user,
  games,
  onEnter,
  onLogin,
  onTasks,
  onLeaderboard,
  onProfile,
  onNotices,
  onAssistant,
  onRules,
}: Props) {
  const [activeTab, setActiveTab] = useState<CategoryTab>('all');
  const [musicOn, setMusicOn] = useState(audio.musicOn);
  const [sfxOn, setSfxOn] = useState(audio.sfxOn);
  const [trackName, setTrackName] = useState(audio.trackName);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

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
      {/* 顶部殿堂级流光导航条 */}
      <header className="app-top">
        <div className="app-top__left">
          {/* 用户头像与信息 */}
          <div
            className="app-top__user"
            onClick={() => (user ? onProfile() : onLogin())}
            role="button"
            tabIndex={0}
            title={user ? '查看个人资产档案' : '点此登入殿堂'}
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
            <span className="wallet-plus" title="福利任务">+</span>
          </div>
        </div>

        {/* 顶部中央跑马灯微胶囊 */}
        <div className="app-top__marquee" onClick={onNotices} role="button" tabIndex={0} title="点击查阅全部官方公告">
          <IconNotice size={14} />
          <div className="marquee-viewport">
            <span className="marquee-text">{ticker}</span>
          </div>
          <span className="marquee-arrow">›</span>
        </div>

        {/* 顶部右侧系统功能群 (全部使用精细矢量图标，无下方导航栏干扰) */}
        <div className="app-top__tools">
          <button
            type="button"
            className="top-feature-btn"
            onClick={onTasks}
            title="福利任务"
          >
            <IconGift size={16} />
            <span>福利</span>
            <span className="feature-dot" />
          </button>

          <button
            type="button"
            className="top-feature-btn"
            onClick={onLeaderboard}
            title="名人堂排行榜"
          >
            <IconTrophy size={16} />
            <span>榜单</span>
          </button>

          <button
            type="button"
            className="top-feature-btn"
            onClick={onAssistant}
            title="智谋助手 (GLM驱动)"
          >
            <IconAssistant size={16} />
            <span>助手</span>
          </button>

          <button
            type="button"
            className="top-feature-btn"
            onClick={onRules}
            title="玩法规则"
          >
            <IconRules size={16} />
            <span>规则</span>
          </button>

          <div className="tool-divider" />

          {/* 媒体控制 */}
          <button
            type="button"
            className={`tool-btn ${musicOn ? 'is-active' : ''}`}
            title={musicOn ? '关闭背景音乐' : '开启背景音乐'}
            onClick={() => setMusicOn(audio.toggleMusic())}
          >
            <IconMusic on={musicOn} size={15} />
          </button>
          <button
            type="button"
            className={`tool-btn ${sfxOn ? 'is-active' : ''}`}
            title={sfxOn ? '关闭音效' : '开启音效'}
            onClick={() => setSfxOn(audio.toggleSfx())}
          >
            <IconSound on={sfxOn} size={15} />
          </button>
          <button
            type="button"
            className="tool-btn"
            title={`切歌（当前：${trackName}）`}
            onClick={() => setTrackName(audio.nextTrack())}
          >
            <IconNext size={14} />
          </button>
        </div>
      </header>

      {/* 大厅主展台：彻底取消底部导航栏，视野宽广 */}
      <main className="app-main app-main--showcase app-main--pure">
        {/* 分类切换胶囊栏 */}
        <div className="category-capsule-bar">
          <div className="category-capsules">
            {TABS.map((tab) => {
              const TabIcon = tab.icon;
              return (
                <button
                  key={tab.key}
                  type="button"
                  className={`category-capsule ${activeTab === tab.key ? 'is-active' : ''}`}
                  onClick={() => {
                    audio.play('click');
                    setActiveTab(tab.key);
                  }}
                >
                  <TabIcon size={14} />
                  <span className="capsule-label">{tab.label}</span>
                </button>
              );
            })}
          </div>
          <div className="category-counter">
            收录 <strong>{filteredGames.length}</strong> 款经典竞技游戏
          </div>
        </div>

        {/* 横向游戏画卷展示 */}
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
                <div className="showcase-card__rim" />
                <div className="showcase-card__shimmer" />

                <div className="showcase-card__top">
                  <span className={`game-badge ${isLive ? 'badge--live' : isBoard ? 'badge--board' : 'badge--table'}`}>
                    {isLive ? '平台坐庄' : isBoard ? '棋艺博弈' : '多人竞技'}
                  </span>
                  <span className="game-players-badge">
                    {isLive ? '极速轮转' : `${game.minPlayers}-${game.maxPlayers}人`}
                  </span>
                </div>

                <div className="showcase-card__poster">
                  {artUrl ? (
                    <img src={artUrl} alt={game.name} loading="lazy" draggable={false} />
                  ) : (
                    <div className="showcase-card__fallback-icon">{game.icon}</div>
                  )}
                  <div className="showcase-card__poster-gradient" />
                </div>

                <div className="showcase-card__content">
                  <div className="showcase-card__header">
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
              <p>暂无此类游戏，请确认游戏服已正常启动</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
