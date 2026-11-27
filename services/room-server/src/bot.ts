import { EMOTES } from '@cc/protocol';
import { config } from './config';
import type { GameRoom } from './room';

/**
 * 本地分级机器人驱动器：
 * 完全依赖游戏插件内的经典博弈算法（Alpha-Beta / VCF / 拆牌记牌 / Monte Carlo 赔率 / Basic Strategy），
 * 支持低、中、高三档可选难度，不依赖任何外部大模型服务。
 */

export const BOT_NAMES: readonly string[] = [
  '智多星',
  '小机灵',
  '算无遗策',
  '牌桌猎手',
  '冷静先生',
  '快刀手',
  '老练玩家',
  '深蓝之手',
  '赌侠阿星',
  '发哥门徒',
  '顺子大王',
  '闷牌大师',
  '炸弹狂魔',
  '梭哈老鬼',
  '牌坛浪子',
  '偷鸡专家',
  '全压战士',
  '金花仙子',
  '铁算盘',
  '不败战神',
];

/**
 * 驱动机器人行动：按难度模拟人类思索节奏（含人性化随机停顿与偶发喊话），随后调用本地插件 `botIntent`。
 * 返回 true 表示已成功提交合法动作。
 */
export async function driveBot(room: GameRoom, botId: string): Promise<boolean> {
  const diff = room.botDifficultyOf(botId);
  const scale = diff === 'low' ? 0.85 : diff === 'high' ? 1.25 : 1.05;
  const baseThink = Math.max(700, config.bot.thinkMs);
  const think = Math.round(baseThink * scale) + Math.floor(Math.random() * 850);
  await new Promise((resolve) => setTimeout(resolve, think));

  // 思考期间局面可能已经变化
  if (room.currentActor() !== botId) return false;

  const ok = await room.actAsBot(botId);
  if (ok && Math.random() < 0.08) {
    const emote = EMOTES[Math.floor(Math.random() * EMOTES.length)];
    if (emote) {
      try {
        room.sendEmote(botId, emote.key, emote.text);
      } catch {
        /* 限频时忽略 */
      }
    }
  }
  return ok;
}
