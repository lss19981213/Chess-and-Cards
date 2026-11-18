/**
 * 任务与称号配置。
 * 任务进度由结算与登录行为驱动，奖励通过账本幂等入账。
 */

export type TaskKind =
  | 'login'
  | 'play'
  | 'win'
  | 'relief'
  | 'tip'
  | 'variety'
  | 'invite'
  | 'worship'
  | 'turnover'
  | 'level'
  | 'frame'
  | 'mahjong';
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
   * - `kind: totalGameKinds`：统计历史累计玩过的不同游戏数量
   * - `kind: level`：直接读取玩家当前账号等级
   * - `kind: ownedFrames`：直接读取玩家已拥有的头像框数量
   */
  progressSource?: {
    key?: string;
    kind?: 'gameKinds' | 'totalGameKinds' | 'level' | 'ownedFrames';
  };
}

export const TASKS: readonly TaskDef[] = [
  // ---------- 每日任务 ----------
  {
    key: 'daily_invite',
    name: '邀请新玩家',
    description: '每邀请1位新玩家注册入场奖励 1,000 筹码，上不封顶随时领取！',
    target: 1,
    reward: 1000,
    period: 'daily',
    kind: 'invite',
    group: 'daily',
  },
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
  // ---------- 新增 5 个每日高频活跃留存任务 ----------
  {
    key: 'daily_play_25',
    name: '牌坛劳模',
    description: '当日累计完成 25 局任意对局，赢取丰厚日活奖励',
    target: 25,
    reward: 1200,
    period: 'daily',
    kind: 'play',
    group: 'daily',
    progressSource: { key: 'daily_play' },
  },
  {
    key: 'daily_win_8',
    name: '势如破竹',
    description: '当日累计赢下 8 局对局，手热不停歇',
    target: 8,
    reward: 1800,
    period: 'daily',
    kind: 'win',
    group: 'daily',
    progressSource: { key: 'daily_win' },
  },
  {
    key: 'daily_mahjong',
    name: '雀神手气',
    description: '当日完成 2 局雀神麻将系列对局（长沙/四川/广东/国标任选）',
    target: 2,
    reward: 600,
    period: 'daily',
    kind: 'mahjong',
    group: 'daily',
  },
  {
    key: 'daily_worship',
    name: '礼贤下士',
    description: '当日在排行榜向大佬膜拜 3 次，沾沾欧气领双倍福利',
    target: 3,
    reward: 400,
    period: 'daily',
    kind: 'worship',
    group: 'daily',
  },
  {
    key: 'daily_turnover_3000',
    name: '挥金如土',
    description: '当日累计有效流水达到 3,000 筹码（所有游戏与老虎机均计入）',
    target: 3000,
    reward: 1000,
    period: 'daily',
    kind: 'turnover',
    group: 'daily',
    progressSource: { key: 'daily_turnover' },
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
  // ---------- 新增 10 个长线留存成长任务 ----------
  {
    key: 'once_checkin_3',
    name: '三日之约',
    description: '累计完成 3 天每日签到，养成每日领福利好习惯',
    target: 3,
    reward: 1500,
    period: 'once',
    kind: 'login',
    group: 'growth',
    progressSource: { key: 'total_checkin' },
  },
  {
    key: 'once_checkin_7',
    name: '七日忠粉',
    description: '累计完成 7 天每日签到，解锁老友专属豪礼',
    target: 7,
    reward: 5000,
    period: 'once',
    kind: 'login',
    group: 'growth',
    progressSource: { key: 'total_checkin' },
  },
  {
    key: 'once_checkin_30',
    name: '月度牌神',
    description: '累计完成 30 天每日签到，殿堂常驻至尊回馈',
    target: 30,
    reward: 25000,
    period: 'once',
    kind: 'login',
    group: 'growth',
    progressSource: { key: 'total_checkin' },
  },
  {
    key: 'once_play_300',
    name: '沙场老将',
    description: '累计完成 300 局任意对局，牌艺登峰造极',
    target: 300,
    reward: 15000,
    period: 'once',
    kind: 'play',
    group: 'growth',
    progressSource: { key: 'total_play' },
  },
  {
    key: 'once_win_100',
    name: '百胜传说',
    description: '累计赢下 100 局对局，威震全服牌坛',
    target: 100,
    reward: 20000,
    period: 'once',
    kind: 'win',
    group: 'growth',
    progressSource: { key: 'total_win' },
  },
  {
    key: 'once_level_5',
    name: '牌坛新锐',
    description: '账号等级晋升至 Lv.5，解锁新锐进阶补贴',
    target: 5,
    reward: 3000,
    period: 'once',
    kind: 'level',
    group: 'growth',
    progressSource: { kind: 'level' },
  },
  {
    key: 'once_level_15',
    name: '殿堂宗师',
    description: '账号等级晋升至 Lv.15，荣膺高阶宗师大奖',
    target: 15,
    reward: 18000,
    period: 'once',
    kind: 'level',
    group: 'growth',
    progressSource: { kind: 'level' },
  },
  {
    key: 'once_variety_6',
    name: '全能玩家',
    description: '累计体验 6 款不同游戏（扑克/麻将/棋类/百人/老虎机均可）',
    target: 6,
    reward: 4000,
    period: 'once',
    kind: 'variety',
    group: 'growth',
    progressSource: { kind: 'totalGameKinds' },
  },
  {
    key: 'once_frame_2',
    name: '盛装登场',
    description: '累计拥有 2 款头像框（解锁任意一款炫彩动态头像框即可回血）',
    target: 2,
    reward: 3000,
    period: 'once',
    kind: 'frame',
    group: 'growth',
    progressSource: { kind: 'ownedFrames' },
  },
  {
    key: 'once_tip_10',
    name: '艾莉丝挚友',
    description: '累计打赏荷官艾莉丝 10 次，收获满满牌运祝福',
    target: 10,
    reward: 5000,
    period: 'once',
    kind: 'tip',
    group: 'growth',
    progressSource: { key: 'total_tip' },
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
