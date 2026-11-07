import { GomokuPlugin } from '@cc/game-gomoku';
import { DoudizhuPlugin } from '@cc/game-doudizhu';
import { PaodekuaiPlugin } from '@cc/game-paodekuai';
import { TuizhuanziPlugin } from '@cc/game-tuizhuanzi';
import { TexasPlugin } from '@cc/game-texas';
import type { RoomManager } from './registry';

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
}
