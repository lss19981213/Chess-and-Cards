/**
 * 下注类玩法共用的额度约束。
 *
 * baccarat / dice / niuniu / blackjack / tuizhuanzi 五个玩法的注额上下限
 * 必须保持一致，否则同一个玩家在不同台子的体验和风控口径会漂移。
 * 这里做唯一来源，各游戏不要再各自写死数字。
 */
export const BET_LIMITS = {
  minBet: 10,
  maxBet: 2_000,
  maxTotal: 6_000,
} as const;

/** 标准下注阶段时长 */
export const BET_PHASE_MS = 30_000;

/**
 * 校验单注金额，返回规范化后的整数。
 * 越界时抛出可直接展示给玩家的错误文案。
 */
export function assertBetAmount(raw: unknown): number {
  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount < BET_LIMITS.minBet) {
    throw new Error(`单注至少 ${BET_LIMITS.minBet} 筹码`);
  }
  if (amount > BET_LIMITS.maxBet) {
    throw new Error(`单注最多 ${BET_LIMITS.maxBet} 筹码`);
  }
  return amount;
}

/** 校验本局累计注额是否超过上限 */
export function assertTotalWithin(currentTotal: number, amount: number): void {
  if (currentTotal + amount > BET_LIMITS.maxTotal) {
    throw new Error(`本局总下注不能超过 ${BET_LIMITS.maxTotal} 筹码`);
  }
}
