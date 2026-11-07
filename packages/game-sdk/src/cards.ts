/**
 * 共享扑克牌引擎：确定性洗牌、牌型解析与比较、德州牌力评估。
 * 洗牌由房间种子驱动，同一局可完整复现，便于战报回放与公平性核验。
 */

export type Suit = 'S' | 'H' | 'D' | 'C';

export interface Card {
  /** 唯一标识，如 "S10"、"JOKER_S" */
  id: string;
  /** 点数：3-15（15 为 2），16 小王，17 大王；德州使用 2-14 */
  rank: number;
  suit: Suit | 'JOKER';
}

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

export function rankLabel(rank: number): string {
  if (rank === 17) return '大王';
  if (rank === 16) return '小王';
  if (rank === 15) return '2';
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  return String(rank);
}

export const SUIT_LABEL: Record<string, string> = { S: '♠', H: '♥', D: '♦', C: '♣', JOKER: '' };

export function cardLabel(card: Card): string {
  return `${SUIT_LABEL[card.suit] ?? ''}${rankLabel(card.rank)}`;
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 基于种子洗牌，结果可复现 */
export function shuffleWithSeed<T>(items: readonly T[], seed: string): T[] {
  const rand = mulberry32(hashSeed(seed));
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
  return arr;
}

/** 斗地主/跑得快牌组：3 - 2（rank 3-15），可选大小王 */
export function createCardDeck(ranks: readonly number[], withJokers: boolean): Card[] {
  const deck: Card[] = [];
  for (const rank of ranks) {
    for (const suit of SUITS) {
      deck.push({ id: `${suit}${rank}`, rank, suit });
    }
  }
  if (withJokers) {
    deck.push({ id: 'JOKER_S', rank: 16, suit: 'JOKER' });
    deck.push({ id: 'JOKER_B', rank: 17, suit: 'JOKER' });
  }
  return deck;
}

/** 标准 52 张（rank 2-14） */
export function createPokerDeck(): Card[] {
  const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  return createCardDeck(ranks, false);
}

export type ComboKind =
  | 'single'
  | 'pair'
  | 'triple'
  | 'triple_one'
  | 'triple_two'
  | 'straight'
  | 'double_straight'
  | 'plane'
  | 'bomb'
  | 'rocket';

export interface Combo {
  kind: ComboKind;
  /** 主点数，用于同牌型比较 */
  main: number;
  size: number;
  cards: Card[];
}

export interface ComboRules {
  allowTripleWith: boolean;
  allowPlane: boolean;
  minStraight: number;
  minDoubleStraight: number;
  allowRocket: boolean;
}

export const DOUDIZHU_RULES: ComboRules = {
  allowTripleWith: true,
  allowPlane: true,
  minStraight: 5,
  minDoubleStraight: 3,
  allowRocket: true,
};

export const PAODEKUAI_RULES: ComboRules = {
  allowTripleWith: false,
  allowPlane: false,
  minStraight: 5,
  minDoubleStraight: 2,
  allowRocket: false,
};

function isConsecutive(sorted: readonly number[]): boolean {
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev === undefined || cur === undefined || cur - prev !== 1) return false;
  }
  return sorted.length > 0;
}

/** 顺子、连对、飞机不能包含 2 与大小王 */
function containsBig(ranks: readonly number[]): boolean {
  return ranks.some((r) => r >= 15);
}

export function parseCombo(cards: Card[], rules: ComboRules): Combo | null {
  const n = cards.length;
  if (n === 0) return null;

  const counts = new Map<number, number>();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);

  const ranks = [...counts.keys()].sort((a, b) => a - b);
  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  const top = groups[0];

  if (rules.allowRocket && n === 2 && cards.every((c) => c.rank >= 16)) {
    return { kind: 'rocket', main: 17, size: 2, cards };
  }
  if (n === 4 && counts.size === 1 && ranks[0] !== undefined) {
    return { kind: 'bomb', main: ranks[0], size: 4, cards };
  }
  if (n === 1 && ranks[0] !== undefined) {
    return { kind: 'single', main: ranks[0], size: 1, cards };
  }
  if (n === 2 && counts.size === 1 && ranks[0] !== undefined) {
    return { kind: 'pair', main: ranks[0], size: 2, cards };
  }
  if (n === 3 && counts.size === 1 && ranks[0] !== undefined) {
    return { kind: 'triple', main: ranks[0], size: 3, cards };
  }

  if (n >= rules.minStraight && counts.size === n && !containsBig(ranks) && isConsecutive(ranks)) {
    const high = ranks[ranks.length - 1];
    if (high !== undefined) return { kind: 'straight', main: high, size: n, cards };
  }

  if (
    n % 2 === 0 &&
    n / 2 >= rules.minDoubleStraight &&
    groups.length === n / 2 &&
    groups.every((g) => g.count === 2) &&
    !containsBig(ranks) &&
    isConsecutive(ranks)
  ) {
    const high = ranks[ranks.length - 1];
    if (high !== undefined) return { kind: 'double_straight', main: high, size: n, cards };
  }

  if (rules.allowTripleWith && top) {
    if (n === 4 && top.count === 3) {
      return { kind: 'triple_one', main: top.rank, size: 4, cards };
    }
    if (n === 5 && top.count === 3 && groups[1]?.count === 2) {
      return { kind: 'triple_two', main: top.rank, size: 5, cards };
    }
  }

  if (rules.allowPlane) {
    const triples = ranks.filter((r) => (counts.get(r) ?? 0) >= 3 && r < 16);
    if (triples.length >= 2 && isConsecutive(triples)) {
      const k = triples.length;
      const high = triples[k - 1];
      if (high !== undefined && (n === k * 3 || n === k * 4 || n === k * 5)) {
        return { kind: 'plane', main: high, size: n, cards };
      }
    }
  }

  return null;
}

