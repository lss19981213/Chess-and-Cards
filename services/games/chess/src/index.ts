import type { GameMeta, GameSnapshot } from '@cc/protocol';
import type { RoomContext } from '@cc/game-sdk';
import { BaseGamePlugin } from '@cc/game-sdk';

export default class ChessPlugin extends BaseGamePlugin {
  override readonly apiVersion = 1;

  override readonly meta: GameMeta = {
    gameId: 'chess',
    name: '国际象棋',
    description: '楚汉对决，王将争锋',
    icon: '♞',
    minPlayers: 2,
    maxPlayers: 2,
    version: '1.0.0',
    clientBundle: '',
    tags: ['新玩法'],
  };

  override readonly commands = [] as const;

  override getSnapshot(_ctx: RoomContext, _viewerId: string | null): GameSnapshot {
    return { phase: 'waiting' };
  }
}
