/**
 * 雀神麻将 · 智能牌局军师引擎（向听数 + 有效进张数 + 胜率留牌/舍牌建议）
 */

export type AdvisorSuit = 'wan' | 'bamboo' | 'dot' | 'wind' | 'dragon';
export type AdvisorNumericSuit = 'wan' | 'bamboo' | 'dot';

export interface AdvisorTile {
  id: string;
  suit: AdvisorSuit;
  val: number;
}

export interface AdvisorMeld {
  type: 'pong' | 'kong' | 'chow';
  tiles: AdvisorTile[];
}

export interface WaitTileInfo {
  suit: AdvisorSuit;
  val: number;
  remaining: number;
  label: string;
}

export interface DiscardEvaluation {
  tile: AdvisorTile;
  shanten: number;
  totalLive: number;
  waits: WaitTileInfo[];
  winRatePct: number;
  reason: string;
}

export interface HandAdvice {
  mode: 'discard' | 'wait';
  currentShanten: number;
  isTenpai: boolean;
  tenpaiWaits: WaitTileInfo[];
  bestDiscard: DiscardEvaluation | null;
  byTileKey: Map<string, DiscardEvaluation>;
  keepTips: string[];
  summary: string;
}

const NUM_SUITS: AdvisorNumericSuit[] = ['wan', 'bamboo', 'dot'];
const CN_NUM = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const WIND_CN = ['', '东', '南', '西', '北'];
const DRAGON_CN = ['', '红中', '发财', '白板'];

export function tileLabel(suit: AdvisorSuit, val: number): string {
  if (suit === 'wan') return `${CN_NUM[val]}万`;
  if (suit === 'bamboo') return `${CN_NUM[val]}条`;
  if (suit === 'dot') return `${CN_NUM[val]}筒`;
  if (suit === 'wind') return `${WIND_CN[val]}风`;
  return DRAGON_CN[val] ?? '字';
}

export function suitLabel(suit: AdvisorNumericSuit): string {
  return suit === 'wan' ? '万子' : suit === 'bamboo' ? '条子' : '筒子';
}

/** 将牌映射为 0..33 紧凑索引：0..8万, 9..17条, 18..26筒, 27..30东南西北, 31..33中发白 */
function toIndex(suit: AdvisorSuit, val: number): number {
  if (suit === 'wan') return val - 1;
  if (suit === 'bamboo') return 9 + (val - 1);
  if (suit === 'dot') return 18 + (val - 1);
  if (suit === 'wind') return 27 + (val - 1);
  return 31 + (val - 1);
}

function fromIndex(idx: number): { suit: AdvisorSuit; val: number } {
  if (idx < 9) return { suit: 'wan', val: idx + 1 };
  if (idx < 18) return { suit: 'bamboo', val: idx - 9 + 1 };
  if (idx < 27) return { suit: 'dot', val: idx - 18 + 1 };
  if (idx < 31) return { suit: 'wind', val: idx - 27 + 1 };
  return { suit: 'dragon', val: idx - 31 + 1 };
}

