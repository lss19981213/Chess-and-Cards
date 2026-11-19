/**
 * 房间服务结构化日志引擎与落盘模块。
 * 
 * 核心特性：
 * 1. 控制台彩色/标准输出（供 Docker logs / 终端实时查看）
 * 2. 异步高性能落盘（每日按 YYYY-MM-DD 自动轮转，写入 data/logs/room-YYYY-MM-DD.log）
 * 3. 错误双写隔离：任何 ERROR 级别日志额外汇总双写至 error-YYYY-MM-DD.log，便于集中诊断
 * 4. 内存环形队列（保留最新 1,000 条结构化日志）
 * 5. 全局未捕获异常监听（uncaughtException 与 unhandledRejection），防止对战服崩溃未记录
 */

import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  at: string;
  timestamp: number;
  level: LogLevel;
  service: string;
  scope: string;
  message: string;
  extra?: Record<string, unknown>;
  raw: string;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';
const SERVICE_NAME = 'room';

/** 解析日志目录路径（支持环境变量 LOG_DIR 或自动查找宿主机 data/logs） */
export function getLogDir(): string {
  if (process.env.LOG_DIR) {
    const custom = resolve(process.env.LOG_DIR);
    if (!existsSync(custom)) mkdirSync(custom, { recursive: true });
    return custom;
  }

  const candidates = [
    resolve(process.cwd(), 'data/logs'),
    resolve(process.cwd(), '../../data/logs'),
    resolve(process.cwd(), '../data/logs'),
  ];

  for (const candidate of candidates) {
    try {
      const parent = dirname(candidate);
      if (existsSync(parent)) {
        if (!existsSync(candidate)) mkdirSync(candidate, { recursive: true });
        return candidate;
      }
    } catch {
      // 尝试下一个候选路径
    }
  }

  const fallback = resolve(process.cwd(), 'data/logs');
  if (!existsSync(fallback)) mkdirSync(fallback, { recursive: true });
  return fallback;
}

/** 获取北京时间当前日期字符串 YYYY-MM-DD */
function getBeijingDateStr(now = new Date()): string {
  const beijingMs = now.getTime() + 8 * 60 * 60 * 1000;
  const d = new Date(beijingMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 内存环形队列（最近 1000 条） */
const MAX_MEMORY_LOGS = 1000;
const memoryBuffer: LogEntry[] = [];
let nextLogId = 1;

/** 异步文件写入队列 */
interface WriteTask {
  filePath: string;
  line: string;
}
const writeQueue: WriteTask[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushWriteQueue();
  }, 100);
  flushTimer.unref?.();
}

function flushWriteQueue(): void {
  if (writeQueue.length === 0) return;
  const tasks = writeQueue.splice(0, writeQueue.length);
  const fileMap = new Map<string, string[]>();
  for (const t of tasks) {
    let arr = fileMap.get(t.filePath);
    if (!arr) {
      arr = [];
      fileMap.set(t.filePath, arr);
    }
    arr.push(t.line);
  }

  for (const [filePath, lines] of fileMap.entries()) {
    try {
      appendFileSync(filePath, lines.join('\n') + '\n', 'utf8');
    } catch (err) {
      console.error(`[room-logger] 写入日志文件失败: ${filePath}`, err);
    }
  }
}

process.on('beforeExit', () => {
  flushWriteQueue();
});

function serialize(extra?: Record<string, unknown>): string {
  if (!extra) return '';
  try {
    return ` ${JSON.stringify(extra)}`;
  } catch {
    return ' [unserializable]';
  }
}

function emit(
  level: LogLevel,
  service: string,
  scope: string,
  message: string,
  extra?: Record<string, unknown>,
): void {
  if (ORDER[level] < ORDER[MIN_LEVEL]) return;

  const now = new Date();
  const timestamp = now.getTime();
  const isoTime = now.toISOString();
  const levelStr = level.toUpperCase().padEnd(5);
  const rawLine = `${isoTime} ${levelStr} [${scope}] ${message}${serialize(extra)}`;

  // 1. 控制台输出
  if (level === 'error') console.error(rawLine);
  else if (level === 'warn') console.warn(rawLine);
  else console.log(rawLine);

  // 2. 内存环形队列存储
  const entry: LogEntry = {
    id: nextLogId++,
    at: isoTime,
    timestamp,
    level,
    service,
    scope,
    message,
    extra,
    raw: rawLine,
  };
  memoryBuffer.push(entry);
  if (memoryBuffer.length > MAX_MEMORY_LOGS) {
    memoryBuffer.splice(0, memoryBuffer.length - MAX_MEMORY_LOGS);
  }

  // 3. 异步排队写入本地日志文件
  try {
    const logDir = getLogDir();
    const dayKey = getBeijingDateStr(now);
    const serviceLogFile = join(logDir, `${service}-${dayKey}.log`);
    writeQueue.push({ filePath: serviceLogFile, line: rawLine });

    if (level === 'error') {
      const errorLogFile = join(logDir, `error-${dayKey}.log`);
      writeQueue.push({ filePath: errorLogFile, line: `[${service.toUpperCase()}] ${rawLine}` });
    }

    if (level === 'error' || writeQueue.length >= 20) {
      flushWriteQueue();
    } else {
      scheduleFlush();
    }
  } catch (err) {
    console.error('[room-logger] 日志落盘调度失败', err);
  }
}

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

export function createLogger(scope: string, service = SERVICE_NAME): Logger {
  return {
    debug: (message, extra) => emit('debug', service, scope, message, extra),
    info: (message, extra) => emit('info', service, scope, message, extra),
    warn: (message, extra) => emit('warn', service, scope, message, extra),
    error: (message, extra) => emit('error', service, scope, message, extra),
  };
}

/** 全局未捕获异常捕获注册（只执行一次） */
let globalHookRegistered = false;
export function registerGlobalErrorHooks(logger: Logger): void {
  if (globalHookRegistered) return;
  globalHookRegistered = true;

  process.on('uncaughtException', (err) => {
    logger.error('未捕获的全局对战异常 (uncaughtException)', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
    flushWriteQueue();
  });

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.error('未处理的对战 Promise 拒绝 (unhandledRejection)', {
      message,
      stack,
    });
    flushWriteQueue();
  });
}
