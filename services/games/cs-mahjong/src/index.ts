/**
 * 长沙麻将五变体合集（单文件）。找 bug 请先看目录再跳转，勿全文盲搜。
 *
 * 目录（约行号，以当前文件为准）：
 * - 牌型 / 状态类型定义 …… 文件前部
 * - VariantMahjongPlugin 核心逻辑 …… 中部大类
 * - CsMahjongPlugin   (cs-mahjong)      …… ~2429
 * - ScMahjongPlugin   (sc-mahjong)      …… ~2463
 * - GdMahjongPlugin   (gd-mahjong)      …… ~2497
 * - GuobiaoMahjongPlugin (guobiao-mahjong) …… ~2531
 * - HzMahjongPlugin   (hz-mahjong)      …… ~2565
 *
 * 前端共用：apps/lobby-web/src/games/CsMahjong.tsx
 * 导航：仓库根 CONTEXT.md、docs/GAME_MAP.md
 */
import type { BotDifficulty, GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';
import type { GameIntent, RoomContext } from '@cc/game-sdk';
import { BaseGamePlugin, shuffleWithSeed } from '@cc/game-sdk';

export type MahjongSuit = 'wan' | 'bamboo' | 'dot' | 'wind' | 'dragon';
export type NumericSuit = 'wan' | 'bamboo' | 'dot';

export interface MahjongTileData {
  id: string;
  suit: MahjongSuit;
  val: number;
}

export interface Meld {
  type: 'pong' | 'kong' | 'chow';
  concealed?: boolean;
  tiles: MahjongTileData[];
}

export interface ChowOption {
  tileIds: [string, string];
  tiles: MahjongTileData[];
}

export interface MahjongActionEvent {
  seq: number;
  type: 'start' | 'start_bonus' | 'dingque_done' | 'discard' | 'chow' | 'pong' | 'kong' | 'hu' | 'zimo' | 'draw_game';
  playerId: string;
  nickname: string;
  tile?: MahjongTileData;
  huType?: string;
  detail?: string;
}

interface ClaimRights {
  canHu: boolean;
  canKong: boolean;
  canPong: boolean;
  chowOptions: ChowOption[];
}

interface ClaimChoice {
  cmd: 'hu' | 'kong' | 'pong' | 'chow';
  tileIds?: [string, string];
}

interface PendingClaim {
  discarderId: string;
  tile: MahjongTileData;
  isRobKong?: boolean;
  kongPlayerId?: string;
  eligible: Map<string, ClaimRights>;
  passed: Set<string>;
  chosen: Map<string, ClaimChoice>;
}

interface ResultRow {
  playerId: string;
  nickname: string;
  delta: number;
  huType: string;
  birds: MahjongTileData[];
}

interface HuEval {
  ok: boolean;
  type: string;
  fan: number;
  fanTags: string[];
}

interface State {
  phase: 'dingque' | 'playing' | 'settled';
  wall: MahjongTileData[];
  hands: Map<string, MahjongTileData[]>;
  melds: Map<string, Meld[]>;
  discards: Map<string, MahjongTileData[]>;
  dingque: Map<string, NumericSuit>;
  gangScore: Map<string, number>;
  startBonusLabels: Map<string, string[]>;
  huDone: Set<string>;
  huTypes: Map<string, string>;
  runningDelta: Map<string, number>;
  turn: string | null;
  dealerId: string | null;
  lastDiscard: { playerId: string; tile: MahjongTileData } | null;
  pendingClaim: PendingClaim | null;
  lastAction: MahjongActionEvent | null;
  actionSeq: number;
  afterKong: boolean;
  turnCount: number;
  settled: boolean;
  winners: string[];
  birds: MahjongTileData[];
  results: ResultRow[];
  drawnTile: Map<string, MahjongTileData | null>;
}

export interface MahjongVariantConfig {
  meta: GameMeta;
  /** 是否包含风牌(东南西北)与箭牌(中发白)，共 136 张 */
  includeHonors: boolean;
  /** 是否为 112 张红中牌堆（万条筒 108 张 + 4 张红中） */
  includeRedDragonOnly?: boolean;
  /** 万能癞子牌（如红中麻将：dragon_1） */
  wildCard?: { suit: MahjongSuit; val: number } | null;
  /** 是否仅允许自摸胡（除抢杠胡外不可点炮胡，如红中麻将） */
  zimoOnly?: boolean;
  /** 是否允许吃牌（仅限上家顺子） */
  allowChow: boolean;
  /** 普通平胡是否要求 2/5/8 硬将（长沙麻将） */
  is258Strict: boolean;
  /** 是否启用长沙起手胡（四喜/板板胡/缺一色/六六顺） */
  hasStartBonuses: boolean;
  /** 是否启用四川定缺 */
  hasDingque: boolean;
  /** 是否启用四川血战到底（一家胡后继续至三家胡或摸完牌墙，含查花猪/查大叫） */
  bloodBattle: boolean;
  /** 杠牌是否即时计分（四川刮风下雨 / 广东杠分 / 红中杠分） */
  gangInstantScore: boolean;
  /** 是否采用国标麻将多番种累加与 8 番起胡 */
  guobiaoScoring: boolean;
  /** 起胡最低番数 */
  minHuFan: number;
  /** 胡牌后摸鸟/买马/扎码张数 */
  birdCount: number;
  /** 鸟/马/码规则类型 */
  birdMode: 'none' | 'changsha' | 'guangdong' | 'hongzhong';
  /** 奖励牌展示文案（如 鸟 / 马 / 码 / 番） */
  bonusLabel: string;
  /** 基础底分 */
  baseWin: number;
  /** 番型倍率系数 */
  fanBoost: number;
  /** 结算原因标识 */
  settleReason: string;
}

const SUIT_ORDER: Record<MahjongSuit, number> = {
  wan: 1,
  bamboo: 2,
  dot: 3,
  wind: 4,
  dragon: 5,
};

const NUMERIC_SUITS: NumericSuit[] = ['wan', 'bamboo', 'dot'];

function isNumericSuit(suit: MahjongSuit): suit is NumericSuit {
  return suit === 'wan' || suit === 'bamboo' || suit === 'dot';
}

function emptyState(): State {
  return {
    phase: 'playing',
    wall: [],
    hands: new Map(),
    melds: new Map(),
    discards: new Map(),
    dingque: new Map(),
    gangScore: new Map(),
    startBonusLabels: new Map(),
    huDone: new Set(),
    huTypes: new Map(),
    runningDelta: new Map(),
    turn: null,
    dealerId: null,
    lastDiscard: null,
    pendingClaim: null,
    lastAction: null,
    actionSeq: 0,
    afterKong: false,
    turnCount: 0,
    settled: false,
    winners: [],
    birds: [],
    results: [],
    drawnTile: new Map(),
  };
}

function isWildTile(t: { suit: MahjongSuit; val: number }, variant: MahjongVariantConfig): boolean {
  return Boolean(variant.wildCard && t.suit === variant.wildCard.suit && t.val === variant.wildCard.val);
}

/** 生成 108 张（筒条万）、112 张（红中麻将：筒条万 + 4 张红中）或 136 张（筒条万 + 东南西北中发白）牌墙 */
function buildMahjongDeck(includeHonors: boolean, includeRedDragonOnly = false): MahjongTileData[] {
  const deck: MahjongTileData[] = [];
  for (const suit of NUMERIC_SUITS) {
    for (let val = 1; val <= 9; val++) {
      for (let copy = 0; copy < 4; copy++) {
        deck.push({ id: `${suit}${val}_${copy}`, suit, val });
      }
    }
  }
  if (includeHonors) {
    for (let val = 1; val <= 4; val++) {
      for (let copy = 0; copy < 4; copy++) {
        deck.push({ id: `wind${val}_${copy}`, suit: 'wind', val });
      }
    }
    for (let val = 1; val <= 3; val++) {
      for (let copy = 0; copy < 4; copy++) {
        deck.push({ id: `dragon${val}_${copy}`, suit: 'dragon', val });
      }
    }
  } else if (includeRedDragonOnly) {
    for (let copy = 0; copy < 4; copy++) {
      deck.push({ id: `dragon1_${copy}`, suit: 'dragon', val: 1 });
    }
  }
  return deck;
}

function sortHand(
  tiles: MahjongTileData[],
  dingqueSuit?: NumericSuit,
  wildCard?: { suit: MahjongSuit; val: number } | null,
): MahjongTileData[] {
  return [...tiles].sort((a, b) => {
    // 红中癞子置顶排在手牌最左侧，清晰醒目
    if (wildCard) {
      const aW = a.suit === wildCard.suit && a.val === wildCard.val ? 0 : 1;
      const bW = b.suit === wildCard.suit && b.val === wildCard.val ? 0 : 1;
      if (aW !== bW) return aW - bW;
    }
    // 四川定缺花色排到最右侧，方便一眼识别优先打出
    if (dingqueSuit) {
      const aDq = a.suit === dingqueSuit ? 1 : 0;
      const bDq = b.suit === dingqueSuit ? 1 : 0;
      if (aDq !== bDq) return aDq - bDq;
    }
    if (a.suit !== b.suit) return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    return a.val - b.val;
  });
}

function tileKey(t: { suit: MahjongSuit; val: number }): string {
  return `${t.suit}_${t.val}`;
}

function isTerminalOrHonor(t: { suit: MahjongSuit; val: number }): boolean {
  if (!isNumericSuit(t.suit)) return true;
  return t.val === 1 || t.val === 9;
}

interface DecomposedSet {
  kind: 'triplet' | 'sequence';
  suit: MahjongSuit;
  val: number;
}

/** 将手牌（不含将牌）拆解为面子集合，返回所有可行拆解之一（优先最大刻子或顺子） */
function decomposeSets(
  counts: Map<string, number>,
  preferTriplets: boolean,
  acc: DecomposedSet[] = [],
): DecomposedSet[] | null {
  let firstKey: string | null = null;
  for (const [k, c] of counts.entries()) {
    if (c > 0) {
      firstKey = k;
      break;
    }
  }
  if (!firstKey) return acc;

  const [suit, valStr] = firstKey.split('_') as [MahjongSuit, string];
  const val = Number(valStr);
  const count = counts.get(firstKey) ?? 0;

  const tryTriplet = (): DecomposedSet[] | null => {
    if (count < 3) return null;
    counts.set(firstKey!, count - 3);
    acc.push({ kind: 'triplet', suit, val });
    const res = decomposeSets(counts, preferTriplets, acc);
    if (res) return res;
    acc.pop();
    counts.set(firstKey!, count);
    return null;
  };

  const trySequence = (): DecomposedSet[] | null => {
    if (!isNumericSuit(suit) || val > 7) return null;
    const k2 = `${suit}_${val + 1}`;
    const k3 = `${suit}_${val + 2}`;
    const c2 = counts.get(k2) ?? 0;
    const c3 = counts.get(k3) ?? 0;
    if (c2 <= 0 || c3 <= 0) return null;
    counts.set(firstKey!, count - 1);
    counts.set(k2, c2 - 1);
    counts.set(k3, c3 - 1);
    acc.push({ kind: 'sequence', suit, val });
    const res = decomposeSets(counts, preferTriplets, acc);
    if (res) return res;
    acc.pop();
    counts.set(firstKey!, count);
    counts.set(k2, c2);
    counts.set(k3, c3);
    return null;
  };

  return preferTriplets ? tryTriplet() ?? trySequence() : trySequence() ?? tryTriplet();
}

function findStandardDecomp(
  tiles: MahjongTileData[],
  require258Pair: boolean,
): { pair: { suit: MahjongSuit; val: number }; sets: DecomposedSet[] } | null {
  if (tiles.length % 3 !== 2) return null;
  const counts = new Map<string, number>();
  for (const t of tiles) {
    const k = tileKey(t);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const orderedKeys = [...counts.keys()].sort((a, b) => {
    const [sa, va] = a.split('_') as [MahjongSuit, string];
    const [sb, vb] = b.split('_') as [MahjongSuit, string];
    if (sa !== sb) return SUIT_ORDER[sa] - SUIT_ORDER[sb];
    return Number(va) - Number(vb);
  });

  for (const pk of orderedKeys) {
    const c = counts.get(pk) ?? 0;
    if (c < 2) continue;
    const [suit, valStr] = pk.split('_') as [MahjongSuit, string];
    const val = Number(valStr);
    if (require258Pair && (!isNumericSuit(suit) || (val !== 2 && val !== 5 && val !== 8))) {
      continue;
    }
    const copy = new Map<string, number>();
    for (const k of orderedKeys) copy.set(k, counts.get(k) ?? 0);
    copy.set(pk, c - 2);
    const sets = decomposeSets(copy, true, []) ?? decomposeSets(new Map(copy), false, []);
    if (sets) return { pair: { suit, val }, sets };
  }
  return null;
}

/** 检测十三幺（136 张牌玩法专属顶级大胡） */
function isThirteenOrphans(tiles: MahjongTileData[]): boolean {
  if (tiles.length !== 14) return false;
  const required = [
    'wan_1', 'wan_9', 'bamboo_1', 'bamboo_9', 'dot_1', 'dot_9',
    'wind_1', 'wind_2', 'wind_3', 'wind_4', 'dragon_1', 'dragon_2', 'dragon_3',
  ];
  const counts = new Map<string, number>();
  for (const t of tiles) {
    const k = tileKey(t);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let hasPair = false;
  for (const req of required) {
    const c = counts.get(req) ?? 0;
    if (c === 0) return false;
    if (c === 2) hasPair = true;
    if (c > 2) return false;
  }
  return hasPair && counts.size === 13;
}

/** 检测七小对 / 豪华七小对 */
function checkSevenPairs(tiles: MahjongTileData[]): { ok: boolean; quadCount: number } {
  if (tiles.length !== 14) return { ok: false, quadCount: 0 };
  const counts = new Map<string, number>();
  for (const t of tiles) {
    const k = tileKey(t);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let pairs = 0;
  let quadCount = 0;
  for (const c of counts.values()) {
    if (c === 4) {
      pairs += 2;
      quadCount += 1;
    } else if (c === 2) {
      pairs += 1;
    } else {
      return { ok: false, quadCount: 0 };
    }
  }
  return { ok: pairs === 7, quadCount };
}

/** 统计全手牌（含副露）中的「根」数（四张相同） */
function countRoots(hand: MahjongTileData[], melds: Meld[]): number {
  const counts = new Map<string, number>();
  for (const t of hand) counts.set(tileKey(t), (counts.get(tileKey(t)) ?? 0) + 1);
  for (const m of melds) {
    for (const t of m.tiles) counts.set(tileKey(t), (counts.get(tileKey(t)) ?? 0) + 1);
  }
  let roots = 0;
  for (const c of counts.values()) {
    if (c >= 4) roots += 1;
  }
  return roots;
}

// ---------- 红中麻将：精确万能癞子求解器（每门花色最小需癞子数，带记忆化缓存） ----------
const suitWildCache = new Map<string, number>();

function minWildsForSuit(arr: number[]): number {
  const key = arr.join(',');
  const cached = suitWildCache.get(key);
  if (cached !== undefined) return cached;

  let first = -1;
  for (let i = 0; i < 9; i++) {
    if (arr[i]! > 0) {
      first = i;
      break;
    }
  }
  if (first === -1) return 0;

  let best = 99;
  const c = arr[first]!;

  // 1) 刻子（消耗 3 张，或用癞子补齐至 3 张）
  if (c >= 3) {
    arr[first]! -= 3;
    best = Math.min(best, minWildsForSuit(arr));
    arr[first]! += 3;
  } else if (c === 2) {
    arr[first]! -= 2;
    best = Math.min(best, 1 + minWildsForSuit(arr));
    arr[first]! += 2;
  } else {
    arr[first]! -= 1;
    best = Math.min(best, 2 + minWildsForSuit(arr));
    arr[first]! += 1;
  }

  // 2) 顺子（以 first / first-1 / first-2 开头，缺张用癞子补齐）
  const seqStarts = [first, first - 1, first - 2];
  for (const s of seqStarts) {
    if (s < 0 || s > 6) continue;
    let need = 0;
    const dec: number[] = [];
    for (let k = s; k <= s + 2; k++) {
      if (arr[k]! > 0) {
        arr[k]! -= 1;
        dec.push(k);
      } else {
        need += 1;
      }
    }
    if (dec.length > 0 && need < best) {
      best = Math.min(best, need + minWildsForSuit(arr));
    }
    for (const k of dec) arr[k]! += 1;
  }

  if (suitWildCache.size < 20000) suitWildCache.set(key, best);
  return best;
}

function canFormStandardWithWilds(normalTiles: MahjongTileData[], wilds: number): boolean {
  if ((normalTiles.length + wilds) % 3 !== 2) return false;
  const suitArrs: Record<NumericSuit, number[]> = {
    wan: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    bamboo: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    dot: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  };
  for (const t of normalTiles) {
    if (!isNumericSuit(t.suit)) return false;
    suitArrs[t.suit][t.val - 1]! += 1;
  }

  const checkMelds = (remWilds: number): boolean => {
    const need =
      minWildsForSuit(suitArrs.wan) +
      minWildsForSuit(suitArrs.bamboo) +
      minWildsForSuit(suitArrs.dot);
    return need <= remWilds && (remWilds - need) % 3 === 0;
  };

  // 尝试用 2 张红中直接做将
  if (wilds >= 2 && checkMelds(wilds - 2)) return true;

  // 尝试任意牌做真对子将，或单张 + 1 红中做将
  for (const s of NUMERIC_SUITS) {
    const arr = suitArrs[s];
    for (let i = 0; i < 9; i++) {
      if (arr[i]! >= 2) {
        arr[i]! -= 2;
        if (checkMelds(wilds)) {
          arr[i]! += 2;
          return true;
        }
        arr[i]! += 2;
      }
      if (arr[i]! >= 1 && wilds >= 1) {
        arr[i]! -= 1;
        if (checkMelds(wilds - 1)) {
          arr[i]! += 1;
          return true;
        }
        arr[i]! += 1;
      }
    }
  }
  return false;
}

function canFormAllTripletsWithWilds(normalTiles: MahjongTileData[], wilds: number): boolean {
  if ((normalTiles.length + wilds) % 3 !== 2) return false;
  const counts = new Map<string, number>();
  for (const t of normalTiles) {
    const k = tileKey(t);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const keys = [...counts.keys()];
  const calcNeedTriplets = (): number => {
    let need = 0;
    for (const c of counts.values()) {
      if (c === 0) continue;
      if (c === 1) need += 2;
      else if (c === 2) need += 1;
      else if (c === 4) need += 2;
    }
    return need;
  };

  if (wilds >= 2) {
    const need = calcNeedTriplets();
    if (need <= wilds - 2 && (wilds - 2 - need) % 3 === 0) return true;
  }
  for (const k of keys) {
    const c = counts.get(k)!;
    if (c >= 2) {
      counts.set(k, c - 2);
      const need = calcNeedTriplets();
      counts.set(k, c);
      if (need <= wilds && (wilds - need) % 3 === 0) return true;
    }
    if (c >= 1 && wilds >= 1) {
      counts.set(k, c - 1);
      const need = calcNeedTriplets();
      counts.set(k, c);
      if (need <= wilds - 1 && (wilds - 1 - need) % 3 === 0) return true;
    }
  }
  return false;
}

function checkWildSevenPairs(normalTiles: MahjongTileData[], wilds: number): { ok: boolean; deluxe: boolean } {
  if (normalTiles.length + wilds !== 14) return { ok: false, deluxe: false };
  const counts = new Map<string, number>();
  for (const t of normalTiles) {
    const k = tileKey(t);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let odd = 0;
  let quads = 0;
  for (const c of counts.values()) {
    if (c % 2 === 1) odd += 1;
    if (c === 4) quads += 1;
  }
  if (odd > wilds) return { ok: false, deluxe: false };
  const extraWilds = wilds - odd;
  if (extraWilds % 2 !== 0) return { ok: false, deluxe: false };
  const deluxe = quads > 0 || extraWilds >= 2;
  return { ok: true, deluxe };
}

/** 统一五玩法正宗胡牌与番型判别器 */
function evaluateHu(params: {
  hand: MahjongTileData[];
  melds: Meld[];
  variant: MahjongVariantConfig;
  dingqueSuit?: NumericSuit;
  isSelfDraw: boolean;
  isRobKong?: boolean;
  afterKong: boolean;
  isLastWallTile: boolean;
  isFirstTurnDealer: boolean;
  seatWindVal: number; // 1..4 对应东南西北
}): HuEval {
  const {
    hand,
    melds,
    variant,
    dingqueSuit,
    isSelfDraw,
    isRobKong,
    afterKong,
    isLastWallTile,
    isFirstTurnDealer,
    seatWindVal,
  } = params;

  if (hand.length % 3 !== 2) return { ok: false, type: '', fan: 0, fanTags: [] };

  // ---------------- 0. 红中麻将（112张 · 红中万能癞子 · 四红中秒胡 · 仅自摸/抢杠胡 · 扎4码） ----------------
  if (variant.wildCard) {
    if (variant.zimoOnly && !isSelfDraw && !isRobKong) {
      return { ok: false, type: '红中麻将仅支持自摸或抢杠胡', fan: 0, fanTags: [] };
    }
    const wildCount = hand.filter((t) => isWildTile(t, variant)).length;
    const normalHand = hand.filter((t) => !isWildTile(t, variant));
    const nonWildAll = [...normalHand, ...melds.flatMap((m) => m.tiles)].filter((t) => !isWildTile(t, variant));
    const numericSuits = new Set(nonWildAll.filter((t) => isNumericSuit(t.suit)).map((t) => t.suit));
    const isPureSuit = numericSuits.size <= 1;

    // 1) 四红中秒胡（集齐 4 张红中直接胡牌！）
    if (wildCount >= 4) {
      const tags = ['四红中'];
      let fan = 4;
      if (isFirstTurnDealer && isSelfDraw) {
        fan += 2;
        tags.push('天胡');
      }
      if (afterKong) {
        fan += 2;
        tags.push('杠上开花');
      }
      return { ok: true, type: tags.join('·'), fan, fanTags: tags };
    }

    const sevenWild = melds.length === 0 ? checkWildSevenPairs(normalHand, wildCount) : { ok: false, deluxe: false };
    const standardOk = canFormStandardWithWilds(normalHand, wildCount);
    if (!sevenWild.ok && !standardOk) {
      return { ok: false, type: '', fan: 0, fanTags: [] };
    }

    const tags: string[] = [];
    let fan = 1;
    if (sevenWild.ok) {
      if (sevenWild.deluxe) {
        tags.push('豪华七小对');
        fan = 4;
      } else {
        tags.push('七小对');
        fan = 2;
      }
    } else if (
      standardOk &&
      melds.every((m) => m.type !== 'chow') &&
      canFormAllTripletsWithWilds(normalHand, wildCount)
    ) {
      tags.push('碰碰胡');
      fan = 2;
    } else {
      tags.push('平胡');
    }

    if (isPureSuit && nonWildAll.length > 0) {
      fan += 3;
      tags.push('清一色');
    }
    if (wildCount === 0) {
      fan += 2;
      tags.push('无红中硬胡');
    }
    if (isRobKong) {
      fan += 2;
      tags.push('抢杠胡');
    }
    if (afterKong) {
      fan += 2;
      tags.push('杠上开花');
    }
    if (isFirstTurnDealer && isSelfDraw) {
      fan += 3;
      tags.push('天胡');
    }
    return { ok: true, type: tags.join('·'), fan, fanTags: tags };
  }

  const allTiles: MahjongTileData[] = [...hand, ...melds.flatMap((m) => m.tiles)];

  // 四川血战强约束：胡牌时手牌及副露绝不能含定缺花色
  if (variant.hasDingque && dingqueSuit) {
    if (allTiles.some((t) => t.suit === dingqueSuit)) {
      return { ok: false, type: '', fan: 0, fanTags: [] };
    }
  }

  const numericSuitsUsed = new Set(allTiles.filter((t) => isNumericSuit(t.suit)).map((t) => t.suit));
  const hasHonors = allTiles.some((t) => !isNumericSuit(t.suit));
  const isPureOneSuit = !hasHonors && numericSuitsUsed.size === 1;
  const isHalfOneSuit = hasHonors && numericSuitsUsed.size === 1;
  const isAllHonors = hasHonors && numericSuitsUsed.size === 0;
  const all258 = allTiles.every((t) => isNumericSuit(t.suit) && (t.val === 2 || t.val === 5 || t.val === 8));
  const exposedMelds = melds.filter((m) => !m.concealed);
  const isMenqing = exposedMelds.length === 0;

  // 1) 十三幺（广东/国标）
  if (variant.includeHonors && melds.length === 0 && isThirteenOrphans(hand)) {
    const fan = variant.guobiaoScoring ? 88 : 13;
    return { ok: true, type: '十三幺', fan, fanTags: [`十三幺(${fan}番)`] };
  }

  // 2) 长沙将将胡（全部 2/5/8 即可直接胡，不要求顺刻成面）
  if (variant.meta.gameId === 'cs-mahjong' && all258) {
    const tags = ['将将胡(3番)'];
    let fan = 3;
    if (afterKong) {
      fan += 2;
      tags.push('杠上开花(+2番)');
    }
    return { ok: true, type: '将将胡', fan, fanTags: tags };
  }

  // 3) 七小对 / 豪华七对 / 龙七对
  const seven = melds.length === 0 ? checkSevenPairs(hand) : { ok: false, quadCount: 0 };
  const decompAny = findStandardDecomp(hand, false);
  const decomp258 = variant.is258Strict ? findStandardDecomp(hand, true) : decompAny;

  if (!seven.ok && !decompAny) {
    return { ok: false, type: '', fan: 0, fanTags: [] };
  }

  // 汇总全部面子（手牌拆解 + 副露）
  const allSets: DecomposedSet[] = decompAny
    ? [
        ...decompAny.sets,
        ...melds.map((m): DecomposedSet => ({
          kind: m.type === 'chow' ? 'sequence' : 'triplet',
          suit: m.tiles[0]!.suit,
          val: Math.min(...m.tiles.map((t) => t.val)),
        })),
      ]
    : [];

  const isAllTriplets = decompAny !== null && allSets.every((s) => s.kind === 'triplet');
  const isAllSequences = decompAny !== null && allSets.every((s) => s.kind === 'sequence');
  const isQuanQiuRen = hand.length === 2 && !isSelfDraw && exposedMelds.length === 4;
  const isJinGouDiao = hand.length === 2 && melds.length === 4;

  // 统计三元与四喜刻子
  const dragonTriplets = allSets.filter((s) => s.kind === 'triplet' && s.suit === 'dragon').length;
  const windTriplets = allSets.filter((s) => s.kind === 'triplet' && s.suit === 'wind').length;
  const pairIsDragon = decompAny?.pair.suit === 'dragon';
  const pairIsWind = decompAny?.pair.suit === 'wind';

  // ---------------- A. 大众国标麻将（正宗多番种叠加 + 8番起胡） ----------------
  if (variant.guobiaoScoring) {
    const tags: string[] = [];
    let total = 0;
    const add = (label: string, f: number) => {
      total += f;
      tags.push(`${label}${f}番`);
    };

    if (windTriplets === 4) add('大四喜', 88);
    else if (dragonTriplets === 3) add('大三元', 88);
    else if (isAllHonors) add('字一色', 64);
    else if (windTriplets === 3 && pairIsWind) add('小四喜', 64);
    else if (dragonTriplets === 2 && pairIsDragon) add('小三元', 64);

    if (seven.ok) {
      add('七对', 24);
      if (seven.quadCount > 0) add('四归一', 2 * seven.quadCount);
    }

    if (isPureOneSuit) {
      add('清一色', 24);
    } else if (isHalfOneSuit) {
      add('混一色', 6);
    }

    if (decompAny) {
      // 清龙（同花色 123+456+789）
      for (const s of NUMERIC_SUITS) {
        const seqVals = new Set(allSets.filter((x) => x.kind === 'sequence' && x.suit === s).map((x) => x.val));
        if (seqVals.has(1) && seqVals.has(4) && seqVals.has(7)) {
          add('清龙', 16);
          break;
        }
      }

      if (isAllTriplets && total < 64) add('碰碰和', 6);

      // 暗刻数
      const concealedTriplets =
        decompAny.sets.filter((s) => s.kind === 'triplet').length +
        melds.filter((m) => m.type === 'kong' && m.concealed).length;
      if (concealedTriplets >= 4) add('四暗刻', 64);
      else if (concealedTriplets === 3) add('三暗刻', 16);
      else if (concealedTriplets === 2) add('双暗刻', 2);

      // 箭刻 & 门风刻
      if (dragonTriplets > 0 && dragonTriplets < 3) {
        add('箭刻', 2 * dragonTriplets);
      }
      if (allSets.some((s) => s.kind === 'triplet' && s.suit === 'wind' && s.val === seatWindVal)) {
        add('门风刻', 2);
      }

      // 全带幺
      const allCarryTerminal =
        isTerminalOrHonor(decompAny.pair) &&
        allSets.every((s) =>
          s.kind === 'triplet'
            ? isTerminalOrHonor({ suit: s.suit, val: s.val })
            : s.val === 1 || s.val === 7,
        );
      if (allCarryTerminal) add('全带幺', 4);

      // 平和（全顺子 + 序数牌将）
      if (isAllSequences && isNumericSuit(decompAny.pair.suit)) add('平和', 2);

      // 一般高（两副相同顺子）
      const seqCounts = new Map<string, number>();
      for (const s of allSets) {
        if (s.kind === 'sequence') {
          const k = `${s.suit}_${s.val}`;
          seqCounts.set(k, (seqCounts.get(k) ?? 0) + 1);
        }
      }
      if ([...seqCounts.values()].some((c) => c >= 2)) add('一般高', 1);
    }

    // 五门齐（万筒条风箭俱全）
    const categories = new Set(allTiles.map((t) => t.suit));
    if (categories.size === 5) add('五门齐', 6);

    // 断幺（无1/9/字牌）
    if (allTiles.every((t) => !isTerminalOrHonor(t))) add('断幺', 2);

    // 杠类加番
    const kongCount = melds.filter((m) => m.type === 'kong').length;
    const concealedKong = melds.filter((m) => m.type === 'kong' && m.concealed).length;
    if (concealedKong >= 2) add('双暗杠', 6);
    else if (concealedKong === 1) add('暗杠', 2);
    if (kongCount - concealedKong >= 2) add('双明杠', 4);
    else if (kongCount - concealedKong === 1) add('明杠', 1);

    // 门清 / 不求人 / 全求人
    if (isQuanQiuRen) add('全求人', 6);
    else if (isMenqing && isSelfDraw) add('不求人', 4);
    else if (isMenqing) add('门前清', 2);

    if (afterKong) add('杠上开花', 8);
    if (isLastWallTile) add('海底捞月', 8);
    if (!hasHonors && !isPureOneSuit) add('无字', 1);
    if (!isPureOneSuit && numericSuitsUsed.size <= 2) add('缺一门', 1);
    if (isSelfDraw && !tags.some((t) => t.startsWith('不求人'))) add('自摸', 1);

    if (total < variant.minHuFan) {
      return { ok: false, type: `不足${variant.minHuFan}番(当前${total}番)`, fan: total, fanTags: tags };
    }
    return {
      ok: true,
      type: `${tags.slice(0, 3).join('·')}（共${total}番）`,
      fan: total,
      fanTags: tags,
    };
  }

  // ---------------- B. 四川血战到底（成都番型 + 根加番） ----------------
  if (variant.meta.gameId === 'sc-mahjong') {
    const tags: string[] = [];
    let fan = 1; // 基础平胡 1 番
    let mainName = '平胡';

    if (seven.ok) {
      if (isPureOneSuit && seven.quadCount > 0) {
        mainName = '清龙七对';
        fan = 5;
      } else if (isPureOneSuit) {
        mainName = '清七对';
        fan = 4;
      } else if (seven.quadCount > 0) {
        mainName = '龙七对';
        fan = 3;
      } else {
        mainName = '暗七对';
        fan = 2;
      }
      tags.push(mainName);
    } else if (decompAny) {
      const allCarry19 =
        isTerminalOrHonor(decompAny.pair) &&
        allSets.every((s) =>
          s.kind === 'triplet'
            ? isTerminalOrHonor({ suit: s.suit, val: s.val })
            : s.val === 1 || s.val === 7,
        );
      if (isPureOneSuit && isAllTriplets) {
        mainName = '清对';
        fan = 4;
      } else if (isPureOneSuit) {
        mainName = '清一色';
        fan = 3;
      } else if (allCarry19) {
        mainName = '带幺九';
        fan = 3;
      } else if (isAllTriplets) {
        mainName = '对对胡';
        fan = 2;
      }
      tags.push(mainName);
      if (isJinGouDiao) {
        fan += 1;
        tags.push('金钩钓');
      }
    }

    const roots = countRoots(hand, melds);
    const extraRoots = seven.ok ? Math.max(0, roots - seven.quadCount) : roots;
    if (extraRoots > 0) {
      fan += extraRoots;
      tags.push(`${extraRoots}根`);
    }
    if (isFirstTurnDealer && isSelfDraw) {
      fan += 3;
      tags.push('天胡');
    }
    if (afterKong) {
      fan += 1;
      tags.push('杠上开花');
    }
    if (isSelfDraw) {
      fan += 1;
      tags.push('自摸');
    }

    return { ok: true, type: `${tags.join('·')}（${fan}番）`, fan, fanTags: tags };
  }

  // ---------------- C. 广东推倒胡（136张含字牌 + 经典岭南大胡） ----------------
  if (variant.meta.gameId === 'gd-mahjong') {
    const tags: string[] = [];
    let fan = 1;
    let mainName = '鸡胡';

    if (windTriplets === 4) {
      mainName = '大四喜';
      fan = 8;
    } else if (dragonTriplets === 3) {
      mainName = '大三元';
      fan = 8;
    } else if (isAllHonors) {
      mainName = '字一色';
      fan = 6;
    } else if (windTriplets === 3 && pairIsWind) {
      mainName = '小四喜';
      fan = 6;
    } else if (dragonTriplets === 2 && pairIsDragon) {
      mainName = '小三元';
      fan = 5;
    } else if (seven.ok) {
      mainName = seven.quadCount > 0 ? '豪华七对' : '七对子';
      fan = seven.quadCount > 0 ? 4 : 3;
    } else if (isPureOneSuit && isAllTriplets) {
      mainName = '清碰';
      fan = 5;
    } else if (isPureOneSuit) {
      mainName = '清一色';
      fan = 4;
    } else if (isHalfOneSuit && isAllTriplets) {
      mainName = '混碰';
      fan = 3;
    } else if (isHalfOneSuit) {
      mainName = '混一色';
      fan = 2;
    } else if (isAllTriplets) {
      mainName = '碰碰胡';
      fan = 2;
    }
    tags.push(mainName);

    if (isFirstTurnDealer && isSelfDraw) {
      fan += 3;
      tags.push('天胡');
    }
    if (afterKong) {
      fan += 2;
      tags.push('杠上开花');
    }
    return { ok: true, type: tags.join('·'), fan, fanTags: tags };
  }

  // ---------------- D. 长沙麻将（大胡乱将，小胡严格 258 硬将） ----------------
  const tags: string[] = [];
  let isBigHu = false;
  let fan = 1;

  if (seven.ok) {
    isBigHu = true;
    fan = seven.quadCount > 0 ? (isPureOneSuit ? 6 : 4) : isPureOneSuit ? 4 : 2;
    tags.push(seven.quadCount > 0 ? '豪华七小对' : '七小对');
    if (isPureOneSuit) tags.push('清一色');
  } else {
    if (isPureOneSuit) {
      isBigHu = true;
      fan += 2;
      tags.push('清一色');
    }
    if (isAllTriplets) {
      isBigHu = true;
      fan += 2;
      tags.push('碰碰胡');
    }
    if (isQuanQiuRen) {
      isBigHu = true;
      fan += 2;
      tags.push('全求人');
    }
  }

  if (isFirstTurnDealer && isSelfDraw) {
    isBigHu = true;
    fan += 3;
    tags.push('天胡');
  }
  if (afterKong) {
    isBigHu = true;
    fan += 2;
    tags.push('杠上开花');
  }
  if (isLastWallTile) {
    isBigHu = true;
    fan += 2;
    tags.push('海底捞月');
  }

  // 普通小胡必须满足 258 硬将
  if (!isBigHu) {
    if (!decomp258) return { ok: false, type: '', fan: 0, fanTags: [] };
    tags.push('258平胡');
  }

  return { ok: true, type: tags.join('·'), fan, fanTags: tags };
}

/** 长沙麻将起手胡检测（四喜 / 板板胡 / 缺一色 / 六六顺） */
function detectChangshaStartBonuses(hand: MahjongTileData[]): string[] {
  const bonuses: string[] = [];
  const counts = new Map<string, number>();
  const suits = new Set<MahjongSuit>();
  let has258 = false;

  for (const t of hand) {
    counts.set(tileKey(t), (counts.get(tileKey(t)) ?? 0) + 1);
    suits.add(t.suit);
    if (t.val === 2 || t.val === 5 || t.val === 8) has258 = true;
  }

  let triplets = 0;
  let hasQuad = false;
  for (const c of counts.values()) {
    if (c >= 4) hasQuad = true;
    if (c >= 3) triplets += 1;
  }

  if (hasQuad) bonuses.push('大四喜');
  if (!has258) bonuses.push('板板胡');
  if (suits.size < 3) bonuses.push('缺一色');
  if (triplets >= 2) bonuses.push('六六顺');
  return bonuses;
}

/** 计算给定 13/10/7/4/1 张手牌的所有可听胡牌与最高番数（供四川查大叫 & AI 评估） */
function findTenpaiMaxFan(params: {
  hand: MahjongTileData[];
  melds: Meld[];
  variant: MahjongVariantConfig;
  dingqueSuit?: NumericSuit;
  seatWindVal: number;
}): number {
  const candidates: Array<{ suit: MahjongSuit; val: number }> = [];
  for (const suit of NUMERIC_SUITS) {
    if (params.variant.hasDingque && params.dingqueSuit === suit) continue;
    for (let val = 1; val <= 9; val++) candidates.push({ suit, val });
  }
  if (params.variant.includeHonors) {
    for (let val = 1; val <= 4; val++) candidates.push({ suit: 'wind', val });
    for (let val = 1; val <= 3; val++) candidates.push({ suit: 'dragon', val });
  }

  let maxFan = 0;
  for (const cand of candidates) {
    const testHand = [...params.hand, { id: 'test', suit: cand.suit, val: cand.val }];
    const res = evaluateHu({
      hand: testHand,
      melds: params.melds,
      variant: params.variant,
      dingqueSuit: params.dingqueSuit,
      isSelfDraw: false,
      afterKong: false,
      isLastWallTile: false,
      isFirstTurnDealer: false,
      seatWindVal: params.seatWindVal,
    });
    if (res.ok && res.fan > maxFan) maxFan = res.fan;
  }
  return maxFan;
}

/** 计算上家出牌对应的所有合法吃牌组合 */
function computeChowOptions(hand: MahjongTileData[], target: MahjongTileData): ChowOption[] {
  if (!isNumericSuit(target.suit)) return [];
  const options: ChowOption[] = [];
  const patterns: Array<[number, number]> = [
    [target.val - 2, target.val - 1],
    [target.val - 1, target.val + 1],
    [target.val + 1, target.val + 2],
  ];
  for (const [v1, v2] of patterns) {
    if (v1 < 1 || v2 > 9) continue;
    const t1 = hand.find((t) => t.suit === target.suit && t.val === v1);
    const t2 = hand.find((t) => t.suit === target.suit && t.val === v2);
    if (t1 && t2) {
      const seq = [t1, t2, target].sort((a, b) => a.val - b.val);
      options.push({ tileIds: [t1.id, t2.id], tiles: seq });
    }
  }
  return options;
}

/** 选出张数最少的花色作为自动定缺建议 */
function recommendDingqueSuit(hand: MahjongTileData[]): NumericSuit {
  const counts: Record<NumericSuit, number> = { wan: 0, bamboo: 0, dot: 0 };
  for (const t of hand) {
    if (isNumericSuit(t.suit)) counts[t.suit] += 1;
  }
  let best: NumericSuit = 'wan';
  for (const s of NUMERIC_SUITS) {
    if (counts[s] < counts[best]) best = s;
  }
  return best;
}

function handIsFourteen(len: number): boolean {
  return len === 14 || len === 11 || len === 8 || len === 5 || len === 2;
}

class VariantMahjongPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta;
  override readonly commands = ['dingque', 'discard', 'chow', 'pong', 'kong', 'hu', 'pass'] as const;

  private readonly variant: MahjongVariantConfig;
  private state: State = emptyState();

  constructor(variant: MahjongVariantConfig) {
    super();
    this.variant = variant;
    this.meta = variant.meta;
  }

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  private seatWindOf(ctx: RoomContext, playerId: string): number {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const dIdx = Math.max(0, players.findIndex((p) => p.playerId === this.state.dealerId));
    const pIdx = Math.max(0, players.findIndex((p) => p.playerId === playerId));
    return ((pIdx - dIdx + 4) % 4) + 1;
  }

  private recordAction(
    ctx: RoomContext,
    type: MahjongActionEvent['type'],
    playerId: string,
    extra?: { tile?: MahjongTileData; huType?: string; detail?: string },
  ): void {
    const nick = ctx.players.find((p) => p.playerId === playerId)?.nickname ?? '牌手';
    this.state.actionSeq += 1;
    this.state.lastAction = {
      seq: this.state.actionSeq,
      type,
      playerId,
      nickname: nick,
      ...(extra?.tile ? { tile: extra.tile } : {}),
      ...(extra?.huType ? { huType: extra.huType } : {}),
      ...(extra?.detail ? { detail: extra.detail } : {}),
    };
  }

  override onRoundStart(ctx: RoomContext): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    // 雀神麻将所有玩法严格要求 4 人满座开局
    if (players.length < 4) return;

    this.state = emptyState();
    const deck = shuffleWithSeed(
      buildMahjongDeck(this.variant.includeHonors, Boolean(this.variant.includeRedDragonOnly)),
      ctx.config.seed,
    );

    let cursor = 0;
    for (const player of players) {
      const hand: MahjongTileData[] = [];
      for (let i = 0; i < 13; i++) {
        hand.push(deck[cursor++]!);
      }
      this.state.hands.set(player.playerId, sortHand(hand, undefined, this.variant.wildCard));
      this.state.melds.set(player.playerId, []);
      this.state.discards.set(player.playerId, []);
      this.state.gangScore.set(player.playerId, 0);
      this.state.runningDelta.set(player.playerId, 0);
      this.state.startBonusLabels.set(player.playerId, []);
    }

    const dealer = players[(ctx.config.round - 1) % players.length] ?? players[0]!;
    const dealerDrawn = deck[cursor++]!;
    const dealerHand = this.state.hands.get(dealer.playerId) ?? [];
    dealerHand.push(dealerDrawn);
    this.state.hands.set(dealer.playerId, sortHand(dealerHand, undefined, this.variant.wildCard));
    this.state.drawnTile.set(dealer.playerId, dealerDrawn);

    this.state.wall = deck.slice(cursor);
    this.state.dealerId = dealer.playerId;
    this.state.turn = dealer.playerId;

    // 长沙麻将起手胡自动检测与喜钱奖励（不影响正常行牌）
    if (this.variant.hasStartBonuses) {
      const bonusAnnouncements: string[] = [];
      for (const p of players) {
        const h = this.state.hands.get(p.playerId) ?? [];
        const bonuses = detectChangshaStartBonuses(h);
        if (bonuses.length > 0) {
          this.state.startBonusLabels.set(p.playerId, bonuses);
          const perOpp = 40 * bonuses.length;
          for (const other of players) {
            if (other.playerId === p.playerId) {
              this.state.runningDelta.set(
                other.playerId,
                (this.state.runningDelta.get(other.playerId) ?? 0) + perOpp * (players.length - 1),
              );
            } else {
              this.state.runningDelta.set(
                other.playerId,
                (this.state.runningDelta.get(other.playerId) ?? 0) - perOpp,
              );
            }
          }
          bonusAnnouncements.push(`${p.nickname}【${bonuses.join('+')}】`);
        }
      }
      if (bonusAnnouncements.length > 0) {
        this.recordAction(ctx, 'start_bonus', dealer.playerId, {
          detail: bonusAnnouncements.join(' · '),
        });
      }
    }

    // 四川血战定缺阶段：AI 瞬间完成定缺，真人玩家手动挑选定缺花色
    if (this.variant.hasDingque) {
      let anyHuman = false;
      for (const p of players) {
        const h = this.state.hands.get(p.playerId) ?? [];
        if (p.isBot) {
          const rec = recommendDingqueSuit(h);
          this.state.dingque.set(p.playerId, rec);
          this.state.hands.set(p.playerId, sortHand(h, rec));
        } else {
          anyHuman = true;
        }
      }
      this.state.phase = anyHuman ? 'dingque' : 'playing';
    } else {
      this.state.phase = 'playing';
    }

    if (!this.state.lastAction) {
      this.recordAction(ctx, 'start', dealer.playerId);
    }
    ctx.markDirty();
  }

  private addGangBonus(ctx: RoomContext, gainerId: string, payerIds: string[], unit: number): void {
    if (!this.variant.gangInstantScore) return;
    let total = 0;
    for (const pid of payerIds) {
      if (pid === gainerId || this.state.huDone.has(pid)) continue;
      this.state.gangScore.set(pid, (this.state.gangScore.get(pid) ?? 0) - unit);
      total += unit;
    }
    this.state.gangScore.set(gainerId, (this.state.gangScore.get(gainerId) ?? 0) + total);
  }

  private isPrevPlayer(ctx: RoomContext, discarderId: string, claimerId: string): boolean {
    const activePlayers = [...ctx.players]
      .sort((a, b) => a.seat - b.seat)
      .filter((p) => !this.state.huDone.has(p.playerId));
    const dIdx = activePlayers.findIndex((p) => p.playerId === discarderId);
    if (dIdx < 0) return false;
    const next = activePlayers[(dIdx + 1) % activePlayers.length];
    return next?.playerId === claimerId;
  }

  private claimPriority(cmd: ClaimChoice['cmd']): number {
    if (cmd === 'hu') return 3;
    if (cmd === 'kong' || cmd === 'pong') return 2;
    return 1;
  }

  private rightsMaxPriority(rights: ClaimRights): number {
    if (rights.canHu) return 3;
    if (rights.canKong || rights.canPong) return 2;
    if (rights.chowOptions.length > 0) return 1;
    return 0;
  }

  private seatDistance(ctx: RoomContext, fromId: string, toId: string): number {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const a = players.findIndex((p) => p.playerId === fromId);
    const b = players.findIndex((p) => p.playerId === toId);
    if (a < 0 || b < 0) return 99;
    return (b - a + players.length) % players.length;
  }

  /** 出牌后扫描全桌是否有玩家可胡/杠/碰/吃；若有则暂停摸牌并开启响应窗口，否则立刻轮到下家摸牌 */
  private openClaimWindowOrAdvance(
    ctx: RoomContext,
    discarderId: string,
    tile: MahjongTileData,
  ): void {
    const eligible = new Map<string, ClaimRights>();
    const tileIsWild = isWildTile(tile, this.variant);

    for (const p of ctx.players) {
      if (p.playerId === discarderId || this.state.huDone.has(p.playerId)) continue;
      const pHand = this.state.hands.get(p.playerId) ?? [];
      const pMelds = this.state.melds.get(p.playerId) ?? [];
      const pDq = this.state.dingque.get(p.playerId);

      let canHu = false;
      if (!this.variant.zimoOnly) {
        canHu = evaluateHu({
          hand: [...pHand, tile],
          melds: pMelds,
          variant: this.variant,
          dingqueSuit: pDq,
          isSelfDraw: false,
          afterKong: false,
          isLastWallTile: this.state.wall.length === 0,
          isFirstTurnDealer: false,
          seatWindVal: this.seatWindOf(ctx, p.playerId),
        }).ok;
      }

      let canPong = false;
      let canKong = false;
      if (!tileIsWild && (!pDq || tile.suit !== pDq)) {
        const matches = pHand.filter((t) => t.suit === tile.suit && t.val === tile.val);
        canPong = matches.length >= 2;
        canKong = matches.length >= 3 && this.state.wall.length > 0;
      }

      let chowOptions: ChowOption[] = [];
      if (
        this.variant.allowChow &&
        !tileIsWild &&
        (!pDq || tile.suit !== pDq) &&
        this.isPrevPlayer(ctx, discarderId, p.playerId)
      ) {
        chowOptions = computeChowOptions(pHand, tile);
      }

      if (canHu || canKong || canPong || chowOptions.length > 0) {
        eligible.set(p.playerId, { canHu, canKong, canPong, chowOptions });
      }
    }

    if (eligible.size === 0) {
      this.state.pendingClaim = null;
      this.advanceToNextDraw(ctx, discarderId);
      return;
    }

    this.state.pendingClaim = {
      discarderId,
      tile,
      eligible,
      passed: new Set(),
      chosen: new Map(),
    };
    this.state.turn = null;
  }

  /** 补杠时检测是否触发其他玩家「抢杠胡」窗口 */
  private openRobKongWindowIfAny(
    ctx: RoomContext,
    kongPlayerId: string,
    tile: MahjongTileData,
  ): boolean {
    const eligible = new Map<string, ClaimRights>();
    for (const p of ctx.players) {
      if (p.playerId === kongPlayerId || this.state.huDone.has(p.playerId)) continue;
      const pHand = this.state.hands.get(p.playerId) ?? [];
      const pMelds = this.state.melds.get(p.playerId) ?? [];
      const pDq = this.state.dingque.get(p.playerId);
      const canHu = evaluateHu({
        hand: [...pHand, tile],
        melds: pMelds,
        variant: this.variant,
        dingqueSuit: pDq,
        isSelfDraw: false,
        isRobKong: true,
        afterKong: false,
        isLastWallTile: this.state.wall.length === 0,
        isFirstTurnDealer: false,
        seatWindVal: this.seatWindOf(ctx, p.playerId),
      }).ok;
      if (canHu) {
        eligible.set(p.playerId, { canHu: true, canKong: false, canPong: false, chowOptions: [] });
      }
    }
    if (eligible.size === 0) return false;
    this.state.pendingClaim = {
      discarderId: kongPlayerId,
      tile,
      isRobKong: true,
      kongPlayerId,
      eligible,
      passed: new Set(),
      chosen: new Map(),
    };
    this.state.turn = null;
    return true;
  }

  /** 补杠无人抢杠后完成补牌动作 */
  private finishUpgradeKongDraw(ctx: RoomContext, playerId: string, upgradedTile: MahjongTileData): void {
    const hand = this.state.hands.get(playerId) ?? [];
    const dq = this.state.dingque.get(playerId);
    const otherIds = ctx.players.map((p) => p.playerId).filter((id) => id !== playerId);
    this.addGangBonus(ctx, playerId, otherIds, Math.round(this.variant.baseWin * 0.5));
    if (this.state.wall.length === 0) {
      this.state.hands.set(playerId, sortHand(hand, dq, this.variant.wildCard));
      this.finishWallExhausted(ctx);
      return;
    }
    const replacement = this.state.wall.pop()!;
    hand.push(replacement);
    this.state.hands.set(playerId, sortHand(hand, dq, this.variant.wildCard));
    this.state.drawnTile.set(playerId, replacement);
    this.state.turn = playerId;
    this.state.afterKong = true;
    this.recordAction(ctx, 'kong', playerId, {
      tile: upgradedTile,
      detail: this.variant.gangInstantScore ? '刮风(补杠)' : '补杠',
    });
  }

  /** 裁决响应窗口：优先级 胡 > 杠/碰 > 吃；高优先级确定后立刻落地执行 */
  private resolvePendingClaim(ctx: RoomContext): void {
    const pending = this.state.pendingClaim;
    if (!pending) return;

    const undecided: Array<[string, ClaimRights]> = [];
    for (const [pid, rights] of pending.eligible.entries()) {
      if (!pending.passed.has(pid) && !pending.chosen.has(pid)) {
        undecided.push([pid, rights]);
      }
    }

    let maxUndecidedPrio = 0;
    for (const [, rights] of undecided) {
      const p = this.rightsMaxPriority(rights);
      if (p > maxUndecidedPrio) maxUndecidedPrio = p;
    }

    let bestPlayerId: string | null = null;
    let bestChoice: ClaimChoice | null = null;
    let bestPrio = 0;
    let bestDist = 999;

    for (const [pid, choice] of pending.chosen.entries()) {
      const prio = this.claimPriority(choice.cmd);
      const dist = this.seatDistance(ctx, pending.discarderId, pid);
      if (prio > bestPrio || (prio === bestPrio && dist < bestDist)) {
        bestPlayerId = pid;
        bestChoice = choice;
        bestPrio = prio;
        bestDist = dist;
      }
    }

    // 已有响应且没有更高优先级玩家尚未表态（若同为胡牌则等所有可胡者表态或全部完成）
    if (bestChoice && bestPlayerId && (bestPrio > maxUndecidedPrio || undecided.length === 0)) {
      this.state.pendingClaim = null;
      this.executeWinningClaim(ctx, bestPlayerId, bestChoice, pending);
      return;
    }

    // 所有人都选择了「过」
    if (undecided.length === 0 && !bestChoice) {
      this.state.pendingClaim = null;
      if (pending.isRobKong && pending.kongPlayerId) {
        this.finishUpgradeKongDraw(ctx, pending.kongPlayerId, pending.tile);
      } else {
        this.advanceToNextDraw(ctx, pending.discarderId);
      }
    }
  }

  private executeWinningClaim(
    ctx: RoomContext,
    playerId: string,
    choice: ClaimChoice,
    pending: PendingClaim,
  ): void {
    const hand = this.state.hands.get(playerId) ?? [];
    const dq = this.state.dingque.get(playerId);
    const target = pending.tile;
    const discarderId = pending.discarderId;

    if (choice.cmd === 'hu') {
      const checkTiles = [...hand, target];
      const evalRes = evaluateHu({
        hand: checkTiles,
        melds: this.state.melds.get(playerId) ?? [],
        variant: this.variant,
        dingqueSuit: dq,
        isSelfDraw: false,
        isRobKong: Boolean(pending.isRobKong),
        afterKong: false,
        isLastWallTile: this.state.wall.length === 0,
        isFirstTurnDealer: false,
        seatWindVal: this.seatWindOf(ctx, playerId),
      });
      if (!evalRes.ok) {
        if (pending.isRobKong && pending.kongPlayerId) {
          this.finishUpgradeKongDraw(ctx, pending.kongPlayerId, target);
        } else {
          this.advanceToNextDraw(ctx, discarderId);
        }
        return;
      }

      if (pending.isRobKong && pending.kongPlayerId) {
        // 抢杠：将被抢的第 4 张牌从杠退回碰
        const kongMelds = this.state.melds.get(pending.kongPlayerId) ?? [];
        for (const m of kongMelds) {
          if (m.type === 'kong' && m.tiles.some((t) => t.id === target.id)) {
            m.type = 'pong';
            m.tiles = m.tiles.filter((t) => t.id !== target.id);
            break;
          }
        }
      } else {
        const discList = this.state.discards.get(discarderId);
        if (discList && discList.length > 0 && discList[discList.length - 1]?.id === target.id) {
          discList.pop();
        }
      }
      this.state.hands.set(playerId, sortHand(checkTiles, dq, this.variant.wildCard));
      this.state.lastDiscard = null;
      this.handleHu(ctx, playerId, discarderId, evalRes, false);
      return;
    }

    if (choice.cmd === 'kong') {
      const matches = hand.filter((t) => t.suit === target.suit && t.val === target.val);
      if (matches.length < 3) {
        this.advanceToNextDraw(ctx, discarderId);
        return;
      }
      const kept = [...hand];
      let removed = 0;
      for (let i = kept.length - 1; i >= 0 && removed < 3; i--) {
        if (kept[i]!.suit === target.suit && kept[i]!.val === target.val) {
          kept.splice(i, 1);
          removed++;
        }
      }
      const discList = this.state.discards.get(discarderId);
      if (discList && discList.length > 0 && discList[discList.length - 1]?.id === target.id) {
        discList.pop();
      }
      const melds = this.state.melds.get(playerId) ?? [];
      melds.push({ type: 'kong', tiles: [target, matches[0]!, matches[1]!, matches[2]!] });
      this.state.melds.set(playerId, melds);
      this.state.lastDiscard = null;
      this.state.turn = playerId;
      this.addGangBonus(ctx, playerId, [discarderId], this.variant.baseWin);

      if (this.state.wall.length === 0) {
        this.state.hands.set(playerId, sortHand(kept, dq, this.variant.wildCard));
        this.finishWallExhausted(ctx);
        return;
      }
      const replacement = this.state.wall.pop()!;
      kept.push(replacement);
      this.state.hands.set(playerId, sortHand(kept, dq, this.variant.wildCard));
      this.state.drawnTile.set(playerId, replacement);
      this.state.afterKong = true;
      this.recordAction(ctx, 'kong', playerId, {
        tile: target,
        detail: this.variant.gangInstantScore ? '刮风(明杠)' : '明杠',
      });
      return;
    }

    if (choice.cmd === 'pong') {
      const matches = hand.filter((t) => t.suit === target.suit && t.val === target.val);
      if (matches.length < 2) {
        this.advanceToNextDraw(ctx, discarderId);
        return;
      }
      const kept = [...hand];
      let removed = 0;
      for (let i = kept.length - 1; i >= 0 && removed < 2; i--) {
        if (kept[i]!.suit === target.suit && kept[i]!.val === target.val) {
          kept.splice(i, 1);
          removed++;
        }
      }
      this.state.hands.set(playerId, sortHand(kept, dq, this.variant.wildCard));
      const discList = this.state.discards.get(discarderId);
      if (discList && discList.length > 0 && discList[discList.length - 1]?.id === target.id) {
        discList.pop();
      }
      const melds = this.state.melds.get(playerId) ?? [];
      melds.push({ type: 'pong', tiles: [target, matches[0]!, matches[1]!] });
      this.state.melds.set(playerId, melds);
      this.state.turn = playerId;
      this.state.lastDiscard = null;
      this.state.drawnTile.set(playerId, null);
      this.state.afterKong = false;
      this.recordAction(ctx, 'pong', playerId, { tile: target });
      return;
    }

    if (choice.cmd === 'chow') {
      const options = computeChowOptions(hand, target);
      if (options.length === 0) {
        this.advanceToNextDraw(ctx, discarderId);
        return;
      }
      const chosen =
        (choice.tileIds
          ? options.find((o) => o.tileIds[0] === choice.tileIds![0] && o.tileIds[1] === choice.tileIds![1])
          : null) ?? options[0]!;
      const removeSet = new Set(chosen.tileIds);
      const kept = hand.filter((t) => !removeSet.has(t.id));
      this.state.hands.set(playerId, sortHand(kept, dq, this.variant.wildCard));
      const discList = this.state.discards.get(discarderId);
      if (discList && discList.length > 0 && discList[discList.length - 1]?.id === target.id) {
        discList.pop();
      }
      const melds = this.state.melds.get(playerId) ?? [];
      melds.push({ type: 'chow', tiles: chosen.tiles });
      this.state.melds.set(playerId, melds);
      this.state.turn = playerId;
      this.state.lastDiscard = null;
      this.state.drawnTile.set(playerId, null);
      this.state.afterKong = false;
      this.recordAction(ctx, 'chow', playerId, { tile: target });
    }
  }

  override async onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): Promise<void> {
    if (this.state.settled) throw new Error('本局已结束');

    if (intent.cmd === 'dingque') {
      if (this.state.phase !== 'dingque') throw new Error('当前不在定缺阶段');
      const suit = String(intent.payload?.suit ?? '') as NumericSuit;
      if (!isNumericSuit(suit)) throw new Error('请选择万、条或筒作为定缺花色');
      this.state.dingque.set(playerId, suit);
      const hand = this.state.hands.get(playerId) ?? [];
      this.state.hands.set(playerId, sortHand(hand, suit, this.variant.wildCard));
      const allDone = ctx.players.every((p) => this.state.dingque.has(p.playerId));
      if (allDone) {
        this.state.phase = 'playing';
        this.recordAction(ctx, 'dingque_done', this.state.dealerId ?? playerId, {
          detail: '四家定缺完成 · 血战开打',
        });
      }
      ctx.markDirty();
      return;
    }

    if (this.state.phase !== 'playing') throw new Error('请先完成定缺');
    if (this.state.huDone.has(playerId)) throw new Error('你已胡牌，静候本局血战结算');

    // ==================== 响应窗口内（有玩家可胡/杠/碰/吃） ====================
    if (this.state.pendingClaim) {
      const pending = this.state.pendingClaim;
      const rights = pending.eligible.get(playerId);
      if (!rights) {
        if (intent.cmd === 'pass') return;
        throw new Error('正在等待其他玩家响应吃/碰/杠/胡');
      }
      if (pending.passed.has(playerId) || pending.chosen.has(playerId)) {
        return;
      }

      if (intent.cmd === 'pass') {
        pending.passed.add(playerId);
        this.resolvePendingClaim(ctx);
        ctx.markDirty();
        return;
      }
      if (intent.cmd === 'hu') {
        if (!rights.canHu) throw new Error('当前手牌无法胡这张牌');
        pending.chosen.set(playerId, { cmd: 'hu' });
        this.resolvePendingClaim(ctx);
        ctx.markDirty();
        return;
      }
      if (intent.cmd === 'kong') {
        if (!rights.canKong) throw new Error('手牌不足三张相同牌，无法明杠');
        pending.chosen.set(playerId, { cmd: 'kong' });
        this.resolvePendingClaim(ctx);
        ctx.markDirty();
        return;
      }
      if (intent.cmd === 'pong') {
        if (!rights.canPong) throw new Error('手牌不足两张相同牌，无法碰牌');
        pending.chosen.set(playerId, { cmd: 'pong' });
        this.resolvePendingClaim(ctx);
        ctx.markDirty();
        return;
      }
      if (intent.cmd === 'chow') {
        if (rights.chowOptions.length === 0) throw new Error('手牌无法组成顺子吃牌');
        const reqIds = Array.isArray(intent.payload?.tileIds)
          ? (intent.payload?.tileIds as [string, string])
          : undefined;
        pending.chosen.set(playerId, { cmd: 'chow', ...(reqIds ? { tileIds: reqIds } : {}) });
        this.resolvePendingClaim(ctx);
        ctx.markDirty();
        return;
      }
      throw new Error('请先选择吃/碰/杠/胡或点「过」');
    }

    const hand = this.state.hands.get(playerId) ?? [];
    const dq = this.state.dingque.get(playerId);

    switch (intent.cmd) {
      case 'discard': {
        if (this.state.turn !== playerId) throw new Error('还没轮到你出牌');
        const tileId = String(intent.payload?.tileId ?? '');
        const index = hand.findIndex((t) => t.id === tileId);
        if (index < 0) throw new Error('手牌中没有该牌');
        const [discarded] = hand.splice(index, 1);
        if (!discarded) throw new Error('出牌失败');

        this.state.hands.set(playerId, sortHand(hand, dq, this.variant.wildCard));
        const playerDiscards = this.state.discards.get(playerId) ?? [];
        playerDiscards.push(discarded);
        this.state.discards.set(playerId, playerDiscards);

        this.state.lastDiscard = { playerId, tile: discarded };
        this.state.drawnTile.set(playerId, null);
        this.state.afterKong = false;
        this.state.turnCount += 1;
        this.recordAction(ctx, 'discard', playerId, { tile: discarded });

        // 先检测是否有人可胡/杠/碰/吃，有则进入响应窗口等待表态，绝不跳过碰牌！
        this.openClaimWindowOrAdvance(ctx, playerId, discarded);
        break;
      }

      case 'kong': {
        if (this.state.turn !== playerId) throw new Error('当前无法杠牌');
        const otherIds = ctx.players.map((p) => p.playerId).filter((id) => id !== playerId);

        // 1) 暗杠（手牌4张同牌；红中麻将4张红中直接胡「四红中」，不走暗杠）
        const grouped = new Map<string, MahjongTileData[]>();
        for (const t of hand) {
          if (dq && t.suit === dq) continue;
          if (isWildTile(t, this.variant)) continue;
          const k = tileKey(t);
          const list = grouped.get(k) ?? [];
          list.push(t);
          grouped.set(k, list);
        }
        const quad = [...grouped.values()].find((list) => list.length === 4);
        if (quad) {
          const quadIds = new Set(quad.map((t) => t.id));
          const kept = hand.filter((t) => !quadIds.has(t.id));
          const melds = this.state.melds.get(playerId) ?? [];
          melds.push({ type: 'kong', concealed: true, tiles: quad });
          this.state.melds.set(playerId, melds);
          this.addGangBonus(ctx, playerId, otherIds, this.variant.baseWin);

          if (this.state.wall.length === 0) {
            this.state.hands.set(playerId, sortHand(kept, dq, this.variant.wildCard));
            this.finishWallExhausted(ctx);
            return;
          }
          const replacement = this.state.wall.pop()!;
          kept.push(replacement);
          this.state.hands.set(playerId, sortHand(kept, dq, this.variant.wildCard));
          this.state.drawnTile.set(playerId, replacement);
          this.state.afterKong = true;
          this.recordAction(ctx, 'kong', playerId, {
            tile: quad[0]!,
            detail: this.variant.gangInstantScore ? '下雨(暗杠)' : '暗杠',
          });
          break;
        }

        // 2) 补杠 / 面下杠（手牌有第4张匹配已碰刻子，并检测别家「抢杠胡」）
        const melds = this.state.melds.get(playerId) ?? [];
        let upgradedTile: MahjongTileData | null = null;
        for (const m of melds) {
          if (m.type !== 'pong') continue;
          const ref = m.tiles[0]!;
          const idx = hand.findIndex((t) => t.suit === ref.suit && t.val === ref.val);
          if (idx >= 0) {
            upgradedTile = hand.splice(idx, 1)[0]!;
            m.type = 'kong';
            m.tiles.push(upgradedTile);
            break;
          }
        }
        if (!upgradedTile) throw new Error('当前没有可暗杠或补杠的牌');

        this.state.hands.set(playerId, sortHand(hand, dq, this.variant.wildCard));
        if (this.openRobKongWindowIfAny(ctx, playerId, upgradedTile)) {
          break;
        }
        this.finishUpgradeKongDraw(ctx, playerId, upgradedTile);
        break;
      }

      case 'hu': {
        const isSelfDraw = this.state.turn === playerId && handIsFourteen(hand.length);
        if (!isSelfDraw) throw new Error('当前没有可胡的牌');
        const evalRes = evaluateHu({
          hand,
          melds: this.state.melds.get(playerId) ?? [],
          variant: this.variant,
          dingqueSuit: dq,
          isSelfDraw: true,
          afterKong: this.state.afterKong,
          isLastWallTile: this.state.wall.length === 0,
          isFirstTurnDealer: this.state.turnCount === 0 && playerId === this.state.dealerId,
          seatWindVal: this.seatWindOf(ctx, playerId),
        });
        if (!evalRes.ok) {
          throw new Error(evalRes.type || '当前手牌未达到胡牌标准');
        }
        this.handleHu(ctx, playerId, null, evalRes, true);
        return;
      }

      case 'pass': {
        break;
      }

      default:
        throw new Error(`未知操作: ${intent.cmd}`);
    }

    ctx.markDirty();
  }

  private advanceToNextDraw(ctx: RoomContext, currentId: string): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const currIndex = players.findIndex((p) => p.playerId === currentId);
    let nextPlayer = players[(currIndex + 1) % players.length]!;
    for (let step = 1; step <= players.length; step++) {
      const cand = players[(currIndex + step) % players.length]!;
      if (!this.state.huDone.has(cand.playerId)) {
        nextPlayer = cand;
        break;
      }
    }

    if (this.state.wall.length === 0) {
      this.finishWallExhausted(ctx);
      return;
    }

    const drawn = this.state.wall.shift()!;
    const nextHand = this.state.hands.get(nextPlayer.playerId) ?? [];
    nextHand.push(drawn);
    this.state.hands.set(
      nextPlayer.playerId,
      sortHand(nextHand, this.state.dingque.get(nextPlayer.playerId), this.variant.wildCard),
    );
    this.state.drawnTile.set(nextPlayer.playerId, drawn);
    this.state.turn = nextPlayer.playerId;
  }

  private handleHu(
    ctx: RoomContext,
    winnerId: string,
    discarderId: string | null,
    evalRes: HuEval,
    isSelfDraw: boolean,
  ): void {
    this.recordAction(ctx, isSelfDraw ? 'zimo' : 'hu', winnerId, { huType: evalRes.type });

    // ---------- 四川血战到底：一家胡后继续至 3 家胡或牌墙摸完 ----------
    if (this.variant.bloodBattle) {
      this.state.huDone.add(winnerId);
      if (!this.state.winners.includes(winnerId)) this.state.winners.push(winnerId);

      const expMult = Math.min(64, Math.pow(2, Math.max(0, evalRes.fan - 1)));
      const unitScore = Math.round(this.variant.baseWin * expMult * this.variant.fanBoost);

      const activePayers = ctx.players
        .map((p) => p.playerId)
        .filter((pid) => pid !== winnerId && !this.state.huDone.has(pid));

      const payers = isSelfDraw
        ? activePayers
        : discarderId && !this.state.huDone.has(discarderId)
          ? [discarderId]
          : activePayers;

      let gained = 0;
      for (const pid of payers) {
        this.state.runningDelta.set(pid, (this.state.runningDelta.get(pid) ?? 0) - unitScore);
        gained += unitScore;
      }
      this.state.runningDelta.set(winnerId, (this.state.runningDelta.get(winnerId) ?? 0) + gained);
      this.state.huTypes.set(winnerId, `${isSelfDraw ? '自摸·' : '点炮·'}${evalRes.type}`);

      // 若已满 3 家胡牌或牌墙耗尽，立即血战总清算
      const remainingActive = ctx.players.filter((p) => !this.state.huDone.has(p.playerId));
      if (remainingActive.length <= 1 || this.state.wall.length === 0) {
        this.finalizeBloodBattle(ctx);
        return;
      }

      // 否则继续下一位未胡玩家摸牌血战
      this.state.afterKong = false;
      this.advanceToNextDraw(ctx, winnerId);
      ctx.markDirty();
      return;
    }

    // ---------- 常规一局一胡玩法（长沙 / 广东 / 国标） ----------
    this.state.settled = true;
    this.state.phase = 'settled';
    this.state.winners = [winnerId];
    this.state.turn = null;

    // 抓鸟 / 买马
    const birds: MahjongTileData[] = [];
    for (let i = 0; i < this.variant.birdCount && this.state.wall.length > 0; i++) {
      birds.push(this.state.wall.pop()!);
    }
    this.state.birds = birds;

    let birdHit = 0;
    for (const b of birds) {
      if (this.variant.birdMode === 'guangdong') {
        if (
          (isNumericSuit(b.suit) && (b.val === 1 || b.val === 5 || b.val === 9)) ||
          (b.suit === 'wind' && b.val === 1) ||
          (b.suit === 'dragon' && b.val === 1)
        ) {
          birdHit += 1;
        }
      } else if (this.variant.birdMode === 'hongzhong') {
        // 红中扎码：1/5/9 或 红中均算中码！
        if (
          (isNumericSuit(b.suit) && (b.val === 1 || b.val === 5 || b.val === 9)) ||
          (b.suit === 'dragon' && b.val === 1)
        ) {
          birdHit += 1;
        }
      } else if (this.variant.birdMode === 'changsha') {
        if (isNumericSuit(b.suit) && (b.val === 1 || b.val === 5 || b.val === 9)) {
          birdHit += 1;
        }
      }
    }

    const deltas = new Map<string, number>();
    for (const p of ctx.players) {
      deltas.set(
        p.playerId,
        (this.state.runningDelta.get(p.playerId) ?? 0) + (this.state.gangScore.get(p.playerId) ?? 0),
      );
    }

    if (this.variant.guobiaoScoring) {
      // 国标计分：8 底分 + 番数（每分 = baseWin 筹码），自摸三家全付，点和放炮包番 + 三家各出底分
      const basePts = 8 * this.variant.baseWin;
      const fanPts = evalRes.fan * this.variant.baseWin;
      if (isSelfDraw) {
        const perLoser = basePts + fanPts;
        for (const p of ctx.players) {
          if (p.playerId === winnerId) deltas.set(p.playerId, (deltas.get(p.playerId) ?? 0) + perLoser * 3);
          else deltas.set(p.playerId, (deltas.get(p.playerId) ?? 0) - perLoser);
        }
      } else {
        for (const p of ctx.players) {
          if (p.playerId === winnerId) {
            deltas.set(p.playerId, (deltas.get(p.playerId) ?? 0) + basePts * 3 + fanPts);
          } else if (p.playerId === discarderId) {
            deltas.set(p.playerId, (deltas.get(p.playerId) ?? 0) - (basePts + fanPts));
          } else {
            deltas.set(p.playerId, (deltas.get(p.playerId) ?? 0) - basePts);
          }
        }
      }
    } else {
      const selfDrawMult = isSelfDraw ? 2 : 1;
      const unitWin = Math.round(
        this.variant.baseWin * evalRes.fan * this.variant.fanBoost * selfDrawMult * (1 + birdHit),
      );
      if (isSelfDraw || !discarderId) {
        const losers = ctx.players.filter((p) => p.playerId !== winnerId);
        for (const p of losers) {
          deltas.set(p.playerId, (deltas.get(p.playerId) ?? 0) - unitWin);
        }
        deltas.set(winnerId, (deltas.get(winnerId) ?? 0) + unitWin * losers.length);
      } else {
        // 点炮：放炮者承担双倍或全包主体，闲家不赔
        const paoLoss = unitWin * 2;
        deltas.set(discarderId, (deltas.get(discarderId) ?? 0) - paoLoss);
        deltas.set(winnerId, (deltas.get(winnerId) ?? 0) + paoLoss);
      }
    }

    const bonusSuffix =
      this.variant.birdCount > 0
        ? ` (${isSelfDraw ? '自摸·' : ''}中${birdHit}${this.variant.bonusLabel})`
        : isSelfDraw
          ? ' (自摸)'
          : '';

    this.state.results = ctx.players.map((p) => {
      const startTags = this.state.startBonusLabels.get(p.playerId) ?? [];
      const extraTag = startTags.length > 0 ? ` [${startTags.join('+')}]` : '';
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        delta: deltas.get(p.playerId) ?? 0,
        huType:
          p.playerId === winnerId
            ? `${evalRes.type}${bonusSuffix}${extraTag}`
            : p.playerId === discarderId
              ? `放炮${extraTag}`
              : `未胡${extraTag}`,
        birds,
      };
    });

    const entries: SettlementEntry[] = ctx.players
      .map((p) => ({
        playerId: p.playerId,
        currency: 'coin' as const,
        delta: deltas.get(p.playerId) ?? 0,
        reason: this.variant.settleReason,
      }))
      .filter((e) => e.delta !== 0);

    ctx.markDirty();
    ctx.settle({ entries, winners: [winnerId] });
  }

  /** 四川血战流局 / 终局总清算（查花猪 + 查大叫 + 退税 + 刮风下雨） */
  private finalizeBloodBattle(ctx: RoomContext): void {
    this.state.settled = true;
    this.state.phase = 'settled';
    this.state.turn = null;

    const remaining = ctx.players.filter((p) => !this.state.huDone.has(p.playerId));
    const huazhuIds = new Set<string>();
    const tenpaiFan = new Map<string, number>();

    // 若墙空流局仍有 >= 2 家未胡，执行查花猪与查大叫
    if (remaining.length >= 2) {
      for (const p of remaining) {
        const h = this.state.hands.get(p.playerId) ?? [];
        const dq = this.state.dingque.get(p.playerId);
        if (dq && h.some((t) => t.suit === dq)) {
          huazhuIds.add(p.playerId);
          // 花猪退还刮风下雨收益
          if ((this.state.gangScore.get(p.playerId) ?? 0) > 0) {
            this.state.gangScore.set(p.playerId, 0);
          }
          this.state.huTypes.set(p.playerId, '花猪(未打缺)');
        } else {
          const maxF = findTenpaiMaxFan({
            hand: h,
            melds: this.state.melds.get(p.playerId) ?? [],
            variant: this.variant,
            dingqueSuit: dq,
            seatWindVal: this.seatWindOf(ctx, p.playerId),
          });
          tenpaiFan.set(p.playerId, maxF);
          this.state.huTypes.set(p.playerId, maxF > 0 ? `有叫(${maxF}番)` : '无叫(查大叫)');
        }
      }

      // 查花猪赔付
      const huazhuPenalty = this.variant.baseWin * 8;
      for (const hzId of huazhuIds) {
        for (const p of ctx.players) {
          if (p.playerId === hzId || huazhuIds.has(p.playerId)) continue;
          this.state.runningDelta.set(hzId, (this.state.runningDelta.get(hzId) ?? 0) - huazhuPenalty);
          this.state.runningDelta.set(p.playerId, (this.state.runningDelta.get(p.playerId) ?? 0) + huazhuPenalty);
        }
      }

      // 查大叫赔付（无叫赔有叫）
      for (const p of remaining) {
        if (huazhuIds.has(p.playerId)) continue;
        const myFan = tenpaiFan.get(p.playerId) ?? 0;
        if (myFan === 0) {
          for (const other of remaining) {
            const otherFan = tenpaiFan.get(other.playerId) ?? 0;
            if (otherFan > 0) {
              const pay = Math.round(this.variant.baseWin * Math.pow(2, Math.min(4, otherFan - 1)));
              this.state.runningDelta.set(p.playerId, (this.state.runningDelta.get(p.playerId) ?? 0) - pay);
              this.state.runningDelta.set(other.playerId, (this.state.runningDelta.get(other.playerId) ?? 0) + pay);
            }
          }
        }
      }
    }

    const finalDeltas = new Map<string, number>();
    for (const p of ctx.players) {
      const total =
        (this.state.runningDelta.get(p.playerId) ?? 0) + (this.state.gangScore.get(p.playerId) ?? 0);
      finalDeltas.set(p.playerId, total);
    }

    this.state.results = ctx.players.map((p) => {
      const gs = this.state.gangScore.get(p.playerId) ?? 0;
      const gangTxt = gs !== 0 ? ` · 刮风下雨${gs > 0 ? `+${gs}` : gs}` : '';
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        delta: finalDeltas.get(p.playerId) ?? 0,
        huType: `${this.state.huTypes.get(p.playerId) ?? '未胡'}${gangTxt}`,
        birds: [],
      };
    });

    const entries: SettlementEntry[] = ctx.players
      .map((p) => ({
        playerId: p.playerId,
        currency: 'coin' as const,
        delta: finalDeltas.get(p.playerId) ?? 0,
        reason: this.variant.settleReason,
      }))
      .filter((e) => e.delta !== 0);

    const winners = ctx.players.filter((p) => (finalDeltas.get(p.playerId) ?? 0) > 0).map((p) => p.playerId);
    this.state.winners = winners;
    ctx.markDirty();
    ctx.settle({ entries, winners });
  }

  private finishWallExhausted(ctx: RoomContext): void {
    this.recordAction(ctx, 'draw_game', ctx.players[0]?.playerId ?? '');
    if (this.variant.bloodBattle) {
      this.finalizeBloodBattle(ctx);
      return;
    }

    this.state.settled = true;
    this.state.phase = 'settled';
    this.state.winners = [];
    this.state.turn = null;
    this.state.results = ctx.players.map((p) => {
      const d = (this.state.runningDelta.get(p.playerId) ?? 0) + (this.state.gangScore.get(p.playerId) ?? 0);
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        delta: d,
        huType: '荒庄 (海底无牌)',
        birds: [],
      };
    });
    const entries: SettlementEntry[] = this.state.results
      .filter((r) => r.delta !== 0)
      .map((r) => ({
        playerId: r.playerId,
        currency: 'coin' as const,
        delta: r.delta,
        reason: this.variant.settleReason,
      }));
    ctx.settle({ entries, winners: [] });
    ctx.markDirty();
  }

  override botIntent(
    ctx: RoomContext,
    playerId: string,
    _difficulty: BotDifficulty = 'high',
  ): GameIntent | null {
    if (this.state.settled || this.state.phase !== 'playing') return null;
    if (this.state.huDone.has(playerId)) return null;

    const hand = this.state.hands.get(playerId) ?? [];
    const melds = this.state.melds.get(playerId) ?? [];
    const dq = this.state.dingque.get(playerId);
    const windVal = this.seatWindOf(ctx, playerId);

    // 1) 处于响应窗口内（必须给出明确表态：胡 / 杠 / 碰 / 吃 / 过，绝不卡死）
    if (this.state.pendingClaim) {
      const pending = this.state.pendingClaim;
      const rights = pending.eligible.get(playerId);
      if (!rights || pending.passed.has(playerId) || pending.chosen.has(playerId)) {
        return null;
      }
      if (rights.canHu) return { cmd: 'hu', payload: {} };
      if (rights.canKong) return { cmd: 'kong', payload: {} };
      if (rights.canPong) {
        // 高智商碰牌决策：箭风牌/258/已有副露或刻子多时积极碰牌，否则留门清或做顺子
        const target = pending.tile;
        const isHonor = !isNumericSuit(target.suit);
        const is258 = isNumericSuit(target.suit) && (target.val === 2 || target.val === 5 || target.val === 8);
        const shouldPong =
          isHonor ||
          melds.length > 0 ||
          this.variant.wildCard !== undefined ||
          (this.variant.is258Strict && is258) ||
          this.state.turnCount >= 8;
        if (shouldPong) return { cmd: 'pong', payload: {} };
      }
      if (rights.chowOptions.length > 0 && melds.length > 0 && this.state.turnCount >= 12) {
        return { cmd: 'chow', payload: { tileIds: rights.chowOptions[0]!.tileIds } };
      }
      return { cmd: 'pass', payload: {} };
    }

    if (this.state.turn === playerId && hand.length > 0) {
      if (
        evaluateHu({
          hand,
          melds,
          variant: this.variant,
          dingqueSuit: dq,
          isSelfDraw: true,
          afterKong: this.state.afterKong,
          isLastWallTile: this.state.wall.length === 0,
          isFirstTurnDealer: this.state.turnCount === 0 && playerId === this.state.dealerId,
          seatWindVal: windVal,
        }).ok
      ) {
        return { cmd: 'hu', payload: {} };
      }

      // 优先打出定缺花色（避免四川流局花猪）
      if (dq) {
        const dqTile = hand.find((t) => t.suit === dq);
        if (dqTile) return { cmd: 'discard', payload: { tileId: dqTile.id } };
      }

      const counts = new Map<string, number>();
      for (const t of hand) counts.set(tileKey(t), (counts.get(tileKey(t)) ?? 0) + 1);

      // 暗杠或补杠机会（绝不暗杠红中癞子！）
      if (this.state.wall.length > 0) {
        for (const [k, c] of counts.entries()) {
          if (this.variant.wildCard && k === `${this.variant.wildCard.suit}_${this.variant.wildCard.val}`) continue;
          if (c === 4 && (!dq || !k.startsWith(`${dq}_`))) {
            return { cmd: 'kong', payload: {} };
          }
        }
        for (const m of melds) {
          if (m.type === 'pong' && (counts.get(tileKey(m.tiles[0]!)) ?? 0) >= 1) {
            return { cmd: 'kong', payload: {} };
          }
        }
      }

      // 高智商舍牌评估：绝不打出红中癞子，优先保留顺子/刻子/双面搭子与听牌最大进张
      const discardCandidates = hand.filter((t) => !isWildTile(t, this.variant));
      const poolToEval = discardCandidates.length > 0 ? discardCandidates : hand;
      let bestTile = poolToEval[poolToEval.length - 1]!;
      let lowestScore = Number.POSITIVE_INFINITY;
      for (const t of poolToEval) {
        const same = counts.get(tileKey(t)) ?? 1;
        const isNum = isNumericSuit(t.suit);
        const left1 = isNum ? counts.get(`${t.suit}_${t.val - 1}`) ?? 0 : 0;
        const right1 = isNum ? counts.get(`${t.suit}_${t.val + 1}`) ?? 0 : 0;
        const left2 = isNum ? counts.get(`${t.suit}_${t.val - 2}`) ?? 0 : 0;
        const right2 = isNum ? counts.get(`${t.suit}_${t.val + 2}`) ?? 0 : 0;
        const centerBonus = isNum && t.val >= 3 && t.val <= 7 ? 0.6 : 0;
        const jiangBonus = this.variant.is258Strict && isNum && (t.val === 2 || t.val === 5 || t.val === 8) ? 0.8 : 0;
        const honorPenalty = !isNum && same === 1 ? -1.4 : 0;
        const score = same * 4.2 + (left1 + right1) * 2.2 + (left2 + right2) * 0.85 + centerBonus + jiangBonus + honorPenalty;
        if (score < lowestScore) {
          lowestScore = score;
          bestTile = t;
        }
      }
      return { cmd: 'discard', payload: { tileId: bestTile.id } };
    }

    return null;
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const myHand = viewerId ? this.state.hands.get(viewerId) ?? [] : [];
    const myMelds = viewerId ? this.state.melds.get(viewerId) ?? [] : [];
    const myDrawn = viewerId ? this.state.drawnTile.get(viewerId) ?? null : null;
    const myDq = viewerId ? this.state.dingque.get(viewerId) : undefined;

    let canHuFlag = false;
    let canPongFlag = false;
    let canKongFlag = false;
    let chowOptions: ChowOption[] = [];
    let claimPendingForMe = false;

    if (viewerId && this.state.phase === 'playing' && !this.state.settled && !this.state.huDone.has(viewerId)) {
      const windVal = this.seatWindOf(ctx, viewerId);
      if (this.state.pendingClaim) {
        const pending = this.state.pendingClaim;
        const myRights = pending.eligible.get(viewerId);
        if (myRights && !pending.passed.has(viewerId) && !pending.chosen.has(viewerId)) {
          canHuFlag = myRights.canHu;
          canKongFlag = myRights.canKong;
          canPongFlag = myRights.canPong;
          chowOptions = myRights.chowOptions;
          claimPendingForMe = canHuFlag || canKongFlag || canPongFlag || chowOptions.length > 0;
        }
      } else if (this.state.turn === viewerId && handIsFourteen(myHand.length)) {
        canHuFlag = evaluateHu({
          hand: myHand,
          melds: myMelds,
          variant: this.variant,
          dingqueSuit: myDq,
          isSelfDraw: true,
          afterKong: this.state.afterKong,
          isLastWallTile: this.state.wall.length === 0,
          isFirstTurnDealer: this.state.turnCount === 0 && viewerId === this.state.dealerId,
          seatWindVal: windVal,
        }).ok;

        if (this.state.wall.length > 0) {
          const counts = new Map<string, number>();
          for (const t of myHand) {
            if (myDq && t.suit === myDq) continue;
            if (isWildTile(t, this.variant)) continue;
            counts.set(tileKey(t), (counts.get(tileKey(t)) ?? 0) + 1);
          }
          const hasConcealedKong = [...counts.values()].some((c) => c === 4);
          const hasUpgradeKong = myMelds.some(
            (m) => m.type === 'pong' && (counts.get(tileKey(m.tiles[0]!)) ?? 0) >= 1,
          );
          canKongFlag = hasConcealedKong || hasUpgradeKong;
        }
      }
    }

    const pendingClaimTile = claimPendingForMe ? this.state.pendingClaim?.tile ?? null : null;
    const pendingClaimFromNickname = claimPendingForMe && this.state.pendingClaim
      ? ctx.players.find((p) => p.playerId === this.state.pendingClaim!.discarderId)?.nickname ?? null
      : null;

    return {
      phase: this.state.phase,
      round: ctx.config.round,
      variantId: this.meta.gameId,
      variantName: this.meta.name,
      bonusLabel: this.variant.bonusLabel,
      baseWin: this.variant.baseWin,
      includeHonors: this.variant.includeHonors,
      wildCard: this.variant.wildCard ?? null,
      zimoOnly: Boolean(this.variant.zimoOnly),
      allowChow: this.variant.allowChow,
      hasDingque: this.variant.hasDingque,
      bloodBattle: this.variant.bloodBattle,
      minHuFan: this.variant.minHuFan,
      is258Strict: this.variant.is258Strict,
      dealerId: this.state.dealerId,
      turn: this.state.turn,
      remainingCount: this.state.wall.length,
      lastDiscard: this.state.lastDiscard,
      claimPending: claimPendingForMe,
      claimTile: pendingClaimTile,
      claimFromNickname: pendingClaimFromNickname,
      claimIsRobKong: Boolean(claimPendingForMe && this.state.pendingClaim?.isRobKong),
      lastAction: this.state.lastAction,
      myHand,
      myDrawn,
      myDingque: myDq ?? null,
      recommendedDingque: this.variant.hasDingque && !myDq ? recommendDingqueSuit(myHand) : null,
      canHu: canHuFlag,
      canPong: canPongFlag,
      canKong: canKongFlag,
      canChow: chowOptions.length > 0,
      chowOptions,
      birds: this.state.birds,
      winners: this.state.winners,
      results: this.state.results,
      players: players.map((p) => {
        const hand = this.state.hands.get(p.playerId) ?? [];
        const melds = this.state.melds.get(p.playerId) ?? [];
        const discards = this.state.discards.get(p.playerId) ?? [];
        return {
          playerId: p.playerId,
          nickname: p.nickname,
          seat: p.seat,
          isBot: p.isBot,
          cardCount: hand.length,
          melds,
          discards,
          dingqueSuit: this.state.dingque.get(p.playerId) ?? null,
          huDone: this.state.huDone.has(p.playerId),
          huType: this.state.huTypes.get(p.playerId) ?? null,
          gangScore: this.state.gangScore.get(p.playerId) ?? 0,
          startBonuses: this.state.startBonusLabels.get(p.playerId) ?? [],
          hand: this.state.settled || p.playerId === viewerId ? hand : [],
        };
      }),
    };
  }

  override getCurrentActor(ctx?: RoomContext): string | null {
    if (this.state.settled || this.state.phase !== 'playing') return null;
    if (this.state.pendingClaim) {
      const pending = this.state.pendingClaim;
      const undecided: string[] = [];
      for (const pid of pending.eligible.keys()) {
        if (!pending.passed.has(pid) && !pending.chosen.has(pid)) {
          undecided.push(pid);
        }
      }
      if (undecided.length === 0) return null;
      // 优先让未表态的机器人立即行动，避免拖延；若只剩真人玩家则返回真人 ID 暂停等待其点击碰/杠/吃/胡/过
      if (ctx) {
        const botFirst = undecided.find((pid) => ctx.players.some((p) => p.playerId === pid && p.isBot));
        if (botFirst) return botFirst;
      }
      return undecided[0] ?? null;
    }
    return this.state.turn;
  }
}

