import type { GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';

/** 插件 API 版本：容器加载插件时校验，避免协议不兼容。 */
export const PLUGIN_API_VERSION = 1;

export interface PlayerContext {
  playerId: string;
  nickname: string;
  seat: number;
  connected: boolean;
  isBot: boolean;
}

export interface RoomConfig {
  roomId: string;
  gameId: string;
  mode: string;
  maxPlayers: number;
  round: number;
  /** 每局随机种子，写入战报，支持回放与公平性验证 */
  seed: string;
}

export interface GameIntent {
  cmd: string;
  payload: Record<string, unknown>;
}

export interface SettlementInput {
  entries: SettlementEntry[];
  winners: string[];
}

/**
 * 容器注入给插件的房间上下文。
 * 插件的所有副作用（发消息、结算）必须通过它完成，禁止直接触达存储。
 */
export interface RoomContext {
  readonly config: RoomConfig;
  readonly players: readonly PlayerContext[];
  getPlayer(playerId: string): PlayerContext | undefined;
  /** 向房间内所有人广播 */
  broadcast(t: string, d: unknown): void;
  /** 定向某个玩家发送（用于隐藏手牌等私密信息） */
  sendTo(playerId: string, t: string, d: unknown): void;
  /** 标记状态变更，容器在下一个 tick 统一下发快照 */
  markDirty(): void;
  /** 上报结算，容器负责幂等落库与账本记账。每局只允许调用一次。 */
  settle(input: SettlementInput): void;
  /**
   * 下注即时扣款，余额不足时抛错，返回可供撤注退款的幂等凭证。
   * 本金已扣，结算时容器会自动返还本金，插件的结算 delta 仍按净盈亏计算。
   */
  charge(playerId: string, amount: number): Promise<string>;
  /** 撤注退款，凭证必须是 charge 的返回值 */
  refund(playerId: string, ref: string): Promise<void>;
  /** 开启新一局（常驻玩法由插件按时间轴调用） */
  beginRound(): void;
  log(message: string, extra?: Record<string, unknown>): void;
}

/**
 * 棋牌游戏插件契约。
 * 新增一个游戏 = 实现这个接口 + 注册 + 部署，无需改动大厅与容器代码。
 */
export interface GamePlugin {
  readonly apiVersion: number;
  readonly meta: GameMeta;
  /** 服务端接受指令白名单，容器在转发前做第一层校验 */
  readonly commands: readonly string[];

  onRoomCreate(ctx: RoomContext): void;
  /** 满足开局条件、新一局开始时触发，插件在此初始化牌局状态 */
  onRoundStart?(ctx: RoomContext): void;
  onPlayerJoin(ctx: RoomContext, player: PlayerContext): void;
  onPlayerLeave(ctx: RoomContext, playerId: string): void;
  onPlayerReady(ctx: RoomContext, playerId: string): void;
  /** 允许异步：需要即时扣款等副作用时可 await，容器会等待完成 */
  onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): void | Promise<void>;
  onTick?(ctx: RoomContext, dtMs: number): void;
  onDestroy?(ctx: RoomContext): void;

  /** 返回给指定观察者的快照，viewerId 为 null 表示观战/大厅预览 */
  getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot;

  /** 当前应当行动的玩家（用于驱动机器人），无回合概念时返回 null */
  getCurrentActor?(ctx: RoomContext): string | null;

  /** 规则 AI 兜底决策，返回 null 表示无法行动 */
  botIntent?(ctx: RoomContext, playerId: string): GameIntent | null;
}

export type GamePluginFactory = () => GamePlugin;
