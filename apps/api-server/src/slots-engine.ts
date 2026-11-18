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

/** 9 款经典豪华老虎机图标（已彻底移除免费旋转/Scatter机制，所有中奖直接结算筹码） */
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

/** GM 端可实时调控的老虎机中奖概率参数 */
export interface SlotsConfig {
  /** 目标中奖概率 (0~95%，默认 50%) */
  hitRatePercent: number;
  /** 派彩倍率系数 (0.2~3.0，默认 1.0) */
  payoutMultiplier: number;
  /** 超级大奖触发概率 (0~20%，默认 0.8%) */
  jackpotRatePercent: number;
}

export const DEFAULT_SLOTS_CONFIG: SlotsConfig = {
  hitRatePercent: 50,
  payoutMultiplier: 1.0,
  jackpotRatePercent: 0.8,
};

export function sanitizeSlotsConfig(raw?: Partial<SlotsConfig> | null): SlotsConfig {
  const hit = Number(raw?.hitRatePercent);
  const mult = Number(raw?.payoutMultiplier);
  const jp = Number(raw?.jackpotRatePercent);
  return {
    hitRatePercent: Number.isFinite(hit)
      ? Math.round(Math.min(95, Math.max(0, hit)) * 10) / 10
      : DEFAULT_SLOTS_CONFIG.hitRatePercent,
    payoutMultiplier: Number.isFinite(mult)
      ? Math.round(Math.min(3.0, Math.max(0.2, mult)) * 100) / 100
      : DEFAULT_SLOTS_CONFIG.payoutMultiplier,
    jackpotRatePercent: Number.isFinite(jp)
      ? Math.round(Math.min(20, Math.max(0, jp)) * 100) / 100
      : DEFAULT_SLOTS_CONFIG.jackpotRatePercent,
  };
}

const TOTAL_WEIGHT = SLOT_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
const NON_JACKPOT_SYMBOLS = SLOT_SYMBOLS.filter((s) => s.id !== '777' && s.id !== 'wild');

function pickWeightedSymbol(): string {
  let r = randomInt(TOTAL_WEIGHT);
  for (const sym of SLOT_SYMBOLS) {
    if (r < sym.weight) return sym.id;
    r -= sym.weight;
  }
  return SLOT_SYMBOLS[SLOT_SYMBOLS.length - 1]!.id;
}

function generateRandomGrid(): string[][] {
  const reels: string[][] = [];
  for (let col = 0; col < 5; col += 1) {
    reels.push([pickWeightedSymbol(), pickWeightedSymbol(), pickWeightedSymbol()]);
  }
  return reels;
}

function evaluateGrid(
  reels: string[][],
  safeBet: number,
  safeLines: number,
  payoutMultiplier: number,
): { winAmount: number; winningLines: number[]; isJackpot: boolean } {
  const totalBet = safeBet * safeLines;
  let count777 = 0;
  for (let col = 0; col < 5; col += 1) {
    for (let row = 0; row < 3; row += 1) {
      if (reels[col]![row] === '777') count777 += 1;
    }
  }

  let rawWin = 0;
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
        rawWin += mult * safeBet;
        winningLines.push(l);
      }
    }
  }

  const winAmount = Math.max(0, Math.round(rawWin * payoutMultiplier));
  const isJackpot = count777 >= 5 || (winAmount > 0 && winAmount >= totalBet * 20);
  return { winAmount, winningLines, isJackpot };
}

/** 构造一条自然中奖的合法网格，确保展示图案与派彩完全一致 */
function buildWinningGrid(safeLines: number, forceJackpot: boolean): string[][] {
  const reels = generateRandomGrid();
  const targetLineIdx = randomInt(safeLines);
  const pattern = SLOT_PAYLINES[targetLineIdx]!;

  if (forceJackpot) {
    for (let c = 0; c < 5; c += 1) {
      reels[c]![pattern[c]!] = '777';
    }
    return reels;
  }

  // 选一个常规中奖符号与 3~4 连（极小概率 5 连）
  const winSym = pickWeightedSymbol();
  const safeSym = winSym === '777' ? 'gold' : winSym;
  const r = randomInt(100);
  const matchLen = r < 74 ? 3 : r < 95 ? 4 : 5;
  for (let c = 0; c < matchLen; c += 1) {
    reels[c]![pattern[c]!] = safeSym;
  }
  return reels;
}

