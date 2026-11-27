import { randomUUID } from 'node:crypto';
import type { BotDifficulty, GameMeta, GameOpsStatus, RoomSummary, Settlement, StakesTier } from '@cc/protocol';
import { AppError, ErrorCode } from '@cc/protocol';
import { PLUGIN_API_VERSION, type GamePluginFactory } from '@cc/game-sdk';
import type { WebSocket } from 'ws';
import { BOT_NAMES } from './bot';
import { GameRoom, PLATFORM_CAPACITY, type RoomDeps } from './room';
import type { RoomServerConfig } from './config';
import type { ReleaseClient, WalletClient } from './wallet';
import { createLogger } from './logger';

/** 平台房初始数量与弹性上限 */
const PLATFORM_ROOMS_INITIAL = 3;
const PLATFORM_ROOMS_MAX = 12;
/** 三间平均使用率达到该比例就扩容 */
const PLATFORM_SCALE_RATIO = 0.85;
/** 经典扑克机器人自建房玩法清单（每个游戏随机初始化 3-7 间） */
export const BOT_HOSTED_POKER_GAMES = new Set([
  'doudizhu',
  'goldenflower',
  'paodekuai',
  'stud',
  'texas',
]);

const scaleLog = createLogger('scale');
const opsLog = createLogger('game-ops');

export { PLATFORM_ROOMS_INITIAL };

export type MaintenanceMode = 'normal' | 'draining' | 'updating';

export interface RoomMaintenanceStatus {
  mode: MaintenanceMode;
  message: string;
  since: number | null;
  activeHumanGames: number;
  activeRooms: Array<{
    roomId: string;
    gameId: string;
    round: number;
    humans: number;
    persistent: boolean;
  }>;
}

/** 单游戏运营态（与全局 MaintenanceMode 并存） */
export interface GameOpsState {
  status: GameOpsStatus;
  message: string;
  since: number | null;
  /** 最近一次热更时间戳，可空 */
  lastReloadAt: number | null;
}

/** 单游戏维护查询结果，供 GM / 发布脚本轮询 */
export interface GameOpsStatusView extends GameOpsState {
  gameId: string;
  name: string;
  version: string;
  activeHumanGames: number;
  activeRooms: RoomMaintenanceStatus['activeRooms'];
  /** 所属插件包名（热更连带提示用） */
  packageName?: string;
}

const DEFAULT_OPS_MESSAGE: Record<Exclude<GameOpsStatus, 'enabled'>, string> = {
  disabled: '该游戏暂时下架维护中，请稍后再试或前往其它玩法',
  draining: '该游戏即将维护，暂停开启新对局，正在等待进行中的对局完成',
  updating: '该游戏正在热更新中，请稍候片刻',
};

/**
 * 房间与插件注册中心。
 * 新增游戏只需 register()，大厅通过 listGames() 自动获得入口。
 * 支持按 gameId 排水 / 下架 / 热更，不影响其它玩法。
 */
export class RoomManager {
  private readonly factories = new Map<string, GamePluginFactory>();
  private readonly metas = new Map<string, GameMeta>();
  private readonly rooms = new Map<string, GameRoom>();
  private readonly gameOps = new Map<string, GameOpsState>();
  private readonly gamePackages = new Map<string, string>();
  private readonly deps: RoomDeps;
  private maintenanceMode: MaintenanceMode = 'normal';
  private maintenanceMessage = '';
  private maintenanceSince: number | null = null;

  constructor(
    config: RoomServerConfig,
    reportSettlement: (settlement: Settlement) => void,
    adjustWallet: WalletClient,
    releaseBets: ReleaseClient,
  ) {
    this.deps = {
      config,
      settle: (settlement) => reportSettlement(settlement),
      adjustWallet,
      releaseBets,
      empty: (roomId) => {
        this.rooms.delete(roomId);
      },
      isDraining: (gameId: string) => this.isRoomActionBlocked(gameId),
    };
  }

  isDraining(): boolean {
    return this.maintenanceMode !== 'normal';
  }

