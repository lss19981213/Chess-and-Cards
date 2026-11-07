/**
 * 运营后台事件缓冲区（内存环形队列）。
 * 只保留最近的事件，服务重启即清空，不落库、不影响主流程性能。
 */

export type EventLevel = 'info' | 'warn' | 'error';

export interface AdminEvent {
  at: number;
  level: EventLevel;
  scope: string;
  message: string;
  detail?: Record<string, unknown>;
}

const MAX_EVENTS = 240;
const buffer: AdminEvent[] = [];

export function recordEvent(
  level: EventLevel,
  scope: string,
  message: string,
  detail?: Record<string, unknown>,
): void {
  buffer.push({ at: Date.now(), level, scope, message, detail });
  if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
}

/** 倒序返回最近若干条 */
export function recentEvents(limit = 60): AdminEvent[] {
  const safe = Math.min(Math.max(1, limit), MAX_EVENTS);
  return buffer.slice(-safe).reverse();
}

let lastSettlementAt = 0;

/** 结算心跳：证明常驻牌局仍在推进（不计入事件流） */
export function markSettlement(): void {
  lastSettlementAt = Date.now();
}

export function getLastSettlementAt(): number {
  return lastSettlementAt;
}
