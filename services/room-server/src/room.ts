import { randomBytes, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  AppError,
  ErrorCode,
  ServerMsg,
  type PlayerView,
  type RoomStatus,
  type RoomView,
  type RoomSummary,
  type Settlement,
} from '@cc/protocol';
import type { GameIntent, GamePlugin, PlayerContext, RoomContext, SettlementInput } from '@cc/game-sdk';
import type { RoomServerConfig } from './config';
import { createLogger } from './logger';

const roomLog = createLogger('room');

const TICK_MS = 200;
const SETTLE_RESET_MS = 5_000;
/** 平台台容量 */
export const PLATFORM_CAPACITY = 168;
/** 场内最低氛围人数 */
const AMBIENT_MIN = 30;
const AMBIENT_MAX = 50;

const AMBIENT_NAMES = [
  '夜雨声烦', '老赌徒', '一掷千金', '淡定哥', '风清扬', '南城旧梦', '小赌怡情', '铁头娃',
  '顺风耳', '稳如老狗', '赌一把', '飘渺孤鸿', '半夜不睡', '老王来了', '暴富梦想', '手气不错',
  '一见发财', '沉默的羔羊', '不服就干', '春天里', '看牌高手', '好运来', '点背到家', '再来一把',
  '月下独酌', '浪里白条', '百万富翁', '风继续吹', '佛系玩家', '追梦人', '东方不败', '笑看风云',
];

interface Seat {
  playerId: string;
  nickname: string;
  seat: number;
  ready: boolean;
  score: number;
  socket: WebSocket | null;
  graceTimer: NodeJS.Timeout | null;
  isBot: boolean;
}

export interface RoomDeps {
  config: RoomServerConfig;
  /** 上报结算到大厅（幂等落库 + 账本） */
  settle(settlement: Settlement): void;
  /** 空房间回收 */
  empty(roomId: string): void;
}

function sendEnvelope(socket: WebSocket | null, t: string, d: unknown): void {
  if (!socket || socket.readyState !== 1) return;
  try {
    socket.send(JSON.stringify({ t, d, ts: Date.now() }));
  } catch {
    /* 忽略发送失败，由心跳负责清理 */
  }
}

/**
 * 通用房间容器：承载任意 GamePlugin。
 * 负责座位、准备、开局、断线重连、快照下发与结算上报，
 * 不包含任何具体游戏规则。
 */
export class GameRoom {
  readonly id: string;
  private readonly plugin: GamePlugin;
  private readonly mode: string;
  private readonly maxPlayers: number;
  private readonly deps: RoomDeps;
  private readonly seats = new Map<string, Seat>();
  private readonly ctx: RoomContext;

  private hostId: string | null = null;
  private status: RoomStatus = 'waiting';
  private round = 0;
  private seq = 0;
  private seed = '';
  private dirty = true;
  private settledThisRound = false;
  private tickTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly persistent: boolean;
  private platformNo = 0;
  private emoteTimes = new Map<string, number[]>();
  /** 结算展示期间预约的准备意愿 */
  private pendingReady = new Map<string, boolean>();
  /** 已开启「连续对局」的玩家：之后每局结算都自动准备 */
  private autoReady = new Set<string>();

  constructor(
    id: string,
    plugin: GamePlugin,
    mode: string,
    maxPlayers: number,
    deps: RoomDeps,
    options: { persistent?: boolean } = {},
  ) {
    this.id = id;
    this.plugin = plugin;
    this.mode = mode;
    this.maxPlayers = Math.max(plugin.meta.minPlayers, Math.min(maxPlayers, plugin.meta.maxPlayers));
    this.deps = deps;
    this.persistent = options.persistent === true;

    const self = this;
    this.ctx = {
      get config() {
        return {
          roomId: self.id,
          gameId: self.plugin.meta.gameId,
          mode: self.mode,
          maxPlayers: self.maxPlayers,
          round: self.round,
          seed: self.seed,
        };
      },
      get players(): readonly PlayerContext[] {
        return self.playerContexts();
      },
      getPlayer: (playerId: string) => self.playerContexts().find((p) => p.playerId === playerId),
      broadcast: (t: string, d: unknown) => {
        for (const seat of self.seats.values()) sendEnvelope(seat.socket, t, d);
      },
      sendTo: (playerId: string, t: string, d: unknown) => {
        sendEnvelope(self.seats.get(playerId)?.socket ?? null, t, d);
      },
      markDirty: () => {
        self.dirty = true;
      },
      settle: (input: SettlementInput) => self.handleSettle(input),
      beginRound: () => self.beginRound(),
      log: (message: string, extra?: Record<string, unknown>) => {
        roomLog.debug(message, { roomId: self.id, ...extra });
      },
    };

    this.plugin.onRoomCreate(this.ctx);
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);

