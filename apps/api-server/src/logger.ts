/**
 * 企业级结构化日志引擎与落盘模块。
 * 
 * 核心特性：
 * 1. 控制台彩色/标准输出（供 Docker logs / 终端实时查看）
 * 2. 异步高性能落盘（每日按 YYYY-MM-DD 自动轮转，写入 data/logs/api-YYYY-MM-DD.log）
 * 3. 错误双写隔离：任何 ERROR 级别日志额外汇总双写至 error-YYYY-MM-DD.log，便于一键排查全部故障
 * 4. 内存环形队列（保留最新 1,000 条结构化日志），支持 GM 端秒级实时拉取与关键字过滤
 * 5. 全局未捕获异常监听（uncaughtException 与 unhandledRejection），防止默默崩溃无日志
 * 6. 提供文件归档查询与日志尾部读取工具，供 GM 接口下载与在线诊断使用
 */

import { existsSync, mkdirSync, readdirSync, statSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';

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

export interface LogFileInfo {
  name: string;
  service: 'api' | 'room' | 'error' | 'other';
  size: number;
  formattedSize: string;
  mtime: number;
  formattedMtime: string;
  hint: string;
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? 'info';
const SERVICE_NAME = 'api';

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

/** 格式化北京时间 YYYY-MM-DD HH:mm:ss */
function formatBeijingDateTime(timestamp: number): string {
  const d = new Date(timestamp + 8 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

/** 格式化字节大小 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 内存环形队列（最近 1000 条） */
const MAX_MEMORY_LOGS = 1000;
const memoryBuffer: LogEntry[] = [];
let nextLogId = 1;

/** 异步文件写入队列（批量微缓冲写入，降低频繁磁盘 IO 开销） */
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
  // 按目标文件聚合写入
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
      console.error(`[logger] 写入日志文件失败: ${filePath}`, err);
    }
  }
}

// 进程退出前强制刷写所有未写出的日志
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

    // 错误日志额外双写进 error-YYYY-MM-DD.log，便于集中诊断
    if (level === 'error') {
      const errorLogFile = join(logDir, `error-${dayKey}.log`);
      writeQueue.push({ filePath: errorLogFile, line: `[${service.toUpperCase()}] ${rawLine}` });
    }

    // 若写入队列堆积或遇紧急错误，立即触发刷写
    if (level === 'error' || writeQueue.length >= 20) {
      flushWriteQueue();
    } else {
      scheduleFlush();
    }
  } catch (err) {
    console.error('[logger] 日志落盘调度失败', err);
  }
}

export interface Logger {
  debug(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  error(message: string, extra?: Record<string, unknown>): void;
}

/** 创建业务 Logger 实例 */
export function createLogger(scope: string, service = SERVICE_NAME): Logger {
  return {
    debug: (message, extra) => emit('debug', service, scope, message, extra),
    info: (message, extra) => emit('info', service, scope, message, extra),
    warn: (message, extra) => emit('warn', service, scope, message, extra),
    error: (message, extra) => emit('error', service, scope, message, extra),
  };
}

/**
 * 列出日志目录下的所有日志归档文件
 */
export function listLogFiles(): LogFileInfo[] {
  const dir = getLogDir();
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir);
  const result: LogFileInfo[] = [];

  for (const file of files) {
    if (!file.endsWith('.log')) continue;
    try {
      const fullPath = join(dir, file);
      const st = statSync(fullPath);
      if (!st.isFile()) continue;

      let service: 'api' | 'room' | 'error' | 'other' = 'other';
      let hint = '通用业务日志';
      if (file.startsWith('api-')) {
        service = 'api';
        hint = 'HTTP API 业务与账务流水日志';
      } else if (file.startsWith('room-')) {
        service = 'room';
        hint = 'WebSocket 房间服务与牌局对战日志';
      } else if (file.startsWith('error-')) {
        service = 'error';
        hint = '⚠️ 平台全部异常与错误汇总专用日志';
      }

      result.push({
        name: file,
        service,
        size: st.size,
        formattedSize: formatBytes(st.size),
        mtime: st.mtimeMs,
        formattedMtime: formatBeijingDateTime(st.mtimeMs),
        hint,
      });
    } catch {
      // 忽略单个文件读取异常
    }
  }

