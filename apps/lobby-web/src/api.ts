import type {
  Announcement,
  GameMeta,
  KlinePeriod,
  StakesTier,
  StockHolding,
  StockKlineItem,
  StockLeaderboardEntry,
  StockMeta,
  StockOrder,
  StockQuote,
  StockTradeResult,
  StockTrendPoint,
} from '@cc/protocol';

export interface User {
  id: string;
  nickname: string;
  username: string | null;
  balance: number;
  email?: string | null;
  invitedBy?: string | null;
  oauthProvider?: string | null;
  oauthSub?: string | null;
  createdAt?: number;
  avatar?: string | null;
  equippedFrame?: string;
  worshipCount?: number;
  dealerSkin?: string;
  dealerVoice?: string;
  dealerAffection?: number;
  level?: number;
  xp?: string;
  rewardedLevel?: number;
  totalTurnover?: string;
}

export interface Captcha {
  id: string;
  svg: string;
  expiresIn: number;
}

export interface TaskView {
  key: string;
  name: string;
  description: string;
  target: number;
  reward: number;
  period: 'daily' | 'once';
  group: 'daily' | 'growth';
  progress: number;
  claimed: boolean;
  claimable: boolean;
  locked: boolean;
  lockReason?: string;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  nickname: string;
  balance: number;
  title: string;
  reward: number;
  worshipCount?: number;
  equippedFrame?: string;
  avatar?: string | null;
}

export interface LevelLeaderboardEntry {
  rank: number;
  userId: string;
  nickname: string;
  level: number;
  xp: string;
  totalTurnover: string;
  balance: number;
  levelTitle: string;
  worshipCount?: number;
  equippedFrame?: string;
  avatar?: string | null;
}

/** 每日 0 点结算的排行榜快照 */
export interface LeaderboardRewardRow {
  userId: string;
  nickname: string;
  rank: number;
  balance: number;
  reward: number;
}

const TOKEN_KEY = 'cc.token';

/** 站点部署在子路径（/lobby/），所有接口都带此前缀 */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, '');

/** 奇幻维度 OAuth 2.0 授权登录入口 */
export function fantasyClawOAuthStartUrl(): string {
  return `${BASE_PATH}/api/auth/oauth/fantasyclaw/start`;
}

