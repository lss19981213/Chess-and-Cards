import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyToken } from '@cc/auth';
import {
  AppError,
  ClientMsg,
  EMOTES,
  ErrorCode,
  RateLimiter,
  ServerMsg,
  asString,
  isPlainObject,
  type BotDifficulty,
  type Envelope,
} from '@cc/protocol';
import { BOT_NAMES, driveBot } from './bot';
import { config } from './config';
import { createLogger } from './logger';

const log = createLogger('room-server');
import { RoomManager } from './registry';
import { createSettlementReporter } from './settlement';
import { createReleaseClient, createWalletClient } from './wallet';
import { registerBuiltinGames } from './plugins';

const AUTH_TIMEOUT_MS = 15_000;
const HEARTBEAT_MS = 30_000;

type AliveSocket = WebSocket & { __alive?: boolean };

interface Session {
  ws: WebSocket;
  playerId: string | null;
  nickname: string | null;
  roomId: string | null;
  limiter: RateLimiter;
  authTimer: NodeJS.Timeout | null;
}

const releaseBets = createReleaseClient(config);
const settlementReporter = createSettlementReporter(config);
const manager = new RoomManager(
  config,
  (settlement) => settlementReporter.report(settlement),
  createWalletClient(config),
  releaseBets,
);
registerBuiltinGames(manager);

// 启动时把上一次进程遗留的未投递结算补投出去
void settlementReporter.flush().catch((error: unknown) => {
  log.error('启动补投结算失败', { error: (error as Error).message });
});

// 定期重投 outbox：网络恢复后不必等下一次重启就能把积压结算送出去
const outboxRetryTicker = setInterval(() => {
  void settlementReporter.flush();
}, 60_000);
outboxRetryTicker.unref?.();

// 房间服务重启意味着上一进程的所有房间状态都已作废，未结算的下注本金不可能再等来结算。
// 大厅可能稍后才就绪，做有限次重试。
void (async () => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await releaseBets('');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  log.warn('启动时清理未结算下注失败，需人工检查', {});
})();

function send(ws: WebSocket, t: string, d: unknown): void {
  if (ws.readyState !== 1) return;
  const envelope: Envelope = { t, d, ts: Date.now() };
  ws.send(JSON.stringify(envelope));
}

function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, ServerMsg.Error, { code, message });
}

function cors(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse): void {
  const origin = req.headers.origin;
  // 默认只回显同源请求，避免任意站点跨域读取房间/游戏列表
  const allowed = config.corsOrigin
    ? config.corsOrigin
    : origin && originHostMatches(origin, req.headers.host)
      ? origin
      : '';
  if (allowed) res.setHeader('access-control-allow-origin', allowed);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-headers', 'content-type,authorization');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
}

function originHostMatches(origin: string, host?: string): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** 浏览器握手必须同源或在白名单内；无 Origin 的客户端（GM 工具/测试脚本）放行 */
function isOriginAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  if (config.allowedOrigins.length > 0) return config.allowedOrigins.includes(origin);
  return originHostMatches(origin, host);
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  cors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: manager.list().length, games: manager.listGames().length }));
    return;
  }

  if (url.pathname === '/games') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ games: manager.listGames() }));
    return;
  }

  if (url.pathname === '/rooms') {
    const gameId = url.searchParams.get('gameId') ?? undefined;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ rooms: manager.listPublic(gameId) }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

const wss = new WebSocketServer({
  server: httpServer,
  path: '/ws',
  // 默认 100MB 的单帧上限足以被一条超大 JSON 打满内存
  maxPayload: 64 * 1024,
  verifyClient: (info, done) => {
    if (isOriginAllowed(info.origin, info.req.headers.host)) {
      done(true);
      return;
    }
    log.warn('拒绝跨站 WebSocket 连接', { origin: info.origin });
    done(false, 403, 'origin not allowed');
  },
});