export class CsMahjongPlugin extends VariantMahjongPlugin {
  constructor() {
    super({
      meta: {
        gameId: 'cs-mahjong',
        name: '长沙麻将',
        description: '地道湖南长沙麻将，108张无字牌，起手胡（四喜/板板胡/缺一色/六六顺）、258硬将、吃碰杠与开门抓2鸟翻倍',
        icon: '🀄',
        minPlayers: 4,
        maxPlayers: 4,
        version: '2.0.0',
        clientBundle: '',
        tags: ['麻将', '起手胡', '258将', '抓鸟'],
        category: 'mahjong',
      },
      includeHonors: false,
      allowChow: true,
      is258Strict: true,
      hasStartBonuses: true,
      hasDingque: false,
      bloodBattle: false,
      gangInstantScore: false,
      guobiaoScoring: false,
      minHuFan: 1,
      birdCount: 2,
      birdMode: 'changsha',
      bonusLabel: '鸟',
      baseWin: 100,
      fanBoost: 1,
      settleReason: 'cs-mahjong.hu',
    });
  }
}

export class ScMahjongPlugin extends VariantMahjongPlugin {
  constructor() {
    super({
      meta: {
        gameId: 'sc-mahjong',
        name: '四川血战麻将',
        description: '正宗成都血战到底！108张开局定缺、不可吃牌、刮风下雨即时收豆、一家胡继续战到底、流局查花猪查大叫',
        icon: '🌶️',
        minPlayers: 4,
        maxPlayers: 4,
        version: '2.0.0',
        clientBundle: '',
        tags: ['麻将', '血战到底', '定缺', '刮风下雨'],
        category: 'mahjong',
      },
      includeHonors: false,
      allowChow: false,
      is258Strict: false,
      hasStartBonuses: false,
      hasDingque: true,
      bloodBattle: true,
      gangInstantScore: true,
      guobiaoScoring: false,
      minHuFan: 1,
      birdCount: 0,
      birdMode: 'none',
      bonusLabel: '番',
      baseWin: 100,
      fanBoost: 1.2,
      settleReason: 'sc-mahjong.hu',
    });
  }
}

