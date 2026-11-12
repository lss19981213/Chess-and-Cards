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
];

/**
 * 驱动机器人行动：按难度模拟人类思索节奏，随后调用本地插件 `botIntent`。
 * 返回 true 表示已成功提交合法动作。
 */
export async function driveBot(room: GameRoom, botId: string): Promise<boolean> {
  const diff = room.botDifficultyOf(botId);
  const scale = diff === 'low' ? 0.7 : diff === 'high' ? 1.15 : 1.0;
  const think = Math.round(config.bot.thinkMs * scale) + Math.floor(Math.random() * 420);
  await new Promise((resolve) => setTimeout(resolve, think));

  // 思考期间局面可能已经变化
  if (room.currentActor() !== botId) return false;

  return room.actAsBot(botId);
}
