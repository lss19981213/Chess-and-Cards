import { GomokuPlugin } from '@cc/game-gomoku';
import { DoudizhuPlugin } from '@cc/game-doudizhu';
import { PaodekuaiPlugin } from '@cc/game-paodekuai';
import { TuizhuanziPlugin } from '@cc/game-tuizhuanzi';
import { TexasPlugin } from '@cc/game-texas';
import { DicePlugin } from '@cc/game-dice';
import type { RoomManager } from './registry';

/** 常驻玩法：无玩家也持续开局，需要预先创建房间 */
const PERSISTENT_GAMES = ['tuizhuanzi', 'dice'];

/**
 * 内置游戏注册表。
 * 新增游戏：安装依赖 → 在此注册一行 → 重新部署游戏服。
 */
export function registerBuiltinGames(manager: RoomManager): void {
  manager.register(() => new GomokuPlugin());
  manager.register(() => new DoudizhuPlugin());
  manager.register(() => new PaodekuaiPlugin());
  manager.register(() => new TuizhuanziPlugin());
  manager.register(() => new TexasPlugin());
  manager.register(() => new DicePlugin());

  for (const gameId of PERSISTENT_GAMES) {
    manager.ensurePersistent(gameId, 5);
  }
}
