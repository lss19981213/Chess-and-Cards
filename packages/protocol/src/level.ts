/**
 * 玩家账号等级与经验计算模块（前后端共享）
 * - 默认 1 级，最高 100 级
 * - 初始经验条 100，每级翻 2 倍：100, 200, 400, 800, 1600...
 * - 升级奖励筹码：Lv.2 领 1,000，Lv.3 领 2,000，Lv.4 领 3,000... 依次递增
 * - 使用 BigInt 保证高达 100 级（~3.17e31）的经验值也永不溢出
 */

export const MAX_PLAYER_LEVEL = 100;
export const BASE_LEVEL_XP = 100n;

export function parseBigIntSafe(val: string | number | bigint | null | undefined): bigint {
  if (typeof val === 'bigint') return val < 0n ? 0n : val;
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) return 0n;
    return BigInt(Math.floor(val));
  }
  if (typeof val === 'string') {
    const trimmed = val.trim().split('.')[0] ?? '';
    if (!trimmed || !/^\d+$/.test(trimmed)) return 0n;
    try {
      return BigInt(trimmed);
    } catch {
      return 0n;
    }
  }
  return 0n;
}

/** 从 level 升到 level + 1 所需的经验值（100 * 2^(level-1)） */
export function xpRequiredForLevel(level: number): bigint {
  const lv = Math.max(1, Math.floor(level));
  if (lv >= MAX_PLAYER_LEVEL) return 0n;
  return BASE_LEVEL_XP * (1n << BigInt(lv - 1));
}

/** 升至 reachedLevel 级时对应的升级筹码奖励：Lv.2=1000, Lv.3=2000, ... */
export function levelUpRewardFor(reachedLevel: number): number {
  const lv = Math.min(MAX_PLAYER_LEVEL, Math.floor(reachedLevel));
  if (lv <= 1) return 0;
  return (lv - 1) * 1000;
}

/** 计算当前尚未领取的所有升级奖励总额 */
export function totalClaimableLevelReward(currentLevel: number, rewardedLevel: number): number {
  const from = Math.max(1, Math.floor(rewardedLevel)) + 1;
  const to = Math.min(MAX_PLAYER_LEVEL, Math.floor(currentLevel));
  if (to < from) return 0;
  let total = 0;
  for (let lv = from; lv <= to; lv += 1) {
    total += levelUpRewardFor(lv);
  }
  return total;
}

/** 叠加经验并自动连续升级（溢出经验自动结转至下一级） */
export function applyXpGain(
  currentLevel: number,
  currentXp: string | number | bigint,
  gain: number | bigint,
): { level: number; xp: string; levelsGained: number } {
  let lv = Math.min(MAX_PLAYER_LEVEL, Math.max(1, Math.floor(currentLevel || 1)));
  let xp = parseBigIntSafe(currentXp);
  const delta = parseBigIntSafe(gain);

  if (lv >= MAX_PLAYER_LEVEL) {
    return { level: MAX_PLAYER_LEVEL, xp: '0', levelsGained: 0 };
  }

  xp += delta;
  const startLv = lv;

  while (lv < MAX_PLAYER_LEVEL) {
    const req = xpRequiredForLevel(lv);
    if (req <= 0n || xp < req) break;
    xp -= req;
    lv += 1;
  }

  if (lv >= MAX_PLAYER_LEVEL) {
    xp = 0n;
  }

  return {
    level: lv,
    xp: xp.toString(),
    levelsGained: lv - startLv,
  };
}

/** 友好格式化超大经验数值，确保 UI 紧凑美观 */
export function formatBigXp(val: string | number | bigint): string {
  const n = parseBigIntSafe(val);
  if (n < 10_000n) return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (n < 100_000_000n) {
    const num = Number(n) / 10_000;
    return `${num >= 100 ? num.toFixed(0) : num.toFixed(1).replace(/\.0$/, '')}万`;
  }
  if (n < 1_000_000_000_000n) {
    const num = Number(n) / 100_000_000;
    return `${num >= 100 ? num.toFixed(0) : num.toFixed(2).replace(/\.?0+$/, '')}亿`;
  }
  if (n < 10_000_000_000_000_000n) {
    const num = Number(n / 1_000_000_000n) / 1_000;
    return `${num >= 100 ? num.toFixed(0) : num.toFixed(2).replace(/\.?0+$/, '')}万亿`;
  }
  const str = n.toString();
  const exp = str.length - 1;
  const head = `${str[0]}.${str.slice(1, 3)}`;
  return `${head}e${exp}`;
}

export interface PlayerLevelInfo {
  level: number;
  maxLevel: number;
  isMax: boolean;
  xp: string;
  requiredXp: string;
  xpFormatted: string;
  requiredXpFormatted: string;
  percent: number;
  nextReward: number;
  rewardedLevel: number;
  claimableReward: number;
  unclaimedLevels: number;
}

export function computeLevelInfo(
  levelRaw?: number | null,
  xpRaw?: string | number | bigint | null,
  rewardedLevelRaw?: number | null,
): PlayerLevelInfo {
  const level = Math.min(MAX_PLAYER_LEVEL, Math.max(1, Math.floor(levelRaw ?? 1)));
  const rewardedLevel = Math.min(level, Math.max(1, Math.floor(rewardedLevelRaw ?? 1)));
  const isMax = level >= MAX_PLAYER_LEVEL;
  const xpBig = isMax ? 0n : parseBigIntSafe(xpRaw);
  const reqBig = xpRequiredForLevel(level);

  let percent = 100;
  if (!isMax && reqBig > 0n) {
    const bps = Number((xpBig * 10000n) / reqBig);
    percent = Math.min(100, Math.max(0, Math.round(bps) / 100));
  }

  return {
    level,
    maxLevel: MAX_PLAYER_LEVEL,
    isMax,
    xp: xpBig.toString(),
    requiredXp: reqBig.toString(),
    xpFormatted: formatBigXp(xpBig),
    requiredXpFormatted: isMax ? 'MAX' : formatBigXp(reqBig),
    percent,
    nextReward: isMax ? 0 : levelUpRewardFor(level + 1),
    rewardedLevel,
    claimableReward: totalClaimableLevelReward(level, rewardedLevel),
    unclaimedLevels: Math.max(0, level - rewardedLevel),
  };
}

/** 等级段位头衔 */
export function levelTitleFor(level: number): string {
  if (level >= 100) return '百级至尊·万界赌帝';
  if (level >= 80) return '传世赌圣';
  if (level >= 60) return '殿堂赌神';
  if (level >= 45) return '皇家宗师';
  if (level >= 30) return '金牌雀圣';
  if (level >= 20) return '翡翠大师';
  if (level >= 12) return '黄金牌王';
  if (level >= 6) return '白银好手';
  if (level >= 3) return '青铜新秀';
  return '初入牌坛';
}
