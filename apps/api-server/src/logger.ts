/**
 * 轻量结构化日志（与游戏服保持同一格式，便于统一检索）。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';

function serialize(extra?: Record<string, unknown>): string {
  if (!extra) return '';
  try {
    return ` ${JSON.stringify(extra)}`;
  } catch {
    return ' [unserializable]';
  }
}

function emit(level: LogLevel, scope: string, message: string, extra?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[MIN_LEVEL]) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${serialize(extra)}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, extra) => emit('debug', scope, message, extra),
    info: (message, extra) => emit('info', scope, message, extra),
    warn: (message, extra) => emit('warn', scope, message, extra),
    error: (message, extra) => emit('error', scope, message, extra),
  };
}
