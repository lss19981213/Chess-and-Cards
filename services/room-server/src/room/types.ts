import type { WebSocket } from 'ws';
import type { BotDifficulty, Settlement } from '@cc/protocol';
import type { RoomServerConfig } from '../config';
import type { ReleaseClient, WalletClient } from '../wallet';

export const TICK_MS = 200;
export const SETTLE_RESET_MS = 5_000;
/** 对战回合单步超时时长（毫秒）与托管自动出牌延迟 */
export const TURN_TIMEOUT_MS = 20_000;
export const HOST_ACT_DELAY_MS = 1_100;
/** 平台台容量 */
export const PLATFORM_CAPACITY = 168;

export interface Seat {
  playerId: string;
  nickname: string;
  seat: number;
  ready: boolean;
  score: number;
  socket: WebSocket | null;
  graceTimer: NodeJS.Timeout | null;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  avatar?: string | null;
  equippedFrame?: string;
}

export interface Spectator {
  playerId: string;
  nickname: string;
  socket: WebSocket | null;
  queuedToSit: boolean;
  avatar?: string | null;
  equippedFrame?: string;
}

export interface RoomDeps {
  config: RoomServerConfig;
  /** 上报结算到大厅（幂等落库 + 账本） */
  settle(settlement: Settlement): void;
  /** 下注即时扣款 / 撤注退款，返回操作后余额 */
  adjustWallet: WalletClient;
  /** 房间销毁时释放未结算的下注扣款 */
  releaseBets: ReleaseClient;
  /** 空房间回收 */
  empty(roomId: string): void;
  /**
   * 是否处于排水期（全局平台维护，或该 gameId 单游戏 draining/disabled/updating）。
   * @param gameId 房间所属玩法 ID，不可空
   */
  isDraining?: (gameId: string) => boolean;
}

export function sendEnvelope(socket: WebSocket | null, t: string, d: unknown): void {
  if (!socket || socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify({ t, d, ts: Date.now() }));
  } catch {
    /* 忽略发送失败，由心跳负责清理 */
  }
}
