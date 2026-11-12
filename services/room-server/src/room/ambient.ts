import { randomUUID } from 'node:crypto';
import type { BotDifficulty } from '@cc/protocol';
import type { Seat } from './types';

const AMBIENT_MIN = 30;
const AMBIENT_MAX = 50;

const AMBIENT_NAMES = [
  '夜雨声烦', '老赌徒', '一掷千金', '淡定哥', '风清扬', '南城旧梦', '小赌怡情', '铁头娃',
  '顺风耳', '稳如老狗', '赌一把', '飘渺孤鸿', '半夜不睡', '老王来了', '暴富梦想', '手气不错',
  '一见发财', '沉默的羔羊', '不服就干', '春天里', '看牌高手', '好运来', '点背到家', '再来一把',
  '月下独酌', '浪里白条', '百万富翁', '风继续吹', '佛系玩家', '追梦人', '东方不败', '笑看风云',
];

/** 补足/回收场内氛围玩家：真人少时保持热闹，真人增多时让出容量 */
export function reconcileAmbientSeats(
  seats: Map<string, Seat>,
  capacity: number,
  nextSeatIndex: () => number,
): boolean {
  const all = [...seats.values()];
  const humans = all.filter((seat) => !seat.isBot).length;
  const ambient = all.filter((seat) => seat.playerId.startsWith('ambient:'));

  const desired =
    humans < 10
      ? AMBIENT_MIN + Math.floor(Math.random() * (AMBIENT_MAX - AMBIENT_MIN + 1))
      : Math.min(capacity, humans + 8);

  if (seats.size > desired) {
    let changed = false;
    for (const seat of ambient) {
      if (seats.size <= desired) break;
      seats.delete(seat.playerId);
      changed = true;
    }
    return changed;
  }

  if (seats.size >= desired) return false;

  const used = new Set(all.map((seat) => seat.nickname));
  const diffs: BotDifficulty[] = ['low', 'medium', 'high'];
  for (let i = seats.size; i < desired; i += 1) {
    const base = AMBIENT_NAMES[Math.floor(Math.random() * AMBIENT_NAMES.length)] ?? '牌友';
    let nickname = base;
    let suffix = 2;
    while (used.has(nickname)) nickname = `${base}${suffix++}`;
    used.add(nickname);

    const playerId = `ambient:${randomUUID()}`;
    seats.set(playerId, {
      playerId,
      nickname,
      seat: nextSeatIndex(),
      ready: true,
      score: 0,
      socket: null,
      graceTimer: null,
      isBot: true,
      botDifficulty: diffs[i % diffs.length]!,
    });
  }
  return true;
}
