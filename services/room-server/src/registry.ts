import { randomUUID } from 'node:crypto';
import type { GameMeta, Settlement } from '@cc/protocol';
import { AppError, ErrorCode } from '@cc/protocol';
import { PLUGIN_API_VERSION, type GamePluginFactory } from '@cc/game-sdk';
import type { WebSocket } from 'ws';
import { GameRoom, type RoomDeps } from './room';
import type { RoomServerConfig } from './config';

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

    // 下注类玩法只有一个常驻房间，所有玩家共享同一时间轴
    const persistent = this.list(gameId).find((r) => r.isPersistent);
    if (persistent) {
      persistent.join(player, socket);
      return persistent;
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

  /** 创建常驻房间：服务启动即开局，无人也持续推进 */
  ensurePersistent(gameId: string, maxPlayers: number): GameRoom | null {
    const factory = this.factories.get(gameId);
    if (!factory) return null;
    const existing = this.list(gameId).find((r) => r.isPersistent);
    if (existing) return existing;
    const room = new GameRoom(randomUUID(), factory(), 'classic', maxPlayers, this.deps, {
      persistent: true,
    });
    this.rooms.set(room.id, room);
    return room;
  }

  shutdown(): void {
    for (const room of [...this.rooms.values()]) room.destroy();
    this.rooms.clear();
  }
}
