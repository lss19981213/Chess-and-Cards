/**
 * 下注类玩法共用的额度约束。
 *
 * baccarat / dice / niuniu / blackjack / tuizhuanzi 五个玩法的注额上下限
 * 必须保持一致，否则同一个玩家在不同台子的体验和风控口径会漂移。
 * 这里做唯一来源，各游戏不要再各自写死数字。
 */
export const BET_LIMITS = {
  minBet: 1,
  maxBet: Number.MAX_SAFE_INTEGER,
  maxTotal: Number.MAX_SAFE_INTEGER,
} as const;

/** 标准下注阶段时长 */
export const BET_PHASE_MS = 30_000;

/**
 * 校验单注金额，返回规范化后的整数。
 * 无上限限制，单注只要大于等于最低起注即可。
 */
export function assertBetAmount(raw: unknown): number {
  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount < BET_LIMITS.minBet) {
    throw new Error(`单注至少 ${BET_LIMITS.minBet} 筹码`);
  }
  return amount;
}

/** 校验本局累计注额（已取消上限限制，无限下注） */
export function assertTotalWithin(_currentTotal: number, _amount: number): void {
  // 取消下注上限，支持无限下注
}