    // 常驻房间：无玩家也持续开局
    if (this.persistent) {
      this.status = 'playing';
      this.beginRound();
    }
  }

  get isPersistent(): boolean {
    return this.persistent;
  }

  /** 台子容量：平台台固定 168，玩家房按游戏配置 */
  get capacity(): number {
    return this.persistent ? PLATFORM_CAPACITY : this.maxPlayers;
  }

  setPlatformNo(no: number): void {
    this.platformNo = no;
  }

  /** 补足/回收场内氛围玩家：真人少时热闹，真人多时让出容量 */
  private ensureAmbient(): void {
    if (!this.persistent || this.closed) return;

    const seats = [...this.seats.values()];
    const humans = seats.filter((seat) => !seat.isBot).length;
    const ambient = seats.filter((seat) => seat.playerId.startsWith('ambient:'));

    const desired =
      humans < 10
        ? AMBIENT_MIN + Math.floor(Math.random() * (AMBIENT_MAX - AMBIENT_MIN + 1))
        : Math.min(this.capacity, humans + 8);

    if (this.seats.size > desired) {
      for (const seat of ambient) {
        if (this.seats.size <= desired) break;
        this.seats.delete(seat.playerId);
      }
      this.dirty = true;
      return;
    }
    if (this.seats.size >= desired) return;

    const used = new Set([...this.seats.values()].map((seat) => seat.nickname));
    for (let i = this.seats.size; i < desired; i += 1) {
      const base = AMBIENT_NAMES[Math.floor(Math.random() * AMBIENT_NAMES.length)] ?? '牌友';
      let nickname = base;
      let suffix = 2;
      while (used.has(nickname)) nickname = `${base}${suffix++}`;
      used.add(nickname);

      const playerId = `ambient:${randomUUID()}`;
      this.seats.set(playerId, {
        playerId,
        nickname,
        seat: this.nextSeatIndex(),
        ready: true,
        score: 0,
        socket: null,
        graceTimer: null,
        isBot: true,
      });
    }
    this.dirty = true;
  }

  /** 开启新一局：常驻玩法由插件按时间轴主动调用 */
  beginRound(): void {
    if (this.closed) return;
    this.round += 1;
    this.seq += 1;
    this.seed = `${this.id}-${this.round}`;
    this.status = 'playing';
    this.settledThisRound = false;
    this.dirty = true;
    this.ensureAmbient();
    this.plugin.onRoundStart?.(this.ctx);
    this.broadcastView();
    this.pushSnapshots();
  }

  get gameId(): string {
    return this.plugin.meta.gameId;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** 是否还有空位且可加入 */
  get isJoinable(): boolean {
    return !this.closed && this.status === 'waiting' && this.seats.size < this.maxPlayers;
  }

  get playerCount(): number {
    return this.seats.size;
  }

  view(): RoomView {
    return {
      roomId: this.id,
      gameId: this.plugin.meta.gameId,
      mode: this.mode,
      status: this.status,
      round: this.round,
      maxPlayers: this.maxPlayers,
      players: this.playerViews(),
      hostId: this.hostId,
    };
  }

  /** 供选台列表使用 */
  summary(): RoomSummary {
    const host = [...this.seats.values()].find((seat) => seat.playerId === this.hostId);
    return {
      roomId: this.id,
      gameId: this.plugin.meta.gameId,
      roomName: this.persistent
        ? `${this.plugin.meta.name} · ${this.platformNo || 1} 号台`
        : `${host?.nickname ?? '玩家'}的${this.plugin.meta.name}`,
      hostId: this.hostId,
      hostName: this.persistent ? '平台庄' : (host?.nickname ?? '玩家'),
      players: this.seats.size,
      maxPlayers: this.capacity,
      status: this.status === 'closed' ? 'settled' : this.status,
      persistent: this.persistent,
      joinable: this.isJoinable || this.persistent,
    };
  }

  join(player: { playerId: string; nickname: string }, socket: WebSocket): void {
    const existing = this.seats.get(player.playerId);
    if (existing) {
      this.attach(player.playerId, socket);
      return;
    }
    // 常驻下注房不关盘，但受容量限制，玩家随时可进出
    if (!this.persistent) {
      if (this.status !== 'waiting') {
        throw new AppError(ErrorCode.RoomFull, '房间已开局，请等待本局结束');
      }
      if (this.seats.size >= this.maxPlayers) {
        throw new AppError(ErrorCode.RoomFull, '房间人数已满');
      }
    } else if (this.seats.size >= this.capacity) {
      throw new AppError(ErrorCode.RoomFull, '本桌已满，换一张台吧');
    }

    const seat: Seat = {
      playerId: player.playerId,
      nickname: player.nickname,
      seat: this.nextSeatIndex(),
      ready: false,
      score: 0,
      socket,
      graceTimer: null,
      isBot: false,
    };
    this.seats.set(player.playerId, seat);
    if (this.hostId === null) this.hostId = player.playerId;

    this.plugin.onPlayerJoin(this.ctx, {
      playerId: seat.playerId,
      nickname: seat.nickname,
      seat: seat.seat,
      connected: true,
      isBot: false,
    });

    this.broadcastView();
    this.dirty = true;
    this.tryStart();

    // 常驻房间开局中：新加入的玩家立刻拿到当前快照
    if (this.persistent && this.status === 'playing') {
      this.pushSnapshots();
    }
  }

  /** 添加机器人陪玩：入座即准备，由外部驱动器代其行动 */
  addBot(playerId: string, nickname: string): void {
    if (this.closed) throw new AppError(ErrorCode.RoomNotFound, '房间已关闭');
    if (this.seats.has(playerId)) return;
    if (this.status !== 'waiting') throw new AppError(ErrorCode.IllegalAction, '对局进行中，无法添加机器人');
    if (this.seats.size >= this.maxPlayers) throw new AppError(ErrorCode.RoomFull, '房间人数已满');

    const seat: Seat = {
      playerId,
      nickname,
      seat: this.nextSeatIndex(),
      ready: true,
      score: 0,
      socket: null,
      graceTimer: null,
      isBot: true,
    };
    this.seats.set(playerId, seat);
    if (this.hostId === null) this.hostId = playerId;

    this.plugin.onPlayerJoin(this.ctx, {
      playerId,
      nickname,
      seat: seat.seat,
      connected: true,
      isBot: true,
    });

    this.broadcastView();
    this.dirty = true;
    this.tryStart();
  }

  /** 当前行动的玩家，非对局中返回 null */
  currentActor(): string | null {
    if (this.closed || this.status !== 'playing') return null;
    try {
      return this.plugin.getCurrentActor?.(this.ctx) ?? null;
    } catch {
      return null;
    }
  }

  isBot(playerId: string): boolean {
    return this.seats.get(playerId)?.isBot === true;
  }

  /** 用规则 AI 代机器人行动，返回是否成功提交 */
  actAsBot(playerId: string): boolean {
    if (!this.isBot(playerId)) return false;
    try {
      const intent = this.plugin.botIntent?.(this.ctx, playerId) ?? null;
      if (!intent) return false;
      this.handleIntent(playerId, intent.cmd, intent.payload);
      return true;
    } catch (error) {
      console.warn(`[room ${this.id}] 机器人行动失败`, (error as Error).message);
      return false;
    }
  }

  /** 提交外部决策器（大模型）给出的机器人指令，合法性由容器统一校验 */
  applyBotIntent(playerId: string, intent: GameIntent): void {
    if (!this.isBot(playerId)) throw new AppError(ErrorCode.IllegalAction, '非机器人玩家');
    this.handleIntent(playerId, intent.cmd, intent.payload);
  }

  /** 供外部决策器（含大模型）读取局面 */
  snapshotFor(playerId: string): Record<string, unknown> | null {
    if (!this.seats.has(playerId)) return null;
    try {
      return this.plugin.getSnapshot(this.ctx, playerId);
    } catch {
      return null;
    }
  }

  /** 断线重连：复用原座位，保留分数与角色 */
  attach(playerId: string, socket: WebSocket): void {
    const seat = this.seats.get(playerId);
    if (!seat) throw new AppError(ErrorCode.RoomNotFound, '房间内不存在该玩家');
    if (seat.graceTimer) {
      clearTimeout(seat.graceTimer);
      seat.graceTimer = null;
    }
    seat.socket = socket;
    this.broadcastView();
    this.dirty = true;
    this.ctx.sendTo(playerId, ServerMsg.RoomView, { room: this.view() });
  }

  /** 连接断开：等待宽限期后真正移除 */
  detach(playerId: string): void {
    const seat = this.seats.get(playerId);
    if (!seat) return;
    seat.socket = null;
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    seat.graceTimer = setTimeout(() => this.removePlayer(playerId), this.deps.config.disconnectGraceMs);
    seat.graceTimer.unref?.();
    this.broadcastView();
    this.dirty = true;
  }

  setReady(playerId: string, ready: boolean): void {
    const seat = this.seats.get(playerId);
    if (!seat) throw new AppError(ErrorCode.RoomNotFound, '你不在该房间内');

    // 结算展示期间点的「准备」先预约下来，回到等待态时自动生效
    if (this.status === 'settled') {
      this.pendingReady.set(playerId, ready);
      if (ready) this.autoReady.add(playerId);
      else this.autoReady.delete(playerId);
      return;
    }
    if (this.status !== 'waiting') throw new AppError(ErrorCode.IllegalAction, '当前不能修改准备状态');
    // 主动准备即进入连续对局模式，主动取消才退出
    if (ready) this.autoReady.add(playerId);
    else this.autoReady.delete(playerId);
    if (seat.ready === ready) return;
    seat.ready = ready;
    this.plugin.onPlayerReady(this.ctx, playerId);
    this.broadcastView();
    this.tryStart();
  }

  handleIntent(playerId: string, cmd: string, payload: Record<string, unknown>): void {
    if (!this.seats.has(playerId)) throw new AppError(ErrorCode.RoomNotFound, '你不在该房间内');
    if (this.status !== 'playing') throw new AppError(ErrorCode.IllegalAction, '当前不在对局中');
    if (!this.plugin.commands.includes(cmd)) {
      throw new AppError(ErrorCode.IllegalAction, `未知指令: ${cmd}`);
    }
    this.plugin.onIntent(this.ctx, playerId, { cmd, payload });
  }

  /** 客户端主动离开 */
  leave(playerId: string): void {
    const inGame = this.status === 'playing';
    if (inGame) {
      // 对局中直接退出视为认输，交由插件决定结算
      this.plugin.onPlayerLeave(this.ctx, playerId);
      this.removeSeat(playerId);
      this.checkEnoughPlayers();
    } else {
      this.removeSeat(playerId);
    }
    this.broadcastView();
    this.dirty = true;
  }

  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.tickTimer = null;
    for (const seat of this.seats.values()) {
      if (seat.graceTimer) clearTimeout(seat.graceTimer);
      try {
        seat.socket?.close(4001, 'room closed');
      } catch {
        /* ignore */
      }
    }
    this.seats.clear();
    this.plugin.onDestroy?.(this.ctx);
    this.deps.empty(this.id);
  }

  private tick(): void {
    if (this.closed) return;
    if (this.status === 'playing') {
      try {
        this.plugin.onTick?.(this.ctx, TICK_MS);
      } catch (error) {
        console.error(`[room ${this.id}] onTick 异常`, error);
      }
      if (this.dirty) {
        this.dirty = false;
        this.pushSnapshots();
      }
    }
  }

  private tryStart(): void {
    if (this.status !== 'waiting' || this.closed) return;
    if (this.seats.size < this.plugin.meta.minPlayers) return;
    if (![...this.seats.values()].every((s) => s.ready)) return;
    this.startRound();
  }

  private startRound(): void {
    this.round += 1;
    this.seed = randomBytes(16).toString('hex');
    this.status = 'playing';
    this.settledThisRound = false;
    this.plugin.onRoundStart?.(this.ctx);
    this.dirty = true;
    this.broadcastView();
    this.pushSnapshots();
  }

  private handleSettle(input: SettlementInput): void {
    if (this.settledThisRound) {
      throw new AppError(ErrorCode.IllegalAction, '本局已结算，不能重复结算');
    }
    this.settledThisRound = true;
    // 常驻房间由插件接续下一局，状态保持 playing，避免中途加入的玩家看到「已结算」
    this.status = this.persistent ? 'playing' : 'settled';

    const entries = input.entries.filter((e) => {
      const valid = Number.isInteger(e.delta) && Math.abs(e.delta) <= 1_000_000;
      if (!valid) console.warn(`[room ${this.id}] 结算条目非法，已丢弃`, e);
      return valid;
    });
    const settlement: Settlement = {
      settlementId: `${this.id}:${this.round}`,
      roomId: this.id,
      gameId: this.plugin.meta.gameId,
      round: this.round,
      seed: this.seed,
      winners: input.winners,
      entries,
      finishedAt: Date.now(),
    };

    for (const entry of entries) {
      const seat = this.seats.get(entry.playerId);
      if (seat) seat.score += entry.delta;
    }

    this.ctx.broadcast(ServerMsg.Settlement, { settlement });
    this.deps.settle(settlement);
    this.dirty = true;
    this.pushSnapshots();

    // 常驻玩法由插件自己接续下一局，不回到准备态
    if (!this.persistent) {
      setTimeout(() => this.resetRound(), SETTLE_RESET_MS).unref?.();
    }
  }

  private resetRound(): void {
    if (this.closed) return;
    this.status = 'waiting';
    // 机器人没有客户端，结算后自动重新准备，否则只能陪玩一局
    // 真人若点过「继续」，视为开启连续对局，后续每局都自动准备
    for (const seat of this.seats.values()) {
      seat.ready = seat.isBot || this.autoReady.has(seat.playerId);
    }
    this.pendingReady.clear();
    this.broadcastView();
    this.dirty = true;
    this.tryStart();
  }

  /** 快捷喊话：白名单文本 + 频率限制，广播给房间内所有人 */
  sendEmote(playerId: string, key: string, text: string): void {
    const seat = this.seats.get(playerId);
    if (!seat) throw new AppError(ErrorCode.RoomNotFound, '你不在该房间内');
    if (this.closed) return;

    const now = Date.now();
    const recent = (this.emoteTimes.get(playerId) ?? []).filter((t) => now - t < 10_000);
    if (recent.length >= 6) {
      throw new AppError(ErrorCode.RateLimited, '喊话太频繁，歇一下');
    }
    recent.push(now);
    this.emoteTimes.set(playerId, recent);

    this.ctx.broadcast(ServerMsg.Emote, {
      playerId,
      nickname: seat.nickname,
      key,
      text,
      at: now,
    });
  }

  private checkEnoughPlayers(): void {
    if (this.persistent) return;
    if (this.seats.size === 0) {
      this.destroy();
      return;
    }
    // 真人全部离开后，纯机器人房间没有存在意义
    if (![...this.seats.values()].some((seat) => !seat.isBot)) {
      this.destroy();
      return;
    }
    if (this.status === 'playing' && this.seats.size < this.plugin.meta.minPlayers) {
      // 人数不足，中止本局（不计输赢）
      this.status = 'waiting';
      for (const seat of this.seats.values()) seat.ready = false;
      this.broadcastView();
    }
  }

  private removePlayer(playerId: string): void {
    this.autoReady.delete(playerId);
    this.pendingReady.delete(playerId);
    this.emoteTimes.delete(playerId);
    this.removeSeat(playerId);
    this.broadcastView();
    this.dirty = true;
    this.checkEnoughPlayers();
  }

  private removeSeat(playerId: string): void {
    const seat = this.seats.get(playerId);
    if (!seat) return;
    if (seat.graceTimer) clearTimeout(seat.graceTimer);
    this.seats.delete(playerId);
    this.plugin.onPlayerLeave(this.ctx, playerId);

    if (this.hostId === playerId) {
      const next = [...this.seats.values()].sort((a, b) => a.seat - b.seat)[0];
      this.hostId = next ? next.playerId : null;
    }
    if (this.seats.size === 0) this.destroy();
  }

  private nextSeatIndex(): number {
    const used = new Set([...this.seats.values()].map((s) => s.seat));
    for (let i = 0; i < this.maxPlayers; i += 1) {
      if (!used.has(i)) return i;
    }
    return this.seats.size;
  }

  private playerContexts(): PlayerContext[] {
    return [...this.seats.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((s) => ({
        playerId: s.playerId,
        nickname: s.nickname,
        seat: s.seat,
        connected: s.socket !== null || s.isBot,
        isBot: s.isBot,
      }));
  }

  private playerViews(): PlayerView[] {
    return [...this.seats.values()]
      .sort((a, b) => a.seat - b.seat)
      .map((s) => ({
        playerId: s.playerId,
        nickname: s.nickname,
        seat: s.seat,
        ready: s.ready,
        online: s.socket !== null || s.isBot,
        score: s.score,
        isBot: s.isBot,
      }));
  }

  private broadcastView(): void {
    this.ctx.broadcast(ServerMsg.RoomView, { room: this.view() });
  }

  private pushSnapshots(): void {
    this.seq += 1;
    const view = this.view();
    for (const seat of this.seats.values()) {
      if (!seat.socket) continue;
      try {
        const snapshot = this.plugin.getSnapshot(this.ctx, seat.playerId);
        sendEnvelope(seat.socket, ServerMsg.Snapshot, {
          roomId: this.id,
          gameId: this.plugin.meta.gameId,
          status: view.status,
          round: this.round,
          seq: this.seq,
          snapshot,
        });
      } catch (error) {
        console.error(`[room ${this.id}] getSnapshot 异常`, error);
      }
    }
  }
}
