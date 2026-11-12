import type { BotDifficulty } from '@cc/protocol';
import { canBeat, parseCombo, type Card, type Combo, type ComboRules } from './cards';

export interface CardBotInput {
  hand: readonly Card[];
  prevCombo: Combo | null;
  lastPlayerId: string | null;
  myId: string;
  rules: ComboRules;
  difficulty: BotDifficulty;
  /** 本局已知已出掉的牌，用于高难度记牌 */
  playedCards?: readonly Card[];
  /** 各家剩余张数 */
  handCounts?: ReadonlyArray<{ playerId: string; count: number; isLandlord?: boolean }>;
  /** 斗地主地主ID，用于识别盟友与对手 */
  landlordId?: string | null;
}

interface DecomposedGroup {
  combo: Combo;
  /** 是否属于控牌大牌权 */
  isControl: boolean;
}

function groupByRank(cards: readonly Card[]): Map<number, Card[]> {
  const map = new Map<number, Card[]>();
  for (const c of cards) {
    const arr = map.get(c.rank) ?? [];
    arr.push(c);
    map.set(c.rank, arr);
  }
  return map;
}

function cloneMap(src: Map<number, Card[]>): Map<number, Card[]> {
  const out = new Map<number, Card[]>();
  for (const [k, v] of src) out.set(k, [...v]);
  return out;
}

function removeCardsFromMap(map: Map<number, Card[]>, chosen: readonly Card[]): void {
  for (const card of [...chosen]) {
    const arr = map.get(card.rank);
    if (!arr) continue;
    const i = arr.findIndex((c) => c.id === card.id);
    if (i >= 0) arr.splice(i, 1);
    if (arr.length === 0) map.delete(card.rank);
  }
}

/** 提取连续最长或最短合法顺子 */
function extractStraights(map: Map<number, Card[]>, minLen: number): Card[][] {
  const found: Card[][] = [];
  while (true) {
    const ranks = [...map.keys()].filter((r) => r >= 3 && r <= 14 && (map.get(r)?.length ?? 0) >= 1).sort((a, b) => a - b);
    let bestRun: number[] = [];
    let curRun: number[] = [];
    for (const r of ranks) {
      if (curRun.length === 0 || r === curRun[curRun.length - 1]! + 1) {
        curRun.push(r);
      } else {
        if (curRun.length >= minLen && curRun.length > bestRun.length) bestRun = curRun;
        curRun = [r];
      }
    }
    if (curRun.length >= minLen && curRun.length > bestRun.length) bestRun = curRun;
    if (bestRun.length < minLen) break;

    const chosen: Card[] = [];
    for (const r of bestRun) {
      const c = map.get(r)?.[0];
      if (c) chosen.push(c);
    }
    if (chosen.length >= minLen) {
      found.push(chosen);
      removeCardsFromMap(map, chosen);
    } else {
      break;
    }
  }
  return found;
}

/** 提取连对 */
function extractDoubleStraights(map: Map<number, Card[]>, minPairs: number): Card[][] {
  const found: Card[][] = [];
  while (true) {
    const ranks = [...map.keys()].filter((r) => r >= 3 && r <= 14 && (map.get(r)?.length ?? 0) >= 2).sort((a, b) => a - b);
    let bestRun: number[] = [];
    let curRun: number[] = [];
    for (const r of ranks) {
      if (curRun.length === 0 || r === curRun[curRun.length - 1]! + 1) {
        curRun.push(r);
      } else {
        if (curRun.length >= minPairs && curRun.length > bestRun.length) bestRun = curRun;
        curRun = [r];
      }
    }
    if (curRun.length >= minPairs && curRun.length > bestRun.length) bestRun = curRun;
    if (bestRun.length < minPairs) break;

    const chosen: Card[] = [];
    for (const r of bestRun) {
      const arr = map.get(r);
      if (arr && arr.length >= 2) chosen.push(arr[0]!, arr[1]!);
    }
    if (chosen.length >= minPairs * 2) {
      found.push(chosen);
      removeCardsFromMap(map, chosen);
    } else {
      break;
    }
  }
  return found;
}