  /**
   * 房间内「新开局 / 新下注 / 入座」是否应拦截。
   * 全局维护或单游戏非 enabled 时返回 true。
   */
  isRoomActionBlocked(gameId: string): boolean {
    if (this.maintenanceMode !== 'normal') return true;
    const status = this.gameOps.get(gameId)?.status ?? 'enabled';
    return status !== 'enabled';
  }

  /**
   * 禁止新玩家加入该游戏（含选台入房）。
   * @param gameId 玩法 ID
   */
  assertGameAcceptsJoin(gameId: string): void {
    if (this.maintenanceMode !== 'normal') {
      throw new AppError(
        ErrorCode.IllegalAction,
        this.maintenanceMessage || '平台即将紧急更新，当前暂停开启新游戏，请耐心等待！',
      );
    }
    const ops = this.gameOps.get(gameId);
    const status = ops?.status ?? 'enabled';
    if (status === 'enabled') return;
    throw new AppError(
      ErrorCode.GameUnavailable,
      ops?.message || DEFAULT_OPS_MESSAGE[status] || '该游戏暂时不可用',
    );
  }

  setMaintenanceMode(mode: MaintenanceMode, message?: string): RoomMaintenanceStatus {
    this.maintenanceMode = mode;
    if (mode === 'normal') {
      this.maintenanceMessage = '';
      this.maintenanceSince = null;
    } else {
      this.maintenanceMessage =
        message?.trim() ||
        (mode === 'updating'
          ? '平台正在紧急更新中，请耐心等待（更新完成后自动补偿 1,000 欢乐豆）'
          : '平台即将紧急更新，当前暂停开启新游戏，正在等待进行中的对局完成！');
      if (this.maintenanceSince === null) this.maintenanceSince = Date.now();
    }
    return this.getMaintenanceStatus();
  }

  getMaintenanceStatus(): RoomMaintenanceStatus {
    return {
      mode: this.maintenanceMode,
      message: this.maintenanceMessage,
      since: this.maintenanceSince,
      ...this.collectActiveHumanRooms(),
    };
  }

  /**
   * 设置单游戏运营态。
   * @param gameId 玩法 ID
   * @param status 目标状态
   * @param message 可选自定义文案
   */
  setGameOps(gameId: string, status: GameOpsStatus, message?: string): GameOpsStatusView {
    if (!this.factories.has(gameId) && !this.metas.has(gameId)) {
      throw new AppError(ErrorCode.BadRequest, `游戏不存在: ${gameId}`);
    }
    const prev = this.gameOps.get(gameId);
    const next: GameOpsState = {
      status,
      message:
        message?.trim() ||
        (status === 'enabled' ? '' : DEFAULT_OPS_MESSAGE[status]) ||
        prev?.message ||
        '',
      since: status === 'enabled' ? null : (prev?.since ?? Date.now()),
      lastReloadAt: prev?.lastReloadAt ?? null,
    };
    if (status === 'enabled') {
      next.message = message?.trim() || '';
    }
    this.gameOps.set(gameId, next);
    opsLog.info('单游戏运营态变更', { gameId, status: next.status });
    return this.getGameOpsStatus(gameId);
  }

  /** 标记热更完成时间（reload 成功后调用） */
  markGameReloaded(gameId: string): void {
    const prev = this.gameOps.get(gameId) ?? {
      status: 'enabled' as const,
      message: '',
      since: null,
      lastReloadAt: null,
    };
    this.gameOps.set(gameId, { ...prev, lastReloadAt: Date.now() });
  }

  /**
   * 绑定 gameId 与插件包名，供热更连带与 GM 展示。
   * @param gameId 玩法 ID
   * @param packageName 如 @cc/game-dice
   */
  bindGamePackage(gameId: string, packageName: string): void {
    this.gamePackages.set(gameId, packageName);
  }

  getGamePackage(gameId: string): string | undefined {
    return this.gamePackages.get(gameId);
  }

  /** 列出同包下全部 gameId（麻将五变体等） */
  listGameIdsByPackage(packageName: string): string[] {
    return [...this.gamePackages.entries()]
      .filter(([, pkg]) => pkg === packageName)
      .map(([id]) => id);
  }

