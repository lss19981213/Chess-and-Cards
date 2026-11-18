import { randomInt } from 'node:crypto';

export interface SlotSymbolDef {
  id: string;
  name: string;
  icon: string;
  payout5: number;
  payout4: number;
  payout3: number;
  isWild?: boolean;
  weight: number;
}

/** 9 款经典豪华老虎机图标（已彻底移除免费旋转/Scatter机制，所有中奖直接结算筹码，理论 RTP ≈ 93%） */
export const SLOT_SYMBOLS: readonly SlotSymbolDef[] = [
  { id: '777', name: '777至尊大奖', icon: '🎰', payout5: 600, payout4: 185, payout3: 56, weight: 4 },
  { id: 'wild', name: '钻石百搭', icon: '💎', payout5: 420, payout4: 125, payout3: 40, isWild: true, weight: 6 },
  { id: 'star', name: '黄金幸运星', icon: '⭐', payout5: 270, payout4: 80, payout3: 28, weight: 7 },
  { id: 'gold', name: '金条金砖', icon: '🪙', payout5: 200, payout4: 60, payout3: 22, weight: 9 },
  { id: 'bell', name: '自由之钟', icon: '🔔', payout5: 140, payout4: 45, payout3: 18, weight: 11 },
  { id: 'watermelon', name: '好运西瓜', icon: '🍉', payout5: 100, payout4: 32, payout3: 14, weight: 13 },
  { id: 'grape', name: '幸运葡萄', icon: '🍇', payout5: 75, payout4: 25, payout3: 11, weight: 15 },
  { id: 'cherry', name: '红火樱桃', icon: '🍒', payout5: 55, payout4: 20, payout3: 9, weight: 17 },
  { id: 'horseshoe', name: '幸运马蹄', icon: '🧲', payout5: 40, payout4: 15, payout3: 6, weight: 18 },
];

export const SLOT_BET_OPTIONS = [10, 50, 100, 500, 1000, 5000] as const;
export const SLOT_LINE_OPTIONS = [1, 9, 15, 25] as const;

export const SLOT_PAYLINES: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2],
  [2, 2, 1, 0, 0],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1],
  [0, 0, 2, 0, 0],
  [2, 2, 0, 2, 2],
  [0, 2, 0, 2, 0],
  [2, 0, 2, 0, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 2, 2, 2, 0],
  [2, 0, 0, 0, 2],
  [0, 1, 2, 2, 2],
  [2, 1, 0, 0, 0],
];

const TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);

function pickWeightedSymbol(): string {
  let r = randomInt(TOTAL_WEIGHT);
  for (const sym of SLOT_SYMBOLS) {
    if (r < sym.weight) return sym.id;
    r -= sym.weight;
  }
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1]!.id;
}

export interface ComputedSlotSpin {
  reels: string[][];
  betPerLine: number;
  lines: number;
  totalBet: number;
  winAmount: number;
  netDelta: number;
  winningLines: number[];
  isJackpot: boolean;
}

/** 服务端权威老虎机摇奖引擎：使用加密级随机数，无免费旋转，直接计算 25 线真实奖金 */
export function rollSlots(betPerLine: number, lines: number): ComputedSlotSpin {
  const safeLines = Math.min(SLOT_PAYLINES.length, Math.max(1, Math.floor(lines)));
  const safeBet = Math.max(10, Math.floor(betPerLine));
  const totalBet = safeBet * safeLines;

  const reels: string[][] = [];
  let count777 = 0;
  for (let col = 0; col < 5; col += 1) {
    const column: string[] = [];
    for (let row = 0; row < 3; row += 1) {
      const sym = pickWeightedSymbol();
      if (sym === '777') count777 += 1;
      column.push(sym);
    }
    reels.push(column);
  }

  let winAmount = 0;
  const winningLines: number[] = [];

  for (let l = 0; l < safeLines; l += 1) {
    const pattern = SLOT_PAYLINES[l]!;
    const lineSyms = [
      reels[0]![pattern[0]!]!,
      reels[1]![pattern[1]!]!,
      reels[2]![pattern[2]!]!,
      reels[3]![pattern[3]!]!,
      reels[4]![pattern[4]!]!,
    ];

    const firstNonWild = lineSyms.find((s) => s !== 'wild') ?? 'wild';
    let matchCount = 0;
    for (const s of lineSyms) {
      if (s === firstNonWild || s === 'wild') matchCount += 1;
      else break;
    }

    if (matchCount >= 3) {
      const def = SLOT_SYMBOLS.find((s) => s.id === firstNonWild);
      if (def) {
        const mult =
          matchCount === 5 ? def.payout5 : matchCount === 4 ? def.payout4 : def.payout3;
        winAmount += mult * safeBet;
        winningLines.push(l);
      }
    }
  }

  const isJackpot = count777 >= 5 || (winAmount > 0 && winAmount >= totalBet * 20);
  const netDelta = winAmount - totalBet;

  return {
    reels,
    betPerLine: safeBet,
    lines: safeLines,
    totalBet,
    winAmount,
    netDelta,
    winningLines,
    isJackpot,
  };
}