export class GdMahjongPlugin extends VariantMahjongPlugin {
  constructor() {
    super({
      meta: {
        gameId: 'gd-mahjong',
        name: '广东推倒胡',
        description: '岭南经典136张推倒胡（含东南西北中发白），不可吃牌、明暗补杠即时杠分、十三幺/大三元/清一色，胡牌豪买4匹马',
        icon: '🐎',
        minPlayers: 4,
        maxPlayers: 4,
        version: '2.0.0',
        clientBundle: '',
        tags: ['麻将', '136张', '买4马', '推倒胡'],
        category: 'mahjong',
      },
      includeHonors: true,
      allowChow: false,
      is258Strict: false,
      hasStartBonuses: false,
      hasDingque: false,
      bloodBattle: false,
      gangInstantScore: true,
      guobiaoScoring: false,
      minHuFan: 1,
      birdCount: 4,
      birdMode: 'guangdong',
      bonusLabel: '马',
      baseWin: 100,
      fanBoost: 1,
      settleReason: 'gd-mahjong.hu',
    });
  }
}

export class GuobiaoMahjongPlugin extends VariantMahjongPlugin {
  constructor() {
    super({
      meta: {
        gameId: 'guobiao-mahjong',
        name: '大众国标麻将',
        description: '国家体育总局竞技国标麻将！136张全牌可吃碰杠，经典多番种叠加8番起胡，8底分+总番精准竞技计分',
        icon: '👑',
        minPlayers: 4,
        maxPlayers: 4,
        version: '2.0.0',
        clientBundle: '',
        tags: ['麻将', '136张', '8番起胡', '国标'],
        category: 'mahjong',
      },
      includeHonors: true,
      allowChow: true,
      is258Strict: false,
      hasStartBonuses: false,
      hasDingque: false,
      bloodBattle: false,
      gangInstantScore: false,
      guobiaoScoring: true,
      minHuFan: 8,
      birdCount: 0,
      birdMode: 'none',
      bonusLabel: '番',
      baseWin: 10,
      fanBoost: 1,
      settleReason: 'guobiao-mahjong.hu',
    });
  }
}

