import { randomBytes, randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  AppError,
  ErrorCode,
  ServerMsg,
  stakesTierOf,
  type BotDifficulty,
  type GameMeta,
  type RoomStatus,
  type RoomSummary,
  type RoomView,
  type StakesTier,
} from '@cc/protocol';
import type { GamePlugin, PlayerContext, RoomContext, SettlementInput } from '@cc/game-sdk';
import { BOT_NAMES } from './bot';
import { createLogger } from './logger';
import { reconcileAmbientSeats } from './room/ambient';
import { applySettlementScores, buildSettlementEnvelope } from './room/settlement';
import {
  HOST_ACT_DELAY_MS,
  PLATFORM_CAPACITY,
  SETTLE_RESET_MS,
  TICK_MS,
  TURN_TIMEOUT_MS,
  sendEnvelope,
  type RoomDeps,
  type Seat,
  type Spectator,
} from './room/types';
import { buildRoomSummary, buildRoomView, recentTrendFor, toPlayerContexts } from './room/view';

const roomLog = createLogger('room');

export { PLATFORM_CAPACITY, type RoomDeps };

/**
 * 通用房间容器：承载任意 GamePlugin。
 * 负责座位、准备、开局、断线重连、快照下发与结算上报，不包含任何具体游戏规则。
 */
export class GameRoom {
  readonly id: string;
  private readonly plugin: GamePlugin;
  private readonly mode: string;
  private readonly maxPlayers: number;
  private readonly deps: RoomDeps;
  private readonly seats = new Map<string, Seat>();
  private readonly spectators = new Map<string, Spectator>();
  private readonly ctx: RoomContext;

  private hostId: string | null = null;
  private status: RoomStatus = 'waiting';
  private round = 0;
  private seq = 0;
  /** 本进程内递增，用于生成下注扣款的幂等凭证 */
  private betSeq = 0;
  /** 同一玩家的意图队列，保证 await 扣款期间不会被并发指令穿插 */
  private readonly intentQueues = new Map<string, Promise<void>>();
  private seed = '';
  private dirty = true;
  private settledThisRound = false;
  private tickTimer: NodeJS.Timeout | null = null;
  private closed = false;
  private readonly persistent: boolean;
  private readonly botHosted: boolean;
  readonly stakesTier: StakesTier;
  readonly stakeMultiplier: number;
  private platformNo = 0;
  private emoteTimes = new Map<string, number[]>();
  private chatTimes = new Map<string, number[]>();
  /** 开启了托管（手动或超时自动开启）的玩家集合 */
  private readonly hostedPlayers = new Set<string>();
  private turnActorId: string | null = null;
  private turnDeadlineAt: number | null = null;
  private hostActionInFlight = false;
  /** 结算展示期间预约的准备意愿 */
  private pendingReady = new Map<string, boolean>();
  /** 已开启「连续对局」的玩家：之后每局结算都自动准备 */
  private autoReady = new Set<string>();
  /** 本局已下注/扣款的真人玩家集合（用于维护排水期精确判断常驻牌桌是否有进行中的真人注单） */
  private activeHumanBets = new Set<string>();
  /** 常驻房间上次推送状态快照时间（避免长静默期移动端切回后台后倒计时不同步） */
  private lastSyncPushAt = 0;

