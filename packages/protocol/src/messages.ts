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
} as const;

export type ClientMsgType = (typeof ClientMsg)[keyof typeof ClientMsg];

export const ServerMsg = {
  Hello: 'server:hello',
  RoomView: 'server:room_view',
  Snapshot: 'server:snapshot',
  Settlement: 'server:settlement',
  Error: 'server:error',
  Pong: 'server:pong',
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
