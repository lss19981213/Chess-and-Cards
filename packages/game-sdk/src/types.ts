import type { GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';

/** 插件 API 版本：容器加载插件时校验，避免协议不兼容。 */
export const PLUGIN_API_VERSION = 1;

export interface PlayerContext {
  playerId: string;
  nickname: string;
  seat: number;
  connected: boolean;
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
  /** 上报结算，容器负责幂等落库与账本记账。每局只允许调用一次。 */
  settle(input: SettlementInput): void;
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
  onPlayerJoin(ctx: RoomContext, player: PlayerContext): void;
  onPlayerLeave(ctx: RoomContext, playerId: string): void;
  onPlayerReady(ctx: RoomContext, playerId: string): void;
  onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): void;
  onTick?(ctx: RoomContext, dtMs: number): void;
  onDestroy?(ctx: RoomContext): void;

  /** 返回给指定观察者的快照，viewerId 为 null 表示观战/大厅预览 */
  getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot;
}

export type GamePluginFactory = () => GamePlugin;
