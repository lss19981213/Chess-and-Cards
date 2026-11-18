function IconBolt() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="btn-bolt-svg" aria-hidden="true">
      <path d="M13 2L3 14h8l-2 8 11-12h-8l1-8z" />
    </svg>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { computeLevelInfo, DEALER_VOICES, type Announcement, type BotDifficulty, type GameMeta } from '@cc/protocol';
import { api, type User } from '../api';
import { audio } from '../audio';
import { speakDealerQuote } from '../speech';
import { DEALER_MAIN, DEALER_SKINS_ASSETS, GAME_ART, HERO_BG } from '../assets';
import { AvatarFrameModal } from './AvatarFrameModal';
import { AvatarWithFrame } from './AvatarWithFrame';
import { Chip } from './Chip';
import { DealerTipWidget } from './DealerTipWidget';
import { DealerWardrobeModal } from './DealerWardrobeModal';
import {
  IconGift,
  IconMail,
  IconMusic,
  IconNext,
  IconNotice,
  IconRules,
  IconSound,
  IconTrophy,
} from './Icons';
import { LuxurySlotsModal } from './LuxurySlotsModal';

interface Props {
  user: User | null;
  games: GameMeta[];
  onEnter: (game: GameMeta) => void;
  onQuickPlay: (game: GameMeta) => void;
  onLogin: () => void;
  onTasks: () => void;
  onFriends?: () => void;
  onLeaderboard: () => void;
  onProfile: () => void;
  onNotices: () => void;
  onMail?: () => void;
  onRules: () => void;
  botDifficulty: BotDifficulty;
  onChangeBotDifficulty: (difficulty: BotDifficulty) => void;
  onBalanceChange?: (newBalance: number) => void;
  onUserUpdate?: (patch: Partial<User>) => void;
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

/** 荷官与卡片 Hover 联动台词库 */
const GAME_DEALER_QUOTES: Record<string, string> = {
  gomoku: '“落子无悔，棋局变幻莫测～主人要来一盘五子棋切磋智谋吗？♟️”',
  xiangqi: '“楚河汉界，车马纵横！艾莉丝看好主人的神机妙算排兵布阵～🐎”',
  chess: '“六十四格西洋棋，黑白交锋王后争霸！期待主人的精妙绝杀～👑”',
  doudizhu: '“飞机！顺子！炸弹！今天主人是想当农民还是当地主呢？🃏”',
  paodekuai: '“手牌走得快，筹码赢得多！16张快节奏对抗超刺激的～⚡”',
  texas: '“All-in！看穿对手底牌，主人就是今晚叱咤风云的德州赌神！♠️”',
  goldenflower: '“闷抓看底，胆识与魄力的巅峰较量，快来试试主人今天的手气吧！🔥”',
  stud: '“一张底牌定乾坤，同花顺在向主人招手哦！🕶️”',
  tuizhuanzi: '“万人推筒子正热烈开奖中！主人快去压天门试试手气～🎲”',
  niuniu: '“极速三张算牛，单注押牛一至牛牛，高倍奖池火爆开奖！🐂✨”',
  blackjack: '“Blackjack 豪华双倍！艾莉丝亲手给主人发黑杰克～🎩”',
  dice: '“买定离手！大、小、全围豹子，听听骰盅清脆的声音吧～🎲”',
  baccarat: '“免佣庄闲博弈，长龙走势清晰，艾莉丝陪主人见证神路！💎”',
};

/** 热闹感动态在线/在玩数据 */
const LIVE_HEAT_MAP: Record<string, string> = {
  tuizhuanzi: '🎰 5,690 人同台',
  doudizhu: '🔥 4,320 人在线',
  niuniu: '🔥 3,850 人在玩',
  blackjack: '🎩 3,210 人在玩',
  paodekuai: '⚡ 2,780 人激战',
  baccarat: '💎 4,520 人在玩',
  dice: '🎲 2,930 人同台',
  texas: '♠️ 2,190 人激战',
  goldenflower: '🔥 1,980 人在玩',
  stud: '🕶️ 1,420 人在玩',
  xiangqi: '♟️ 1,650 局对弈',
  gomoku: '♟️ 1,320 局对弈',
  chess: '♟️ 860 局对弈',
};

/** 场次门槛与底分透明提示 */
const STAKES_MAP: Record<string, string> = {
  tuizhuanzi: '💰 单注 10 豆起 · 奖池火爆',
  niuniu: '💰 单注 10 豆起 · 最高 10 倍',
  blackjack: '💰 单注 10 豆起 · 双倍赔率',
  dice: '💰 单注 10 豆起 · 豹子 24 倍',
  baccarat: '💰 单注 10 豆起 · 免佣庄闲',
  doudizhu: '💰 底分 10 豆 · 准入 100 豆',
  paodekuai: '💰 底分 10 豆 · 准入 100 豆',
  texas: '💰 小盲 5 / 大盲 10 · 准入 200 豆',
  goldenflower: '💰 底分 10 豆 · 准入 100 豆',
  stud: '💰 底分 10 豆 · 准入 100 豆',
  gomoku: '💰 胜负 100 豆 · 准入 100 豆',
  xiangqi: '💰 胜负 100 豆 · 准入 100 豆',
  chess: '💰 胜负 100 豆 · 准入 100 豆',
};

export function Lobby({
  user,
  games,
  onEnter,
  onQuickPlay,
  onLogin,
  onTasks,
  onFriends: _onFriends,
  onLeaderboard,
  onProfile,
  onNotices,
  onMail,
  onRules,
  botDifficulty,
  onChangeBotDifficulty,
  onBalanceChange,
  onUserUpdate,
}: Props) {
  const [activeTab, setActiveTab] = useState<CategoryKey>('all');
  const [musicOn, setMusicOn] = useState(audio.musicOn);
  const [sfxOn, setSfxOn] = useState(audio.sfxOn);
  const [trackName, setTrackName] = useState(audio.trackName);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dealerHeart, setDealerHeart] = useState(false);
  const [customQuote, setCustomQuote] = useState<string | null>(null);
  const [hoveredGame, setHoveredGame] = useState<GameMeta | null>(null);
  const [showSlotsModal, setShowSlotsModal] = useState(false);
  const [showAvatarFrameModal, setShowAvatarFrameModal] = useState(false);
  const [showDealerWardrobe, setShowDealerWardrobe] = useState(false);

