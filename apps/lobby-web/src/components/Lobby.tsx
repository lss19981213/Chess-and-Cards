import { useEffect, useMemo, useState } from 'react';
import type { Announcement, GameMeta } from '@cc/protocol';
import { api, type User } from '../api';
import { audio } from '../audio';
import { DEALER_MAIN, GAME_ART, HERO_BG } from '../assets';
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

const DEALER_QUOTES = [
  '尊贵的主人，艾莉丝已就绪，今天想挑战哪位牌王？',
  '祝主人牌运亨通，把把天胡，筹码暴涨！',
  '百人推筒子正在火热下注，主人要不要去试试手气？',
  '点击右上方「助手」，艾莉丝随时为您提供算牌与胜率推演哦～',
  '每天都有丰厚福利金币，记得去「福利」领取哦！',
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
  const [quoteIndex, setQuoteIndex] = useState(0);
  const [dealerHeart, setDealerHeart] = useState(false);

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

  // 荷官台词自然轮换
  useEffect(() => {
    const quoteTimer = window.setInterval(() => {
      setQuoteIndex((prev) => (prev + 1) % DEALER_QUOTES.length);
    }, 6000);
    return () => window.clearInterval(quoteTimer);
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

  const handleDealerClick = () => {
    audio.play('shunzi');
    setDealerHeart(true);
    setQuoteIndex((prev) => (prev + 1) % DEALER_QUOTES.length);
    window.setTimeout(() => setDealerHeart(false), 800);
  };

  const handleQuickPlay = () => {
    audio.play('click');
    const target = filteredGames[0] ?? games[0];
    if (target) {
      onEnter(target);
    }
  };

  return (
    <div className="lobby lobby--luxury" style={{ ['--lobby-bg' as string]: `url(${HERO_BG})` }}>
      {/* 顶部殿堂级导航条：1166px 宽度黄金排布，元素永不挤压变形 */}
      <header className="app-top app-top--fixed">
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
              <strong className="user-nickname-text">{user?.nickname ?? '游客身份'}</strong>
              <small>{user ? `ID: ${user.id.slice(0, 6)}` : '点此登录'}</small>
            </div>
          </div>

          {/* 筹码钱包：紧凑横排胶囊，绝对不折行 */}
          <div
            className="app-top__wallet"
            onClick={onTasks}
            role="button"
            tabIndex={0}
            title="筹码钱包 · 点击领取福利"
          >
            <div className="wallet-chip-icon">
              <Chip size={20} />
            </div>
            <div className="wallet-info-col">
              <span className="wallet-label">筹码</span>
              <strong className="wallet-val">{user ? user.balance.toLocaleString() : '1,000'}</strong>
            </div>
            <span className="wallet-plus">+</span>
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

        {/* 顶部右侧系统功能群：统一胶囊尺寸，绝不变形 */}
        <div className="app-top__tools">
          <button
            type="button"
            className="top-feature-pill"
            onClick={onTasks}
            title="福利任务"
          >
            <IconGift size={15} />
            <span>福利</span>
            <span className="feature-dot" />
          </button>

          <button
            type="button"
            className="top-feature-pill"
            onClick={onLeaderboard}
            title="名人堂排行榜"
          >
            <IconTrophy size={15} />
            <span>榜单</span>
          </button>

          <button
            type="button"
            className="top-feature-pill"
            onClick={onAssistant}
            title="智谋助手 (GLM驱动)"
          >
            <IconAssistant size={15} />
            <span>助手</span>
          </button>

          <button
            type="button"
            className="top-feature-pill"
            onClick={onRules}
            title="玩法规则"
          >
            <IconRules size={15} />
            <span>规则</span>
          </button>

          <div className="tool-divider" />

          {/* 媒体控制群 */}
          <div className="top-media-group">
            <button
              type="button"
              className={`media-icon-btn ${musicOn ? 'is-active' : ''}`}
              title={musicOn ? '关闭背景音乐' : '开启背景音乐'}
              onClick={() => setMusicOn(audio.toggleMusic())}
            >
              <IconMusic on={musicOn} size={15} />
            </button>
            <button
              type="button"
              className={`media-icon-btn ${sfxOn ? 'is-active' : ''}`}
              title={sfxOn ? '关闭音效' : '开启音效'}
              onClick={() => setSfxOn(audio.toggleSfx())}
            >
              <IconSound on={sfxOn} size={15} />
            </button>
            <button
              type="button"
              className="media-icon-btn"
              title={`切歌（当前：${trackName}）`}
              onClick={() => setTrackName(audio.nextTrack())}
            >
              <IconNext size={14} />
            </button>
          </div>
        </div>
      </header>

      {/* 大厅主展台：1166*514 黄金比例，高度 470px 垂直撑满，彻底消除底部空白 */}
      <main className="app-main app-main--showcase app-main--pure app-main--stage1166">
        <div className="lobby-stage-layout">
          {/* 左侧主要区域：分类胶囊 + 纵向满幅横向游戏画卷 */}
          <section className="lobby-games-section">
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

            {/* 横向游戏画卷轨道：高度 420px 完整纵向拉满 */}
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
                  <p>暂无此类游戏，请切换分类或确认游戏服状态</p>
                </div>
              )}
            </div>
          </section>

          {/* 右侧专属区域：动漫首席荷官·艾莉丝迎宾展台 (高度420px撑满，立绘完整呈现) */}
          <aside className="lobby-dealer-stand" onClick={handleDealerClick} title="点击与美女荷官艾莉丝互动">
            {/* 灵动台词气泡 */}
            <div className="dealer-stand__bubble">
              <span className="bubble-speaker">艾莉丝 (Alice)</span>
              <p className="bubble-text">{DEALER_QUOTES[quoteIndex]}</p>
              <div className="bubble-tail" />
              {dealerHeart && <span className="dealer-heart-float">💖</span>}
            </div>

            {/* 荷官精美大立绘卡片 */}
            <div className="dealer-stand__portrait-card">
              <div className="dealer-stand__halo" />
              <img
                src={DEALER_MAIN}
                alt="首席动漫美女荷官艾莉丝"
                className="dealer-stand__img"
                draggable={false}
              />
              <div className="dealer-stand__vignette" />

              <div className="dealer-stand__badge">
                <span className="dealer-badge__title">首席金牌荷官</span>
                <span className="dealer-badge__status">
                  <em className="status-live-dot" /> 发牌迎宾中
                </span>
              </div>
            </div>

            {/* 荷官专属交互动作栏 */}
            <div className="dealer-stand__actions" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="dealer-action-btn dealer-action-btn--assistant"
                onClick={onAssistant}
                title="开启智谋助手"
              >
                <IconAssistant size={14} />
                <span>智谋推演</span>
              </button>
              <button
                type="button"
                className="dealer-action-btn dealer-action-btn--play"
                onClick={handleQuickPlay}
                title="立即快速开始对局"
              >
                <span>快速匹配</span>
                <span className="action-arrow">›</span>
              </button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