/**
 * 手牌最优拆解：尝试多种提取顺序，选出最小手数且控制力最合理的方案
 */
function decomposeHand(hand: readonly Card[], rules: ComboRules): DecomposedGroup[] {
  const runPlan = (order: 'bomb_first' | 'straight_first'): DecomposedGroup[] => {
    const map = cloneMap(groupByRank(hand));
    const groups: DecomposedGroup[] = [];

    const takeBombs = () => {
      if (rules.allowRocket && map.has(16) && map.has(17)) {
        const cards = [map.get(16)![0]!, map.get(17)![0]!];
        const combo = parseCombo(cards, rules);
        if (combo) {
          groups.push({ combo, isControl: true });
          removeCardsFromMap(map, cards);
        }
      }
      for (const r of [...map.keys()].sort((a, b) => a - b)) {
        const arr = map.get(r);
        if (arr && arr.length === 4) {
          const cards = [...arr];
          const combo = parseCombo(cards, rules);
          if (combo) {
            groups.push({ combo, isControl: true });
            removeCardsFromMap(map, cards);
          }
        }
      }
    };

    const takeChains = () => {
      // 飞机
      if (rules.allowPlane) {
        while (true) {
          const tripleRanks = [...map.keys()].filter((r) => r < 15 && (map.get(r)?.length ?? 0) >= 3).sort((a, b) => a - b);
          let bestRun: number[] = [];
          let cur: number[] = [];
          for (const r of tripleRanks) {
            if (cur.length === 0 || r === cur[cur.length - 1]! + 1) cur.push(r);
            else {
              if (cur.length >= 2 && cur.length > bestRun.length) bestRun = cur;
              cur = [r];
            }
          }
          if (cur.length >= 2 && cur.length > bestRun.length) bestRun = cur;
          if (bestRun.length < 2) break;
          const base: Card[] = [];
          for (const r of bestRun) {
            const arr = map.get(r)!;
            base.push(arr[0]!, arr[1]!, arr[2]!);
          }
          removeCardsFromMap(map, base);
          // 尝试寻找小单翼配齐飞机
          const singles = [...map.keys()].filter((r) => (map.get(r)?.length ?? 0) === 1 && r < 15).sort((a, b) => a - b);
          if (singles.length >= bestRun.length) {
            for (let i = 0; i < bestRun.length; i++) {
              const c = map.get(singles[i]!)![0]!;
              base.push(c);
              removeCardsFromMap(map, [c]);
            }
          }
          const combo = parseCombo(base, rules);
          if (combo) groups.push({ combo, isControl: bestRun[bestRun.length - 1]! >= 12 });
        }
      }

      // 连对
      for (const cards of extractDoubleStraights(map, rules.minDoubleStraight)) {
        const combo = parseCombo(cards, rules);
        if (combo) groups.push({ combo, isControl: combo.main >= 13 });
      }
      // 顺子
      for (const cards of extractStraights(map, rules.minStraight)) {
        const combo = parseCombo(cards, rules);
        if (combo) groups.push({ combo, isControl: combo.main >= 13 });
      }
    };

    if (order === 'bomb_first') {
      takeBombs();
      takeChains();
    } else {
      takeChains();
      takeBombs();
    }

    // 三张（待配单/对）
    const tripleCards: Card[][] = [];
    for (const r of [...map.keys()].sort((a, b) => a - b)) {
      const arr = map.get(r);
      if (arr && arr.length === 3) {
        tripleCards.push([...arr]);
        removeCardsFromMap(map, arr);
      }
    }

    // 剩余孤单与对子
    const singleRanks = [...map.keys()].filter((r) => (map.get(r)?.length ?? 0) === 1).sort((a, b) => a - b);
    const pairRanks = [...map.keys()].filter((r) => (map.get(r)?.length ?? 0) === 2).sort((a, b) => a - b);

    // 三带一或三带二优先吸收最弱散牌（不拆 2 和王）
    for (const tri of tripleCards) {
      const chosen = [...tri];
      if (rules.allowTripleWith) {
        const weakSingle = singleRanks.find((r) => r <= 14);
        if (weakSingle !== undefined) {
          const c = map.get(weakSingle)![0]!;
          chosen.push(c);
          removeCardsFromMap(map, [c]);
          singleRanks.splice(singleRanks.indexOf(weakSingle), 1);
        } else {
          const weakPair = pairRanks.find((r) => r <= 12);
          if (weakPair !== undefined) {
            const p = map.get(weakPair)!;
            chosen.push(p[0]!, p[1]!);
            removeCardsFromMap(map, p);
            pairRanks.splice(pairRanks.indexOf(weakPair), 1);
          }
        }
      }
      const combo = parseCombo(chosen, rules);
      if (combo) groups.push({ combo, isControl: combo.main >= 14 });
    }

    // 剩余对子与单张
    for (const r of [...map.keys()].sort((a, b) => a - b)) {
      const arr = map.get(r);
      if (!arr || arr.length === 0) continue;
      const combo = parseCombo([...arr], rules);
      if (combo) {
        const isCtrl = combo.kind === 'single' ? combo.main >= 15 : combo.kind === 'pair' ? combo.main >= 14 : false;
        groups.push({ combo, isControl: isCtrl });
      }
    }

    return groups;
  };

  const planA = runPlan('bomb_first');
  const planB = runPlan('straight_first');

  const scorePlan = (g: DecomposedGroup[]): number => {
    // 越少手越好；孤小单张多惩罚
    let s = -g.length * 100;
    for (const item of g) {
      if (item.combo.kind === 'single' && item.combo.main < 11) s -= 18;
      if (item.combo.kind === 'bomb' || item.combo.kind === 'rocket') s += 45;
      if (item.combo.kind === 'straight' || item.combo.kind === 'double_straight' || item.combo.kind === 'plane') s += 25;
    }
    return s;
  };

  return scorePlan(planA) >= scorePlan(planB) ? planA : planB;
}