wss.on('connection', (ws) => {
  (ws as AliveSocket).__alive = true;
  const session: Session = {
    ws,
    playerId: null,
    nickname: null,
    roomId: null,
    limiter: new RateLimiter(40, 1000),
    authTimer: null,
  };

  session.authTimer = setTimeout(() => {
    if (!session.playerId) ws.close(4003, 'auth timeout');
  }, AUTH_TIMEOUT_MS);
  session.authTimer.unref?.();

  ws.on('pong', () => {
    (ws as AliveSocket).__alive = true;
  });

  ws.on('message', (raw) => {
    void handleMessage(session, raw.toString()).catch((error: unknown) => {
      if (error instanceof AppError) {
        sendError(ws, error.code, error.message);
      } else {
        log.error('未处理的连接异常', { error: (error as Error).message });
        sendError(ws, ErrorCode.Internal, '服务器内部错误');
      }
    });
  });

  ws.on('close', () => {
    if (session.authTimer) clearTimeout(session.authTimer);
    if (session.roomId && session.playerId) {
      manager.get(session.roomId)?.detach(session.playerId, ws);
    }
  });

  ws.on('error', (error) => console.error('[ws] socket 错误', error.message));
});

async function handleMessage(session: Session, raw: string): Promise<void> {
  if (!session.limiter.allow()) {
    sendError(session.ws, ErrorCode.RateLimited, '操作过于频繁');
    return;
  }

  let msg: { t?: unknown; d?: unknown };
  try {
    msg = JSON.parse(raw) as { t?: unknown; d?: unknown };
  } catch {
    sendError(session.ws, ErrorCode.BadRequest, '消息格式错误');
    return;
  }

  const type = typeof msg.t === 'string' ? msg.t : '';
  const payload = isPlainObject(msg.d) ? msg.d : {};

  if (type === ClientMsg.Hello) {
    const token = asString(payload.token, 'token');
    const claims = verifyToken(config.jwtSecret, token);
    if (!claims) throw new AppError(ErrorCode.Unauthorized, '令牌无效或已过期');
    session.playerId = claims.sub;
    session.nickname = claims.name;
    if (session.authTimer) clearTimeout(session.authTimer);
    send(session.ws, ServerMsg.Hello, {
      playerId: claims.sub,
      nickname: claims.name,
      serverTime: Date.now(),
    });
    return;
  }

  if (!session.playerId) {
    throw new AppError(ErrorCode.Unauthorized, '请先完成认证');
  }

  switch (type) {
    case ClientMsg.Ping:
      send(session.ws, ServerMsg.Pong, { ts: Date.now() });
      return;

    case ClientMsg.JoinRoom: {
      if (session.roomId) throw new AppError(ErrorCode.AlreadyInRoom, '你已在房间中');
      const gameId = asString(payload.gameId, 'gameId');
      const mode = typeof payload.mode === 'string' ? payload.mode : 'casual';
      const rawMax = payload.maxPlayers;
      // 非法数值（NaN / 负数 / 超大）会造出永远无法加入的房间
      const maxPlayers =
        typeof rawMax === 'number' && Number.isInteger(rawMax) && rawMax >= 2 && rawMax <= 16
          ? rawMax
          : 2;
      const roomId = typeof payload.roomId === 'string' ? payload.roomId : undefined;
      const create = payload.create === true;
      const player = { playerId: session.playerId, nickname: session.nickname ?? '玩家' };

      let room;
      if (roomId) {
        const target = manager.get(roomId);
        if (!target || target.isClosed) {
          throw new AppError(ErrorCode.RoomNotFound, '房间不存在或已解散');
        }
        if (!target.isJoinable && !target.isPersistent) {
          throw new AppError(ErrorCode.RoomFull, '该房间已开局或已满员');
        }
        target.join(player, session.ws);
        room = target;
      } else if (create) {
        room = manager.createRoom(gameId, mode, maxPlayers, player, session.ws);
      } else {
        room = manager.joinOrCreate(gameId, mode, maxPlayers, player, session.ws);
      }

      session.roomId = room.id;
      log.info('玩家进入房间', {
        playerId: session.playerId,
        roomId: room.id,
        gameId: room.gameId,
        players: room.playerCount,
        byRoomId: Boolean(roomId),
        create,
      });
      send(session.ws, ServerMsg.RoomView, { room: room.view() });
      return;
    }

    case ClientMsg.Ready: {
      const room = requireRoom(session);
      room.setReady(session.playerId, payload.ready !== false);
      return;
    }

    case ClientMsg.Intent: {
      const room = requireRoom(session);
      const cmd = asString(payload.cmd, 'cmd');
      const data = isPlainObject(payload.payload) ? payload.payload : {};
      await room.handleIntent(session.playerId, cmd, data);
      return;
    }

    case ClientMsg.Reconnect: {
      const roomId = asString(payload.roomId, 'roomId');
      const playerId = asString(payload.playerId, 'playerId');
      if (playerId !== session.playerId) throw new AppError(ErrorCode.Unauthorized, '身份不匹配');
      const room = manager.get(roomId);
      if (!room) throw new AppError(ErrorCode.RoomNotFound, '房间已关闭');
      room.attach(playerId, session.ws);
      session.roomId = roomId;
      return;
    }

    case ClientMsg.AddBot: {
      const room = requireRoom(session);
      if (room.view().hostId !== session.playerId) {
        throw new AppError(ErrorCode.IllegalAction, '只有房主可以添加机器人');
      }
      const rawDiff = payload.difficulty;
      const difficulty: BotDifficulty =
        rawDiff === 'low' || rawDiff === 'medium' || rawDiff === 'high' ? rawDiff : 'medium';
      const used = new Set(room.view().players.map((p) => p.nickname));
      const free = BOT_NAMES.filter((name) => !used.has(`🤖 ${name}`));
      const nickname =
        free[Math.floor(Math.random() * free.length)] ?? `机器人${room.view().players.length + 1}`;
      room.addBot(`bot:${randomUUID()}`, `🤖 ${nickname}`, difficulty);
      return;
    }

    case ClientMsg.Emote: {
      const room = requireRoom(session);
      const key = asString(payload.key, 'key');
      const emote = EMOTES.find((item) => item.key === key);
      if (!emote) throw new AppError(ErrorCode.BadRequest, '无效的喊话');
      room.sendEmote(session.playerId, emote.key, emote.text);
      return;
    }

    case ClientMsg.LeaveRoom: {
      if (!session.roomId) return;
      manager.get(session.roomId)?.leave(session.playerId);
      session.roomId = null;
      return;
    }

    default:
      throw new AppError(ErrorCode.BadRequest, `未知消息类型: ${type}`);
  }
}

