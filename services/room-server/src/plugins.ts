import { GomokuPlugin } from '@cc/game-gomoku';
import type { RoomManager } from './registry';

/**
 * 内置游戏注册表。
 * 新增游戏：安装依赖 → 在此注册一行 → 重新部署游戏服。
 */
export function registerBuiltinGames(manager: RoomManager): void {
  manager.register(() => new GomokuPlugin());
}
