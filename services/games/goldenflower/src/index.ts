import type { GameMeta, GameSnapshot } from '@cc/protocol';
import type { RoomContext } from '@cc/game-sdk';
import { BaseGamePlugin } from '@cc/game-sdk';

export default class GoldenFlowerPlugin extends BaseGamePlugin {
  override readonly apiVersion = 1;

  override readonly meta: GameMeta = {
    gameId: 'goldenflower',
    name: '翻金花',
    description: '三张牌比大小，金花通杀',
    icon: '🌸',
    minPlayers: 2,
    maxPlayers: 6,
    version: '1.0.0',
    clientBundle: '',
    tags: ['新玩法'],
  };

  override readonly commands = [] as const;

  override getSnapshot(_ctx: RoomContext, _viewerId: string | null): GameSnapshot {
    return { phase: 'waiting' };
  }
}
