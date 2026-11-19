function IconBolt() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="btn-bolt-svg" aria-hidden="true">
      <path d="M13 2L3 14h8l-2 8 11-12h-8l1-8z" />
    </svg>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { computeLevelInfo, DEALER_VOICES, type Announcement, type GameMeta } from '@cc/protocol';
import { api, fantasyClawOAuthStartUrl, type GameCategoryDef, type User } from '../api';
import { audio } from '../audio';
import { speakDealerQuote } from '../speech';
import { DEALER_MAIN, DEALER_SKINS_ASSETS, HERO_BG } from '../assets';
import { gameStatusBadge, isGameJoinable, gameUnavailableToast } from '../gameAvailability';
import {
  DEFAULT_GAME_CATEGORY_MAP,
  GAME_ART,
  GAME_DEALER_QUOTES,
  LIVE_HEAT_MAP,
  STAKES_MAP,
} from '../game-registry';
import { AvatarFrameModal } from './AvatarFrameModal';
import { AvatarWithFrame } from './AvatarWithFrame';
import { Chip } from './Chip';
import { DealerTipWidget } from './DealerTipWidget';
import { DealerWardrobeModal } from './DealerWardrobeModal';
import { FeedbackModal } from './FeedbackModal';
import {
  IconFriends,
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
  onRegister?: () => void;
  onTasks: () => void;
  onFriends?: () => void;
  onLeaderboard: () => void;
  onProfile: () => void;
  onNotices: () => void;
  onMail?: () => void;
  onRules: () => void;
  onBalanceChange?: (newBalance: number) => void;
  onUserUpdate?: (patch: Partial<User>) => void;
}

const DEFAULT_TABS: GameCategoryDef[] = [
  { key: 'all', label: '全部热门', icon: '🔥', sortOrder: 0 },
  { key: 'live', label: '百人竞技', icon: '🎰', badge: '火爆', sortOrder: 1 },
  { key: 'cards', label: '经典扑克', icon: '♠️', sortOrder: 2 },
  { key: 'mahjong', label: '雀神麻将', icon: '🀄', badge: '热门', sortOrder: 3 },
  { key: 'chess', label: '智谋对弈', icon: '♟️', sortOrder: 4 },
];