/** 构造所有合法的压制组合，按出牌成本从小到大排序（不轻易拆炸弹和长顺） */
function findAllBeatingMoves(hand: readonly Card[], prev: Combo, rules: ComboRules): Array<{ combo: Combo; isBomb: boolean }> {
  const results: Array<{ combo: Combo; isBomb: boolean }> = [];
  const map = groupByRank(hand);
  const ranks = [...map.keys()].sort((a, b) => a - b);

  // 如果 prev 不是火箭，先看能否常规同型压制
  if (prev.kind !== 'rocket' && prev.kind !== 'bomb') {
    if (prev.kind === 'single') {
      for (const r of ranks) {
        if (r <= prev.main) continue;
        const c = map.get(r)![0]!;
        const combo = parseCombo([c], rules);
        if (combo && canBeat(combo, prev)) results.push({ combo, isBomb: false });
      }
    } else if (prev.kind === 'pair') {
      for (const r of ranks) {
        if (r <= prev.main) continue;
        const arr = map.get(r)!;
        if (arr.length < 2) continue;
        const combo = parseCombo(arr.slice(0, 2), rules);
        if (combo && canBeat(combo, prev)) results.push({ combo, isBomb: false });
      }
    } else if (prev.kind === 'triple') {
      for (const r of ranks) {
        if (r <= prev.main) continue;
        const arr = map.get(r)!;
        if (arr.length < 3) continue;
        const combo = parseCombo(arr.slice(0, 3), rules);
        if (combo && canBeat(combo, prev)) results.push({ combo, isBomb: false });
      }
    } else if (prev.kind === 'triple_one' && rules.allowTripleWith) {
      for (const r of ranks) {
        if (r <= prev.main) continue;
        const arr = map.get(r)!;
        if (arr.length < 3) continue;
        // 找一张最小的非自身牌作为带牌
        const kickerRank = ranks.find((kr) => kr !== r && (map.get(kr)?.length ?? 0) < 4);
        if (kickerRank === undefined) continue;
        const combo = parseCombo([...arr.slice(0, 3), map.get(kickerRank)![0]!], rules);
        if (combo && canBeat(combo, prev)) results.push({ combo, isBomb: false });
      }
    } else if (prev.kind === 'triple_two' && rules.allowTripleWith) {
      for (const r of ranks) {
        if (r <= prev.main) continue;
        const arr = map.get(r)!;
        if (arr.length < 3) continue;
        const kickerRank = ranks.find((kr) => kr !== r && (map.get(kr)?.length ?? 0) >= 2 && (map.get(kr)?.length ?? 0) < 4);
        if (kickerRank === undefined) continue;
        const combo = parseCombo([...arr.slice(0, 3), ...map.get(kickerRank)!.slice(0, 2)], rules);
        if (combo && canBeat(combo, prev)) results.push({ combo, isBomb: false });
      }
    } else if (prev.kind === 'straight') {
      const len = prev.size;
      const minHigh = prev.main + 1;
      for (let high = minHigh; high <= 14; high++) {
        const start = high - len + 1;
        if (start < 3) continue;
        const cards: Card[] = [];
        let ok = true;
        for (let r = start; r <= high; r++) {
          const arr = map.get(r);
          if (!arr || arr.length === 0) {
            ok = false;
            break;
          }
          cards.push(arr[0]!);
        }
        if (ok) {
          const combo = parseCombo(cards, rules);
          if (combo && canBeat(combo, prev)) results.push({ combo, isBomb: false });
        }
      }
    } else if (prev.kind === 'double_straight') {
      const pairCount = prev.size / 2;
      const minHigh = prev.main + 1;
      for (let high = minHigh; high <= 14; high++) {
        const start = high - pairCount + 1;
        if (start < 3) continue;
        const cards: Card[] = [];
        let ok = true;
        for (let r = start; r <= high; r++) {
          const arr = map.get(r);
          if (!arr || arr.length < 2) {
            ok = false;
            break;
          }
          cards.push(arr[0]!, arr[1]!);
        }
        if (ok) {
          const combo = parseCombo(cards, rules);
          if (combo && canBeat(combo, prev)) results.push({ combo, isBomb: false });
        }
      }
    }
  }

  // 寻找合法炸弹与火箭
  if (prev.kind !== 'rocket') {
    for (const r of ranks) {
      const arr = map.get(r)!;
      if (arr.length === 4) {
        if (prev.kind === 'bomb' && r <= prev.main) continue;
        const combo = parseCombo(arr, rules);
        if (combo && canBeat(combo, prev)) results.push({ combo, isBomb: true });
      }
    }
    if (rules.allowRocket && map.has(16) && map.has(17)) {
      const combo = parseCombo([map.get(16)![0]!, map.get(17)![0]!], rules);
      if (combo && canBeat(combo, prev)) results.push({ combo, isBomb: true });
    }
  }

  return results;
}

