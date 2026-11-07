import { ErrorCode, type ErrorCodeType } from './messages';

/** 业务异常：由网关或游戏插件抛出，统一转成 server:error 下发。 */
export class AppError extends Error {
  readonly code: ErrorCodeType;
  readonly detail: Record<string, unknown> | undefined;

  constructor(code: ErrorCodeType, message: string, detail?: Record<string, unknown>) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }
}

export function badRequest(message: string): AppError {
  return new AppError(ErrorCode.BadRequest, message);
}

export function illegalAction(message: string): AppError {
  return new AppError(ErrorCode.IllegalAction, message);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw badRequest(`字段 ${field} 必须是非空字符串`);
  }
  return value;
}

export function asInt(value: unknown, field: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw badRequest(`字段 ${field} 必须是整数`);
  }
  return value;
}

/** 单个连接的消息频率限制，防止恶意刷包。 */
export class RateLimiter {
  private hits: number[];
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit = 30, windowMs = 1000) {
    this.hits = [];
    this.limit = limit;
    this.windowMs = windowMs;
  }

  allow(now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    while (this.hits.length > 0 && this.hits[0]! < cutoff) {
      this.hits.shift();
    }
    if (this.hits.length >= this.limit) return false;
    this.hits.push(now);
    return true;
  }
}
