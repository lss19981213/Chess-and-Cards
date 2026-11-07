import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { verifyToken } from '@cc/auth';
import {
  AppError,
  ClientMsg,
  ErrorCode,
  RateLimiter,
  ServerMsg,
  asString,
  isPlainObject,
  type Envelope,
} from '@cc/protocol';
import { BOT_NAMES, driveBot } from './bot';
import { config } from './config';
import { RoomManager } from './registry';
import { createSettlementReporter } from './settlement';
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

const manager = new RoomManager(config, createSettlementReporter(config));
registerBuiltinGames(manager);

function send(ws: WebSocket, t: string, d: unknown): void {
  if (ws.readyState !== 1) return;
  const envelope: Envelope = { t, d, ts: Date.now() };
  ws.send(JSON.stringify(envelope));
}

function sendError(ws: WebSocket, code: string, message: string): void {
  send(ws, ServerMsg.Error, { code, message });
}

function cors(res: import('node:http').ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type,authorization');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
}

const httpServer = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  cors(res);

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
    res.end(JSON.stringify({ rooms: manager.list(gameId).map((r) => r.view()) }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

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
        console.error('[ws] 未处理异常', error);
        sendError(ws, ErrorCode.Internal, '服务器内部错误');
      }
    });
  });

  ws.on('close', () => {
    if (session.authTimer) clearTimeout(session.authTimer);
    if (session.roomId && session.playerId) {
      manager.get(session.roomId)?.detach(session.playerId);
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
      const maxPlayers = typeof payload.maxPlayers === 'number' ? payload.maxPlayers : 2;
      const room = manager.joinOrCreate(
        gameId,
        mode,
        maxPlayers,
        { playerId: session.playerId, nickname: session.nickname ?? '玩家' },
        session.ws,
      );
      session.roomId = room.id;
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
      room.handleIntent(session.playerId, cmd, data);
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
      const nickname = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] ?? '机器人';
      room.addBot(`bot:${randomUUID()}`, `🤖 ${nickname}`);
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

httpServer.listen(config.port, () => {
  console.log(`[room-server] ws://0.0.0.0:${config.port}/ws`);
  console.log(`[room-server] 已注册游戏: ${manager.listGames().map((g) => g.gameId).join(', ') || '无'}`);
});

function shutdown(): void {
  console.log('[room-server] 正在关闭...');
  clearInterval(heartbeat);
  clearInterval(botTicker);
  manager.shutdown();
  wss.close();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
