import { randomUUID } from 'node:crypto';
import type { BotDifficulty, GameMeta, RoomSummary, Settlement } from '@cc/protocol';
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

export { PLATFORM_ROOMS_INITIAL };

/**
 * 房间与插件注册中心。
 * 新增游戏只需 register()，大厅通过 listGames() 自动获得入口。
 */
export class RoomManager {
  private readonly factories = new Map<string, GamePluginFactory>();
  private readonly metas = new Map<string, GameMeta>();
  private readonly rooms = new Map<string, GameRoom>();
  private readonly deps: RoomDeps;

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
    };
  }

  register(factory: GamePluginFactory): GameMeta {
    const probe = factory();
    if (probe.apiVersion !== PLUGIN_API_VERSION) {
      throw new Error(
        `插件 ${probe.meta.gameId} 的 API 版本为 ${probe.apiVersion}，容器要求 ${PLUGIN_API_VERSION}`,
      );
    }
    this.factories.set(probe.meta.gameId, factory);
    this.metas.set(probe.meta.gameId, probe.meta);
    return probe.meta;
  }

  listGames(): GameMeta[] {
    return [...this.metas.values()];
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

  /** 快速匹配：常驻房间优先，其次可加入的房间，否则新开一间 */
  joinOrCreate(
    gameId: string,
    mode: string,
    maxPlayers: number,
    player: { playerId: string; nickname: string },
    socket: WebSocket,
  ): GameRoom {
    const factory = this.factories.get(gameId);
    if (!factory) throw new AppError(ErrorCode.BadRequest, `游戏不存在或未部署: ${gameId}`);

    // 下注类玩法：在平台台里挑人最少且未满的一间
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
      // 全部满员，临时扩一间
      const extra = this.createPlatform(gameId);
      if (extra) {
        extra.join(player, socket);
        return extra;
      }
    }

    // 经典扑克机器人自建房：优先进入活跃的机器人对局桌（默认观战模式，点击入座参战）
    const botHostedRooms = this.list(gameId).filter((r) => r.isBotHosted);
    if (botHostedRooms.length > 0) {
      const sorted = [...botHostedRooms].sort((a, b) => a.spectatorCount - b.spectatorCount);
      const target = sorted[0]!;
      target.joinAsSpectator(player, socket);
      return target;
    }

    let room = this.list(gameId).find((r) => r.isJoinable);
    if (!room) {
      const plugin = factory();
      room = new GameRoom(randomUUID(), plugin, mode, maxPlayers, this.deps);
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
  ): GameRoom {
    const factory = this.factories.get(gameId);
    if (!factory) throw new AppError(ErrorCode.BadRequest, `游戏不存在或未部署: ${gameId}`);
    const meta = this.metas.get(gameId);
    if (meta?.persistent) {
      throw new AppError(ErrorCode.IllegalAction, '该玩法由平台坐庄，不能自行建房');
    }
    const room = new GameRoom(randomUUID(), factory(), mode, maxPlayers, this.deps);
    this.rooms.set(room.id, room);
    room.join(player, socket);
    return room;
  }

  /** 新建一间平台台 */
  createPlatform(gameId: string): GameRoom | null {
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
    const current = this.list(gameId).filter((r) => r.isPersistent).length;
    for (let i = current; i < count; i += 1) this.createPlatform(gameId);
  }

  /** 创建一间经典扑克机器人自建房，坐满机器人并自动开战，玩家进入默认观战 */
  createBotHostedRoom(gameId: string, tableNo?: number): GameRoom | null {
    const factory = this.factories.get(gameId);
    const meta = this.metas.get(gameId);
    if (!factory || !meta) return null;

    const no = tableNo ?? this.list(gameId).filter((r) => r.isBotHosted).length + 1;
    const room = new GameRoom(randomUUID(), factory(), 'classic', meta.maxPlayers, this.deps, {
      botHosted: true,
    });
    room.setPlatformNo(no);
    this.rooms.set(room.id, room);

    // 根据玩法人数安排机器人：3人固定局坐3个，2-6人局随机坐 2~5 个机器人热闹对战
    const botCount =
      meta.minPlayers === meta.maxPlayers
        ? meta.maxPlayers
        : Math.min(
            meta.maxPlayers,
            Math.max(meta.minPlayers, 2 + Math.floor(Math.random() * Math.min(4, meta.maxPlayers - 1))),
          );

    const diffs: BotDifficulty[] = ['low', 'medium', 'high'];
    const pool = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < botCount; i += 1) {
      const name = pool[i % pool.length] ?? `牌手${i + 1}`;
      const diff = diffs[Math.floor(Math.random() * diffs.length)] ?? 'medium';
      room.addBot(`bot:${randomUUID()}`, `🤖 ${name}`, diff);
    }
    return room;
  }

  /** 为经典扑克游戏随机创建 3-7 间机器人自建房 */
  ensureBotHostedRooms(gameId: string): number {
    if (!this.factories.has(gameId)) return 0;
    const existing = this.list(gameId).filter((r) => r.isBotHosted).length;
    if (existing > 0) return existing;
    const targetCount = 3 + Math.floor(Math.random() * 5); // 3 ~ 7 间
    for (let i = 0; i < targetCount; i += 1) {
      this.createBotHostedRoom(gameId, i + 1);
    }
    scaleLog.info('经典扑克机器人自建房初始化完成', { gameId, count: targetCount });
    return targetCount;
  }

  /** 三间都快满时自动加开一间，避免玩家挤不进来 */
  private scaleIfNeeded(gameId: string, platforms: GameRoom[]): void {
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

  shutdown(): void {
    for (const room of [...this.rooms.values()]) room.destroy();
    this.rooms.clear();
  }
}
