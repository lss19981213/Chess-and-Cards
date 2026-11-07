/** 排行榜每日结算配置 */

/** 榜单只展示前 N 名 */
export const LEADERBOARD_SIZE = 10;

/** 每日 0 点按名次发放的筹码奖励 */
export const LEADERBOARD_REWARDS: readonly number[] = [
  500, 350, 250, 200, 150, 120, 100, 80, 60, 40,
];

/** 取名次对应的奖励，未上榜为 0 */
export function rewardForRank(rank: number): number {
  return LEADERBOARD_REWARDS[rank - 1] ?? 0;
}

/**
 * 北京时间（UTC+8）的日期键，形如 2026-11-07。
 * 每日 0 点结算用的是这个口径，和玩家的自然日一致。
 */
export function beijingDayKey(now = new Date()): string {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10);
}

/** 距离下一个北京时间 0 点的毫秒数 */
export function msUntilNextBeijingMidnight(now = new Date()): number {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  const seconds = shifted.getUTCSeconds();
  const passed = minutes * 60 * 1000 + seconds * 1000;
  return Math.max(0, 24 * 60 * 60 * 1000 - passed);
}