/** 精确计算 34 种牌计数数组的标准向听数（含已副露面子数 meldsCount，支持七小对与红中癞子） */
function computeShanten(counts: number[], meldsCount: number, wildIdx = -1): number {
  const wilds = wildIdx >= 0 ? counts[wildIdx]! : 0;
  if (wilds >= 4) return -1; // 四红中直接胡牌！

  let best = 8;
  const savedWild = wildIdx >= 0 ? counts[wildIdx]! : 0;
  if (wildIdx >= 0) counts[wildIdx] = 0;

  try {
    // 1) 七小对向听（仅无副露时）
    if (meldsCount === 0) {
      let pairs = 0;
      let kinds = 0;
      for (let i = 0; i < 34; i++) {
        if (counts[i]! > 0) kinds += 1;
        if (counts[i]! >= 2) pairs += 1;
      }
      const sevenShanten = 6 - pairs - wilds + Math.max(0, 7 - (kinds + wilds));
      if (sevenShanten < best) best = sevenShanten;
    }

    // 2) 标准 4 面子 + 1 将牌向听（快速回溯 + 搭子估价 + 癞子折减）
    const maxGroups = 4 - meldsCount;

    const search = (idx: number, groups: number, taatsu: number, hasPair: boolean) => {
      const effTaatsu = Math.min(taatsu, maxGroups - groups);
      const sh = 2 * (maxGroups - groups) - effTaatsu - (hasPair ? 1 : 0) - wilds;
      if (sh < best) best = sh;
      if (best <= -1) return;

      while (idx < 34 && counts[idx] === 0) idx++;
      if (idx >= 34) return;

      const c = counts[idx]!;
      const isNum = idx < 27;
      const rank = idx % 9;

      // 刻子
      if (c >= 3 && groups < maxGroups) {
        counts[idx]! -= 3;
        search(idx, groups + 1, taatsu, hasPair);
        counts[idx]! += 3;
      }

      // 顺子
      if (isNum && rank <= 6 && counts[idx + 1]! > 0 && counts[idx + 2]! > 0 && groups < maxGroups) {
        counts[idx]! -= 1;
        counts[idx + 1]! -= 1;
        counts[idx + 2]! -= 1;
        search(idx, groups + 1, taatsu, hasPair);
        counts[idx]! += 1;
        counts[idx + 1]! += 1;
        counts[idx + 2]! += 1;
      }

      // 雀头（将牌）
      if (c >= 2 && !hasPair) {
        counts[idx]! -= 2;
        search(idx, groups, taatsu, true);
        counts[idx]! += 2;
      }

      // 对子搭子
      if (c >= 2 && groups + taatsu < maxGroups) {
        counts[idx]! -= 2;
        search(idx, groups, taatsu + 1, hasPair);
        counts[idx]! += 2;
      }

      // 两面 / 边张搭子
      if (isNum && rank <= 7 && counts[idx + 1]! > 0 && groups + taatsu < maxGroups) {
        counts[idx]! -= 1;
        counts[idx + 1]! -= 1;
        search(idx, groups, taatsu + 1, hasPair);
        counts[idx]! += 1;
        counts[idx + 1]! += 1;
      }

      // 坎张搭子
      if (isNum && rank <= 6 && counts[idx + 2]! > 0 && groups + taatsu < maxGroups) {
        counts[idx]! -= 1;
        counts[idx + 2]! -= 1;
        search(idx, groups, taatsu + 1, hasPair);
        counts[idx]! += 1;
        counts[idx + 2]! += 1;
      }

      // 跳过当前单张
      search(idx + 1, groups, taatsu, hasPair);
    };

    search(0, 0, 0, false);
  } finally {
    if (wildIdx >= 0) counts[wildIdx] = savedWild;
  }
  return Math.max(-1, best);
}

/** 统计某个 13/10/7/4/1 张手牌的所有有效进张（降低向听数或直接胡牌的可见剩余牌） */
function computeEffectiveWaits(
  counts: number[],
  seen: number[],
  meldsCount: number,
  includeHonors: boolean,
  dingqueSuit: AdvisorNumericSuit | null,
  wildIdx = -1,
): { shanten: number; waits: WaitTileInfo[]; totalLive: number } {
  const baseShanten = computeShanten(counts, meldsCount, wildIdx);
  const candidateIndices: number[] = [];
  const maxIdx = includeHonors ? 34 : 27;
  for (let i = 0; i < maxIdx; i++) candidateIndices.push(i);
  if (wildIdx >= maxIdx) candidateIndices.push(wildIdx);

  const waits: WaitTileInfo[] = [];
  let totalLive = 0;

  for (const i of candidateIndices) {
    const info = fromIndex(i);
    if (dingqueSuit && info.suit === dingqueSuit) continue;
    const rem = Math.max(0, 4 - seen[i]!);
    if (counts[i]! >= 4) continue;
    counts[i]! += 1;
    const nextSh = computeShanten(counts, meldsCount, wildIdx);
    counts[i]! -= 1;
    if (nextSh < baseShanten) {
      waits.push({
        suit: info.suit,
        val: info.val,
        remaining: rem,
        label: tileLabel(info.suit, info.val),
      });
      totalLive += rem;
    }
  }

  waits.sort((a, b) => b.remaining - a.remaining);
  return { shanten: baseShanten, waits, totalLive };
}

