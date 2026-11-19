/**
 * 前端 gameId 展示与运营字典（单一入口）。
 * 修文案 / 分类 / 热度时只改本文件；配图仍在 assets.ts 的 GAME_ART。
 * 完整路径表见仓库 docs/GAME_MAP.md 与根目录 CONTEXT.md。
 */
import { GAME_ART as ART_FROM_ASSETS } from './assets';

/** 与 assets 同源，便于业务侧只 import game-registry */
export const GAME_ART = ART_FROM_ASSETS;

/** 大厅/牌桌/结算统一中文名 */
export const GAME_TITLE: Record<string, string> = {
  gomoku: '五子棋',
  doudizhu: '斗地主',
  paodekuai: '跑得快',
  tuizhuanzi: '推筒子',
  texas: '德州扑克',
  dice: '骰宝',
  baccarat: '百家乐',
  niuniu: '斗牛',
  blackjack: '21点',
  stud: '梭哈',
  goldenflower: '翻金花',
  chess: '国际象棋',
  xiangqi: '中国象棋',
  'cs-mahjong': '长沙麻将',
  'sc-mahjong': '四川血战麻将',
  'gd-mahjong': '广东推倒胡',
  'guobiao-mahjong': '大众国标麻将',
  'hz-mahjong': '红中麻将',
  slots: '疯狂老虎机',
};

/** @deprecated 使用 GAME_TITLE；保留别名避免旧 import 断裂 */
export const GAME_NAME = GAME_TITLE;

/**
 * 默认大厅分类（可被 GM game_categories 覆盖）。
 * 与 apps/api-server/src/game-categories.ts 默认值保持一致。
 */
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
  'hz-mahjong': 'mahjong',
  xiangqi: 'chess',
  gomoku: 'chess',
  chess: 'chess',
};

/**
 * 平台常驻百人玩法（兜底；优先信 GameMeta.persistent）。
 * @deprecated 新逻辑请用 game.persistent === true
 */
export const PERSISTENT_GAME_IDS = new Set([
  'tuizhuanzi',
  'dice',
  'baccarat',
  'niuniu',
  'blackjack',
]);

/** 荷官 Hover 台词 */
export const GAME_DEALER_QUOTES: Record<string, string> = {
  gomoku: '“落子无悔，棋局变幻莫测～主人要来一盘五子棋切磋智谋吗？♟️”',
  xiangqi: '“楚河汉界，车马纵横！艾莉丝看好主人的神机妙算排兵布阵～🐎”',
  chess: '“六十四格西洋棋，黑白交锋王后争霸！期待主人的精妙绝杀～👑”',
  doudizhu: '“飞机！顺子！炸弹！今天主人是想当农民还是当地主呢？🃏”',
  paodekuai: '“手牌走得快，筹码赢得多！16张快节奏对抗超刺激的～⚡”',
  texas: '“All-in！看穿对手底牌，主人就是今晚叱咤风云的德州赌神！♠️”',
  goldenflower: '“闷抓看底，胆识与魄力的巅峰较量，快来试试主人今天的手气吧！🔥”',
  stud: '“一张底牌定乾坤，同花顺在向主人招手哦！🕶️”',
  'cs-mahjong': '“长沙麻将开门抓鸟！258硬将、将将胡、七小对，祝主人把把自摸中大鸟！🀄”',
  'sc-mahjong': '“四川血战麻将火辣开桌！清一色龙七对高番翻倍，艾莉丝陪主人血战到底！🌶️”',
  'gd-mahjong': '“广东推倒胡极速成胡，胡牌豪买四匹马！中马翻倍赢到手软哦～🐎”',
  'guobiao-mahjong': '“正宗大众国标麻将开席！碰碰胡、清一色、门清自摸，谁才是今晚真雀神？👑”',
  'hz-mahjong': '“红中万能百搭癞子来袭！四红中直接秒胡、胡牌扎4码翻倍，祝主人把把红中在手！🧧”',
  tuizhuanzi: '“万人推筒子正热烈开奖中！主人快去压天门试试手气～🎲”',
  niuniu: '“极速三张算牛，单注押牛一至牛牛，高倍奖池火爆开奖！🐂✨”',
  blackjack: '“Blackjack 豪华双倍！艾莉丝亲手给主人发黑杰克～🎩”',
  dice: '“买定离手！大、小、全围豹子，听听骰盅清脆的声音吧～🎲”',
  baccarat: '“免佣庄闲博弈，长龙走势清晰，艾莉丝陪主人见证神路！💎”',
};