/**
 * 斗牌类通用决策入口（支持斗地主、跑得快低中高三级难度算法）
 */
export function decideCardBotAction(input: CardBotInput): { cmd: 'play'; cards: Card[] } | { cmd: 'pass' } | null {
  const { hand, prevCombo, lastPlayerId, myId, rules, difficulty, playedCards = [], handCounts = [], landlordId } = input;
  if (hand.length === 0) return null;

  const isLead = !prevCombo || lastPlayerId === myId;

  // 若整个手牌本身就是一组合法出牌（例如最后一手绝杀/顺子/三带），任何难度都能顺手打空？
  // 低级经常反应不过来会分着出；中高级必定直接一手清空赢下！
  if (difficulty !== 'low') {
    const whole = parseCombo([...hand], rules);
    if (whole && (isLead || canBeat(whole, prevCombo))) {
      return { cmd: 'play', cards: whole.cards };
    }
  }

  // ================== 低难度：贪心盲打，不拆顺子，不配合不记牌 ==================
  if (difficulty === 'low') {
    if (isLead) {
      // 有对子有时出小对子，大多直接出最小单张
      const map = groupByRank(hand);
      const ranks = [...map.keys()].sort((a, b) => a - b);
      const smallRank = ranks[0];
      if (smallRank !== undefined) {
        const arr = map.get(smallRank)!;
        if (arr.length >= 2 && Math.random() < 0.35) {
          return { cmd: 'play', cards: arr.slice(0, 2) };
        }
        return { cmd: 'play', cards: [arr[0]!] };
      }
      return null;
    }

    const candidates = findAllBeatingMoves(hand, prevCombo, rules).filter((c) => !c.isBomb);
    if (candidates.length > 0) {
      // 随机在最小的一两个解里选一个
      const pick = candidates[Math.random() < 0.8 ? 0 : Math.min(1, candidates.length - 1)]!;
      return { cmd: 'play', cards: pick.combo.cards };
    }
    return { cmd: 'pass' };
  }

  // ================== 中/高难度共用最优拆解与态势识别 ==================
  const groups = decomposeHand(hand, rules);

  // 判断危险对手（如地主或他人手牌 <= 2 张）与自己是否处于农民阵营合作
  const minOpponentCount = handCounts
    .filter((h) => {
      if (h.playerId === myId) return false;
      if (landlordId && myId !== landlordId && h.playerId !== landlordId) return false; // 忽略农民队友
      return true;
    })
    .reduce((min, h) => Math.min(min, h.count), 99);

  const isAllyLead = Boolean(
    landlordId &&
      myId !== landlordId &&
      lastPlayerId &&
      lastPlayerId !== landlordId &&
      lastPlayerId !== myId,
  );

  // ------------------ 领出 (Lead) ------------------
  if (isLead) {
    // 计算记牌器控场大牌：若高难度且手数 <= 2，有绝对控牌先打控牌稳赢
    if (difficulty === 'high' && groups.length === 2) {
      const ctrl = groups.find((g) => g.isControl && g.combo.kind !== 'bomb' && g.combo.kind !== 'rocket');
      if (ctrl) return { cmd: 'play', cards: ctrl.combo.cards };
    }

    // 排序出牌优先级：优先清走长牌（飞机、顺子、连对、三带），然后较小对子/单张；保留炸弹王炸
    const sorted = [...groups].sort((a, b) => {
      const weight = (g: DecomposedGroup): number => {
        const k = g.combo.kind;
        if (k === 'rocket' || k === 'bomb') return 1000 + g.combo.main;
        // 对手报单/剩1张时尽量避免先出小单张给对面逃跑
        if (k === 'single' && minOpponentCount <= 1 && difficulty === 'high') {
          return 500 - g.combo.main; // 真要出单必须从大单开始卡死，优先走非单牌型
        }
        if (k === 'plane') return 10 + g.combo.main;
        if (k === 'double_straight') return 20 + g.combo.main;
        if (k === 'straight') return 30 + g.combo.main;
        if (k === 'triple_one' || k === 'triple_two' || k === 'triple') return 40 + g.combo.main;
        if (k === 'pair') return 60 + g.combo.main;
        return 80 + g.combo.main;
      };
      return weight(a) - weight(b);
    });

    const pick = sorted[0];
    if (pick) return { cmd: 'play', cards: pick.combo.cards };
    return { cmd: 'play', cards: [hand[0]!] };
  }

  // ------------------ 跟牌 (Follow) ------------------
  // 高难度：农民合作判断——如果盟友刚打过牌且牌还挺大或者盟友快走完了，放行给盟友！
  if (difficulty === 'high' && isAllyLead && prevCombo) {
    const ally = handCounts.find((h) => h.playerId === lastPlayerId);
    const allyAlmostWin = ally && ally.count <= 4;
    const isStrongPlay =
      prevCombo.kind === 'bomb' ||
      prevCombo.kind === 'rocket' ||
      (prevCombo.kind === 'single' && prevCombo.main >= 14) ||
      (prevCombo.kind === 'pair' && prevCombo.main >= 12) ||
      prevCombo.size >= 4;

    if (allyAlmostWin || (isStrongPlay && groups.length > 2)) {
      return { cmd: 'pass' };
    }
  }

  const allMoves = findAllBeatingMoves(hand, prevCombo, rules);
  if (allMoves.length === 0) return { cmd: 'pass' };

  // 优先匹配已拆解组里完整存在的同牌型（不破坏顺子、炸弹结构）
  const intactMatch = groups.find(
    (g) => g.combo.kind !== 'bomb' && g.combo.kind !== 'rocket' && canBeat(g.combo, prevCombo),
  );
  if (intactMatch) {
    // 高难度：如果对面只剩 1 张且我们在防单张，尽量用手中够大的单张卡住而不送小单
    if (difficulty === 'high' && prevCombo.kind === 'single' && minOpponentCount <= 1) {
      const intactSingles = groups
        .filter((g) => g.combo.kind === 'single' && canBeat(g.combo, prevCombo))
        .sort((a, b) => b.combo.main - a.combo.main);
      if (intactSingles[0]) return { cmd: 'play', cards: intactSingles[0].combo.cards };
    }
    return { cmd: 'play', cards: intactMatch.combo.cards };
  }

  // 查看外部是否还有更大牌，评估是否拆牌或动用炸弹
  const nonBombs = allMoves.filter((m) => !m.isBomb);
  const bombs = allMoves.filter((m) => m.isBomb);

  // 对手危险警报（<= 2 张）：坚决抢牌！优先非炸大牌卡死，没有就动用炸弹
  const emergency = minOpponentCount <= 2 || groups.length <= 2;

  if (nonBombs.length > 0) {
    // 统计哪些点数被长牌型依赖，中/高难度避免拆掉3张以上组合/炸弹去顶一个微不足道的牌
    const map = groupByRank(hand);
    const safeNonBombs = nonBombs.filter((m) => {
      // 检查是否拆了炸弹
      const touchesBomb = m.combo.cards.some((c) => (map.get(c.rank)?.length ?? 0) === 4);
      if (touchesBomb) return false;
      // 如果非紧急，尽量不拆三张去跟单张/对子
      if (!emergency && (prevCombo.kind === 'single' || prevCombo.kind === 'pair')) {
        const touchesTriple = m.combo.cards.some((c) => (map.get(c.rank)?.length ?? 0) === 3);
        if (touchesTriple) return false;
      }
      return true;
    });

    const chosen = safeNonBombs[0] ?? (emergency ? nonBombs[0] : null);
    if (chosen) {
      // 高难度残局记牌器判断：外面没 2/王 时放心出牌抢权
      if (difficulty === 'high') {
        const playedSet = new Set(playedCards.map((c) => c.id));
        const seenBig = playedCards.filter((c) => c.rank >= 15).length + hand.filter((c) => c.rank >= 15).length;
        const unknownBig = Math.max(0, 6 - seenBig);
        if (unknownBig === 0 || !isAllyLead || emergency) {
          return { cmd: 'play', cards: chosen.combo.cards };
        }
        // 记录逻辑保底直接跟上最小安全非炸
        if (playedSet.size >= 0) return { cmd: 'play', cards: chosen.combo.cards };
      }
      return { cmd: 'play', cards: chosen.combo.cards };
    }
  }

  // 炸弹决策：紧急防守 或 自己手数极少（<= 2手）可直接一波带走
  if (bombs.length > 0 && (emergency || groups.length <= 2 || (difficulty === 'high' && prevCombo.size >= 5))) {
    return { cmd: 'play', cards: bombs[0]!.combo.cards };
  }

  return { cmd: 'pass' };
}