  constructor(
    id: string,
    plugin: GamePlugin,
    mode: string,
    maxPlayers: number,
    deps: RoomDeps,
    options: { persistent?: boolean; botHosted?: boolean; stakesTier?: StakesTier } = {},
  ) {
    this.id = id;
    this.plugin = plugin;
    this.mode = mode;
    this.maxPlayers = Math.max(plugin.meta.minPlayers, Math.min(maxPlayers, plugin.meta.maxPlayers));
    this.deps = deps;
    this.persistent = options.persistent === true;
    this.botHosted = options.botHosted === true;
    const tierCfg = stakesTierOf(options.stakesTier);
    this.stakesTier = tierCfg.tier;
    this.stakeMultiplier = this.persistent ? 1 : tierCfg.multiplier;

    const getConfig = () => ({
      roomId: this.id,
      gameId: this.plugin.meta.gameId,
      mode: this.mode,
      maxPlayers: this.maxPlayers,
      round: this.round,
      seed: this.seed,
      stakeMultiplier: this.stakeMultiplier,
    });
    const getPlayers = () => toPlayerContexts(this.seats.values());

    this.ctx = {
      get config() {
        return getConfig();
      },
      get players(): readonly PlayerContext[] {
        return getPlayers();
      },
      getPlayer: (playerId: string) => toPlayerContexts(this.seats.values()).find((p) => p.playerId === playerId),
      broadcast: (t: string, d: unknown) => {
        for (const seat of this.seats.values()) sendEnvelope(seat.socket, t, d);
        for (const spec of this.spectators.values()) sendEnvelope(spec.socket, t, d);
      },
      sendTo: (playerId: string, t: string, d: unknown) => {
        const sock = this.seats.get(playerId)?.socket ?? this.spectators.get(playerId)?.socket ?? null;
        sendEnvelope(sock, t, d);
      },
      markDirty: () => {
        this.dirty = true;
      },
      settle: (input: SettlementInput) => this.handleSettle(input),
      charge: async (playerId: string, amount: number) => {
        const ref = `${this.id}:${this.round}:${playerId}:${++this.betSeq}`;
        const balance = await this.deps.adjustWallet({ playerId, amount, action: 'debit', bizId: ref });
        if (!playerId.startsWith('bot:') && !playerId.startsWith('ambient:')) {
          this.activeHumanBets.add(playerId);
        }
        this.ctx.sendTo(playerId, ServerMsg.Wallet, { balance });
        return ref;
      },
      refund: async (playerId: string, ref: string) => {
        const balance = await this.deps.adjustWallet({ playerId, amount: 0, action: 'refund', bizId: ref });
        this.activeHumanBets.delete(playerId);
        this.ctx.sendTo(playerId, ServerMsg.Wallet, { balance });
      },
      beginRound: () => this.beginRound(),
      log: (message: string, extra?: Record<string, unknown>) => {
        roomLog.debug(message, { roomId: this.id, ...extra });
      },
    };

    this.plugin.onRoomCreate(this.ctx);
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);