export function canBeat(candidate: Combo, previous: Combo | null): boolean {
  if (!previous) return true;
  if (candidate.kind === 'rocket') return true;
  if (previous.kind === 'rocket') return false;
  if (candidate.kind === 'bomb' && previous.kind !== 'bomb') return true;
  if (previous.kind === 'bomb' && candidate.kind !== 'bomb') return false;
  if (candidate.kind !== previous.kind) return false;
  if (candidate.size !== previous.size) return false;
  return candidate.main > previous.main;
}

export interface HandRank {
  category: number;
  values: number[];
  label: string;
}

const CATEGORY_LABEL = [
  '高牌',
  '一对',
  '两对',
  '三条',
  '顺子',
  '同花',
  '葫芦',
  '四条',
  '同花顺',
];

function detectStraight(ranksDesc: readonly number[]): number {
  const unique = [...new Set(ranksDesc)].sort((a, b) => b - a);
  if (unique.length < 5) return 0;
  // A 可作为 1：A,5,4,3,2
  if (unique[0] === 14) {
    const wheel = [14, 5, 4, 3, 2];
    if (wheel.every((r) => unique.includes(r))) return 5;
  }
  for (let i = 0; i + 4 < unique.length; i += 1) {
    const slice = unique.slice(i, i + 5);
    if (isConsecutive([...slice].reverse())) {
      return slice[0] ?? 0;
    }
  }
  return 0;
}

function evaluateFive(cards: Card[]): HandRank {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const isFlush = new Set(cards.map((c) => c.suit)).size === 1;

  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()]
    .map(([rank, count]) => ({ rank, count }))
    .sort((a, b) => b.count - a.count || b.rank - a.rank);

  const straightHigh = detectStraight(ranks);
  const kickers = groups.map((g) => g.rank);

  if (straightHigh > 0 && isFlush) return { category: 8, values: [straightHigh], label: CATEGORY_LABEL[8]! };
  if (groups[0]?.count === 4) {
    return { category: 7, values: [groups[0].rank, ...groups.slice(1).map((g) => g.rank)], label: CATEGORY_LABEL[7]! };
  }
  if (groups[0]?.count === 3 && groups[1]?.count === 2) {
    return { category: 6, values: [groups[0].rank, groups[1].rank], label: CATEGORY_LABEL[6]! };
  }
  if (isFlush) return { category: 5, values: ranks, label: CATEGORY_LABEL[5]! };
  if (straightHigh > 0) return { category: 4, values: [straightHigh], label: CATEGORY_LABEL[4]! };
  if (groups[0]?.count === 3) {
    return { category: 3, values: [groups[0].rank, ...kickers.slice(1)], label: CATEGORY_LABEL[3]! };
  }
  if (groups[0]?.count === 2 && groups[1]?.count === 2) {
    return {
      category: 2,
      values: [groups[0].rank, groups[1].rank, ...groups.slice(2).map((g) => g.rank)],
      label: CATEGORY_LABEL[2]!,
    };
  }
  if (groups[0]?.count === 2) {
    return { category: 1, values: [groups[0].rank, ...kickers.slice(1)], label: CATEGORY_LABEL[1]! };
  }
  return { category: 0, values: ranks, label: CATEGORY_LABEL[0]! };
}

export function compareHandRank(a: HandRank, b: HandRank): number {
  if (a.category !== b.category) return a.category - b.category;
  const len = Math.max(a.values.length, b.values.length);
  for (let i = 0; i < len; i += 1) {
    const av = a.values[i] ?? 0;
    const bv = b.values[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function combinations<T>(items: readonly T[], pick: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, acc: T[]): void => {
    if (acc.length === pick) {
      result.push([...acc]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      const item = items[i];
      if (item === undefined) continue;
      acc.push(item);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return result;
}

export interface BestHand extends HandRank {
  best5: Card[];
}

/** 从 5-7 张牌中选出最强的 5 张 */
export function evaluateBestHand(cards: Card[]): BestHand {
  if (cards.length <= 5) {
    const rank = evaluateFive(cards);
    return { ...rank, best5: [...cards] };
  }
  let best: BestHand | null = null;
  for (const combo of combinations(cards, 5)) {
    const rank = evaluateFive(combo);
    if (!best || compareHandRank(rank, best) > 0) {
      best = { ...rank, best5: combo };
    }
  }
  if (!best) {
    const rank = evaluateFive(cards.slice(0, 5));
    return { ...rank, best5: cards.slice(0, 5) };
  }
  return best;
}
