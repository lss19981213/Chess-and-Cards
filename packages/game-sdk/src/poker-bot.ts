import type { BotDifficulty } from '@cc/protocol';
import { compareHandRank, createPokerDeck, evaluateBestHand, type Card } from './cards';

export interface PokerBotInput {
  mode: 'texas' | 'stud' | 'goldenflower';
  holeCards: readonly Card[];
  communityCards: readonly Card[];
  /** 已明牌亮出的对手/自身全部可见牌（梭哈/翻金花可用于剔除已知牌，德州为手牌+公共牌） */
  knownDeadCards?: readonly Card[];
  pot: number;
  toCall: number;
  canRaise: boolean;
  raiseUnit: number;
  opponents: number;
  difficulty: BotDifficulty;
}

export interface PokerBotDecision {
  cmd: 'fold' | 'check' | 'call' | 'raise';
  payload: Record<string, unknown>;
}

/** 德州翻牌前 Chen Formula 评分（映射至约 0.25 ~ 0.90 估算胜率区间） */
function preflopTexasScore(hole: readonly Card[]): number {
  if (hole.length < 2) return 0.35;
  const a = hole[0]!;
  const b = hole[1]!;
  const high = Math.max(a.rank, b.rank);
  const low = Math.min(a.rank, b.rank);
  const suited = a.suit === b.suit;
  const gap = high - low;
  const isPair = high === low;

  let base: number;
  if (high === 14) base = 10;
  else if (high === 13) base = 8;
  else if (high === 12) base = 7;
  else if (high === 11) base = 6;
  else base = high / 2;

  if (isPair) {
    base = Math.max(5, base * 2);
  } else {
    if (suited) base += 2;
    if (gap === 1) base += 1;
    else if (gap === 2) base -= 1;
    else if (gap === 3) base -= 2;
    else if (gap >= 4) base -= 4;
    if (gap <= 2 && high < 12) base += 1;
  }

  // Chen score 大致在 -2 到 20 之间，归一化到估算对抗胜率
  const norm = Math.max(0.18, Math.min(0.88, (base + 2) / 22));
  return norm;
}

/** 从剩余牌堆中洗出前 n 张 */
function drawRandom(pool: Card[], count: number): Card[] {
  const n = pool.length;
  for (let i = 0; i < count && i < n; i += 1) {
    const j = i + Math.floor(Math.random() * (n - i));
    const tmp = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = tmp;
  }
  return pool.slice(0, count);
}

/**
 * 蒙特卡洛胜率模拟：模拟补齐公共牌并随机分发未知对手手牌，对比真实赢率
 */
export function estimatePokerEquity(
  mode: 'texas' | 'stud' | 'goldenflower',
  holeCards: readonly Card[],
  communityCards: readonly Card[],
  knownDeadCards: readonly Card[],
  opponents: number,
  iterations: number,
): number {
  if (opponents <= 0) return 1;
  const fullDeck = createPokerDeck();
  const deadIds = new Set([...holeCards, ...communityCards, ...knownDeadCards].map((c) => c.id));
  const pool = fullDeck.filter((c) => !deadIds.has(c.id));

  const targetSize = mode === 'texas' ? 5 : 5; // 德州 5 张公共牌；梭哈/翻金花总计凑 5 张对比
  let wins = 0;
  let ties = 0;

  for (let iter = 0; iter < iterations; iter += 1) {
    if (mode === 'texas') {
      const needComm = Math.max(0, 5 - communityCards.length);
      const needed = needComm + opponents * 2;
      if (pool.length < needed) break;
      const drawn = drawRandom(pool, needed);
      const simComm = [...communityCards, ...drawn.slice(0, needComm)];
      const heroRank = evaluateBestHand([...holeCards, ...simComm]);

      let heroBest = true;
      let tie = false;
      for (let o = 0; o < opponents; o += 1) {
        const oppHole = [drawn[needComm + o * 2]!, drawn[needComm + o * 2 + 1]!];
        const oppRank = evaluateBestHand([...oppHole, ...simComm]);
        const cmp = compareHandRank(oppRank, heroRank);
        if (cmp > 0) {
          heroBest = false;
          break;
        }
        if (cmp === 0) tie = true;
      }
      if (heroBest) {
        if (tie) ties += 1;
        else wins += 1;
      }
    } else {
      // stud / goldenflower：每个人一共 5 张牌比较
      const needHero = Math.max(0, targetSize - holeCards.length);
      const oppSize = targetSize;
      const needed = needHero + opponents * oppSize;
      if (pool.length < needed) break;
      const drawn = drawRandom(pool, needed);
      const heroHand = [...holeCards, ...drawn.slice(0, needHero)];
      const heroRank = evaluateBestHand(heroHand);

      let heroBest = true;
      let tie = false;
      for (let o = 0; o < opponents; o += 1) {
        const start = needHero + o * oppSize;
        const oppHand = drawn.slice(start, start + oppSize);
        const oppRank = evaluateBestHand(oppHand);
        const cmp = compareHandRank(oppRank, heroRank);
        if (cmp > 0) {
          heroBest = false;
          break;
        }
        if (cmp === 0) tie = true;
      }
      if (heroBest) {
        if (tie) ties += 1;
        else wins += 1;
      }
    }
  }

  return iterations > 0 ? (wins + ties * 0.5) / iterations : 0.5;
}