    if (this.persistent) {
      this.status = 'playing';
      this.beginRound();
    }
  }

  get isPersistent(): boolean {
    return this.persistent;
  }

  get isBotHosted(): boolean {
    return this.botHosted;
  }

  get spectatorCount(): number {
    return this.spectators.size;
  }

  /** 是否存在正在进行中的真人对局（维护更新前需等待全部真人本局结算完） */
  get hasActiveHumanGame(): boolean {
    if (this.closed) return false;
    if (this.persistent) {
      return this.activeHumanBets.size > 0;
    }
    if (this.status !== 'playing') return false;
    for (const seat of this.seats.values()) {
      if (!seat.isBot) return true;
    }
    return false;
  }

  /** 当前房间真人数量 */
  get humanCount(): number {
    let count = 0;
    for (const seat of this.seats.values()) {
      if (!seat.isBot) count += 1;
    }
    return count;
  }

  get pluginMeta(): GameMeta {
    return this.plugin.meta;
  }

  get capacity(): number {
    return this.persistent ? PLATFORM_CAPACITY : this.maxPlayers;
  }

  setPlatformNo(no: number): void {
    this.platformNo = no;
  }

  private ensureAmbient(): void {
    if (!this.persistent || this.closed) return;
    if (reconcileAmbientSeats(this.seats, this.capacity, () => this.nextSeatIndex())) {
      this.dirty = true;
    }
  }

  /** 开启新一局：常驻玩法由插件按时间轴主动调用 */
  beginRound(): void {
    if (this.closed) return;
    // 单游戏/全站排水期间暂停新一局，已在局由结算后自然停下
    if (this.deps.isDraining?.(this.plugin.meta.gameId)) return;
    this.round += 1;
    this.seq += 1;
    // 种子必须不可预测：房间号与局数客户端都可见，用它们派生种子等于公开整副牌。
    this.seed = randomBytes(16).toString('hex');
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

  get isPlatform(): boolean {
    return this.persistent;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get isJoinable(): boolean {
    return !this.closed && this.status === 'waiting' && this.seats.size < this.maxPlayers;
  }

  get playerCount(): number {
    return this.seats.size;
  }

  view(): RoomView {
    return buildRoomView({
      roomId: this.id,
      gameId: this.plugin.meta.gameId,
      mode: this.mode,
      status: this.status,
      round: this.round,
      maxPlayers: this.maxPlayers,
      hostId: this.hostId,
      seats: this.seats.values(),
      botHosted: this.botHosted,
      spectators: this.spectators.values(),
      stakesTier: this.stakesTier,
      stakeMultiplier: this.stakeMultiplier,
      turnActorId: this.turnActorId,
      turnDeadlineAt: this.turnDeadlineAt,
      hostedPlayerIds: [...this.hostedPlayers],
    });
  }

  summary(): RoomSummary {
    return buildRoomSummary({
      roomId: this.id,
      meta: this.plugin.meta,
      persistent: this.persistent,
      botHosted: this.botHosted,
      platformNo: this.platformNo,
      hostId: this.hostId,
      seats: this.seats.values(),
      spectatorCount: this.spectators.size,
      capacity: this.capacity,
      status: this.status,
      joinable: this.isJoinable,
      recent: recentTrendFor(this.plugin, this.ctx, this.persistent),
      stakesTier: this.stakesTier,
      stakeMultiplier: this.stakeMultiplier,
    });
  }

  /** 以观战模式进入机器人自建房，默认只看牌不入座；点击入座后加入下一局或立即入座 */
  joinAsSpectator(
    player: { playerId: string; nickname: string; avatar?: string | null; equippedFrame?: string },
    socket: WebSocket,
  ): void {
    if (this.closed) throw new AppError(ErrorCode.RoomNotFound, '房间已关闭');
    const existingSeat = this.seats.get(player.playerId);
    if (existingSeat) {
      if (player.avatar !== undefined) existingSeat.avatar = player.avatar;
      if (player.equippedFrame) existingSeat.equippedFrame = player.equippedFrame;
      this.attach(player.playerId, socket);
      return;
    }

    this.spectators.set(player.playerId, {
      playerId: player.playerId,
      nickname: player.nickname,
      socket,
      queuedToSit: false,
      avatar: player.avatar ?? null,
      equippedFrame: player.equippedFrame ?? 'frame_default',
    });

    this.broadcastView();
    if (this.round > 0 || this.status === 'playing' || this.status === 'settled') {
      this.pushSnapshotToSocket(socket, null);
    }
  }

  /** 观战玩家点击「入座」加入对局：若等待中立即入座（满员则替换一名机器人），若对局中则预约下局自动入座 */
  sitDown(playerId: string): { status: 'seated' | 'queued'; message: string } {
    if (this.closed) throw new AppError(ErrorCode.RoomNotFound, '房间已关闭');
    if (this.deps.isDraining?.(this.plugin.meta.gameId)) {
      throw new AppError(ErrorCode.GameUnavailable, '该游戏维护中，暂停入座开新局，请稍候或前往其它玩法！');
    }
    if (this.seats.has(playerId)) {
      return { status: 'seated', message: '您已在牌桌上入座' };
    }
    const spec = this.spectators.get(playerId);
    if (!spec) {
      throw new AppError(ErrorCode.RoomNotFound, '请先进入房间');
    }

    if (this.status === 'waiting') {
      const seated = this.seatSpectatorNow(spec);
      if (!seated) {
        throw new AppError(ErrorCode.RoomFull, '牌桌真人已满，请稍候观战');
      }
      this.broadcastView();
      this.dirty = true;
      this.tryStart();
      return { status: 'seated', message: '入座成功，牌局即将开始！' };
    }

    spec.queuedToSit = true;
    this.broadcastView();
    return { status: 'queued', message: '已预约入座，本局结束后将自动为您安排座位！' };
  }

  /** 离座返回观战或取消入座预约 */
  standUp(playerId: string): void {
    if (this.closed) return;
    const spec = this.spectators.get(playerId);
    if (spec) {
      if (spec.queuedToSit) {
        spec.queuedToSit = false;
        this.broadcastView();
      }
      return;
    }

    const seat = this.seats.get(playerId);
    if (!seat || !this.botHosted) return;
    const savedSocket = seat.socket;
    const savedNickname = seat.nickname;
    const savedAvatar = seat.avatar ?? null;
    const savedFrame = seat.equippedFrame ?? 'frame_default';
    this.autoReady.delete(playerId);
    this.pendingReady.delete(playerId);
    this.removeSeat(playerId);

    this.spectators.set(playerId, {
      playerId,
      nickname: savedNickname,
      socket: savedSocket,
      queuedToSit: false,
      avatar: savedAvatar,
      equippedFrame: savedFrame,
    });

    this.checkEnoughPlayers();
    this.broadcastView();
    this.dirty = true;
    if (savedSocket && (this.round > 0 || this.status === 'playing' || this.status === 'settled')) {
      this.pushSnapshotToSocket(savedSocket, null);
    }
  }

  private evictOneBot(): boolean {
    const bots = [...this.seats.values()].filter((s) => s.isBot);
    if (bots.length === 0) return false;
    // 优先请离非房主机器人
    const victim = bots.find((b) => b.playerId !== this.hostId) ?? bots[0]!;
    this.seats.delete(victim.playerId);
    if (this.hostId === victim.playerId) {
      const next = [...this.seats.values()].sort((a, b) => a.seat - b.seat)[0];
      this.hostId = next ? next.playerId : null;
    }
    return true;
  }

  private seatSpectatorNow(spec: Spectator): boolean {
    if (this.seats.size >= this.maxPlayers) {
      if (!this.evictOneBot()) return false;
    }
    this.spectators.delete(spec.playerId);
    const seat: Seat = {
      playerId: spec.playerId,
      nickname: spec.nickname,
      seat: this.nextSeatIndex(),
      ready: true,
      score: 0,
      socket: spec.socket,
      graceTimer: null,
      isBot: false,
      avatar: spec.avatar ?? null,
      equippedFrame: spec.equippedFrame ?? 'frame_default',
    };
    this.seats.set(spec.playerId, seat);
    this.pendingReady.set(spec.playerId, true);
    if (this.hostId === null) this.hostId = spec.playerId;

    this.plugin.onPlayerJoin(this.ctx, {
      playerId: seat.playerId,
      nickname: seat.nickname,
      seat: seat.seat,
      connected: seat.socket !== null,
      isBot: false,
    });
    return true;
  }

  private refillBotHostedSeats(): void {
    if (!this.botHosted || this.closed) return;
    const minTarget = this.plugin.meta.minPlayers;
    if (this.seats.size >= minTarget) return;
    const diff: BotDifficulty = 'high';
    const used = new Set([...this.seats.values()].map((s) => s.nickname));
    while (this.seats.size < minTarget) {
      const free = BOT_NAMES.filter((name) => !used.has(`🤖 ${name}`));
      const picked = free[Math.floor(Math.random() * free.length)] ?? `机器人${this.seats.size + 1}`;
      const nickname = `🤖 ${picked}`;
      used.add(nickname);
      const botId = `bot:${randomUUID()}`;
      const seat: Seat = {
        playerId: botId,
        nickname,
        seat: this.nextSeatIndex(),
        ready: true,
        score: 0,
        socket: null,
        graceTimer: null,
        isBot: true,
        botDifficulty: diff,
      };
      this.seats.set(botId, seat);
      if (this.hostId === null) this.hostId = botId;
      this.plugin.onPlayerJoin(this.ctx, {
        playerId: botId,
        nickname,
        seat: seat.seat,
        connected: true,
        isBot: true,
        botDifficulty: diff,
      });
    }
  }

  join(
    player: { playerId: string; nickname: string; avatar?: string | null; equippedFrame?: string },
    socket: WebSocket,
  ): void {
    const existing = this.seats.get(player.playerId);
    if (existing) {
      if (player.avatar !== undefined) existing.avatar = player.avatar;
      if (player.equippedFrame) existing.equippedFrame = player.equippedFrame;
      this.attach(player.playerId, socket);
      return;
    }
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
      avatar: player.avatar ?? null,
      equippedFrame: player.equippedFrame ?? 'frame_default',
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

    if (this.persistent && this.status === 'playing') {
      this.pushSnapshots();
    }
  }

  /** 添加机器人陪玩：入座即准备，按指定难度由本地博弈算法代其行动 */
  addBot(
    playerId: string,
    nickname: string,
    difficulty: BotDifficulty = 'high',
    options?: { deferStart?: boolean },
  ): void {
    if (this.closed) throw new AppError(ErrorCode.RoomNotFound, '房间已关闭');
    if (this.seats.has(playerId)) return;
    const capacityLimit = this.persistent ? this.capacity : this.maxPlayers;
    if (this.seats.size >= capacityLimit) throw new AppError(ErrorCode.RoomFull, '房间人数已满');
    if (!this.persistent && this.status !== 'waiting') {
      throw new AppError(ErrorCode.IllegalAction, '对局进行中，无法添加机器人');
    }

    const seat: Seat = {
      playerId,
      nickname,
      seat: this.nextSeatIndex(),
      ready: true,
      score: 0,
      socket: null,
      graceTimer: null,
      isBot: true,
      botDifficulty: difficulty,
    };
    this.seats.set(playerId, seat);
    if (this.hostId === null) this.hostId = playerId;

    this.plugin.onPlayerJoin(this.ctx, {
      playerId,
      nickname,
      seat: seat.seat,
      connected: true,
      isBot: true,
      botDifficulty: difficulty,
    });

    this.broadcastView();
    this.dirty = true;
    if (!options?.deferStart) {
      this.tryStart();
    }
  }

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

  botDifficultyOf(playerId: string): BotDifficulty {
    return this.seats.get(playerId)?.botDifficulty ?? 'high';
  }

  async actAsBot(playerId: string): Promise<boolean> {
    if (!this.isBot(playerId)) return false;
    try {
      const difficulty = this.botDifficultyOf(playerId);
      const intent = this.plugin.botIntent?.(this.ctx, playerId, difficulty) ?? null;
      if (!intent) return false;
      await this.handleIntent(playerId, intent.cmd, intent.payload);
      return true;
    } catch (error) {
      console.warn(`[room ${this.id}] 机器人行动失败`, (error as Error).message);
      return false;
    }
  }

  /** 断线重连：复用原座位，保留分数与角色；观战者直接重绑连接 */
  attach(playerId: string, socket: WebSocket): void {
    const seat = this.seats.get(playerId);
    if (seat) {
      if (seat.graceTimer) {
        clearTimeout(seat.graceTimer);
        seat.graceTimer = null;
      }
      seat.socket = socket;
      this.broadcastView();
      this.dirty = true;
      this.ctx.sendTo(playerId, ServerMsg.RoomView, { room: this.view() });
      return;
    }
    const spec = this.spectators.get(playerId);
    if (spec) {
      spec.socket = socket;
      this.ctx.sendTo(playerId, ServerMsg.RoomView, { room: this.view() });
      if (this.round > 0 || this.status === 'playing' || this.status === 'settled') {
        this.pushSnapshotToSocket(socket, null);
      }
      return;
    }
    throw new AppError(ErrorCode.RoomNotFound, '房间内不存在该玩家');
  }

  /** 连接断开：校验 socket 引用，避免双端切换时旧连接误删新连接 */
  detach(playerId: string, socket?: WebSocket | null): void {
    const spec = this.spectators.get(playerId);
    if (spec) {
      if (socket && spec.socket !== socket) return;
      this.spectators.delete(playerId);
      this.broadcastView();
      return;
    }
    const seat = this.seats.get(playerId);
    if (!seat) return;
    if (socket && seat.socket !== socket) return;
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
    if (ready && !seat.isBot && this.deps.isDraining?.(this.plugin.meta.gameId)) {
      throw new AppError(
        ErrorCode.GameUnavailable,
        '该游戏维护中，当前暂停开启新对局，请稍候或前往其它玩法！',
      );
    }

    if (this.status === 'settled') {
      this.pendingReady.set(playerId, ready);
      if (ready) this.autoReady.add(playerId);
      else this.autoReady.delete(playerId);
      return;
    }
    if (this.status !== 'waiting') throw new AppError(ErrorCode.IllegalAction, '当前不能修改准备状态');
    if (ready) this.autoReady.add(playerId);
    else this.autoReady.delete(playerId);
    if (seat.ready === ready) return;
    seat.ready = ready;
    this.plugin.onPlayerReady(this.ctx, playerId);
    this.broadcastView();
    this.tryStart();
  }

  async handleIntent(
    playerId: string,
    cmd: string,
    payload: Record<string, unknown>,
    isHostedAuto = false,
  ): Promise<void> {
    if (!this.seats.has(playerId)) throw new AppError(ErrorCode.RoomNotFound, '你不在该房间内');
    if (this.status !== 'playing') throw new AppError(ErrorCode.IllegalAction, '当前不在对局中');
    if (
      this.deps.isDraining?.(this.plugin.meta.gameId) &&
      this.persistent &&
      (cmd === 'bet' || cmd === 'spin')
    ) {
      throw new AppError(
        ErrorCode.GameUnavailable,
        '该游戏维护中，当前暂停新下注，请等待本局结算或前往其它玩法！',
      );
    }
    if (!this.plugin.commands.includes(cmd)) {
      throw new AppError(ErrorCode.IllegalAction, `未知指令: ${cmd}`);
    }
    // 真人手动出牌/行动时自动取消超时托管状态
    if (!isHostedAuto && this.hostedPlayers.delete(playerId)) {
      this.broadcastView();
    }
    // 同一玩家的指令串行执行，避免 await 扣款期间并发下注重复扣款或覆盖注单
    const prev = this.intentQueues.get(playerId) ?? Promise.resolve();
    const run = prev.catch(() => undefined).then(async () => {
      try {
        await this.plugin.onIntent(this.ctx, playerId, { cmd, payload });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(ErrorCode.IllegalAction, (error as Error).message || '操作失败');
      }
    });
    this.intentQueues.set(playerId, run);
    try {
      await run;
    } finally {
      if (this.intentQueues.get(playerId) === run) this.intentQueues.delete(playerId);
    }
  }

  leave(playerId: string): void {
    if (this.spectators.has(playerId)) {
      this.spectators.delete(playerId);
      this.broadcastView();
      return;
    }
    this.removeSeat(playerId);
    this.checkEnoughPlayers();
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
    for (const spec of this.spectators.values()) {
      try {
        spec.socket?.close(4001, 'room closed');
      } catch {
        /* ignore */
      }
    }
    this.seats.clear();
    this.spectators.clear();
    this.plugin.onDestroy?.(this.ctx);
    void this.deps.releaseBets(this.id).catch(() => undefined);
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

      // 回合制对战玩法：监测当前行动玩家，计算超时与自动托管代打
      if (!this.persistent && typeof this.plugin.getCurrentActor === 'function') {
        const actor = this.currentActor();
        if (actor !== this.turnActorId) {
          this.turnActorId = actor;
          if (actor && !this.isBot(actor)) {
            this.turnDeadlineAt = this.hostedPlayers.has(actor)
              ? Date.now() + HOST_ACT_DELAY_MS
              : Date.now() + TURN_TIMEOUT_MS;
          } else {
            this.turnDeadlineAt = null;
          }
          this.broadcastView();
        } else if (
          this.turnActorId &&
          !this.isBot(this.turnActorId) &&
          this.turnDeadlineAt !== null &&
          Date.now() >= this.turnDeadlineAt &&
          !this.hostActionInFlight
        ) {
          if (!this.hostedPlayers.has(this.turnActorId)) {
            this.hostedPlayers.add(this.turnActorId);
            this.broadcastView();
          }
          void this.triggerHostedAction(this.turnActorId);
        }
      }

      if (this.dirty) {
        this.dirty = false;
        this.lastSyncPushAt = Date.now();
        this.pushSnapshots();
      } else if (this.persistent && this.humanCount > 0 && Date.now() - this.lastSyncPushAt >= 2000) {
        this.lastSyncPushAt = Date.now();
        this.pushSnapshots();
      }
    }
  }

  private async triggerHostedAction(actorId: string): Promise<void> {
    if (this.closed || this.status !== 'playing' || this.hostActionInFlight) return;
    if (this.currentActor() !== actorId || this.isBot(actorId)) return;
    this.hostActionInFlight = true;
    try {
      const intent = this.plugin.botIntent?.(this.ctx, actorId, 'high') ?? null;
      if (!intent) return;
      await this.handleIntent(actorId, intent.cmd, intent.payload, true);
    } catch (error) {
      roomLog.warn('超时/托管代打执行失败', {
        roomId: this.id,
        actorId,
        error: (error as Error).message,
      });
    } finally {
      this.hostActionInFlight = false;
    }
  }

  /** 玩家主动切换托管状态 */
  toggleHost(playerId: string): boolean {
    if (!this.seats.has(playerId)) throw new AppError(ErrorCode.RoomNotFound, '你不在该房间内');
    if (this.persistent) throw new AppError(ErrorCode.IllegalAction, '百人下注玩法不支持托管');
    const next = !this.hostedPlayers.has(playerId);
    if (next) this.hostedPlayers.add(playerId);
    else this.hostedPlayers.delete(playerId);

    if (this.status === 'playing' && this.turnActorId === playerId) {
      this.turnDeadlineAt = next ? Date.now() + HOST_ACT_DELAY_MS : Date.now() + TURN_TIMEOUT_MS;
    }
    this.broadcastView();
    return next;
  }

  private tryStart(): void {
    if (this.status !== 'waiting' || this.closed) return;
    if (this.deps.isDraining?.(this.plugin.meta.gameId) && this.humanCount > 0) return;
    if (this.seats.size < this.plugin.meta.minPlayers) return;
    if (![...this.seats.values()].every((s) => s.ready)) return;
    this.startRound();
  }

  private startRound(): void {
    this.round += 1;
    this.seed = randomBytes(16).toString('hex');
    this.status = 'playing';
    this.settledThisRound = false;
    this.activeHumanBets.clear();
    this.hostedPlayers.clear();
    this.turnActorId = null;
    this.turnDeadlineAt = null;
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
    this.activeHumanBets.clear();
    this.turnActorId = null;
    this.turnDeadlineAt = null;
    this.hostedPlayers.clear();
    this.status = this.persistent ? 'playing' : 'settled';

    const settlement = buildSettlementEnvelope({
      roomId: this.id,
      gameId: this.plugin.meta.gameId,
      round: this.round,
      seed: this.seed,
      input,
    });
    applySettlementScores(this.seats, settlement);

    this.ctx.broadcast(ServerMsg.Settlement, { settlement });
    const hasHuman = settlement.entries.some(
      (e) => !e.playerId.startsWith('bot:') && !e.playerId.startsWith('ambient:'),
    );
    if (!this.botHosted || hasHuman) {
      this.deps.settle(settlement);
    }
    this.dirty = true;
    this.pushSnapshots();

    if (!this.persistent) {
      setTimeout(() => this.resetRound(), SETTLE_RESET_MS).unref?.();
    }
  }

  private resetRound(): void {
    if (this.closed) return;
    this.status = 'waiting';
    if (this.botHosted) {
      // 将预约入座的观战玩家安排上桌，并确保桌内机器人足够继续下一局
      for (const spec of [...this.spectators.values()]) {
        if (spec.queuedToSit && spec.socket) {
          this.seatSpectatorNow(spec);
        }
      }
      this.refillBotHostedSeats();
    }
    for (const seat of this.seats.values()) {
      // 真人玩家本局结束后不再强行自动开下一把，必须明确点击「再来一局 / 立即准备」才继续
      seat.ready = seat.isBot || this.pendingReady.get(seat.playerId) === true;
    }
    this.autoReady.clear();
    this.pendingReady.clear();
    this.broadcastView();
    this.dirty = true;
    this.tryStart();
  }

  forceReset(): void {
    if (this.closed) return;
    void this.deps.releaseBets(this.id).catch((error: unknown) => {
      roomLog.error('GM 中止本局退款失败', { roomId: this.id, error: (error as Error).message });
    });
    this.status = 'waiting';
    this.settledThisRound = false;
    for (const seat of this.seats.values()) seat.ready = seat.isBot;
    this.pendingReady.clear();
    this.broadcastView();
    this.dirty = true;
  }

  sendEmote(playerId: string, key: string, text: string): void {
    const who = this.seats.get(playerId) ?? this.spectators.get(playerId);
    if (!who) throw new AppError(ErrorCode.RoomNotFound, '你不在该房间内');
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
      nickname: who.nickname,
      key,
      text,
      at: now,
    });
  }

  /** 房间内轻量文字聊天（含刷屏限频与长度裁剪） */
  sendChat(playerId: string, rawText: string): void {
    const who = this.seats.get(playerId) ?? this.spectators.get(playerId);
    if (!who) throw new AppError(ErrorCode.RoomNotFound, '你不在该房间内');
    if (this.closed) return;

    const text = rawText.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!text) throw new AppError(ErrorCode.BadRequest, '请输入聊天内容');

    const now = Date.now();
    const recent = (this.chatTimes.get(playerId) ?? []).filter((t) => now - t < 10_000);
    if (recent.length >= 6) {
      throw new AppError(ErrorCode.RateLimited, '发言太频繁，休息 10 秒再发吧');
    }
    recent.push(now);
    this.chatTimes.set(playerId, recent);

    this.ctx.broadcast(ServerMsg.RoomChat, {
      playerId,
      nickname: who.nickname,
      text,
      avatar: who.avatar ?? null,
      equippedFrame: who.equippedFrame ?? 'frame_default',
      at: now,
    });
  }

  private checkEnoughPlayers(): void {
    if (this.persistent) return;
    if (this.botHosted) {
      if (this.status === 'playing' && this.seats.size < this.plugin.meta.minPlayers) {
        void this.deps.releaseBets(this.id).catch((error: unknown) => {
          roomLog.error('中止本局退款失败', { roomId: this.id, error: (error as Error).message });
        });
        this.status = 'waiting';
        this.settledThisRound = false;
        this.refillBotHostedSeats();
        for (const seat of this.seats.values()) {
          seat.ready = seat.isBot || this.autoReady.has(seat.playerId);
        }
        this.broadcastView();
        this.tryStart();
      } else if (this.status === 'waiting') {
        this.refillBotHostedSeats();
        this.tryStart();
      }
      return;
    }
    if (this.seats.size === 0 || ![...this.seats.values()].some((seat) => !seat.isBot)) {
      this.destroy();
      return;
    }
    if (this.status === 'playing' && this.seats.size < this.plugin.meta.minPlayers) {
      void this.deps.releaseBets(this.id).catch((error: unknown) => {
        roomLog.error('中止本局退款失败', { roomId: this.id, error: (error as Error).message });
      });
      this.status = 'waiting';
      this.settledThisRound = false;
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
    // 必须在删座位之前通知插件，否则 ctx.players 里已无此人导致赢家加钱而离场者不扣钱
    if (this.status === 'playing') {
      try {
        this.plugin.onPlayerLeave(this.ctx, playerId);
      } catch (error) {
        console.error(`[room ${this.id}] onPlayerLeave 异常`, error);
      }
    }
    this.seats.delete(playerId);

    if (this.hostId === playerId) {
      const next = [...this.seats.values()].sort((a, b) => a.seat - b.seat)[0];
      this.hostId = next ? next.playerId : null;
    }
    if (this.seats.size === 0 && !this.botHosted) this.destroy();
  }

  private nextSeatIndex(): number {
    const used = new Set([...this.seats.values()].map((s) => s.seat));
    for (let i = 0; i < this.maxPlayers; i += 1) {
      if (!used.has(i)) return i;
    }
    return this.seats.size;
  }

  private broadcastView(): void {
    this.ctx.broadcast(ServerMsg.RoomView, { room: this.view() });
  }

  private pushSnapshotToSocket(socket: WebSocket, viewerId: string | null): void {
    try {
      const view = this.view();
      const snapshot = this.plugin.getSnapshot(this.ctx, viewerId);
      sendEnvelope(socket, ServerMsg.Snapshot, {
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
    if (this.spectators.size > 0) {
      try {
        const spectatorSnap = this.plugin.getSnapshot(this.ctx, null);
        for (const spec of this.spectators.values()) {
          if (!spec.socket) continue;
          sendEnvelope(spec.socket, ServerMsg.Snapshot, {
            roomId: this.id,
            gameId: this.plugin.meta.gameId,
            status: view.status,
            round: this.round,
            seq: this.seq,
            snapshot: spectatorSnap,
          });
        }
      } catch (error) {
        console.error(`[room ${this.id}] spectator getSnapshot 异常`, error);
      }
    }
  }
}
