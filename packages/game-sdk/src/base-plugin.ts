import type { GameMeta, GameSnapshot } from '@cc/protocol';
import { PLUGIN_API_VERSION, type GameIntent, type GamePlugin, type PlayerContext, type RoomContext } from './types';

/** 插件基类，提供默认的空实现，具体游戏只需覆写关心的钩子。 */
export abstract class BaseGamePlugin implements GamePlugin {
  readonly apiVersion: number = PLUGIN_API_VERSION;
  abstract readonly meta: GameMeta;
  readonly commands: readonly string[] = [];

  onRoomCreate(_ctx: RoomContext): void {}
  onRoundStart(_ctx: RoomContext): void {}
  onPlayerJoin(_ctx: RoomContext, _player: PlayerContext): void {}
  onPlayerLeave(_ctx: RoomContext, _playerId: string): void {}
  onPlayerReady(_ctx: RoomContext, _playerId: string): void {}
  onIntent(_ctx: RoomContext, _playerId: string, _intent: GameIntent): void {}
  onTick(_ctx: RoomContext, _dtMs: number): void {}
  onDestroy(_ctx: RoomContext): void {}

  abstract getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot;

  getCurrentActor(_ctx: RoomContext): string | null {
    return null;
  }

  botIntent(_ctx: RoomContext, _playerId: string): GameIntent | null {
    return null;
  }
}