/** 生成留牌策略提示（针对当前手牌结构与具体玩法） */
function buildKeepTips(params: {
  hand: AdvisorTile[];
  melds: AdvisorMeld[];
  variantId: string;
  dingqueSuit: AdvisorNumericSuit | null;
  is258Strict: boolean;
  includeHonors: boolean;
}): string[] {
  const { hand, melds, variantId, dingqueSuit, is258Strict, includeHonors } = params;
  const tips: string[] = [];

  if (dingqueSuit) {
    const dqCount = hand.filter((t) => t.suit === dingqueSuit).length;
    if (dqCount > 0) {
      tips.push(`定缺【${suitLabel(dingqueSuit)}】还剩 ${dqCount} 张，请优先打完以免流局变花猪！`);
    } else {
      tips.push(`定缺【${suitLabel(dingqueSuit)}】已清空，可放心冲大番听牌！`);
    }
  }

  // 检查清一色潜力
  const suitCnt: Record<AdvisorNumericSuit, number> = { wan: 0, bamboo: 0, dot: 0 };
  for (const t of [...hand, ...melds.flatMap((m) => m.tiles)]) {
    if (t.suit === 'wan' || t.suit === 'bamboo' || t.suit === 'dot') suitCnt[t.suit] += 1;
  }
  const bestSuit = NUM_SUITS.reduce((a, b) => (suitCnt[a] >= suitCnt[b] ? a : b));
  if (suitCnt[bestSuit] >= 9) {
    tips.push(`【${suitLabel(bestSuit)}】已有 ${suitCnt[bestSuit]} 张，极具清一色高番潜力，建议优先留同花色！`);
  }

  // 检查对子数（七对/碰碰胡潜力）
  const map = new Map<string, number>();
  for (const t of hand) map.set(`${t.suit}_${t.val}`, (map.get(`${t.suit}_${t.val}`) ?? 0) + 1);
  let pairs = 0;
  let triplets = 0;
  for (const c of map.values()) {
    if (c >= 3) triplets += 1;
    else if (c === 2) pairs += 1;
  }
  if (melds.length === 0 && pairs >= 4) {
    tips.push(`已有 ${pairs} 个对子，可重点保留对子冲【七小对】大胡！`);
  } else if (triplets + melds.filter((m) => m.type !== 'chow').length >= 2) {
    tips.push(`刻子较多，碰牌有机会做成【碰碰胡】高番！`);
  }

  // 长沙 258 硬将提醒
  if (is258Strict) {
    const has258Pair = [...map.entries()].some(([k, c]) => {
      if (c < 2) return false;
      const v = Number(k.split('_')[1]);
      return v === 2 || v === 5 || v === 8;
    });
    if (!has258Pair) {
      tips.push('长沙小胡需 2/5/8 硬将，建议尽量留住一张 2、5 或 8 凑对作将。');
    }
  }

  // 国标 8 番起胡 & 红中癞子策略提醒
  if (variantId === 'hz-mahjong') {
    const wilds = hand.filter((t) => t.suit === 'dragon' && t.val === 1).length;
    if (wilds >= 2) {
      tips.push(`手握 ${wilds} 张【红中】万能癞子！切勿打出红中，优先碰牌快速自摸胡牌并冲刺扎 4 码！`);
    } else if (wilds === 1) {
      tips.push('持有 1 张【红中】万能癞子，绝不可打出；可任意补齐顺子/刻子/将牌，极速自摸！');
    } else {
      tips.push('当前手中无红中，若直接自摸可享【无红中硬胡】+2番翻倍奖励！');
    }
  } else if (variantId === 'guobiao-mahjong') {
    tips.push('国标 8 番起胡：可结合【清一色/混一色/碰碰和/断幺/箭刻/门清】凑足 8 番！');
  } else if (includeHonors && variantId === 'gd-mahjong') {
    tips.push('广东推倒胡：孤张风牌优先打，保留中/发/白对子与 3–7 中张顺子搭子胜率更高。');
  }

  if (tips.length === 0) {
    tips.push('优先保留 3–7 中张两面搭子，先舍弃孤立 1/9 边张与单张字牌，听牌速度最快。');
  }

  return tips.slice(0, 3);
}

