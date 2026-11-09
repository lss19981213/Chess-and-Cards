import { useEffect, useMemo, useState } from 'react';
import type { Announcement, GameMeta } from '@cc/protocol';
import { api, type User } from '../api';
import { audio } from '../audio';
import { DEALER_MAIN, GAME_ART, HERO_BG } from '../assets';
import { Chip } from './Chip';
import { DealerTipWidget } from './DealerTipWidget';
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
  onQuickPlay: (game: GameMeta) => void;
  onLogin: () => void;
  onTasks: () => void;
  onLeaderboard: () => void;
  onProfile: () => void;
  onNotices: () => void;
  onAssistant: () => void;
  onRules: () => void;
  onBalanceChange?: (newBalance: number) => void;
}

type CategoryKey = 'all' | 'live' | 'cards' | 'chess';

interface TabItem {
  key: CategoryKey;
  label: string;
  icon: string;
  badge?: string;
}

const TABS: TabItem[] = [
  { key: 'all', label: '全部热门', icon: '🔥', badge: '13款' },
  { key: 'live', label: '百人竞技', icon: '🎰', badge: '火爆' },
  { key: 'cards', label: '经典扑克', icon: '♠️' },
  { key: 'chess', label: '智谋对弈', icon: '♟️' },
];

const LIVE_GAMES = new Set(['tuizhuanzi', 'dice', 'baccarat', 'niuniu', 'blackjack']);
const CARD_GAMES = new Set(['doudizhu', 'paodekuai', 'texas', 'stud', 'goldenflower']);
const CHESS_GAMES = new Set(['xiangqi', 'gomoku', 'chess']);