  getGameOpsStatus(gameId: string): GameOpsStatusView {
    if (!this.metas.has(gameId) && !this.factories.has(gameId)) {
      throw new AppError(ErrorCode.BadRequest, `游戏不存在: ${gameId}`);
    }
    const meta = this.metas.get(gameId);
    const ops = this.gameOps.get(gameId) ?? {
      status: 'enabled' as const,
      message: '',
      since: null,
      lastReloadAt: null,
    };
    const { activeHumanGames, activeRooms } = this.collectActiveHumanRooms(gameId);
    return {
      gameId,
      name: meta?.name ?? gameId,
      version: meta?.version ?? '',
      packageName: this.gamePackages.get(gameId),
      ...ops,
      activeHumanGames,
      activeRooms,
    };
  }

  /** 全部游戏运营态一览 */
  listGameOps(): GameOpsStatusView[] {
    return this.listGames().map((g) => this.getGameOpsStatus(g.gameId));
  }

  private collectActiveHumanRooms(gameId?: string): {
    activeHumanGames: number;
    activeRooms: RoomMaintenanceStatus['activeRooms'];
  } {
    const activeRooms: RoomMaintenanceStatus['activeRooms'] = [];
    for (const room of this.rooms.values()) {
      if (gameId && room.gameId !== gameId) continue;
      if (room.hasActiveHumanGame) {
        const view = room.view();
        activeRooms.push({
          roomId: room.id,
          gameId: room.gameId,
          round: view.round,
          humans: room.humanCount,
          persistent: room.isPersistent,
        });
      }
    }
    return { activeHumanGames: activeRooms.length, activeRooms };
  }

  register(factory: GamePluginFactory, packageName?: string): GameMeta {
    const probe = factory();
    if (probe.apiVersion !== PLUGIN_API_VERSION) {
      throw new Error(
        `插件 ${probe.meta.gameId} 的 API 版本为 ${probe.apiVersion}，容器要求 ${PLUGIN_API_VERSION}`,
      );
    }
    this.factories.set(probe.meta.gameId, factory);
    this.metas.set(probe.meta.gameId, probe.meta);
    if (!this.gameOps.has(probe.meta.gameId)) {
      this.gameOps.set(probe.meta.gameId, {
        status: 'enabled',
        message: '',
        since: null,
        lastReloadAt: null,
      });
    }
    if (packageName) this.bindGamePackage(probe.meta.gameId, packageName);
    return probe.meta;
  }

  /**
   * 注销插件（热更前调用）。要求该游戏无活跃人类对局。
   * @param gameId 玩法 ID
   */
  unregister(gameId: string): void {
    const { activeHumanGames } = this.collectActiveHumanRooms(gameId);
    if (activeHumanGames > 0) {
      throw new AppError(
        ErrorCode.IllegalAction,
        `游戏 ${gameId} 仍有 ${activeHumanGames} 桌真人对局，无法卸载`,
      );
    }
    for (const room of this.list(gameId)) {
      room.destroy();
    }
    this.factories.delete(gameId);
    this.metas.delete(gameId);
    // 保留 gameOps / package 映射，便于 reload 后恢复文案与包名
    opsLog.info('已卸载游戏插件', { gameId });
  }

  listGames(): GameMeta[] {
    return [...this.metas.values()].map((meta) => {
      const ops = this.gameOps.get(meta.gameId);
      return {
        ...meta,
        status: ops?.status ?? 'enabled',
        statusMessage: ops?.message || undefined,
      };
    });
  }

  hasGame(gameId: string): boolean {
    return this.factories.has(gameId);
  }

  get(roomId: string): GameRoom | undefined {
    return this.rooms.get(roomId);
  }

  list(gameId?: string): GameRoom[] {
    const all = [...this.rooms.values()].filter((r) => !r.isClosed);
    return gameId ? all.filter((r) => r.gameId === gameId) : all;
  }

