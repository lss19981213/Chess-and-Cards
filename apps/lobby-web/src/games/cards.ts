export interface CardView {
  id: string;
  rank: number;
  suit?: string;
}

const SUIT_LABEL: Record<string, string> = {
  S: '♠',
  H: '♥',
  D: '♦',
  C: '♣',
  JOKER: '',
};

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

export function cardLabel(card: CardView): string {
  return `${SUIT_LABEL[card.suit ?? ''] ?? ''}${rankLabel(card.rank)}`;
}

export function isRedCard(card: CardView): boolean {
  return card.suit === 'H' || card.suit === 'D' || card.rank === 17;
}

const COMBO_LABEL: Record<string, string> = {
  single: '单张',
  pair: '对子',
  triple: '三张',
  triple_one: '三带一',
  triple_two: '三带二',
  straight: '顺子',
  double_straight: '连对',
  plane: '飞机',
  bomb: '炸弹',
  rocket: '王炸',
};

export function comboLabel(kind?: string | null): string {
  return kind ? (COMBO_LABEL[kind] ?? kind) : '';
}

/** 矢量牌面：按牌 id 取图（S14 → assets/cards/S14.svg） */
export function cardArt(id: string): string {
  return `${import.meta.env.BASE_URL}assets/cards/${id}.svg`;
}

export function cardBackArt(): string {
  return `${import.meta.env.BASE_URL}assets/cards/back.svg`;
}

/** 筒子牌面：1-9 点 */
export function dotArt(points: number): string {
  const safe = Math.min(9, Math.max(1, points));
  return `${import.meta.env.BASE_URL}assets/cards/dot${safe}.svg`;
}

/** 客户端斗牌出牌提示：返回所有可合法出牌（或压过上家）的 card.id 列表候选，按从小到大排序 */
export function findSuggestedCardCombos(
  hand: readonly CardView[],
  prevCombo: { kind: string; main: number; size: number } | null,
  variant: 'doudizhu' | 'paodekuai',
): string[][] {
  if (hand.length === 0) return [];
  const byRank = new Map<number, CardView[]>();
  for (const c of hand) {
    const arr = byRank.get(c.rank) ?? [];
    arr.push(c);
    byRank.set(c.rank, arr);
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b);
  const out: string[][] = [];

  if (!prevCombo) {
    // 领出模式：优先提示最小单张、最小对子、最小三带/顺子
    for (const r of ranks) {
      const arr = byRank.get(r)!;
      if (arr.length === 1) out.push([arr[0]!.id]);
    }
    for (const r of ranks) {
      const arr = byRank.get(r)!;
      if (arr.length >= 2 && r < 16) out.push([arr[0]!.id, arr[1]!.id]);
    }
    if (out.length === 0 && hand[0]) {
      out.push([hand[hand.length - 1]!.id]);
    }
    return out;
  }

  const kind = prevCombo.kind;
  const main = prevCombo.main;
  const size = prevCombo.size;

  if (kind !== 'rocket' && kind !== 'bomb') {
    if (kind === 'single') {
      for (const r of ranks) {
        if (r > main) out.push([byRank.get(r)![0]!.id]);
      }
    } else if (kind === 'pair') {
      for (const r of ranks) {
        const arr = byRank.get(r)!;
        if (r > main && arr.length >= 2) out.push([arr[0]!.id, arr[1]!.id]);
      }
    } else if (kind === 'triple') {
      for (const r of ranks) {
        const arr = byRank.get(r)!;
        if (r > main && arr.length >= 3) out.push([arr[0]!.id, arr[1]!.id, arr[2]!.id]);
      }
    } else if (kind === 'triple_one' && variant === 'doudizhu') {
      for (const r of ranks) {
        const arr = byRank.get(r)!;
        if (r > main && arr.length >= 3) {
          const kicker = ranks.find((kr) => kr !== r && (byRank.get(kr)?.length ?? 0) < 4) ?? ranks.find((kr) => kr !== r);
          if (kicker !== undefined) {
            out.push([arr[0]!.id, arr[1]!.id, arr[2]!.id, byRank.get(kicker)![0]!.id]);
          }
        }
      }
    } else if (kind === 'triple_two' && variant === 'doudizhu') {
      for (const r of ranks) {
        const arr = byRank.get(r)!;
        if (r > main && arr.length >= 3) {
          const kicker = ranks.find((kr) => kr !== r && (byRank.get(kr)?.length ?? 0) >= 2 && (byRank.get(kr)?.length ?? 0) < 4);
          if (kicker !== undefined) {
            const p = byRank.get(kicker)!;
            out.push([arr[0]!.id, arr[1]!.id, arr[2]!.id, p[0]!.id, p[1]!.id]);
          }
        }
      }
    } else if (kind === 'straight') {
      for (let high = main + 1; high <= 14; high += 1) {
        const start = high - size + 1;
        if (start < 3) continue;
        const ids: string[] = [];
        let ok = true;
        for (let r = start; r <= high; r += 1) {
          const arr = byRank.get(r);
          if (!arr || arr.length === 0) {
            ok = false;
            break;
          }
          ids.push(arr[0]!.id);
        }
        if (ok) out.push(ids);
      }
    } else if (kind === 'double_straight') {
      const pairs = size / 2;
      for (let high = main + 1; high <= 14; high += 1) {
        const start = high - pairs + 1;
        if (start < 3) continue;
        const ids: string[] = [];
        let ok = true;
        for (let r = start; r <= high; r += 1) {
          const arr = byRank.get(r);
          if (!arr || arr.length < 2) {
            ok = false;
            break;
          }
          ids.push(arr[0]!.id, arr[1]!.id);
        }
        if (ok) out.push(ids);
      }
    }
  }

  // 炸弹与王炸兜底
  if (kind !== 'rocket') {
    for (const r of ranks) {
      const arr = byRank.get(r)!;
      if (arr.length === 4 && (kind !== 'bomb' || r > main)) {
        out.push(arr.map((c) => c.id));
      }
    }
    if (variant === 'doudizhu' && byRank.has(16) && byRank.has(17)) {
      out.push([byRank.get(16)![0]!.id, byRank.get(17)![0]!.id]);
    }
  }

  return out;
}
