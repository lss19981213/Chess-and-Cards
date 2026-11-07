import { randomUUID } from 'node:crypto';
import type { GameMeta, RoomSummary, Settlement } from '@cc/protocol';
import { AppError, ErrorCode } from '@cc/protocol';
import { PLUGIN_API_VERSION, type GamePluginFactory } from '@cc/game-sdk';
import type { WebSocket } from 'ws';
import { GameRoom, PLATFORM_CAPACITY, type RoomDeps } from './room';
import type { RoomServerConfig } from './config';

/** 平台房初始数量与弹性上限 */
const PLATFORM_ROOMS_INITIAL = 3;
const PLATFORM_ROOMS_MAX = 12;
/** 三间平均使用率达到该比例就扩容 */
const PLATFORM_SCALE_RATIO = 0.85;

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

  constructor(config: RoomServerConfig, reportSettlement: (settlement: Settlement) => void) {
    this.deps = {
      config,
      settle: (settlement) => reportSettlement(settlement),
      empty: (roomId) => {
        this.rooms.delete(roomId);
      },
    };
  }

  register(factory: GamePluginFactory): void {
    const probe = factory();
    if (probe.apiVersion !== PLUGIN_API_VERSION) {
      throw new Error(
        `插件 ${probe.meta.gameId} 的 API 版本为 ${probe.apiVersion}，容器要求 ${PLUGIN_API_VERSION}`,
      );
    }
    this.factories.set(probe.meta.gameId, factory);
    this.metas.set(probe.meta.gameId, probe.meta);
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

    let room = this.list(gameId).find((r) => r.isJoinable);
    if (!room) {
      const plugin = factory();
      room = new GameRoom(randomUUID(), plugin, mode, maxPlayers, this.deps);
      this.rooms.set(room.id, room);
    }
    room.join(player, socket);
    return room;
  }

  /** 选台列表：常驻台在前，玩家房按人数排列 */
  listPublic(gameId?: string): RoomSummary[] {
    return this.list(gameId)
      .map((room) => room.summary())
      .filter((room) => room.status !== 'settled')
      .sort((a, b) => {
        if (a.persistent !== b.persistent) return a.persistent ? -1 : 1;
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
    const room = new GameRoom(randomUUID(), factory(), 'classic', PLATFORM_CAPACITY, this.deps, {
      persistent: true,
    });
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

  /** 三间都快满时自动加开一间，避免玩家挤不进来 */
  private scaleIfNeeded(gameId: string, platforms: GameRoom[]): void {
    if (platforms.length >= PLATFORM_ROOMS_MAX) return;
    const threshold = PLATFORM_CAPACITY * PLATFORM_SCALE_RATIO;
    if (!platforms.every((room) => room.playerCount >= threshold)) return;
    const room = this.createPlatform(gameId);
    if (room) {
      console.info(
        `[scale] ${gameId} 平台台已达 ${platforms.length} 间且接近满员，自动加开 1 间（共 ${platforms.length + 1}）`,
      );
    }
  }

  shutdown(): void {
    for (const room of [...this.rooms.values()]) room.destroy();
    this.rooms.clear();
  }
}