/** 将后端返回的 `/api/avatar/...` 路径补全站点前缀，兼容本地 data URL 预览 */
export function resolveAvatarUrl(avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  if (avatar.startsWith('/api/')) return `${BASE_PATH}${avatar}`;
  return avatar;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${BASE_PATH}${path}`, { ...init, headers });
  } catch {
    if (typeof window !== 'undefined' && !path.startsWith('/api/system/status')) {
      window.dispatchEvent(
        new CustomEvent('cc:maintenance', {
          detail: {
            mode: 'updating',
            message: '平台正在紧急更新中，请耐心等待，更新完成后将自动补偿每位玩家 1,000 欢乐豆！',
            compensationCoins: 1000,
          },
        }),
      );
    }
    throw new Error('平台正在紧急更新中，请耐心等待…');
  }

  const text = await res.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }
  if (!res.ok) {
    // 502 / 503 / 504 或后端显式维护标记：通知全局切换到友好更新中页面，绝不露出 502
    if (res.status === 502 || res.status === 503 || res.status === 504 || body.maintenance === true) {
      if (typeof window !== 'undefined' && !path.startsWith('/api/system/status')) {
        window.dispatchEvent(
          new CustomEvent('cc:maintenance', {
            detail: {
              mode: body.mode === 'draining' ? 'draining' : 'updating',
              message:
                typeof body.error === 'string'
                  ? body.error
                  : '平台正在紧急更新中，请耐心等待（更新完成后自动补偿 1,000 欢乐豆）',
              compensationCoins: Number(body.compensationCoins ?? 1000) || 1000,
            },
          }),
        );
      }
    }
    // 令牌过期或失效时立刻清掉，避免每次启动都拿废 token 请求一遍
    if (res.status === 401) setToken(null);
    throw new Error(typeof body.error === 'string' ? body.error : `请求失败 (${res.status})`);
  }
  return body as T;
}

export interface SystemStatusResponse {
  ok?: boolean;
  mode: 'normal' | 'draining' | 'updating';
  message: string;
  compensationCoins: number;
  activeHumanGames: number;
  startedAt?: number | null;
  lastCompletedVersion?: string | null;
  lastCompletedAt?: number | null;
}

export const api = {
  systemStatus: async (): Promise<SystemStatusResponse> => {
    const res = await fetch(`${BASE_PATH}/api/system/status?t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      return {
        mode: 'updating',
        message: '平台正在紧急更新中，请耐心等待（更新完成后自动补偿 1,000 欢乐豆）',
        compensationCoins: 1000,
        activeHumanGames: 0,
      };
    }
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
    return (await res.json()) as SystemStatusResponse;
  },
  captcha: () => request<Captcha>('/api/captcha'),
  guest: () => request<{ token: string; user: User }>('/api/guest', { method: 'POST', body: '{}' }),

  login: (username: string, password: string, captchaId: string, captcha: string) =>
    request<{ token: string; user: User }>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, captchaId, captcha }),
    }),

  register: (
    username: string,
    password: string,
    nickname: string,
    captchaId: string,
    captcha: string,
    email: string,
    inviteCode?: string,
  ) =>
    request<{ token: string; user: User }>('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, nickname, captchaId, captcha, email, inviteCode }),
    }),

  oauthProviders: () =>
    request<{
      fantasyclaw: { enabled: boolean; name: string; baseUrl: string; callbackUrl: string };
    }>('/api/auth/oauth/providers'),

  bindFantasyClawUrl: () =>
    request<{ ok: boolean; url: string }>('/api/auth/oauth/fantasyclaw/bind-url', {
      method: 'POST',
      body: '{}',
    }),

  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    }),

  updateEmail: (email: string) =>
    request<{ ok: boolean; email: string; message: string }>('/api/auth/update-email', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  sendResetCode: (account: string, captchaId: string, captcha: string) =>
    request<{ ok: boolean; message: string; devCode?: string }>('/api/auth/send-reset-code', {
      method: 'POST',
      body: JSON.stringify({ account, captchaId, captcha }),
    }),

  resetPassword: (account: string, code: string, newPassword: string) =>
    request<{ ok: boolean; message: string }>('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ account, code, newPassword }),
    }),

  me: () => request<{ user: User }>('/api/me'),
  games: () => request<{ games: GameMeta[] }>('/api/games'),
  gamesSummary: () =>
    request<{
      summary: Record<string, { rooms: number; humans: number; bots: number; spectators: number }>;
    }>('/api/games/summary'),
  gameCategories: () => request<GameCategoriesConfig>('/api/game-categories'),
  records: () => request<{ records: unknown[] }>('/api/records?limit=20'),

  tasks: () => request<{ balance: number; tasks: TaskView[] }>('/api/tasks'),
  tipDealer: (amount: number, giftName?: string, quantity = 1) =>
    request<{ ok: boolean; balance: number; amount: number; giftName: string; quantity: number; affection: number }>(
      '/api/tip-dealer',
      {
        method: 'POST',
        body: JSON.stringify({ amount, giftName, quantity }),
      },
    ),
  claimTask: (key: string) =>
    request<{ reward: number; balance: number; tasks: TaskView[] }>('/api/tasks/claim', {
      method: 'POST',
      body: JSON.stringify({ key }),
    }),

  announcements: () =>
    request<{ announcements: Announcement[] }>('/api/announcements'),

  adminCreateAnnouncement: (
    token: string,
    input: { title: string; content: string; kind: Announcement['kind'] },
  ) =>
    request<{ announcement: Announcement }>('/api/admin/announcements', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(input),
    }),

  adminDeleteAnnouncement: (token: string, id: string) =>
    request<{ ok: boolean }>(`/api/admin/announcements/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${token}` },
    }),

  rooms: (gameId: string) =>
    request<{
      rooms: Array<{
        roomId: string;
        gameId: string;
        roomName: string;
        hostId: string | null;
        hostName: string;
        players: number;
        maxPlayers: number;
        status: 'waiting' | 'playing' | 'settled';
        persistent: boolean;
        botHosted?: boolean;
        spectators?: number;
        joinable: boolean;
        recent: Array<{ round: number; text: string; tone: 'red' | 'blue' | 'green' | 'neutral' }>;
        stakesTier?: StakesTier;
        stakeMultiplier?: number;
      }>;
    }>(`/api/rooms?gameId=${encodeURIComponent(gameId)}`),

  dailyWinners: (limit = 10) =>
    request<{
      dayKey: string;
      entries: Array<{ userId: string; nickname: string; net: number; rounds: number }>;
    }>(`/api/leaderboard/daily?limit=${limit}`),

  leaderboard: () =>
    request<{
      entries: LeaderboardEntry[];
      myRank: number | null;
      myUserId: string | null;
      remainingWorshipsToday: number;
    }>('/api/leaderboard'),

  levelLeaderboard: () =>
    request<{
      entries: LevelLeaderboardEntry[];
      myRank: number | null;
      myUserId: string | null;
      remainingWorshipsToday: number;
    }>('/api/leaderboard/level'),

  worshipUser: (userId: string) =>
    request<{
      ok: boolean;
      remainingToday: number;
      newWorshipCount: number;
      reward: number;
      message?: string;
    }>(`/api/leaderboard/${encodeURIComponent(userId)}/worship`, { method: 'POST', body: '{}' }),

  avatarFramesCatalog: () =>
    request<{
      frames: import('@cc/protocol').AvatarFrameMeta[];
      equippedFrame: string;
      ownedFrames: string[];
      worshipCount: number;
    }>('/api/avatar-frames/catalog'),

  buyAvatarFrame: (frameId: string) =>
    request<{
      ok: boolean;
      balance: number;
      equippedFrame: string;
      ownedFrames: string[];
    }>('/api/avatar-frames/buy', {
      method: 'POST',
      body: JSON.stringify({ frameId }),
    }),

  equipAvatarFrame: (frameId: string) =>
    request<{ ok: boolean; equippedFrame: string }>('/api/avatar-frames/equip', {
      method: 'POST',
      body: JSON.stringify({ frameId }),
    }),

  customizeDealer: (skin: string, voice: string) =>
    request<{ ok: boolean; dealerSkin: string; dealerVoice: string }>('/api/dealer/customize', {
      method: 'POST',
      body: JSON.stringify({ skin, voice }),
    }),

  claimLevelReward: () =>
    request<{
      ok: boolean;
      claimedLevels: number;
      reward: number;
      balance: number;
      level: number;
      rewardedLevel: number;
    }>('/api/level/claim', { method: 'POST', body: '{}' }),

  spinSlots: (betPerLine: number, lines: number) =>
    request<SlotsSpinResponse>('/api/slots/spin', {
      method: 'POST',
      body: JSON.stringify({ betPerLine, lines }),
    }),

  leaderboardRewards: () =>
    request<{ dayKey: string; entries: LeaderboardRewardRow[] }>('/api/leaderboard/rewards'),

  // ---------- 个人资料与好友 ----------
  profile: () =>
    request<{
      profile: PlayerProfile;
      balance: number;
      friendsCount: number;
      rank: number | null;
      achievements: number;
      email?: string | null;
      oauthProvider?: string | null;
      oauthSub?: string | null;
    }>('/api/profile'),

  profileStats: () => request<ProfileStatsView>('/api/profile/stats'),

  playerCard: (userId: string) => request<PlayerCardView>(`/api/users/${encodeURIComponent(userId)}/card`),

  updateProfile: (patch: { nickname?: string; bio?: string; avatar?: string | null }) =>
    request<{ profile: PlayerProfile }>('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  uploadAvatar: (avatar: string | null) =>
    request<{ ok: boolean; profile: PlayerProfile }>('/api/profile/avatar', {
      method: 'POST',
      body: JSON.stringify({ avatar }),
    }),

  searchUsers: (keyword: string) =>
    request<{ users: PlayerProfile[] }>(`/api/users/search?q=${encodeURIComponent(keyword)}`),

  friends: () =>
    request<{
      friends: PlayerProfile[];
      incoming: FriendRequestView[];
      outgoing: FriendRequestView[];
    }>('/api/friends'),

  requestFriend: (userId: string, message?: string) =>
    request<{ ok: boolean; request: FriendRequestView }>('/api/friends/request', {
      method: 'POST',
      body: JSON.stringify({ userId, message }),
    }),

  acceptFriend: (requestId: string) =>
    request<{ ok: boolean; friends: PlayerProfile[] }>('/api/friends/accept', {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }),

  rejectFriend: (requestId: string) =>
    request<{ ok: boolean }>('/api/friends/reject', {
      method: 'POST',
      body: JSON.stringify({ requestId }),
    }),

  removeFriend: (userId: string) =>
    request<{ ok: boolean }>(`/api/friends/${encodeURIComponent(userId)}`, { method: 'DELETE' }),

  // ---------- 房间邀请 ----------
  inviteToRoom: (input: { roomId: string; gameId: string; roomName?: string; friendIds: string[] }) =>
    request<{ ok: boolean; sent: number }>('/api/rooms/invite', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  roomInvites: () => request<{ invites: RoomInviteView[] }>('/api/rooms/invites'),

  dismissInvite: (id: string) =>
    request<{ ok: boolean }>(`/api/rooms/invites/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ---------- 邮箱系统 ----------
  listMails: () =>
    request<{ mails: PlayerMailView[]; unreadCount: number; unclaimedCount?: number }>('/api/mail'),
  readMail: (id: string) =>
    request<{ ok: boolean }>(`/api/mail/${encodeURIComponent(id)}/read`, {
      method: 'POST',
      body: '{}',
    }),
  claimMail: (id: string) =>
    request<{ ok: boolean; rewardCoins: number; balance: number }>(`/api/mail/${encodeURIComponent(id)}/claim`, {
      method: 'POST',
      body: '{}',
    }),
  deleteMail: (id: string) =>
    request<{ ok: boolean }>(`/api/mail/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // ---------- 问题反馈工单系统 ----------
  listTickets: () =>
    request<{ tickets: FeedbackTicket[]; unreadCount: number }>('/api/tickets'),
  ticketDetail: (id: string) =>
    request<{ ticket: FeedbackTicket }>(`/api/tickets/${encodeURIComponent(id)}`),
  createTicket: (input: {
    category: TicketCategory;
    priority: TicketPriority;
    title: string;
    content: string;
    contact?: string;
    attachment?: string | null;
    clientInfo?: string;
  }) =>
    request<{ ok: boolean; ticket: FeedbackTicket }>('/api/tickets', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  replyTicket: (id: string, content: string) =>
    request<{ ok: boolean; reply: FeedbackTicketReply; ticket: FeedbackTicket | null }>(
      `/api/tickets/${encodeURIComponent(id)}/reply`,
      {
        method: 'POST',
        body: JSON.stringify({ content }),
      },
    ),
  closeTicket: (id: string) =>
    request<{ ok: boolean; ticket: FeedbackTicket | null }>(
      `/api/tickets/${encodeURIComponent(id)}/close`,
      {
        method: 'POST',
        body: '{}',
      },
    ),

  // ---------- 改命股市 ----------
  getStockQuotes: () =>
    request<{ definitions: StockMeta[]; quotes: StockQuote[]; timestamp: number }>('/api/stocks/quotes'),
  getStockHoldings: () =>
    request<{
      holdings: StockHolding[];
      summary: {
        totalAssets: number;
        availableBalance: number;
        totalMarketValue: number;
        totalFloatingPnl: number;
        totalFloatingPercent: number;
        totalTodayPnl: number;
      };
    }>('/api/stocks/holdings'),
  buyStock: (symbol: string, shares: number, side: 'long' | 'short' = 'long') =>
    request<StockTradeResult>('/api/stocks/buy', {
      method: 'POST',
      body: JSON.stringify({ symbol, shares, side }),
    }),
  sellStock: (symbol: string, shares: number, side: 'long' | 'short' = 'long') =>
    request<StockTradeResult>('/api/stocks/sell', {
      method: 'POST',
      body: JSON.stringify({ symbol, shares, side }),
    }),
  getStockLeaderboard: (limit = 30) =>
    request<{ entries: StockLeaderboardEntry[] }>(`/api/stocks/leaderboard?limit=${limit}`),
  getStockOrders: (limit = 50) =>
    request<{ orders: StockOrder[] }>(`/api/stocks/orders?limit=${limit}`),
  getStockTrends: (symbol: string) =>
    request<{ symbol: string; trends: StockTrendPoint[] }>(`/api/stocks/trends/${encodeURIComponent(symbol)}`),
  getStockKlines: (symbol: string, period: KlinePeriod = 'day') =>
    request<{ symbol: string; period: KlinePeriod; klines: StockKlineItem[] }>(
      `/api/stocks/klines/${encodeURIComponent(symbol)}?period=${period}`,
    ),
};

export type TicketCategory = 'bug' | 'suggestion' | 'wallet' | 'gameplay' | 'account' | 'report' | 'other';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type TicketStatus = 'open' | 'in_progress' | 'replied' | 'resolved' | 'closed';

export interface FeedbackTicketReply {
  id: string;
  ticketId: string;
  senderRole: 'player' | 'gm';
  senderName: string;
  content: string;
  createdAt: number;
}

export interface FeedbackTicket {
  id: string;
  userId: string;
  username: string;
  nickname: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  title: string;
  content: string;
  contact: string;
  attachment: string | null;
  clientInfo: string;
  hasUnreadReply: boolean;
  replyCount: number;
  createdAt: number;
  updatedAt: number;
  replies?: FeedbackTicketReply[];
}

export interface PlayerMailView {
  id: string;
  sender: string;
  title: string;
  content: string;
  rewardCoins: number;
  createdAt: number;
  isRead: boolean;
  isClaimed: boolean;
  claimedAt: number | null;
}

export interface RoomInviteView {
  id: string;
  fromId: string;
  fromNickname: string;
  fromAvatar: string | null;
  toId: string;
  roomId: string;
  gameId: string;
  roomName: string;
  createdAt: number;
}

export interface PlayerProfile {
  userId: string;
  nickname: string;
  username: string | null;
  bio: string;
  avatar: string | null;
  isFriend?: boolean;
  requestPending?: boolean;
  equippedFrame?: string;
  ownedFrames?: string[];
  worshipCount?: number;
  dealerSkin?: string;
  dealerVoice?: string;
  dealerAffection?: number;
  level?: number;
  xp?: string;
  rewardedLevel?: number;
  totalTurnover?: string;
}

export interface FriendRequestView {
  id: string;
  fromId: string;
  fromNickname: string;
  fromAvatar: string | null;
  fromEquippedFrame?: string;
  toId: string;
  toNickname: string;
  toAvatar: string | null;
  toEquippedFrame?: string;
  message: string | null;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: number;
}

export interface SlotsSpinResponse {
  ok: boolean;
  spinId: string;
  reels: string[][];
  betPerLine: number;
  lines: number;
  totalBet: number;
  winAmount: number;
  netDelta: number;
  winningLines: number[];
  isJackpot: boolean;
  balance: number;
  level: number;
  xp: string;
  rewardedLevel: number;
  totalTurnover: string;
  levelsGained: number;
}

export interface GameCategoryDef {
  key: string;
  label: string;
  icon: string;
  badge?: string;
  sortOrder: number;
}

export interface GameCategoriesConfig {
  categories: GameCategoryDef[];
  gameCategoryMap: Record<string, string>;
}

export interface ProfileStatsView {
  totalPlayed: number;
  totalWon: number;
  winRate: number;
  totalNet: number;
  bestSingleWin: number;
  byGame: Array<{
    gameId: string;
    played: number;
    won: number;
    netProfit: number;
    bestWin: number;
  }>;
  recentMatches: Array<{
    settlementId: string;
    gameId: string;
    round: number;
    delta: number;
    finishedAt: number;
    won: boolean;
  }>;
}

export interface PlayerCardView {
  userId: string;
  nickname: string;
  bio: string;
  avatar: string | null;
  equippedFrame: string;
  level: number;
  worshipCount: number;
  balance: number;
  rank: number | null;
  played: number;
  won: number;
  winRate: number;
  bestWin: number;
  isFriend: boolean;
  isSelf: boolean;
}