  // 卡片画卷平滑滚动控制
  const carouselRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  // 鼠标拖拽平滑滑动支持
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const scrollLeftRef = useRef(0);

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

  const hasVipMarquee = ticker.includes('【全服广播】') || ticker.includes('赌神');
  const lastGodChimeRef = useRef<string | null>(null);

  useEffect(() => {
    if (hasVipMarquee && announcements.length > 0) {
      const topAnnounce = announcements.find((a) => a.content.includes('【全服广播】'));
      if (topAnnounce && topAnnounce.id !== lastGodChimeRef.current) {
        lastGodChimeRef.current = topAnnounce.id;
        audio.play('god_login');
      }
    }
  }, [hasVipMarquee, announcements]);

  const activeVoice = useMemo(() => {
    const voiceId = user?.dealerVoice || 'classic';
    return DEALER_VOICES.find((v) => v.id === voiceId) || DEALER_VOICES[0]!;
  }, [user?.dealerVoice]);

  const filteredGames = useMemo(() => {
    if (activeTab === 'live') {
      return games.filter((g) => (LIVE_GAMES.has(g.gameId) || g.persistent) && g.gameId !== 'slots');
    }
    if (activeTab === 'cards') {
      return games.filter((g) => CARD_GAMES.has(g.gameId));
    }
    if (activeTab === 'chess') {
      return games.filter((g) => CHESS_GAMES.has(g.gameId));
    }
    return games;
  }, [games, activeTab]);