function requireRoom(session: Session) {
  if (!session.roomId) throw new AppError(ErrorCode.RoomNotFound, '你还没有加入房间');
  const room = manager.get(session.roomId);
  if (!room) throw new AppError(ErrorCode.RoomNotFound, '房间已关闭');
  return room;
}

/** 机器人驱动器：轮询各房间，命中机器人回合则触发决策 */
const botInFlight = new Map<string, string>();

const botTicker = setInterval(() => {
  if (!config.bot.enabled) return;
  for (const room of manager.list()) {
    const actor = room.currentActor();
    if (!actor || !room.isBot(actor)) continue;
    if (botInFlight.has(room.id)) continue;
    botInFlight.set(room.id, actor);
    void driveBot(room, actor)
      .catch((error: unknown) => console.error('[bot] 驱动异常', error))
      .finally(() => botInFlight.delete(room.id));
  }
}, 300);
botTicker.unref?.();

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    const socket = client as AliveSocket;
    if (socket.__alive === false) {
      socket.terminate();
      continue;
    }
    socket.__alive = false;
    socket.ping();
  }
}, HEARTBEAT_MS);
heartbeat.unref?.();

httpServer.listen(config.port, config.host, () => {
  log.info('WebSocket 服务已启动', { host: config.host, port: config.port, rooms: manager.list().length });
  log.info('游戏注册完成', { games: manager.listGames().map((g) => g.gameId) });
});

function shutdown(): void {
  log.warn('服务正在关闭');
  clearInterval(heartbeat);
  clearInterval(botTicker);
  clearInterval(outboxRetryTicker);
  manager.shutdown();
  wss.close();
  // 退出前尽量把 outbox 里的结算投递出去；失败也没关系，文件会留到下次启动补投
  const flush = settlementReporter.flush().catch(() => undefined);
  Promise.race([flush, new Promise((resolve) => setTimeout(resolve, 5000))]).then(() => {
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
