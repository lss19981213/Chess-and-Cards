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
