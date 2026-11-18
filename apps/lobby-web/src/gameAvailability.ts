import type { GameMeta, GameOpsStatus } from '@cc/protocol';

/**
 * 判断游戏是否允许新玩家从大厅进入（选台 / 极速开局）。
 * @param game 游戏元数据（含可选 status）
 * @returns true 表示可进入
 */
export function isGameJoinable(game: Pick<GameMeta, 'status'>): boolean {
  const status: GameOpsStatus = game.status ?? 'enabled';
  return status === 'enabled';
}

/**
 * 大厅维护角标文案。
 * @param game 游戏元数据
 * @returns 无可展示时返回 null
 */
export function gameStatusBadge(game: Pick<GameMeta, 'status' | 'statusMessage' | 'name'>): string | null {
  const status: GameOpsStatus = game.status ?? 'enabled';
  if (status === 'enabled') return null;
  if (game.statusMessage?.trim()) return game.statusMessage.trim();
  if (status === 'draining') return '即将维护';
  if (status === 'updating') return '热更新中';
  return '维护中';
}

/**
 * 拦截进房时的统一提示。
 * @param game 游戏元数据
 */
export function gameUnavailableToast(game: Pick<GameMeta, 'status' | 'statusMessage' | 'name'>): string {
  return gameStatusBadge(game) || `${game.name} 暂时不可用，请稍后再试或前往其它玩法`;
}