export function Lobby({
  user,
  games,
  onEnter,
  onQuickPlay,
  onLogin,
  onRegister,
  onTasks,
  onFriends,
  onLeaderboard,
  onProfile,
  onNotices,
  onMail,
  onRules,
  onBalanceChange,
  onUserUpdate,
}: Props) {
  const [activeTab, setActiveTab] = useState<string>('all');
  const [categories, setCategories] = useState<GameCategoryDef[]>(DEFAULT_TABS);
  const [gameCategoryMap, setGameCategoryMap] = useState<Record<string, string>>(DEFAULT_GAME_CATEGORY_MAP);
  const [musicOn, setMusicOn] = useState(audio.musicOn);
  const [sfxOn, setSfxOn] = useState(audio.sfxOn);
  const [trackName, setTrackName] = useState(audio.trackName);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const marqueeViewportRef = useRef<HTMLDivElement | null>(null);
  const marqueeSegmentRef = useRef<HTMLSpanElement | null>(null);
  const [marqueeDurationSec, setMarqueeDurationSec] = useState<number>(28);
  const [marqueeMinWidth, setMarqueeMinWidth] = useState<number>(360);
  const [dealerHeart, setDealerHeart] = useState(false);
  const [customQuote, setCustomQuote] = useState<string | null>(null);
  const [hoveredGame, setHoveredGame] = useState<GameMeta | null>(null);
  const [showSlotsModal, setShowSlotsModal] = useState(false);
  const [showAvatarFrameModal, setShowAvatarFrameModal] = useState(false);
  const [showDealerWardrobe, setShowDealerWardrobe] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [pendingFriendRequests, setPendingFriendRequests] = useState(0);
  const [mailAlertCount, setMailAlertCount] = useState(0);
  const [ticketUnreadCount, setTicketUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setPendingFriendRequests(0);
      setMailAlertCount(0);
      setTicketUnreadCount(0);
      return;
    }
    let alive = true;
    const loadTopBadges = () => {
      void api
        .friends()
        .then((data) => {
          if (alive) setPendingFriendRequests(data.incoming?.length ?? 0);
        })
        .catch(() => undefined);
      void api
        .listMails()
        .then((data) => {
          if (!alive) return;
          const mails = data.mails ?? [];
          const actionable = mails.filter((m) => !m.isRead || (m.rewardCoins > 0 && !m.isClaimed)).length;
          setMailAlertCount(actionable);
        })
        .catch(() => undefined);
      void api
        .listTickets()
        .then((data) => {
          if (alive) setTicketUnreadCount(data.unreadCount ?? 0);
        })
        .catch(() => undefined);
    };
    loadTopBadges();
    const timer = window.setInterval(loadTopBadges, 15_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [user?.id]);

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
        .then((data) => {
          const next = data.announcements ?? [];
          setAnnouncements((prev) => {
            if (
              prev.length === next.length &&
              prev.every(
                (p, i) =>
                  p.id === next[i]?.id &&
                  p.title === next[i]?.title &&
                  p.content === next[i]?.content,
              )
            ) {
              return prev;
            }
            return next;
          });
        })
        .catch(() => undefined);
    };
    const loadCategories = () => {
      void api
        .gameCategories()
        .then((cfg) => {
          if (Array.isArray(cfg.categories) && cfg.categories.length > 0) {
            setCategories(cfg.categories);
          }
          if (cfg.gameCategoryMap && typeof cfg.gameCategoryMap === 'object') {
            setGameCategoryMap(cfg.gameCategoryMap);
          }
        })
        .catch(() => undefined);
    };
    load();
    loadCategories();
    const timer = window.setInterval(() => {
      load();
      loadCategories();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const ticker = useMemo(() => {
    if (announcements.length > 0) {
      return announcements
        .map((item) => {
          const title = (item.title ?? '').replace(/\s+/g, ' ').trim();
          const content = (item.content ?? '').replace(/\s+/g, ' ').trim();
          return title ? `${title}：${content}` : content;
        })
        .filter(Boolean)
        .join('　　✦　　');
    }
    return '尊贵牌友欢迎光临，绿色公平竞技环境，虚拟筹码畅享顶级棋牌乐趣！';
  }, [announcements]);

  // 按实际像素宽度动态计算跑马灯周期，恒定舒适阅读速度（约 34px/秒），绝不因文字长短而过快或留白
  useEffect(() => {
    const measure = () => {
      const vpW = marqueeViewportRef.current?.clientWidth ?? 360;
      setMarqueeMinWidth(Math.max(220, vpW));
      const segW = marqueeSegmentRef.current?.scrollWidth ?? 0;
      const effectiveW = Math.max(segW, vpW);
      const PX_PER_SEC = 34;
      setMarqueeDurationSec(Math.max(18, Math.round((effectiveW / PX_PER_SEC) * 10) / 10));
    };
    const raf = window.requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [ticker]);

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
    // 大厅九宫格不展示独立顶部入口的老虎机
    const visibleGames = games.filter((g) => g.gameId !== 'slots');
    if (activeTab === 'all') {
      return visibleGames;
    }
    return visibleGames.filter((g) => {
      const mapped = gameCategoryMap[g.gameId];
      if (mapped) return mapped === activeTab;
      if (activeTab === 'live') return Boolean(g.persistent);
      return g.category === activeTab;
    });
  }, [games, activeTab, gameCategoryMap]);

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
    const joinable = filteredGames.filter((g) => isGameJoinable(g));
    if (joinable.length > 0) {
      const idx = Math.floor(Math.random() * joinable.length);
      const picked = joinable[idx];
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
    if (activeTab === 'cards') return '经典斗地主秒匹秒开，顶级智能牌手陪练随叫随到，祝您把把通天顺！♠️';
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
                {user ? (
                  <>
                    <span className="app-level-pill">Lv.{levelInfo.level}</span>
                    <strong className="user-name-text" title={user.nickname}>
                      {user.nickname}
                    </strong>
                    {levelInfo.claimableReward > 0 && (
                      <span
                        className="level-reward-dot"
                        title={`可领取 ${levelInfo.claimableReward.toLocaleString()} 升级筹码`}
                      >
                        领奖
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <strong className="user-name-text" title="请登录或创建账号">
                      未登录
                    </strong>
                    <span className="login-pill">登录 / 注册</span>
                  </>
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
            onClick={() => (user ? onTasks() : onLogin())}
            role="button"
            tabIndex={0}
            title={user ? '筹码钱包 · 点击领取每日救济金与福利' : '登录后即可领取初始筹码与每日福利'}
          >
            <div className="wallet-chip-icon">
              <Chip size={18} />
            </div>
            <div className="wallet-info-col">
              <span className="wallet-label">欢乐豆</span>
              <strong className="wallet-val">{user ? user.balance.toLocaleString() : '登录后领取'}</strong>
            </div>
            <span className="wallet-plus" title={user ? '领取救济金与签到' : '登录注册'}>+</span>
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
          title="悬停可暂停阅读 · 点击查阅全部官方公告"
        >
          <span className="marquee-badge-gold">{hasVipMarquee ? '👑 全服' : '广播'}</span>
          <span className="marquee-icon-wrap" aria-hidden="true">
            <IconNotice size={14} />
          </span>
          <div className="marquee-viewport" ref={marqueeViewportRef}>
            <div
              className="marquee-track"
              style={{
                animationDuration: `${marqueeDurationSec}s`,
                ['--marquee-min-w' as string]: `${marqueeMinWidth}px`,
              }}
            >
              <span className="marquee-segment" ref={marqueeSegmentRef}>
                {ticker}
              </span>
              <span className="marquee-segment" aria-hidden="true">
                {ticker}
              </span>
            </div>
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
            <button
              type="button"
              className="top-feature-pill top-feature-pill--mail"
              onClick={onMail}
              title={mailAlertCount > 0 ? `您有 ${mailAlertCount} 封未读或待领筹码的邮件` : '个人邮箱与福利信件'}
            >
              <IconMail size={15} />
              <span>信箱</span>
              {mailAlertCount > 0 && <span className="feature-dot feature-dot--pulse" />}
            </button>
          )}

          {onFriends && (
            <button type="button" className="top-feature-pill" onClick={onFriends} title="好友与牌局邀请">
              <IconFriends size={15} />
              <span>好友</span>
              {pendingFriendRequests > 0 && <span className="feature-dot feature-dot--pulse" />}
            </button>
          )}

          {/* 🎰 独立老虎机模块入口 */}
          <button
            type="button"
            className="top-feature-pill top-feature-pill--slots"
            onClick={() => (user ? setShowSlotsModal(true) : onLogin())}
            title={user ? '进入拉斯维加斯疯狂老虎机' : '请先登录或注册账号'}
          >
            <span className="slots-pill-icon">🎰</span>
            <span className="slots-pill-title">老虎机</span>
            <span className="slots-pill-badge">HOT</span>
          </button>

          {/* 🖼️ 头像框商城与更衣室 */}
          <button
            type="button"
            className="top-feature-pill"
            onClick={() => (user ? setShowAvatarFrameModal(true) : onLogin())}
            title={user ? '挑选佩戴30款尊享动态头像框' : '请先登录或注册账号'}
          >
            <span className="frame-pill-icon">🖼️</span>
            <span>头像框</span>
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
            <button
              type="button"
              className="media-icon-btn media-icon-btn--feedback"
              title={user ? '问题反馈 / 查看工单进度' : '问题反馈（请先登录）'}
              aria-label="问题反馈"
              onClick={() => {
                audio.play('click');
                if (user) setShowFeedbackModal(true);
                else onLogin();
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <path d="M12 8v3" />
                <path d="M12 14h.01" />
              </svg>
              {ticketUnreadCount > 0 && (
                <span className="feedback-btn-badge">{ticketUnreadCount > 9 ? '9+' : ticketUnreadCount}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* 未登录引导横幅：不再自动静默创建游客号，指引玩家注册账号或使用奇幻维度账号一键登录 */}
      {!user && (
        <div className="guest-auth-banner" role="region" aria-label="登录引导">
          <div className="guest-auth-banner__text">
            <span className="guest-auth-banner__badge">👋 欢迎光临</span>
            <strong>当前为未登录浏览模式，请登录或创建专属账号以保存筹码、等级与战绩（一个邮箱限建一个账号）</strong>
          </div>
          <div className="guest-auth-banner__actions">
            <button
              type="button"
              className="btn-guest-oauth"
              onClick={() => {
                audio.play('click');
                window.location.href = fantasyClawOAuthStartUrl();
              }}
            >
              🌌 奇幻维度登录
            </button>
            <button
              type="button"
              className="btn-guest-login"
              onClick={() => {
                audio.play('click');
                onLogin();
              }}
            >
              立即登录
            </button>
            <button
              type="button"
              className="btn-guest-register"
              onClick={() => {
                audio.play('click');
                (onRegister ?? onLogin)();
              }}
            >
              ✨ 创建账号
            </button>
          </div>
        </div>
      )}

      {/* ================= 2. 商业级大厅主视口 (满幅展开，零上下黑边) ================= */}
      <main className="commercial-lobby-stage">
        {/* 左侧专区快捷选项卡（支持 GM 端动态配置分类） */}
        <nav className="commercial-nav-rail">
          {categories.map((tab) => {
            const active = activeTab === tab.key;
            const dynamicBadge =
              tab.key === 'all' && !tab.badge
                ? `${games.filter((g) => g.gameId !== 'slots').length}款`
                : tab.badge;
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
                {dynamicBadge && <span className="nav-rail-badge">{dynamicBadge}</span>}
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
                const isLive = game.persistent === true || gameCategoryMap[game.gameId] === 'live';
                const artUrl = GAME_ART[game.gameId];
                const heatText = LIVE_HEAT_MAP[game.gameId] ?? (isLive ? '🎰 万人同台' : '🔥 火热开局');
                const stakesText = STAKES_MAP[game.gameId] ?? '💰 底分 10 豆 · 准入 100 豆';
                const joinable = isGameJoinable(game);
                const maintBadge = gameStatusBadge(game);

                return (
                  <div
                    key={game.gameId}
                    className={`commercial-game-card ${joinable ? '' : 'is-game-maint'}`.trim()}
                    onMouseEnter={() => setHoveredGame(game)}
                    onMouseLeave={() => setHoveredGame(null)}
                  >
                    {/* 3D 质感海报画卷 */}
                    <div
                      className="commercial-game-card__poster"
                      onClick={() => {
                        if (!joinable) {
                          audio.play('alert');
                          return;
                        }
                        onQuickPlay(game);
                      }}
                      role="button"
                      tabIndex={0}
                      title={
                        joinable
                          ? `点击极速开玩 ${game.name}`
                          : gameUnavailableToast(game)
                      }
                      aria-disabled={!joinable}
                    >
                      {artUrl ? (
                        <img
                          src={artUrl}
                          alt={game.name}
                          draggable={false}
                          loading={index < 3 ? 'eager' : 'lazy'}
                          decoding="async"
                          fetchPriority={index < 2 ? 'high' : 'auto'}
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
                        {game.minPlayers === game.maxPlayers
                          ? `${game.minPlayers}人局`
                          : `${game.minPlayers}-${game.maxPlayers}人局`}
                      </span>

                      {maintBadge && (
                        <span className="game-maint-badge" role="status">
                          {maintBadge}
                        </span>
                      )}
                    </div>

                    {/* 信息与双通道按钮群 */}
                    <div className="commercial-game-card__meta">
                      <div className="meta-text-col">
                        <h3 className="meta-title">{game.name}</h3>
                        <div className="card-entry-info">
                          <span className="entry-stakes-text">
                            {joinable ? stakesText : maintBadge || '维护中'}
                          </span>
                          <span className="entry-speed-tag">{joinable ? '极速秒配' : '暂停开放'}</span>
                        </div>
                      </div>

                      <div className="meta-actions-row">
                        {/* 核心高转化：暖金极速开局大按钮 */}
                        <button
                          type="button"
                          className="btn-quick-play-gold"
                          disabled={!joinable}
                          onClick={(e) => {
                            e.stopPropagation();
                            audio.play(joinable ? 'click' : 'alert');
                            if (joinable) onQuickPlay(game);
                          }}
                        >
                          <span className="btn-bolt"><IconBolt /></span>
                          <span>{joinable ? '极速开局' : '维护中'}</span>
                        </button>

                        {/* 次级入口：选房入座 */}
                        <button
                          type="button"
                          className="btn-choose-room-subtle"
                          disabled={!joinable}
                          onClick={(e) => {
                            e.stopPropagation();
                            audio.play(joinable ? 'click' : 'alert');
                            if (joinable) onEnter(game);
                          }}
                          title={joinable ? '查看桌台列表或自建房间' : gameUnavailableToast(game)}
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
                onClick={() => (user ? setShowDealerWardrobe(true) : onLogin())}
                title={user ? '荷官更衣室与自定义台词性格' : '请先登录或注册账号'}
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
          onUserUpdate={(patch) => {
            if (onUserUpdate) onUserUpdate(patch);
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

      {showFeedbackModal && user && (
        <FeedbackModal
          user={user}
          onUnreadChange={setTicketUnreadCount}
          onClose={() => setShowFeedbackModal(false)}
        />
      )}
    </div>
  );
}