  // 九宫格分页状态：固定 3x3 (9 款游戏/页)
  const [gridPage, setGridPage] = useState(0);
  const NINE_GRID_SIZE = 9;

  useEffect(() => {
    setGridPage(0);
  }, [activeTab]);

  const totalGridPages = Math.ceil(filteredGames.length / NINE_GRID_SIZE) || 1;
  const currentGridPage = Math.min(gridPage, totalGridPages - 1);
  const pageGames = filteredGames.slice(
    currentGridPage * NINE_GRID_SIZE,
    (currentGridPage + 1) * NINE_GRID_SIZE,
  );

  const handlePrevGridPage = () => {
    audio.play('click');
    setGridPage((p) => Math.max(0, p - 1));
  };

  const handleNextGridPage = () => {
    audio.play('click');
    setGridPage((p) => Math.min(totalGridPages - 1, p + 1));
  };

  const handleGridWheel = (e: React.WheelEvent) => {
    if (totalGridPages <= 1) return;
    if (e.deltaY > 25 || e.deltaX > 25) {
      setGridPage((p) => Math.min(totalGridPages - 1, p + 1));
    } else if (e.deltaY < -25 || e.deltaX < -25) {
      setGridPage((p) => Math.max(0, p - 1));
    }
  };

  const handleDealerInteract = (e: React.MouseEvent) => {
    e.stopPropagation();
    audio.play('worship');
    setDealerHeart(true);
    window.setTimeout(() => setDealerHeart(false), 800);

    const quotes = activeVoice.quotes.touch;
    const nextQuote = quotes[Math.floor(Math.random() * quotes.length)]!;
    setCustomQuote(nextQuote);
    speakDealerQuote(nextQuote, activeVoice.id);
  };

  const handleRandomPlay = () => {
    audio.play('click');
    if (filteredGames.length > 0) {
      const idx = Math.floor(Math.random() * filteredGames.length);
      const picked = filteredGames[idx];
      if (picked) onQuickPlay(picked);
    }
  };

  // 动态荷官台词：Hover 联动 > 打赏/互动自定义 > 性格语音台词
  const dealerQuoteText = useMemo(() => {
    if (hoveredGame && GAME_DEALER_QUOTES[hoveredGame.gameId]) {
      return GAME_DEALER_QUOTES[hoveredGame.gameId]!;
    }
    if (customQuote) return customQuote;
    const idleQuotes = activeVoice.quotes.idle;
    if (activeTab === 'live') return '百人推筒子、骰宝正在火爆下注，主人要试试手气吗？🎰';
    if (activeTab === 'cards') return '经典斗地主秒匹秒开，多难度牌手陪练随叫随到，祝您把把通天顺！♠️';
    if (activeTab === 'chess') return '楚汉争霸楚河汉界，静候主人排兵布阵～♟️';
    return idleQuotes[0] || '尊贵的主人，艾莉丝已就绪，今天想挑战哪位牌王？💖';
  }, [hoveredGame, customQuote, activeTab, activeVoice]);

