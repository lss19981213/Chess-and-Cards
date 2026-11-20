/**
 * 共享协议层：前后端唯一的类型与消息来源。
 */

/** 单游戏运营态：缺省 enabled；大厅与进房拦截据此展示/拒绝 */
export type GameOpsStatus = 'enabled' | 'disabled' | 'draining' | 'updating';

/** 游戏静态元数据，由游戏插件声明，大厅据此动态渲染入口。 */
export interface GameMeta {
  gameId: string;
  name: string;
  description: string;
  /** 图标，允许 emoji 或 CDN 图片地址 */
  icon: string;
  minPlayers: number;
  maxPlayers: number;
  version: string;
  /** 客户端资源地址（微前端 iframe / 动态模块） */
  clientBundle: string;
  tags: string[];
  /** 大厅分类：board 棋类 / table 牌桌 / live 极速下注 / mahjong 雀神麻将 / slots 老虎机（也支持 GM 动态分类 key） */
  category?: 'board' | 'table' | 'live' | 'mahjong' | 'slots' | (string & {});
  /** 平台坐庄的常驻玩法：只能加入平台开好的台，玩家不能建房 */
  persistent?: boolean;
  /**
   * 运营态（由房间服注入，插件声明时可省略，缺省视为 enabled）。
   * disabled/updating：大厅不可进；draining：禁新进、已在局可打完。
   */
  status?: GameOpsStatus;
  /** 大厅卡片 / 选台页维护文案，可空 */
  statusMessage?: string;
}

/** 运营公告 */
export interface Announcement {
  id: string;
  title: string;
  content: string;
  kind: 'notice' | 'event' | 'maintenance';
  createdAt: number;
  /** 有效截止时间戳（毫秒），到期后不再对玩家展示；为 null/undefined 且超过默认 1 小时时自动过期 */
  expiresAt?: number | null;
}

export type RoomStatus = 'waiting' | 'playing' | 'settled' | 'closed';

/** 机器人对弈难度等级：低 / 中 / 高 */
export type BotDifficulty = 'low' | 'medium' | 'high';

export const BOT_DIFFICULTY_LABEL: Record<BotDifficulty, string> = {
  low: '低级',
  medium: '中级',
  high: '高级',
};

/** 房间内玩家的公开视图，快照会下发给同房间所有人。 */
export interface PlayerView {
  playerId: string;
  nickname: string;
  seat: number;
  ready: boolean;
  online: boolean;
  score: number;
  /** 是否为机器人陪玩 */
  isBot: boolean;
  /** 机器人难度等级 */
  botDifficulty?: BotDifficulty;
  /** 佩戴的头像框 ID */
  equippedFrame?: string;
  /** 玩家头像 URL / DataURL */
  avatar?: string | null;
}

/** 游戏快照：结构由各游戏插件自定义，客户端按 gameId 分发渲染。 */
export type GameSnapshot = Record<string, unknown>;

export interface SpectatorView {
  playerId: string;
  nickname: string;
  /** 是否已预约入座（对局进行中点击入座，本局结束后自动加入） */
  queuedToSit?: boolean;
}

export interface RoomView {
  roomId: string;
  gameId: string;
  mode: string;
  status: RoomStatus;
  round: number;
  maxPlayers: number;
  players: PlayerView[];
  hostId: string | null;
  /** 是否为机器人自建牌桌（默认观战进入，点击入座参战） */
  botHosted?: boolean;
  /** 当前观战玩家列表 */
  spectators?: SpectatorView[];
}

export type Currency = 'coin';

export interface SettlementEntry {
  playerId: string;
  currency: Currency;
  /** 正数为赢，负数为输 */
  delta: number;
  reason: string;
}

export interface Settlement {
  settlementId: string;
  roomId: string;
  gameId: string;
  round: number;
  /** 本局随机种子，写入战报，供回放与公平性校验 */
  seed: string;
  winners: string[];
  entries: SettlementEntry[];
  finishedAt: number;
}
