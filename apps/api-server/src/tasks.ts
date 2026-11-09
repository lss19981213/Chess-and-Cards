/**
 * 任务与称号配置。
 * 任务进度由结算与登录行为驱动，奖励通过账本幂等入账。
 */

export type TaskKind = 'login' | 'play' | 'win' | 'relief' | 'tip' | 'variety';
export type TaskPeriod = 'daily' | 'once';
export type TaskGroup = 'daily' | 'growth';

export interface TaskDef {
  key: string;
  name: string;
  description: string;
  /** 完成所需进度 */
  target: number;
  /** 完成后发放的筹码 */
  reward: number;
  period: TaskPeriod;
  kind: TaskKind;
  /** 展示分组：每日 / 成长 */
  group: TaskGroup;
  /** 仅 relief 使用：余额低于该值才可领取 */
  maxBalance?: number;
  /**
   * 进度来源，缺省为任务自身 key。
   * - `key`：复用另一条任务进度行（多个档位任务共享同一计数）
   * - `kind: gameKinds`：统计当日玩过的不同游戏数量
   */
  progressSource?: { key?: string; kind?: 'gameKinds' };
}

export const TASKS: readonly TaskDef[] = [
  // ---------- 每日任务 ----------
  {
    key: 'daily_login',
    name: '每日签到',
    description: '每天进入大厅即可领取',
    target: 1,
    reward: 100,
    period: 'daily',
    kind: 'login',
    group: 'daily',
  },
  {
    key: 'daily_play',
    name: '勤学苦练',
    description: '完成 3 局任意对局',
    target: 3,
    reward: 200,
    period: 'daily',
    kind: 'play',
    group: 'daily',
  },
  {
    key: 'daily_play_10',
    name: '牌桌常客',
    description: '当日完成 10 局对局',
    target: 10,
    reward: 600,
    period: 'daily',
    kind: 'play',
    group: 'daily',
    progressSource: { key: 'daily_play' },
  },
  {
    key: 'daily_win',
    name: '旗开得胜',
    description: '赢下 1 局对局',
    target: 1,
    reward: 300,
    period: 'daily',
    kind: 'win',
    group: 'daily',
  },
  {
    key: 'daily_win_3',
    name: '三战三捷',
    description: '当日赢下 3 局对局',
    target: 3,
    reward: 900,
    period: 'daily',
    kind: 'win',
    group: 'daily',
    progressSource: { key: 'daily_win' },
  },
  {
    key: 'daily_bigwin',
    name: '大杀四方',
    description: '单局净赢 500 筹码以上',
    target: 1,
    reward: 600,
    period: 'daily',
    kind: 'win',
    group: 'daily',
  },
  {
    key: 'daily_games',
    name: '多面手',
    description: '当日体验 3 款不同游戏',
    target: 3,
    reward: 500,
    period: 'daily',
    kind: 'variety',
    group: 'daily',
    progressSource: { kind: 'gameKinds' },
  },
  {
    key: 'daily_tip',
    name: '慷慨解囊',
    description: '给荷官艾莉丝打赏 1 次',
    target: 1,
    reward: 200,
    period: 'daily',
    kind: 'tip',
    group: 'daily',
  },
  {
    key: 'relief',
    name: '救济金',
    description: '筹码不足 100 时领取，每天一次',
    target: 1,
    reward: 500,
    period: 'daily',
    kind: 'relief',
    group: 'daily',
    maxBalance: 100,
  },

  // ---------- 成长任务（长期累计） ----------
  {
    key: 'once_play_30',
    name: '初出茅庐',
    description: '累计完成 30 局对局',
    target: 30,
    reward: 2000,
    period: 'once',
    kind: 'play',
    group: 'growth',
    progressSource: { key: 'total_play' },
  },
  {
    key: 'once_play_100',
    name: '百战之身',
    description: '累计完成 100 局对局',
    target: 100,
    reward: 6000,
    period: 'once',
    kind: 'play',
    group: 'growth',
    progressSource: { key: 'total_play' },
  },
  {
    key: 'once_win_20',
    name: '常胜将军',
    description: '累计赢下 20 局对局',
    target: 20,
    reward: 5000,
    period: 'once',
    kind: 'win',
    group: 'growth',
    progressSource: { key: 'total_win' },
  },
];

export function findTask(key: string): TaskDef | undefined {
  return TASKS.find((task) => task.key === key);
}

/** 每日任务按东八区自然日划分 */
export function periodKeyFor(period: TaskPeriod): string {
  if (period === 'once') return 'all';
  const shifted = new Date(Date.now() + 8 * 3600_000);
  return shifted.toISOString().slice(0, 10);
}

/** 余额排行榜称号，第 1 名起依次对应 */
export const TITLES: readonly string[] = [
  '赌神',
  '赌圣',
  '赌侠',
  '牌王',
  '牌霸',
  '千王',
  '雀神',
  '不败传说',
  '幸运之星',
  '天选之人',
];

export function titleFor(rank: number): string {
  return TITLES[rank - 1] ?? '';
}

export interface TaskView {
  key: string;
  name: string;
  description: string;
  target: number;
  reward: number;
  period: TaskPeriod;
  group: TaskGroup;
  progress: number;
  claimed: boolean;
  /** 是否满足领取条件 */
  claimable: boolean;
  /** 未满足前置条件时的提示 */
  locked: boolean;
  lockReason?: string;
}
