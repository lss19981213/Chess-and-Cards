/** 静态素材路径（部署在 /lobby/ 子路径下） */
export function asset(name: string): string {
  return `${import.meta.env.BASE_URL}assets/${name}`;
}

/** gameId → 卡片配图 */
export const GAME_ART: Record<string, string> = {
  gomoku: asset('game-gomoku.jpg'),
  doudizhu: asset('game-doudizhu.jpg'),
  paodekuai: asset('game-paodekuai.jpg'),
  tuizhuanzi: asset('game-tuizhuanzi.jpg'),
  texas: asset('game-texas.jpg'),
  dice: asset('game-dice.jpg'),
  baccarat: asset('game-baccarat.jpg'),
};

export const HERO_BG = asset('hero-table.jpg');
export const CHIP_IMG = asset('chip.jpg');
