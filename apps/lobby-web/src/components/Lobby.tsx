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

type MainCategory = 'live' | 'table' | 'board';

interface CategoryConfig {
  key: MainCategory;
  title: string;
  subTitle: string;
  tag: string;
  gameIds: string[];
  bgStyle: string;
}

const CATEGORIES: CategoryConfig[] = [
  {
    key: 'live',
    title: '百人局',
    subTitle: '平台坐庄 · 极速开奖 · 奖池火爆',
    tag: '★ 最热门',
    gameIds: ['tuizhuanzi', 'dice', 'baccarat', 'niuniu', 'blackjack'],
    bgStyle: 'linear-gradient(145deg, rgba(230, 160, 30, 0.22) 0%, rgba(18, 24, 38, 0.95) 75%)',
  },
  {
    key: 'table',
    title: '经典局',
    subTitle: '真人竞技 · 好友开房 · 巅峰对决',
    tag: '多人博弈',
    gameIds: ['doudizhu', 'paodekuai', 'texas', 'stud', 'goldenflower'],
    bgStyle: 'linear-gradient(145deg, rgba(46, 204, 113, 0.18) 0%, rgba(14, 20, 32, 0.95) 75%)',
  },
  {
    key: 'board',
    title: '对弈局',
    subTitle: '国粹精髓 · 智谋推演 · 双人沉思',
    tag: '经典棋艺',
    gameIds: ['xiangqi', 'gomoku', 'chess'],
    bgStyle: 'linear-gradient(145deg, rgba(78, 120, 255, 0.18) 0%, rgba(12, 17, 28, 0.95) 75%)',
  },
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
  const [activeCategory, setActiveCategory] = useState<MainCategory | null>(null);
  const [musicOn, setMusicOn] = useState(audio.musicOn);
  const [sfxOn, setSfxOn] = useState(audio.sfxOn);
  const [trackName, setTrackName] = useState(audio.trackName);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
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

  const ticker = useMemo(() => {
    if (announcements.length > 0) {
      return announcements.map((item) => `${item.title}：${item.content}`).join('　　✦　　');
    }
    return '尊贵牌友欢迎光临，虚拟筹码仅供娱乐竞技，公平可信·畅享巅峰对决';
  }, [announcements]);

  const enterGame = (game: GameMeta) => {
    audio.play('click');
    onEnter(game);
  };

  const handleSelectCategory = (catKey: MainCategory) => {
    audio.play('click');
    setActiveCategory(catKey);
  };

  const handleBackToLobby = () => {
    audio.play('click');
    setActiveCategory(null);
  };

  const handleQuickLive = (e: React.MouseEvent) => {
    e.stopPropagation();
    audio.play('click');
    const liveGames = games.filter((g) => g.persistent === true || g.category === 'live');
    if (liveGames[0]) {
      onEnter(liveGames[0]);
    }
  };

  const handleDealerInteract = (e: React.MouseEvent) => {
    e.stopPropagation();
    audio.play('shunzi');
    setDealerHeart(true);
    window.setTimeout(() => setDealerHeart(false), 800);
  };

  return (
    <div className="lobby lobby--luxury lobby--fluid" style={{ ['--lobby-bg' as string]: `url(${HERO_BG})` }}>
      {/* 顶部殿堂级导航条：自适应弹性伸缩，绝不变形 */}
      <header className="app-top app-top--fixed">
        <div className="app-top__left">
          {activeCategory && (
            <button type="button" className="luxury-back-btn" onClick={handleBackToLobby} title="返回大厅">
              <span className="back-arrow">‹</span>
              <span>返回大厅</span>
            </button>
          )}

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

          {/* 筹码钱包：单行精致横排 */}
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

        {/* 跑马灯微胶囊 */}
        <div className="app-top__marquee" onClick={onNotices} role="button" tabIndex={0} title="点击查阅全部官方公告">
          <IconNotice size={14} />
          <div className="marquee-viewport">
            <span className="marquee-text">{ticker}</span>
          </div>
          <span className="marquee-arrow">›</span>
        </div>

        {/* 顶部右侧系统功能群 */}
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

      {/* 主屏展示区：零滚动条设计 */}
      <main className="app-main app-main--clean-hub">
        {!activeCategory ? (
          /* ================= 主页三大黄金专区入口 (自适应撑满屏幕，无滚动条) ================= */
          <div className="home-trio-hub">
            {/* 1. 百人局 (最大视觉焦点，约 44% 宽度，内嵌首席美女荷官立绘) */}
            <div
              className="hub-portal-card hub-portal-card--live"
              onClick={() => handleSelectCategory('live')}
              role="button"
              tabIndex={0}
            >
              <div className="hub-portal-card__glow" />
              <div className="hub-portal-card__tag">
                <span className="live-sparkle-dot" />
                <span>万人同台 · 平台轮庄</span>
              </div>

              {/* 荷官微缩发牌立绘展示 */}
              <div className="hub-portal-card__dealer" onClick={handleDealerInteract} title="点击与美女荷官互动">
                <img src={DEALER_MAIN} alt="首席动漫荷官艾莉丝" draggable={false} />
                <span className="dealer-floating-name">首席荷官 · 艾莉丝</span>
                {dealerHeart && <span className="dealer-heart-float">💖</span>}
              </div>

              <div className="hub-portal-card__info">
                <div className="hub-card-title-row">
                  <IconDice size={28} />
                  <h2>百人局</h2>
                </div>
                <p className="hub-portal-card__desc">推筒子 · 骰宝 · 百家乐 · 百人牛牛 · 21点</p>
                <div className="hub-portal-card__foot">
                  <span className="hub-count-tag">收录 5 款玩法</span>
                  <button type="button" className="btn-portal-enter btn-portal-enter--gold" onClick={handleQuickLive}>
                    <span>极速开玩 ›</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 2. 经典局 (其次，约 32% 宽度，绿绒扑克质感) */}
            <div
              className="hub-portal-card hub-portal-card--table"
              onClick={() => handleSelectCategory('table')}
              role="button"
              tabIndex={0}
            >
              <div className="hub-portal-card__glow" />
              <div className="hub-portal-card__tag">
                <span>真人竞技 · 好友开房</span>
              </div>

              <div className="hub-portal-card__illustration hub-illustration--table">
                <div className="poker-fan-art">
                  <img src={GAME_ART['doudizhu'] ?? ''} alt="经典牌桌" draggable={false} />
                </div>
              </div>

              <div className="hub-portal-card__info">
                <div className="hub-card-title-row">
                  <IconSpade size={26} />
                  <h2>经典局</h2>
                </div>
                <p className="hub-portal-card__desc">经典斗地主 · 极速跑得快 · 德州扑克 · 梭哈 · 翻金花</p>
                <div className="hub-portal-card__foot">
                  <span className="hub-count-tag">收录 5 款竞技</span>
                  <button type="button" className="btn-portal-enter">
                    <span>进入选台 ›</span>
                  </button>
                </div>
              </div>
            </div>

            {/* 3. 对弈局 (最后，约 24% 宽度，国粹楚汉棋盘) */}
            <div
              className="hub-portal-card hub-portal-card--board"
              onClick={() => handleSelectCategory('board')}
              role="button"
              tabIndex={0}
            >
              <div className="hub-portal-card__glow" />
              <div className="hub-portal-card__tag">
                <span>楚汉争霸 · 智慧对弈</span>
              </div>

              <div className="hub-portal-card__illustration hub-illustration--board">
                <div className="chess-fan-art">
                  <img src={GAME_ART['xiangqi'] ?? ''} alt="棋艺对弈" draggable={false} />
                </div>
              </div>

              <div className="hub-portal-card__info">
                <div className="hub-card-title-row">
                  <IconChess size={26} />
                  <h2>对弈局</h2>
                </div>
                <p className="hub-portal-card__desc">中国象棋 · 五子棋 · 国际象棋</p>
                <div className="hub-portal-card__foot">
                  <span className="hub-count-tag">收录 3 款名棋</span>
                  <button type="button" className="btn-portal-enter">
                    <span>弈者对决 ›</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* ================= 二级专区视图 (一屏自适应排开全部游戏，无滚动条) ================= */
          <div className="category-subpage-view">
            <div className="category-subpage-header">
              <div className="subpage-title-row">
                <h2>{CATEGORIES.find((c) => c.key === activeCategory)?.title}</h2>
                <span className="subpage-desc">
                  {CATEGORIES.find((c) => c.key === activeCategory)?.subTitle}
                </span>
              </div>
              <button type="button" className="subpage-return-btn" onClick={handleBackToLobby}>
                ‹ 返回三大主专区
              </button>
            </div>

            {/* 专区游戏横屏一屏平铺轨道 (无滚动条，自适应 flex) */}
            <div className="category-games-row">
              {games
                .filter((g) => {
                  const targetIds = CATEGORIES.find((c) => c.key === activeCategory)?.gameIds ?? [];
                  return targetIds.includes(g.gameId);
                })
                .map((game) => {
                  const isLive = game.persistent === true || game.category === 'live';
                  const artUrl = GAME_ART[game.gameId];

                  return (
                    <div
                      key={game.gameId}
                      className="subpage-game-card"
                      onClick={() => enterGame(game)}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="subpage-game-card__poster">
                        {artUrl ? (
                          <img src={artUrl} alt={game.name} draggable={false} />
                        ) : (
                          <div className="showcase-card__fallback-icon">{game.icon}</div>
                        )}
                        <span className="subpage-game-tag">
                          {isLive ? '极速轮庄' : `${game.minPlayers}-${game.maxPlayers}人`}
                        </span>
                      </div>

                      <div className="subpage-game-card__body">
                        <h3>{game.name}</h3>
                        <p>{game.description}</p>
                        <button type="button" className="btn-enter-table">
                          <span>{user ? (isLive ? '一键入座' : '进入选台') : '立即开玩'}</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