/**
 * 扑克通用博弈决策入口（德州、梭哈、翻金花低中高三档）
 */
export function decidePokerBotAction(input: PokerBotInput): PokerBotDecision {
  const {
    mode,
    holeCards,
    communityCards,
    knownDeadCards = [],
    pot,
    toCall,
    canRaise,
    raiseUnit,
    opponents,
    difficulty,
  } = input;

  const oppCount = Math.max(1, opponents);
  const currentRank = evaluateBestHand([...holeCards, ...communityCards]);

  // ================== 低难度：松弱随缘鱼玩家 ==================
  if (difficulty === 'low') {
    const strength = currentRank.category;
    if (toCall <= 0) {
      if (canRaise && strength >= 4 && Math.random() < 0.35) {
        return { cmd: 'raise', payload: {} };
      }
      return { cmd: 'check', payload: {} };
    }
    // 经常不懂弃牌乱跟或面对小注无脑弃牌
    if (strength >= 3) {
      if (canRaise && Math.random() < 0.35) return { cmd: 'raise', payload: {} };
      return { cmd: 'call', payload: {} };
    }
    if (strength >= 1 && Math.random() < 0.72) return { cmd: 'call', payload: {} };
    if (toCall <= pot * 0.4 && Math.random() < 0.45) return { cmd: 'call', payload: {} };
    return { cmd: 'fold', payload: {} };
  }

  // ================== 计算蒙特卡洛胜率与底池赔率 ==================
  let equity: number;
  if (mode === 'texas' && communityCards.length === 0) {
    // 翻牌前使用 Chen Formula 快速估权并根据多人底池折扣
    const huEq = preflopTexasScore(holeCards);
    equity = Math.pow(huEq, Math.sqrt(oppCount));
  } else {
    // 蒙特卡洛在 ws 主线程同步执行，保持毫秒级；220 次已足够稳定
    const simCount = difficulty === 'high' ? 120 : 60;
    equity = estimatePokerEquity(mode, holeCards, communityCards, knownDeadCards, oppCount, simCount);
  }

  const totalPotAfterCall = Math.max(1, pot + Math.max(0, toCall));
  const potOdds = toCall > 0 ? toCall / totalPotAfterCall : 0;
  // 多人桌公平胜率基准线 ~ 1 / (oppCount + 1)
  const fairShare = 1 / (oppCount + 1);

  // ================== 中难度：标准紧凶策略 (Pot Odds + Equity) ==================
  if (difficulty === 'medium') {
    if (toCall <= 0) {
      if (canRaise && equity >= fairShare + 0.16) {
        return { cmd: 'raise', payload: {} };
      }
      return { cmd: 'check', payload: {} };
    }
    if (canRaise && equity >= Math.max(potOdds + 0.22, fairShare + 0.20)) {
      return { cmd: 'raise', payload: {} };
    }
    if (equity + 0.04 >= potOdds || toCall <= raiseUnit * 0.5) {
      return { cmd: 'call', payload: {} };
    }
    return { cmd: 'fold', payload: {} };
  }

  // ================== 高难度：大师级博弈 (精准赔率 + 尺度控制 + 混合诈唬/诱敌慢打) ==================
  const margin = equity - potOdds;
  const edgeOverFair = equity - fairShare;

  if (toCall <= 0) {
    // 超强成牌有 25% 概率诱敌过牌慢打 (Slow Play)
    if (equity >= 0.78 && Math.random() < 0.25) {
      return { cmd: 'check', payload: {} };
    }
    if (canRaise && edgeOverFair >= 0.14) {
      // 强优势按底池比例做价值下注
      const sizeMultiplier = equity >= 0.72 ? 2 : 1;
      return { cmd: 'raise', payload: { amount: raiseUnit * sizeMultiplier } };
    }
    // 14% 混合策略抓鸡/半诈唬下注偷池
    if (canRaise && equity >= fairShare * 0.6 && Math.random() < 0.14) {
      return { cmd: 'raise', payload: { amount: raiseUnit } };
    }
    return { cmd: 'check', payload: {} };
  }

  // 面对加注需要跟注
  if (canRaise && edgeOverFair >= 0.22 && margin >= 0.15) {
    const sizeMultiplier = equity >= 0.75 ? 3 : 2;
    return { cmd: 'raise', payload: { amount: raiseUnit * sizeMultiplier } };
  }

  // 半诈唬反击加注 (Semi-Bluff Re-raise)
  if (canRaise && equity >= potOdds - 0.03 && equity >= fairShare * 0.85 && Math.random() < 0.1) {
    return { cmd: 'raise', payload: { amount: raiseUnit } };
  }

  // 计算隐含赔率容差（小注且听牌概率高可跟看下一张）
  const impliedAllowance = communityCards.length < 5 ? 0.05 : 0.01;
  if (equity + impliedAllowance >= potOdds) {
    return { cmd: 'call', payload: {} };
  }

  // 偶尔用合适底池赔率防御盲注不被轻易偷鸡
  if (toCall <= raiseUnit && Math.random() < 0.18) {
    return { cmd: 'call', payload: {} };
  }

  return { cmd: 'fold', payload: {} };
}