/** 构造不中奖网格：通过替换第 3 列冲突图标消除所有中奖线 */
function breakWinsOnGrid(reels: string[][], safeLines: number): string[][] {
  const clone = reels.map((col) => [...col]);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const check = evaluateGrid(clone, 10, safeLines, 1);
    if (check.winningLines.length === 0) return clone;
    for (const lineIdx of check.winningLines) {
      const pattern = SLOT_PAYLINES[lineIdx]!;
      const col0 = clone[0]![pattern[0]!]!;
      const col1 = clone[1]![pattern[1]!]!;
      const replacement =
        NON_JACKPOT_SYMBOLS.find((s) => s.id !== col0 && s.id !== col1)?.id ?? 'horseshoe';
      clone[2]![pattern[2]!] = replacement;
    }
  }
  // 兜底：彻底错开前 3 列所有图标
  const fallback = ['cherry', 'grape', 'watermelon'];
  const fallback2 = ['bell', 'gold', 'horseshoe'];
  const fallback3 = ['star', 'cherry', 'bell'];
  return [
    [fallback[0]!, fallback[1]!, fallback[2]!],
    [fallback2[0]!, fallback2[1]!, fallback2[2]!],
    [fallback3[0]!, fallback3[1]!, fallback3[2]!],
    [pickWeightedSymbol(), pickWeightedSymbol(), pickWeightedSymbol()],
    [pickWeightedSymbol(), pickWeightedSymbol(), pickWeightedSymbol()],
  ];
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

/** 服务端权威老虎机摇奖引擎：使用加密级随机数 + GM 动态概率调控，无免费旋转，展示与派彩 100% 一致 */
export function rollSlots(
  betPerLine: number,
  lines: number,
  rawConfig?: Partial<SlotsConfig> | null,
): ComputedSlotSpin {
  const safeLines = Math.min(SLOT_PAYLINES.length, Math.max(1, Math.floor(lines)));
  const safeBet = Math.max(10, Math.floor(betPerLine));
  const totalBet = safeBet * safeLines;
  const cfg = sanitizeSlotsConfig(rawConfig);

  const jackpotRoll = randomInt(10000) < Math.round(cfg.jackpotRatePercent * 100);
  let reels: string[][] | null = null;

  if (jackpotRoll && cfg.hitRatePercent > 0) {
    reels = buildWinningGrid(safeLines, true);
  } else {
    const shouldWin = randomInt(10000) < Math.round(cfg.hitRatePercent * 100);
    if (shouldWin) {
      for (let i = 0; i < 16; i += 1) {
        const candidate = generateRandomGrid();
        const ev = evaluateGrid(candidate, safeBet, safeLines, cfg.payoutMultiplier);
        if (ev.winAmount > 0 && !ev.isJackpot) {
          reels = candidate;
          break;
        }
      }
      if (!reels) {
        reels = buildWinningGrid(safeLines, false);
      }
    } else {
      for (let i = 0; i < 16; i += 1) {
        const candidate = generateRandomGrid();
        const ev = evaluateGrid(candidate, safeBet, safeLines, cfg.payoutMultiplier);
        if (ev.winAmount === 0) {
          reels = candidate;
          break;
        }
      }
      if (!reels) {
        reels = breakWinsOnGrid(generateRandomGrid(), safeLines);
      }
    }
  }

  const finalEval = evaluateGrid(reels, safeBet, safeLines, cfg.payoutMultiplier);
  const netDelta = finalEval.winAmount - totalBet;

  return {
    reels,
    betPerLine: safeBet,
    lines: safeLines,
    totalBet,
    winAmount: finalEval.winAmount,
    netDelta,
    winningLines: finalEval.winningLines,
    isJackpot: finalEval.isJackpot,
  };
}