  // 按最新修改时间倒序排列
  return result.sort((a, b) => b.mtime - a.mtime);
}

/**
 * 获取指定日志文件的物理绝对路径（带安全校验，防止路径穿越）
 */
export function getSafeLogFilePath(fileName: string): string | null {
  const safeName = basename(fileName.trim());
  if (!safeName || !safeName.endsWith('.log') || safeName.includes('..') || safeName.includes('/') || safeName.includes('\\')) {
    return null;
  }
  const dir = getLogDir();
  const full = join(dir, safeName);
  if (existsSync(full)) {
    return full;
  }
  return null;
}

/**
 * 实时拉取最新日志：
 * 优先支持从指定文件尾部读取，或从内存环形队列过滤返回
 */
export function queryLogTail(params: {
  service?: string;
  level?: string;
  lines?: number;
  keyword?: string;
  file?: string;
}): { total: number; returned: number; content: string; entries: LogEntry[] } {
  // 1. 若指定了具体历史文件名，从物理文件读取末尾行
  if (params.file) {
    const filePath = getSafeLogFilePath(params.file);
    if (!filePath) {
      return { total: 0, returned: 0, content: `[提示] 指定的日志文件不存在: ${params.file}`, entries: [] };
    }

    try {
      const text = readFileSync(filePath, 'utf8');
      let lines = text.split(/\r?\n/).filter(Boolean);
      const total = lines.length;

      // 关键字过滤
      if (params.keyword) {
        const kw = params.keyword.toLowerCase();
        lines = lines.filter((l) => l.toLowerCase().includes(kw));
      }

      // 级别过滤
      if (params.level && params.level !== 'all') {
        const lv = params.level.toUpperCase();
        lines = lines.filter((l) => l.includes(` ${lv} `));
      }

      const limit = Math.max(1, Math.min(params.lines ?? 200, 2000));
      const sliced = lines.slice(-limit);
      return {
        total,
        returned: sliced.length,
        content: sliced.join('\n'),
        entries: [],
      };
    } catch (err) {
      return { total: 0, returned: 0, content: `[错误] 读取文件失败: ${(err as Error).message}`, entries: [] };
    }
  }

  // 2. 否则从内存环形队列中读取（实时性最高）
  let logs = [...memoryBuffer];

  if (params.service && params.service !== 'all') {
    if (params.service === 'error') {
      logs = logs.filter((l) => l.level === 'error');
    } else {
      logs = logs.filter((l) => l.service === params.service);
    }
  }

  if (params.level && params.level !== 'all') {
    logs = logs.filter((l) => l.level === params.level);
  }

  if (params.keyword) {
    const kw = params.keyword.toLowerCase();
    logs = logs.filter((l) => l.raw.toLowerCase().includes(kw));
  }

  const limit = Math.max(1, Math.min(params.lines ?? 200, 2000));
  const returnedLogs = logs.slice(-limit);

  return {
    total: memoryBuffer.length,
    returned: returnedLogs.length,
    content: returnedLogs.map((l) => l.raw).join('\n'),
    entries: returnedLogs,
  };
}

/** 全局未捕获异常捕获注册（只执行一次） */
let globalHookRegistered = false;
export function registerGlobalErrorHooks(logger: Logger): void {
  if (globalHookRegistered) return;
  globalHookRegistered = true;

  process.on('uncaughtException', (err) => {
    logger.error('未捕获的全局异常 (uncaughtException)', {
      name: err.name,
      message: err.message,
      stack: err.stack,
    });
    flushWriteQueue();
  });

  process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.error('未处理的 Promise 拒绝 (unhandledRejection)', {
      message,
      stack,
    });
    flushWriteQueue();
  });
}
