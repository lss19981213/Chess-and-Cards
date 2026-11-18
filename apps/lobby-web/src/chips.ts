/** 筹码面额素材，与 scripts/gen-chips.mjs 保持一致 */
export const CHIP_DENOMS = [
  1, 5, 10, 20, 50, 100, 300, 500, 1000, 2000, 5000, 10000, 50000, 100000, 500000, 1000000,
] as const;

export type ChipDenom = (typeof CHIP_DENOMS)[number];

/** 预设筹码档位（百人场共用） */
export const BET_PRESET_CHIPS = [
  10, 50, 100, 500, 1000, 2000, 5000, 10000, 100000, 500000, 1000000,
] as const;

/** 筹码下方显示文案：大额自动缩写为 1W / 10W / 50W / 100W */
export function formatChipLabel(value: number): string {
  if (value >= 10000 && value % 10000 === 0) return `${value / 10000}W`;
  return String(value);
}

/** 奢华筹码档位额外高亮样式类 */
export function chipTierClass(value: number): string {
  if (value >= 1000000) return 'chip-btn--sovereign';
  if (value >= 500000) return 'chip-btn--royal';
  return '';
}

export function chipArt(value: number): string {
  const exact = CHIP_DENOMS.find((denom) => denom === value);
  if (exact) return `${import.meta.env.BASE_URL}assets/chips/chip-${exact}.svg`;
  // 非标准面额（如自定义下注），取不超过它的最大面额筹码作为图标
  let fallback: number = CHIP_DENOMS[0];
  for (const denom of CHIP_DENOMS) {
    if (denom <= value) fallback = denom;
  }
  return `${import.meta.env.BASE_URL}assets/chips/chip-${fallback}.svg`;
}

/** 把金额拆成筹码组合，用于堆叠展示 */
export function toChipStack(amount: number, limit = 6): number[] {
  const result: number[] = [];
  let rest = Math.max(0, Math.floor(amount));
  for (let i = CHIP_DENOMS.length - 1; i >= 0 && result.length < limit; i -= 1) {
    const denom = CHIP_DENOMS[i]!;
    while (rest >= denom && result.length < limit) {
      result.push(denom);
      rest -= denom;
    }
  }
  return result;
}
