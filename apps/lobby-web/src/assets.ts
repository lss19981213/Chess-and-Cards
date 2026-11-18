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
  niuniu: asset('game-niuniu.jpg'),
  blackjack: asset('game-blackjack.jpg'),
  stud: asset('game-stud.jpg'),
  goldenflower: asset('game-goldenflower.jpg'),
  chess: asset('game-chess.jpg'),
  xiangqi: asset('game-xiangqi.jpg'),
  'cs-mahjong': asset('game-csmahjong.jpg'),
  'sc-mahjong': asset('game-scmahjong.jpg'),
  'gd-mahjong': asset('game-gdmahjong.jpg'),
  'guobiao-mahjong': asset('game-guobiaomahjong.jpg'),
  slots: asset('game-slots.jpg'),
};

export const HERO_BG = asset('hero-table.jpg');
export const CHIP_IMG = asset('chip.jpg');

/** 动漫版高颜值专属荷官立绘 */
export const DEALER_MAIN = asset('dealer-main.jpg');
export const DEALER_CELEBRATE = asset('dealer-celebrate.jpg');
export const DEALER_ASSISTANT = asset('dealer-assistant.jpg');

/** 荷官爱丽丝专属皮肤立绘 */
export const DEALER_SKINS_ASSETS: Record<string, string> = {
  classic: asset('dealer-main.jpg'),
  cheongsam: asset('dealer-cheongsam.jpg'),
  bikini: asset('dealer-bikini.jpg'),
  bunny: asset('dealer-bunny.jpg'),
  nurse: asset('dealer-nurse.jpg'),
  royal: asset('dealer-royal.jpg'),
  catgirl: asset('dealer-catgirl.jpg'),
  cyber: asset('dealer-cyber.jpg'),
  cocktail: asset('dealer-cocktail.jpg'),
  lingerie: asset('dealer-lingerie.jpg'),
  bathrobe: asset('dealer-bathrobe.jpg'),
  maid: asset('dealer-maid.jpg'),
  succubus: asset('dealer-succubus.jpg'),
  celebrate: asset('dealer-celebrate.jpg'),
  wedding: asset('dealer-wedding.jpg'),
  mermaid: asset('dealer-mermaid.jpg'),
  cleopatra: asset('dealer-cleopatra.jpg'),
  racequeen: asset('dealer-racequeen.jpg'),
  vampire: asset('dealer-vampire.jpg'),
  fallenangel: asset('dealer-fallenangel.jpg'),
  oiran: asset('dealer-oiran.jpg'),
  galaxy: asset('dealer-galaxy.jpg'),
  dragoncheongsam: asset('dealer-dragoncheongsam.jpg'),
  aphrodite: asset('dealer-aphrodite.jpg'),
};