export class HzMahjongPlugin extends VariantMahjongPlugin {
  constructor() {
    super({
      meta: {
        gameId: 'hz-mahjong',
        name: '红中麻将',
        description: '超火爆112张红中癞子麻将！红中万能百搭、四红中直接秒胡、禁吃可碰杠、仅自摸与抢杠胡、无红中硬胡翻倍，胡牌扎4码1/5/9/红中全中！',
        icon: '🧧',
        minPlayers: 4,
        maxPlayers: 4,
        version: '2.0.0',
        clientBundle: '',
        tags: ['麻将', '红中癞子', '四红中', '扎4码'],
        category: 'mahjong',
      },
      includeHonors: false,
      includeRedDragonOnly: true,
      wildCard: { suit: 'dragon', val: 1 },
      zimoOnly: true,
      allowChow: false,
      is258Strict: false,
      hasStartBonuses: false,
      hasDingque: false,
      bloodBattle: false,
      gangInstantScore: true,
      guobiaoScoring: false,
      minHuFan: 1,
      birdCount: 4,
      birdMode: 'hongzhong',
      bonusLabel: '码',
      baseWin: 100,
      fanBoost: 1.2,
      settleReason: 'hz-mahjong.hu',
    });
  }
}

export default CsMahjongPlugin;