/** 卡片热度文案（展示用，非真实在线） */
export const LIVE_HEAT_MAP: Record<string, string> = {
  tuizhuanzi: '🎰 5,780 人同台',
  doudizhu: '🔥 4,320 人在线',
  'cs-mahjong': '🀄 3,960 人搓麻',
  'sc-mahjong': '🌶️ 4,180 人血战',
  'gd-mahjong': '🐎 3,120 人买马',
  'guobiao-mahjong': '👑 2,540 人竞技',
  'hz-mahjong': '🧧 4,680 人抢红中',
  niuniu: '🔥 3,850 人在玩',
  blackjack: '🎩 3,210 人在玩',
  paodekuai: '⚡ 2,780 人激战',
  baccarat: '💎 4,520 人在玩',
  dice: '🎲 2,930 人同台',
  texas: '♠️ 2,190 人激战',
  goldenflower: '🔥 1,980 人在玩',
  stud: '🕶️ 1,420 人在玩',
  xiangqi: '♟️ 1,650 局对弈',
  gomoku: '♟️ 1,320 局对弈',
  chess: '♟️ 860 局对弈',
};

/** 底分 / 准入提示文案 */
export const STAKES_MAP: Record<string, string> = {
  tuizhuanzi: '💰 单注 10 豆起 · 奖池火爆',
  niuniu: '💰 单注 10 豆起 · 最高 10 倍',
  blackjack: '💰 单注 10 豆起 · 双倍赔率',
  dice: '💰 单注 10 豆起 · 豹子 24 倍',
  baccarat: '💰 单注 10 豆起 · 免佣庄闲',
  doudizhu: '💰 底分 10 豆 · 准入 100 豆',
  paodekuai: '💰 底分 10 豆 · 准入 100 豆',
  texas: '💰 小盲 5 / 大盲 10 · 准入 200 豆',
  goldenflower: '💰 底分 10 豆 · 准入 100 豆',
  stud: '💰 底分 10 豆 · 准入 100 豆',
  'cs-mahjong': '💰 底分 100 豆 · 258硬将抓2鸟',
  'sc-mahjong': '💰 底分 150 豆 · 血战高番翻倍',
  'gd-mahjong': '💰 底分 100 豆 · 推倒胡买4马',
  'guobiao-mahjong': '💰 底分 120 豆 · 国标竞技番型',
  'hz-mahjong': '💰 底分 100 豆 · 红中癞子扎4码',
  gomoku: '💰 胜负 100 豆 · 准入 100 豆',
  xiangqi: '💰 胜负 100 豆 · 准入 100 豆',
  chess: '💰 胜负 100 豆 · 准入 100 豆',
};

/**
 * 解析展示名。
 * @param gameId 玩法 ID，可空
 * @returns 中文名；未知则回退 gameId 本身
 */
export function gameTitleOf(gameId: string | null | undefined): string {
  if (!gameId) return '';
  return GAME_TITLE[gameId] ?? gameId;
}

/**
 * 是否按百人常驻台处理（优先 meta.persistent）。
 * @param game 含 gameId 与可选 persistent
 */
export function isPersistentGame(game: { gameId: string; persistent?: boolean }): boolean {
  if (game.persistent === true) return true;
  return PERSISTENT_GAME_IDS.has(game.gameId);
}