/** 实时分析玩家当前手牌，输出最优出牌推荐、听牌明细与留牌建议 */
export function analyzeMahjongHand(params: {
  myHand: AdvisorTile[];
  myMelds: AdvisorMeld[];
  allVisibleTiles: AdvisorTile[];
  isMyTurn: boolean;
  variantId: string;
  includeHonors: boolean;
  is258Strict: boolean;
  dingqueSuit: AdvisorNumericSuit | null;
  wildCard?: { suit: AdvisorSuit; val: number } | null;
}): HandAdvice {
  const {
    myHand,
    myMelds,
    allVisibleTiles,
    isMyTurn,
    variantId,
    includeHonors,
    is258Strict,
    dingqueSuit,
    wildCard,
  } = params;
  const wildIdx = wildCard ? toIndex(wildCard.suit, wildCard.val) : -1;

  const seen = new Array<number>(34).fill(0);
  for (const t of allVisibleTiles) {
    seen[toIndex(t.suit, t.val)]! += 1;
  }
  for (const t of myHand) {
    seen[toIndex(t.suit, t.val)]! += 1;
  }

  const handCounts = new Array<number>(34).fill(0);
  for (const t of myHand) {
    handCounts[toIndex(t.suit, t.val)]! += 1;
  }

  const meldsCount = myMelds.length;
  const keepTips = buildKeepTips({
    hand: myHand,
    melds: myMelds,
    variantId,
    dingqueSuit,
    is258Strict,
    includeHonors,
  });

  // 轮到自己出牌（14/11/8/5/2张）：评估打出每一张牌后的向听数与有效进张
  const canDiscardNow = isMyTurn && myHand.length % 3 === 2;
  if (canDiscardNow) {
    const byTileKey = new Map<string, DiscardEvaluation>();
    const evaluated: Array<{ evalItem: DiscardEvaluation; rankScore: number }> = [];
    const seenCandidates = new Set<string>();
    const hasDingqueInHand = Boolean(dingqueSuit && myHand.some((t) => t.suit === dingqueSuit));

    for (const tile of myHand) {
      const k = `${tile.suit}_${tile.val}`;
      if (seenCandidates.has(k)) continue;
      seenCandidates.add(k);

      const idx = toIndex(tile.suit, tile.val);
      const isWild = wildIdx >= 0 && idx === wildIdx;
      handCounts[idx]! -= 1;
      const eff = computeEffectiveWaits(handCounts, seen, meldsCount, includeHonors, dingqueSuit, wildIdx);
      handCounts[idx]! += 1;

      const isDqTile = Boolean(dingqueSuit && tile.suit === dingqueSuit);
      const isHonor = tile.suit === 'wind' || tile.suit === 'dragon';
      const isTerminal = !isHonor && (tile.val === 1 || tile.val === 9);
      const is258 = !isHonor && (tile.val === 2 || tile.val === 5 || tile.val === 8);

      // 综合胜率评分（绝不推荐打出红中癞子！定缺必优先 > 最低向听 > 最大活张数 > 保留258/中张弹性）
      const rankScore =
        (isWild ? -99999 : 0) +
        (hasDingqueInHand && isDqTile ? 5000 : 0) -
        eff.shanten * 400 +
        eff.totalLive * 14 +
        (isHonor && !isWild ? 16 : 0) +
        (isTerminal ? 10 : 0) -
        (is258Strict && is258 ? 8 : 0);

      // 计算直观可读的相对胜率估算 (18% ~ 95%)
      const winRatePct = isWild
        ? 10
        : Math.max(
            18,
            Math.min(96, Math.round(86 - eff.shanten * 19 + Math.min(24, eff.totalLive * 1.4))),
          );

      let reason: string;
      if (isWild) {
        reason = '【红中】为万能癞子王牌，强烈建议保留，切勿打出！';
      } else if (hasDingqueInHand && isDqTile) {
        reason = `优先清空定缺【${suitLabel(dingqueSuit!)}】，避免被查花猪！`;
      } else if (eff.shanten <= 0) {
        const topWaits = eff.waits
          .slice(0, 3)
          .map((w) => `${w.label}(余${w.remaining})`)
          .join('、');
        reason =
          eff.totalLive > 0
            ? `打出即【听牌】！可胡 ${topWaits}（共 ${eff.totalLive} 张活牌）`
            : `打出进入听牌，但桌面活张较少，可留意转张`;
      } else {
        reason = `打出后 ${eff.shanten} 向听，保留高连张搭子，有效进张 ${eff.totalLive} 张`;
      }

      const evalItem: DiscardEvaluation = {
        tile,
        shanten: eff.shanten,
        totalLive: eff.totalLive,
        waits: eff.waits,
        winRatePct,
        reason,
      };
      byTileKey.set(k, evalItem);
      evaluated.push({ evalItem, rankScore });
    }

    evaluated.sort((a, b) => b.rankScore - a.rankScore);
    const best = evaluated[0]?.evalItem ?? null;

    return {
      mode: 'discard',
      currentShanten: best?.shanten ?? 3,
      isTenpai: (best?.shanten ?? 9) <= 0,
      tenpaiWaits: best && best.shanten <= 0 ? best.waits : [],
      bestDiscard: best,
      byTileKey,
      keepTips,
      summary: best
        ? `推荐打【${tileLabel(best.tile.suit, best.tile.val)}】 · ${best.reason}`
        : '请选择一张手牌打出',
    };
  }

  // 等待阶段（13/10/7/4/1张）：计算当前是否听牌与胡牌张
  const eff = computeEffectiveWaits(handCounts, seen, meldsCount, includeHonors, dingqueSuit, wildIdx);
  const isTenpai = eff.shanten <= 0 && !(dingqueSuit && myHand.some((t) => t.suit === dingqueSuit));

  return {
    mode: 'wait',
    currentShanten: eff.shanten,
    isTenpai,
    tenpaiWaits: isTenpai ? eff.waits : [],
    bestDiscard: null,
    byTileKey: new Map(),
    keepTips,
    summary: isTenpai
      ? `🔥 已听牌！可胡 ${eff.waits
          .slice(0, 4)
          .map((w) => `${w.label}(余${w.remaining})`)
          .join('、')}（共 ${eff.totalLive} 张）`
      : `当前距听牌还差 ${Math.max(1, eff.shanten)} 步（有效进张 ${eff.totalLive} 张）`,
  };
}