  const isLowBalance = user && user.balance < 100;
  const levelInfo = useMemo(
    () => computeLevelInfo(user?.level, user?.xp, user?.rewardedLevel),
    [user?.level, user?.xp, user?.rewardedLevel],
  );

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
            title={
              user
                ? `Lv.${levelInfo.level} · 经验 ${levelInfo.xpFormatted}/${levelInfo.requiredXpFormatted} · 点击查看个人中心`
                : '点击登录'
            }
          >
            <div className="app-avatar-wrapper">
              <AvatarWithFrame
                nickname={user ? user.nickname : '牌友'}
                avatar={user?.avatar}
                frameId={user?.equippedFrame || 'frame_default'}
                size={38}
              />
            </div>
            <div className="app-top__id">
              <div className="app-top__name-row">
                <span className="app-level-pill">Lv.{levelInfo.level}</span>
                <strong className="user-name-text" title={user ? user.nickname : '游客牌友'}>
                  {user ? user.nickname : '牌友_萌新'}
                </strong>
                {!user && <span className="login-pill">登录</span>}
                {user && levelInfo.claimableReward > 0 && (
                  <span className="level-reward-dot" title={`可领取 ${levelInfo.claimableReward.toLocaleString()} 升级筹码`}>
                    领奖
                  </span>
                )}
              </div>
              {user && (
                <div className="app-top__xp-bar" title={`升级进度 ${levelInfo.xpFormatted} / ${levelInfo.requiredXpFormatted}`}>
                  <div className="app-top__xp-track">
                    <div className="app-top__xp-fill" style={{ width: `${levelInfo.percent}%` }} />
                  </div>
                  <span className="app-top__xp-num">
                    {levelInfo.isMax ? 'MAX' : `${levelInfo.xpFormatted}/${levelInfo.requiredXpFormatted}`}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 筹码钱包：单行胶囊带加号 */}
          <div
            className="app-top__wallet"
            onClick={onTasks}
            role="button"
            tabIndex={0}
            title="筹码钱包 · 点击领取每日救济金与福利"
          >
            <div className="wallet-chip-icon">
              <Chip size={18} />
            </div>
            <div className="wallet-info-col">
              <span className="wallet-label">欢乐豆</span>
              <strong className="wallet-val">{user ? user.balance.toLocaleString() : '1,000'}</strong>
            </div>
            <span className="wallet-plus" title="领取救济金与签到">+</span>
          </div>

          {/* 破产救济金醒目引导徽章 */}
          {isLowBalance && (
            <div className="bankruptcy-protect-badge" onClick={onTasks} role="button" tabIndex={0}>
              <span className="protect-icon">🆘</span>
              <span>领 1,000 救济金</span>
            </div>
          )}
        </div>

        {/* 跑马灯公告条 */}
        <div
          className={`app-top__marquee ${hasVipMarquee ? 'has-vip-announcement' : ''}`}
          onClick={onNotices}
          role="button"
          tabIndex={0}
          title="点击查阅全部官方公告"
        >
          <span className="marquee-badge-gold">{hasVipMarquee ? '👑 全服' : '广播'}</span>
          <IconNotice size={14} />
          <div className="marquee-viewport">
            <span className="marquee-text">{ticker}</span>
          </div>
          <span className="marquee-arrow">›</span>
        </div>

        {/* 顶部右侧系统功能群 */}
        <div className="app-top__tools">
          <button type="button" className="top-feature-pill top-feature-pill--welfare" onClick={onTasks} title="福利每日任务与救济金">
            <IconGift size={15} />
            <span>福利</span>
            <span className="feature-dot feature-dot--pulse" />
            <span className="feature-bubble-hint">领救济金</span>
          </button>

          <button type="button" className="top-feature-pill" onClick={onLeaderboard} title="名人堂榜单">
            <IconTrophy size={15} />
            <span>榜单</span>
          </button>

          {onMail && (
            <button type="button" className="top-feature-pill" onClick={onMail} title="个人邮箱与福利信件">
              <IconMail size={15} />
              <span>信箱</span>
            </button>
          )}

          {/* 🎰 独立老虎机模块入口（紧随信箱后方） */}
          <button
            type="button"
            className="top-feature-pill top-feature-pill--slots"
            onClick={() => setShowSlotsModal(true)}
            title="进入拉斯维加斯疯狂老虎机"
          >
            <span className="slots-pill-icon">🎰</span>
            <span className="slots-pill-title">老虎机</span>
            <span className="slots-pill-badge">HOT</span>
          </button>

          {/* 🖼️ 头像框商城与更衣室 */}
          <button
            type="button"
            className="top-feature-pill"
            onClick={() => setShowAvatarFrameModal(true)}
            title="挑选佩戴20款尊享动态头像框"
          >
            <span className="frame-pill-icon">🖼️</span>
            <span>头像框</span>
          </button>

          <div className="bot-diff-switch top-diff-switch" title="选择机器人对战难度">
            <span className="bot-diff-switch__label">难度</span>
            {(['low', 'medium', 'high'] as const).map((d) => (
              <button
                key={d}
                type="button"
                className={`bot-diff-btn is-${d} ${botDifficulty === d ? 'is-active' : ''}`}
                onClick={() => onChangeBotDifficulty(d)}
              >
                {d === 'low' ? '低' : d === 'medium' ? '中' : '高'}
              </button>
            ))}
          </div>

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

        {/* 中间游戏展示九宫格 (3x3 矩阵，支持平滑翻页与分页指示器) */}
        <section className="commercial-games-carousel-wrapper commercial-nine-grid-wrapper" onWheel={handleGridWheel}>
          {/* 左翻页箭头 */}
          {totalGridPages > 1 && currentGridPage > 0 && (
            <button
              type="button"
              className="carousel-arrow-btn carousel-arrow-btn--left"
              onClick={handlePrevGridPage}
              title="上一页九宫格"
            >
              ‹
            </button>
          )}

          {/* 右翻页箭头 */}
          {totalGridPages > 1 && currentGridPage < totalGridPages - 1 && (
            <button
              type="button"
              className="carousel-arrow-btn carousel-arrow-btn--right"
              onClick={handleNextGridPage}
              title="下一页九宫格"
            >
              ›
            </button>
          )}

          <div className="commercial-nine-grid-container">
            <div className="commercial-nine-grid">
              {pageGames.map((game, index) => {
                const isLive = game.persistent === true || LIVE_GAMES.has(game.gameId);
                const artUrl = GAME_ART[game.gameId];
                const heatText = LIVE_HEAT_MAP[game.gameId] ?? (isLive ? '🎰 万人同台' : '🔥 火热开局');
                const stakesText = STAKES_MAP[game.gameId] ?? '💰 底分 10 豆 · 准入 100 豆';

                return (
                  <div
                    key={game.gameId}
                    className="commercial-game-card"
                    onMouseEnter={() => setHoveredGame(game)}
                    onMouseLeave={() => setHoveredGame(null)}
                  >
                    {/* 3D 质感海报画卷 */}
                    <div
                      className="commercial-game-card__poster"
                      onClick={() => onQuickPlay(game)}
                      role="button"
                      tabIndex={0}
                      title={`点击极速开玩 ${game.name}`}
                    >
                      {artUrl ? (
                        <img
                          src={artUrl}
                          alt={game.name}
                          draggable={false}
                          loading={index < 3 ? 'eager' : 'lazy'}
                          decoding="async"
                          width={480}
                          height={480}
                        />
                      ) : (
                        <div className="game-card-fallback-icon">{game.icon}</div>
                      )}

                      {/* 柔和底部过渡渐变遮罩 */}
                      <div className="poster-fade-overlay" />
                      <div className="poster-light-sweep" />

                      {/* 动态热闹感热度徽章 */}
                      <span className="game-live-heat-badge">
                        <span className="live-heat-dot" />
                        <span>{heatText}</span>
                      </span>

                      {/* 开局人数标签 */}
                      <span className="game-badge-tag">
                        {`${game.minPlayers}-${game.maxPlayers}人局`}
                      </span>
                    </div>

                    {/* 信息与双通道按钮群 */}
                    <div className="commercial-game-card__meta">
                      <div className="meta-text-col">
                        <h3 className="meta-title">{game.name}</h3>
                        <div className="card-entry-info">
                          <span className="entry-stakes-text">{stakesText}</span>
                          <span className="entry-speed-tag">极速秒配</span>
                        </div>
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
                          <span className="btn-bolt"><IconBolt /></span>
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

            {/* 九宫格多页分页指示器 */}
            {totalGridPages > 1 && (
              <div className="nine-grid-pagination-bar">
                <button
                  type="button"
                  className="grid-page-nav-btn"
                  onClick={handlePrevGridPage}
                  disabled={currentGridPage === 0}
                >
                  ‹ 上一页
                </button>
                <div className="grid-page-dots-wrap">
                  {Array.from({ length: totalGridPages }).map((_, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`grid-page-dot ${i === currentGridPage ? 'is-active' : ''}`}
                      onClick={() => {
                        audio.play('click');
                        setGridPage(i);
                      }}
                      title={`第 ${i + 1} 页`}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="grid-page-nav-btn"
                  onClick={handleNextGridPage}
                  disabled={currentGridPage >= totalGridPages - 1}
                >
                  下一页 ›
                </button>
                <span className="grid-page-num-indicator">
                  第 {currentGridPage + 1} / {totalGridPages} 页 (九宫格)
                </span>
              </div>
            )}
          </div>
        </section>

        {/* 右侧：首席动漫美女荷官艾莉丝陪玩展台 */}
        <aside className="commercial-dealer-companion-stand">
          {/* 对话气泡 (支持鼠标悬停卡片动态联动) */}
          <div
            className={`companion-speech-bubble ${hoveredGame ? 'is-hover-active' : ''}`}
            onClick={handleDealerInteract}
            title="点击与荷官艾莉丝互动"
          >
            <div className="bubble-header">
              <span className="companion-name">首席荷官 · 艾莉丝</span>
              <span className="companion-dot" />
              {dealerHeart && <span className="dealer-heart-float">💖</span>}
            </div>
            <p className="bubble-content">{dealerQuoteText}</p>
          </div>

          {/* 荷官精美半身立绘 */}
          <div className="companion-portrait-wrapper" onClick={handleDealerInteract}>
            <img
              src={DEALER_SKINS_ASSETS[user?.dealerSkin || 'classic'] || DEALER_MAIN}
              alt="首席荷官艾莉丝"
              draggable={false}
              loading="lazy"
              decoding="async"
            />
            <div className="portrait-glow-halo" />
          </div>

          {/* 快捷行动按键：随机幸运开局 + 打赏荷官 + 换装 */}
          <div className="companion-footer-actions">
            <button type="button" className="btn-random-match" onClick={handleRandomPlay}>
              <span>🎲 随机幸运开局</span>
            </button>
            <div className="companion-sub-actions-row">
              <button
                type="button"
                className="btn-dealer-wardrobe"
                onClick={() => setShowDealerWardrobe(true)}
                title="荷官更衣室与自定义台词性格"
              >
                <span>👗 换装 & 语音</span>
              </button>
              <DealerTipWidget
                balance={user?.balance ?? 0}
                onBalanceChange={onBalanceChange ?? (() => {})}
                onAffectionChange={(newAffection) => onUserUpdate?.({ dealerAffection: newAffection })}
                onAliceSpeak={(txt) => {
                  setCustomQuote(txt);
                  speakDealerQuote(txt, activeVoice.id);
                }}
              />
            </div>
          </div>
        </aside>
      </main>

      {/* 弹窗组件群 */}
      {showSlotsModal && user && (
        <LuxurySlotsModal
          user={user}
          onBalanceChange={(newBal) => {
            if (onBalanceChange) onBalanceChange(newBal);
          }}
          onClose={() => setShowSlotsModal(false)}
        />
      )}

      {showAvatarFrameModal && user && (
        <AvatarFrameModal
          user={user}
          onUserUpdate={(patch) => {
            if (onUserUpdate) onUserUpdate(patch);
            if (patch.balance !== undefined && onBalanceChange) {
              onBalanceChange(patch.balance);
            }
          }}
          onClose={() => setShowAvatarFrameModal(false)}
        />
      )}

      {showDealerWardrobe && user && (
        <DealerWardrobeModal
          user={user}
          onUserUpdate={(patch) => {
            if (onUserUpdate) onUserUpdate(patch);
          }}
          onClose={() => setShowDealerWardrobe(false)}
        />
      )}
    </div>
  );
}