  /** 快速匹配：常驻房间优先，其次同档位可加入房间，否则按指定底注档位新开一间 */
  joinOrCreate(
    gameId: string,
    mode: string,
    maxPlayers: number,
    player: { playerId: string; nickname: string },
    socket: WebSocket,
    stakesTier: StakesTier = 'novice',
  ): GameRoom {
    this.assertGameAcceptsJoin(gameId);
    const factory = this.factories.get(gameId);
    if (!factory) throw new AppError(ErrorCode.BadRequest, `游戏不存在或未部署: ${gameId}`);

    const platforms = this.list(gameId).filter((r) => r.isPersistent);
    if (platforms.length > 0) {
      const open = platforms
        .filter((room) => room.playerCount < room.capacity)
        .sort((a, b) => a.playerCount - b.playerCount);
      const target = open[0];
      if (target) {
        target.join(player, socket);
        this.scaleIfNeeded(gameId, platforms);
        return target;
      }
      const extra = this.createPlatform(gameId);
      if (extra) {
        extra.join(player, socket);
        return extra;
      }
    }

    const botHostedRooms = this.list(gameId).filter((r) => r.isBotHosted);
    if (botHostedRooms.length > 0) {
      const tierMatched = botHostedRooms.filter((r) => r.stakesTier === stakesTier);
      const pool = tierMatched.length > 0 ? tierMatched : botHostedRooms;
      const sorted = [...pool].sort((a, b) => a.spectatorCount - b.spectatorCount);
      const target = sorted[0]!;
      target.joinAsSpectator(player, socket);
      return target;
    }

    let room = this.list(gameId).find((r) => r.isJoinable && r.stakesTier === stakesTier);
    if (!room) {
      const plugin = factory();
      room = new GameRoom(randomUUID(), plugin, mode, maxPlayers, this.deps, { stakesTier });
      this.rooms.set(room.id, room);
    }
    room.join(player, socket);
    return room;
  }

  /** 选台列表：常驻台与机器人热战桌在前，玩家房按人数排列 */
  listPublic(gameId?: string): RoomSummary[] {
    return this.list(gameId)
      .map((room) => room.summary())
      .filter((room) => room.persistent || room.botHosted || room.status !== 'settled')
      .sort((a, b) => {
        if (a.persistent !== b.persistent) return a.persistent ? -1 : 1;
        if (Boolean(a.botHosted) !== Boolean(b.botHosted)) return a.botHosted ? -1 : 1;
        if (a.joinable !== b.joinable) return a.joinable ? -1 : 1;
        return b.players - a.players;
      });
  }

  /** 玩家主动开一间新房 */
  createRoom(
    gameId: string,
    mode: string,
    maxPlayers: number,
    player: { playerId: string; nickname: string },
    socket: WebSocket,
    stakesTier: StakesTier = 'novice',
  ): GameRoom {
    this.assertGameAcceptsJoin(gameId);
    const factory = this.factories.get(gameId);
    if (!factory) throw new AppError(ErrorCode.BadRequest, `游戏不存在或未部署: ${gameId}`);
    const meta = this.metas.get(gameId);
    if (meta?.persistent) {
      throw new AppError(ErrorCode.IllegalAction, '该玩法由平台坐庄，不能自行建房');
    }
    const room = new GameRoom(randomUUID(), factory(), mode, maxPlayers, this.deps, { stakesTier });
    this.rooms.set(room.id, room);
    room.join(player, socket);
    return room;
  }

  /** 新建一间平台台 */
  createPlatform(gameId: string): GameRoom | null {
    if (this.isRoomActionBlocked(gameId)) return null;
    const factory = this.factories.get(gameId);
    if (!factory) return null;
    const no = this.list(gameId).filter((r) => r.isPersistent).length + 1;
    const room = new GameRoom(randomUUID(), factory(), 'classic', PLATFORM_CAPACITY, this.deps, {
      persistent: true,
    });
    room.setPlatformNo(no);
    this.rooms.set(room.id, room);
    return room;
  }

  /** 创建常驻房间：服务启动即开局，无人也持续推进 */
  ensurePersistent(gameId: string): GameRoom | null {
    const factory = this.factories.get(gameId);
    if (!factory) return null;
    const existing = this.list(gameId).find((r) => r.isPersistent);
    if (existing) return existing;
    return this.createPlatform(gameId);
  }

