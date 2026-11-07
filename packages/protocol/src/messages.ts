/**
 * WebSocket 消息协议。
 * 统一信封：{ t, d, seq, ts }，d 为具体负载。
 */

export const ClientMsg = {
  Hello: 'client:hello',
  JoinRoom: 'client:join_room',
  LeaveRoom: 'client:leave_room',
  Ready: 'client:ready',
  Intent: 'client:intent',
  Reconnect: 'client:reconnect',
  Ping: 'client:ping',
  /** 房主添加一个机器人陪玩 */
  AddBot: 'client:add_bot',
  /** 快捷喊话 */
  Emote: 'client:emote',
} as const;

export type ClientMsgType = (typeof ClientMsg)[keyof typeof ClientMsg];

export const ServerMsg = {
  Hello: 'server:hello',
  RoomView: 'server:room_view',
  Snapshot: 'server:snapshot',
  Settlement: 'server:settlement',
  Error: 'server:error',
  Pong: 'server:pong',
  /** 广播的快捷喊话 */
  Emote: 'server:emote',
} as const;

export type ServerMsgType = (typeof ServerMsg)[keyof typeof ServerMsg];

export const ErrorCode = {
  BadRequest: 'BAD_REQUEST',
  Unauthorized: 'UNAUTHORIZED',
  RoomNotFound: 'ROOM_NOT_FOUND',
  RoomFull: 'ROOM_FULL',
  AlreadyInRoom: 'ALREADY_IN_ROOM',
  IllegalAction: 'ILLEGAL_ACTION',
  RateLimited: 'RATE_LIMITED',
  Internal: 'INTERNAL',
} as const;

export type ErrorCodeType = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface Envelope<T = unknown> {
  t: string;
  d: T;
  seq?: number;
  ts: number;
}

export interface ClientHelloPayload {
  /** 由大厅 API 签发的访问令牌 */
  token: string;
}

export interface JoinRoomPayload {
  gameId: string;
  mode?: string;
  maxPlayers?: number;
}

export interface IntentPayload {
  cmd: string;
  payload?: Record<string, unknown>;
}

export interface ReconnectPayload {
  roomId: string;
  playerId: string;
}

export interface HelloPayload {
  playerId: string;
  nickname: string;
  serverTime: number;
}

export interface RoomViewPayload {
  room: import('./types').RoomView;
}

export interface SnapshotPayload {
  roomId: string;
  gameId: string;
  status: import('./types').RoomStatus;
  round: number;
  seq: number;
  snapshot: import('./types').GameSnapshot;
}

export interface SettlementPayload {
  settlement: import('./types').Settlement;
}

export interface ErrorPayload {
  code: ErrorCodeType;
  message: string;
  requestType?: string;
}

export interface EmotePayload {
  playerId: string;
  nickname: string;
  /** 表情标识，如 'good' | 'hurry' */
  key: string;
  text: string;
  at: number;
}

/** 允许的喊话内容，服务端白名单校验，避免自由文本带来的风险 */
export const EMOTES: ReadonlyArray<{ key: string; text: string }> = [
  { key: 'hurry', text: '快点吧～' },
  { key: 'good', text: '好牌！' },
  { key: 'nice', text: '打得漂亮' },
  { key: 'lucky', text: '运气不错' },
  { key: 'again', text: '再来一局' },
  { key: 'oops', text: '手滑了…' },
];
