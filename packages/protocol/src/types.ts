/**
 * 共享协议层：前后端唯一的类型与消息来源。
 */

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
}

export type RoomStatus = 'waiting' | 'playing' | 'settled' | 'closed';

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
}

/** 游戏快照：结构由各游戏插件自定义，客户端按 gameId 分发渲染。 */
export type GameSnapshot = Record<string, unknown>;

export interface RoomView {
  roomId: string;
  gameId: string;
  mode: string;
  status: RoomStatus;
  round: number;
  maxPlayers: number;
  players: PlayerView[];
  hostId: string | null;
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
