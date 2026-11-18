export interface GameCategoryDef {
  key: string;
  label: string;
  icon: string;
  badge?: string;
  sortOrder: number;
}

export interface GameCategoriesConfig {
  categories: GameCategoryDef[];
  /** gameId -> categoryKey 映射（除 'all' 外的具体分类） */
  gameCategoryMap: Record<string, string>;
}

export const DEFAULT_GAME_CATEGORIES: GameCategoryDef[] = [
  { key: 'all', label: '全部热门', icon: '🔥', sortOrder: 0 },
  { key: 'live', label: '百人竞技', icon: '🎰', badge: '火爆', sortOrder: 1 },
  { key: 'cards', label: '经典扑克', icon: '♠️', sortOrder: 2 },
  { key: 'mahjong', label: '雀神麻将', icon: '🀄', badge: '热门', sortOrder: 3 },
  { key: 'chess', label: '智谋对弈', icon: '♟️', sortOrder: 4 },
];

export const DEFAULT_GAME_CATEGORY_MAP: Record<string, string> = {
  tuizhuanzi: 'live',
  dice: 'live',
  baccarat: 'live',
  niuniu: 'live',
  blackjack: 'live',
  doudizhu: 'cards',
  paodekuai: 'cards',
  texas: 'cards',
  stud: 'cards',
  goldenflower: 'cards',
  'cs-mahjong': 'mahjong',
  'sc-mahjong': 'mahjong',
  'gd-mahjong': 'mahjong',
  'guobiao-mahjong': 'mahjong',
  xiangqi: 'chess',
  gomoku: 'chess',
  chess: 'chess',
};

export const DEFAULT_GAME_CATEGORIES_CONFIG: GameCategoriesConfig = {
  categories: DEFAULT_GAME_CATEGORIES,
  gameCategoryMap: DEFAULT_GAME_CATEGORY_MAP,
};

export function sanitizeGameCategoriesConfig(
  raw?: Partial<GameCategoriesConfig> | null,
): GameCategoriesConfig {
  const rawCats = Array.isArray(raw?.categories) ? raw.categories : DEFAULT_GAME_CATEGORIES;
  const seen = new Set<string>();
  const cleaned: GameCategoryDef[] = [];

  for (let i = 0; i < rawCats.length; i += 1) {
    const item = rawCats[i];
    if (!item || typeof item !== 'object') continue;
    const key = String(item.key ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 24);
    const label = String(item.label ?? '').trim().slice(0, 16);
    const icon = String(item.icon ?? '🎮').trim().slice(0, 8) || '🎮';
    const badge = typeof item.badge === 'string' && item.badge.trim() ? item.badge.trim().slice(0, 8) : undefined;
    const sortOrder = Number.isFinite(Number(item.sortOrder)) ? Math.floor(Number(item.sortOrder)) : i;
    if (!key || !label || seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ key, label, icon, ...(badge ? { badge } : {}), sortOrder });
  }

  if (!seen.has('all')) {
    cleaned.unshift({ key: 'all', label: '全部热门', icon: '🔥', sortOrder: -1 });
    seen.add('all');
  }
  cleaned.sort((a, b) => (a.key === 'all' ? -1 : b.key === 'all' ? 1 : a.sortOrder - b.sortOrder));

  // 合并游戏映射：保留 GM 已保存的自定义分类，同时为新上线游戏补齐默认分类
  const mergedMap: Record<string, string> = { ...DEFAULT_GAME_CATEGORY_MAP };
  if (raw?.gameCategoryMap && typeof raw.gameCategoryMap === 'object') {
    for (const [gameId, catKey] of Object.entries(raw.gameCategoryMap)) {
      const k = String(catKey ?? '').trim().toLowerCase();
      if (gameId && k && seen.has(k) && k !== 'all') {
        mergedMap[gameId] = k;
      }
    }
  }
  // 清理指向已删除分类的映射
  const fallbackCat = cleaned.find((c) => c.key !== 'all')?.key ?? 'all';
  for (const [gameId, catKey] of Object.entries(mergedMap)) {
    if (!seen.has(catKey)) {
      mergedMap[gameId] = fallbackCat;
    }
  }

  return {
    categories: cleaned,
    gameCategoryMap: mergedMap,
  };
}
