/**
 * 任务与称号配置。
 * 任务进度由结算与登录行为驱动，奖励通过账本幂等入账。
 */

export type TaskKind = 'login' | 'play' | 'win' | 'relief';
export type TaskPeriod = 'daily' | 'once';

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
  /** 仅 relief 使用：余额低于该值才可领取 */
  maxBalance?: number;
}

export const TASKS: readonly TaskDef[] = [
  {
    key: 'daily_login',
    name: '每日签到',
    description: '每天进入大厅即可领取',
    target: 1,
    reward: 100,
    period: 'daily',
    kind: 'login',
  },
  {
    key: 'daily_play',
    name: '勤学苦练',
    description: '完成 3 局任意对局',
    target: 3,
    reward: 200,
    period: 'daily',
    kind: 'play',
  },
  {
    key: 'daily_win',
    name: '旗开得胜',
    description: '赢下 1 局对局',
    target: 1,
    reward: 300,
    period: 'daily',
    kind: 'win',
  },
  {
    key: 'relief',
    name: '救济金',
    description: '筹码不足 100 时领取，每天一次',
    target: 1,
    reward: 500,
    period: 'daily',
    kind: 'relief',
    maxBalance: 100,
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
  progress: number;
  claimed: boolean;
  /** 是否满足领取条件 */
  claimable: boolean;
  /** 未满足前置条件时的提示 */
  locked: boolean;
  lockReason?: string;
}