export function Lobby({
  user,
  games,
  onEnter,
  onQuickPlay,
  onLogin,
  onTasks,
  onLeaderboard,
  onProfile,
  onNotices,
  onAssistant,
  onRules,
  onBalanceChange,
}: Props) {
  const [customQuote, setCustomQuote] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<CategoryKey>('all');
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
    return '尊贵牌友欢迎光临，绿色公平竞技环境，虚拟筹码畅享顶级棋牌乐趣！';
  }, [announcements]);

  const filteredGames = useMemo(() => {
    if (activeTab === 'live') {
      return games.filter((g) => LIVE_GAMES.has(g.gameId) || g.persistent);
    }
    if (activeTab === 'cards') {
      return games.filter((g) => CARD_GAMES.has(g.gameId));
    }
    if (activeTab === 'chess') {
      return games.filter((g) => CHESS_GAMES.has(g.gameId));
    }
    return games;
  }, [games, activeTab]);

  const handleDealerInteract = (e: React.MouseEvent) => {
    e.stopPropagation();
    audio.play('shunzi');
    setDealerHeart(true);
    window.setTimeout(() => setDealerHeart(false), 800);
  };

  const handleRandomPlay = () => {
    audio.play('click');
    if (filteredGames.length > 0) {
      const idx = Math.floor(Math.random() * filteredGames.length);
      const picked = filteredGames[idx];
      if (picked) onQuickPlay(picked);
    }
  };

  return (
    <div className="lobby lobby--luxury lobby--commercial-grade" style={{ ['--lobby-bg' as string]: `url(${HERO_BG})` }}>
      {/* ================= 1. 经典商业顶栏 (绝不换行、自适应紧凑) ================= */}
      <header className="app-top lobby-main-header">
        <div className="app-top__left">
          {/* 用户资产名片 */}
          <div
            className="app-top__user"
            onClick={() => (user ? onProfile() : onLogin())}
            role="button"
            tabIndex={0}
            title={user ? '点击查看个人资产' : '点击登录'}
          >
            <div className="app-avatar-wrapper">
              <span className="app-avatar">{user ? user.nickname.slice(0, 1) : '游'}</span>
              <span className="app-avatar-badge">{user ? 'VIP' : 'GUEST'}</span>
            </div>
            <div className="app-top__id">
              <div className="app-top__name-row">
                <strong>{user ? user.nickname : '游客牌友'}</strong>
                {!user && <span className="login-pill">登录</span>}
              </div>
            </div>
          </div>

          {/* 筹码钱包：单行胶囊带加号 */}
          <div
            className="app-top__wallet"
            onClick={onTasks}
            role="button"
            tabIndex={0}
            title="筹码钱包 · 点击领取福利"
          >
            <div className="wallet-chip-icon">
              <Chip size={18} />
            </div>
            <div className="wallet-info-col">
              <span className="wallet-label">欢乐豆</span>
              <strong className="wallet-val">{user ? user.balance.toLocaleString() : '1,000'}</strong>
            </div>
            <span className="wallet-plus">+</span>
          </div>
        </div>

        {/* 跑马灯公告条 */}
        <div className="app-top__marquee" onClick={onNotices} role="button" tabIndex={0} title="点击查阅全部官方公告">
          <IconNotice size={14} />
          <div className="marquee-viewport">
            <span className="marquee-text">{ticker}</span>
          </div>
          <span className="marquee-arrow">›</span>
        </div>

        {/* 顶部右侧系统功能群 */}
        <div className="app-top__tools">
          <button type="button" className="top-feature-pill" onClick={onTasks} title="福利每日任务">
            <IconGift size={15} />
            <span>福利</span>
            <span className="feature-dot" />
          </button>

          <button type="button" className="top-feature-pill" onClick={onLeaderboard} title="名人堂榜单">
            <IconTrophy size={15} />
            <span>榜单</span>
          </button>

          <button type="button" className="top-feature-pill" onClick={onAssistant} title="AI智谋推演助手">
            <IconAssistant size={15} />
            <span>助手</span>
          </button>

          <button type="button" className="top-feature-pill" onClick={onRules} title="全游戏规则说明">
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

      {/* ================= 2. 商业级大厅主视口 (满幅展开，零上下黑边) ================= */}
      <main className="commercial-lobby-stage">
        {/* 左侧专区快捷选项卡 */}
        <nav className="commercial-nav-rail">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                className={`nav-rail-item ${active ? 'is-active' : ''}`}
                onClick={() => {
                  audio.play('click');
                  setActiveTab(tab.key);
                }}
              >
                <span className="nav-rail-icon">{tab.icon}</span>
                <span className="nav-rail-label">{tab.label}</span>
                {tab.badge && <span className="nav-rail-badge">{tab.badge}</span>}
              </button>
            );
          })}
        </nav>

        {/* 中间游戏展示画卷 (自适应 100% 纵向充满，横向流畅滑动画卷，零纵向滚动条) */}
        <section className="commercial-games-carousel-viewport">
          <div className="commercial-games-strip">
            {filteredGames.map((game) => {
              const isLive = game.persistent === true || LIVE_GAMES.has(game.gameId);
              const artUrl = GAME_ART[game.gameId];

              return (
                <div key={game.gameId} className="commercial-game-card">
                  {/* 3D 质感海报画卷 */}
                  <div
                    className="commercial-game-card__poster"
                    onClick={() => onQuickPlay(game)}
                    role="button"
                    tabIndex={0}
                    title={`点击极速开玩 ${game.name}`}
                  >
                    {artUrl ? (
                      <img src={artUrl} alt={game.name} draggable={false} />
                    ) : (
                      <div className="game-card-fallback-icon">{game.icon}</div>
                    )}
                    <div className="poster-light-sweep" />
                    <span className="game-badge-tag">
                      {isLive ? '🎰 万人同台' : `${game.minPlayers}-${game.maxPlayers}人开局`}
                    </span>
                  </div>

                  {/* 信息与双通道按钮群 */}
                  <div className="commercial-game-card__meta">
                    <div className="meta-text-col">
                      <h3 className="meta-title">{game.name}</h3>
                      <p className="meta-desc">{game.description}</p>
                    </div>

                    <div className="meta-actions-row">
                      {/* 核心高转化：暖金极速开局大按钮 */}
                      <button
                        type="button"
                        className="btn-quick-play-gold"
                        onClick={(e) => {
                          e.stopPropagation();
                          audio.play('click');
                          onQuickPlay(game);
                        }}
                      >
                        <span className="btn-bolt">⚡</span>
                        <span>极速开局</span>
                      </button>

                      {/* 次级入口：选房入座 */}
                      <button
                        type="button"
                        className="btn-choose-room-subtle"
                        onClick={(e) => {
                          e.stopPropagation();
                          audio.play('click');
                          onEnter(game);
                        }}
                        title="查看桌台列表或自建房间"
                      >
                        选台
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 右侧：首席动漫美女荷官艾莉丝陪玩展台 */}
        <aside className="commercial-dealer-companion-stand">
          {/* 对话气泡 */}
          <div className="companion-speech-bubble" onClick={handleDealerInteract} title="点击互动">
            <div className="bubble-header">
              <span className="companion-name">首席荷官 · 艾莉丝</span>
              <span className="companion-dot" />
              {dealerHeart && <span className="dealer-heart-float">💖</span>}
            </div>
            <p className="bubble-content">
              {customQuote ?? (activeTab === 'live'
                ? '百人推筒子、骰宝正在火爆下注，主人要试试手气吗？'
                : activeTab === 'cards'
                  ? '经典斗地主秒匹秒开，AI陪玩随叫随到，祝您把把通天顺！'
                  : '国粹象棋楚汉争霸，静候主人排兵布阵～')}
            </p>
          </div>

          {/* 荷官精美半身立绘 */}
          <div className="companion-portrait-wrapper" onClick={handleDealerInteract}>
            <img src={DEALER_MAIN} alt="首席荷官艾莉丝" draggable={false} />
            <div className="portrait-glow-halo" />
          </div>

          {/* 快捷行动按键 */}
          <div className="companion-footer-actions">
            <button type="button" className="btn-random-match" onClick={handleRandomPlay}>
              <span>🎲 随机幸运开局</span>
            </button>
            <DealerTipWidget
              balance={user?.balance ?? 0}
              onBalanceChange={onBalanceChange ?? (() => {})}
              onAliceSpeak={(txt) => setCustomQuote(txt)}
            />
          </div>
        </aside>
      </main>
    </div>
  );
}