  /** 每款平台玩法默认开 N 间，起步就有多个台子可选 */
  ensurePlatformRooms(gameId: string, count: number): void {
    if (!this.factories.has(gameId)) return;
    if (this.isRoomActionBlocked(gameId)) return;
    const current = this.list(gameId).filter((r) => r.isPersistent).length;
    for (let i = current; i < count; i += 1) this.createPlatform(gameId);
  }

  /** 创建一间经典扑克机器人自建房，坐满机器人并自动开战，玩家进入默认观战 */
  createBotHostedRoom(gameId: string, tableNo?: number): GameRoom | null {
    if (this.isRoomActionBlocked(gameId)) return null;
    const factory = this.factories.get(gameId);
    const meta = this.metas.get(gameId);
    if (!factory || !meta) return null;

    const no = tableNo ?? this.list(gameId).filter((r) => r.isBotHosted).length + 1;
    const tier: StakesTier = no <= 2 ? 'novice' : no <= 4 ? 'classic' : 'master';
    const room = new GameRoom(randomUUID(), factory(), 'classic', meta.maxPlayers, this.deps, {
      botHosted: true,
      stakesTier: tier,
    });
    room.setPlatformNo(no);
    this.rooms.set(room.id, room);

    const botCount =
      meta.minPlayers === meta.maxPlayers
        ? meta.maxPlayers
        : Math.min(
            meta.maxPlayers,
            Math.max(meta.minPlayers, 2 + Math.floor(Math.random() * Math.min(4, meta.maxPlayers - 1))),
          );

    const diff: BotDifficulty = 'high';
    const pool = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < botCount; i += 1) {
      const name = pool[i % pool.length] ?? `牌手${i + 1}`;
      room.addBot(`bot:${randomUUID()}`, `🤖 ${name}`, diff, { deferStart: i < botCount - 1 });
    }
    return room;
  }

  /** 为经典扑克游戏随机创建 3-7 间机器人自建房 */
  ensureBotHostedRooms(gameId: string): number {
    if (!this.factories.has(gameId)) return 0;
    if (this.isRoomActionBlocked(gameId)) return 0;
    const existing = this.list(gameId).filter((r) => r.isBotHosted).length;
    if (existing > 0) return existing;
    const targetCount = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < targetCount; i += 1) {
      this.createBotHostedRoom(gameId, i + 1);
    }
    scaleLog.info('经典扑克机器人自建房初始化完成', { gameId, count: targetCount });
    return targetCount;
  }

  /** 三间都快满时自动加开一间，避免玩家挤不进来 */
  private scaleIfNeeded(gameId: string, platforms: GameRoom[]): void {
    if (this.isRoomActionBlocked(gameId)) return;
    if (platforms.length >= PLATFORM_ROOMS_MAX) return;
    const threshold = PLATFORM_CAPACITY * PLATFORM_SCALE_RATIO;
    if (!platforms.every((room) => room.playerCount >= threshold)) return;
    const room = this.createPlatform(gameId);
    if (room) {
      scaleLog.info('平台台接近满员，自动加开新台', {
        gameId,
        before: platforms.length,
        after: platforms.length + 1,
        roomId: room.id,
      });
    }
  }

  /** 汇总每个玩法当前的真实房间数与在线人数，供大厅实时展示 */
  getGameLiveSummary(): Record<string, { rooms: number; humans: number; bots: number; spectators: number }> {
    const out: Record<string, { rooms: number; humans: number; bots: number; spectators: number }> = {};
    for (const meta of this.metas.values()) {
      out[meta.gameId] = { rooms: 0, humans: 0, bots: 0, spectators: 0 };
    }
    for (const room of this.list()) {
      const entry = out[room.gameId] ?? { rooms: 0, humans: 0, bots: 0, spectators: 0 };
      const sum = room.summary();
      entry.rooms += 1;
      entry.humans += sum.humans;
      entry.bots += sum.bots;
      entry.spectators += sum.spectators ?? 0;
      out[room.gameId] = entry;
    }
    return out;
  }

  shutdown(): void {
    for (const room of [...this.rooms.values()]) room.destroy();
    this.rooms.clear();
  }
}
