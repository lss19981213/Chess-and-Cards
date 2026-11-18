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

export interface TaskMetricMeta {
  metric: string;
  label: string;
  group: TaskGroup;
  kind: TaskKind;
  progressSource?: TaskDef['progressSource'];
  supportsMaxBalance?: boolean;
}

export const TASK_METRICS_META: readonly TaskMetricMeta[] = [
  // 每日任务可选进度统计维度
  { metric: 'daily_play', label: '当日完成任意对局局数', group: 'daily', kind: 'play', progressSource: { key: 'daily_play' } },
  { metric: 'daily_win', label: '当日赢下对局局数', group: 'daily', kind: 'win', progressSource: { key: 'daily_win' } },
  { metric: 'daily_bigwin', label: '当日单局净赢500+次数', group: 'daily', kind: 'win', progressSource: { key: 'daily_bigwin' } },
  { metric: 'gameKinds', label: '当日体验不同游戏款数', group: 'daily', kind: 'variety', progressSource: { kind: 'gameKinds' } },
  { metric: 'daily_mahjong', label: '当日雀神麻将对局局数', group: 'daily', kind: 'mahjong', progressSource: { key: 'daily_mahjong' } },
  { metric: 'daily_turnover', label: '当日累计有效流水筹码', group: 'daily', kind: 'turnover', progressSource: { key: 'daily_turnover' } },
  { metric: 'daily_tip', label: '当日打赏荷官次数', group: 'daily', kind: 'tip', progressSource: { key: 'daily_tip' } },
  { metric: 'daily_worship', label: '当日排行榜膜拜次数', group: 'daily', kind: 'worship', progressSource: { key: 'daily_worship' } },
  { metric: 'daily_login', label: '每日登录签到', group: 'daily', kind: 'login', progressSource: { key: 'daily_login' } },
  { metric: 'daily_invite', label: '当日邀请新玩家注册(按人头)', group: 'daily', kind: 'invite', progressSource: { key: 'daily_invite' } },
  { metric: 'relief', label: '破产救济金(余额低于阈值可领)', group: 'daily', kind: 'relief', supportsMaxBalance: true },

  // 成长任务可选进度统计维度
  { metric: 'total_play', label: '历史累计完成对局局数', group: 'growth', kind: 'play', progressSource: { key: 'total_play' } },
  { metric: 'total_win', label: '历史累计赢下对局局数', group: 'growth', kind: 'win', progressSource: { key: 'total_win' } },
  { metric: 'total_checkin', label: '历史累计签到天数', group: 'growth', kind: 'login', progressSource: { key: 'total_checkin' } },
  { metric: 'total_tip', label: '历史累计打赏荷官次数', group: 'growth', kind: 'tip', progressSource: { key: 'total_tip' } },
  { metric: 'level', label: '玩家当前账号等级', group: 'growth', kind: 'level', progressSource: { kind: 'level' } },
  { metric: 'totalGameKinds', label: '历史累计体验不同游戏款数', group: 'growth', kind: 'variety', progressSource: { kind: 'totalGameKinds' } },
  { metric: 'ownedFrames', label: '历史累计拥有头像框数量', group: 'growth', kind: 'frame', progressSource: { kind: 'ownedFrames' } },
];

export interface TaskConfigInput {
  key?: unknown;
  name?: unknown;
  description?: unknown;
  target?: unknown;
  reward?: unknown;
  group?: unknown;
  period?: unknown;
  kind?: unknown;
  metric?: unknown;
  maxBalance?: unknown;
  progressSource?: TaskDef['progressSource'];
}

export interface EnrichedTaskDef extends TaskDef {
  metric: string;
  metricLabel: string;
  sortOrder: number;
}

export function inferTaskMetric(task: TaskDef): string {
  if (task.kind === 'relief') return 'relief';
  if (task.progressSource?.kind) return task.progressSource.kind;
  if (task.progressSource?.key) return task.progressSource.key;
  if (TASK_METRICS_META.some((m) => m.metric === task.key)) return task.key;
  return task.group === 'growth' ? 'total_play' : 'daily_play';
}

export function toEnrichedTask(task: TaskDef, index: number): EnrichedTaskDef {
  const metric = inferTaskMetric(task);
  const meta = TASK_METRICS_META.find((m) => m.metric === metric);
  return {
    ...task,
    metric,
    metricLabel: meta?.label ?? metric,
    sortOrder: index + 1,
  };
}

export function sanitizeSingleTask(raw: TaskConfigInput): TaskDef | null {
  if (!raw || typeof raw !== 'object') return null;

  const key = String(raw.key ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 40);
  const name = String(raw.name ?? '').trim().slice(0, 24);
  const description = String(raw.description ?? '').trim().slice(0, 120);
  const group: TaskGroup = raw.group === 'growth' || raw.period === 'once' ? 'growth' : 'daily';
  const period: TaskPeriod = group === 'growth' ? 'once' : 'daily';

  const targetNum = Math.floor(Number(raw.target ?? 0));
  const rewardNum = Math.floor(Number(raw.reward ?? 0));

  if (!key || !name) return null;
  if (!Number.isFinite(targetNum) || targetNum < 1 || targetNum > 100_000_000) return null;
  if (!Number.isFinite(rewardNum) || rewardNum < 1 || rewardNum > 50_000_000) return null;

  const rawMetric = typeof raw.metric === 'string' && raw.metric.trim() ? raw.metric.trim() : '';
  let metricMeta = TASK_METRICS_META.find((m) => m.metric === rawMetric);

  // 如果未显式传 metric，则从 progressSource / key / kind 推导
  if (!metricMeta) {
    if (raw.kind === 'relief' || key === 'relief') {
      metricMeta = TASK_METRICS_META.find((m) => m.metric === 'relief');
    } else if (raw.progressSource?.kind) {
      metricMeta = TASK_METRICS_META.find((m) => m.metric === raw.progressSource?.kind);
    } else if (raw.progressSource?.key) {
      metricMeta = TASK_METRICS_META.find((m) => m.metric === raw.progressSource?.key);
    } else {
      metricMeta = TASK_METRICS_META.find((m) => m.metric === key);
    }
  }

  // 兜底匹配同组第一个维度
  if (!metricMeta) {
    metricMeta = TASK_METRICS_META.find((m) => m.group === group) ?? TASK_METRICS_META[0]!;
  }

  const maxBalanceNum =
    raw.maxBalance !== undefined && raw.maxBalance !== null && raw.maxBalance !== ''
      ? Math.floor(Number(raw.maxBalance))
      : undefined;

  const task: TaskDef = {
    key,
    name,
    description: description || `${name}（目标 ${targetNum}）`,
    target: targetNum,
    reward: rewardNum,
    period,
    kind: metricMeta.kind,
    group,
  };

  if (metricMeta.kind === 'relief') {
    task.maxBalance =
      maxBalanceNum !== undefined && Number.isFinite(maxBalanceNum) && maxBalanceNum > 0
        ? Math.min(maxBalanceNum, 10_000_000)
        : 100;
  } else if (metricMeta.progressSource) {
    // 若任务 key 与自身进度源一致（如 daily_play / daily_win），不冗余写或保持明确均可，统一写明更清晰
    task.progressSource = { ...metricMeta.progressSource };
  }

  return task;
}

export interface TasksConfigPayload {
  tasks: TaskDef[];
}

export function sanitizeTasksConfig(raw?: unknown): TaskDef[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { tasks?: unknown }).tasks)
      ? (raw as { tasks: unknown[] }).tasks
      : null;

  if (!list) {
    return TASKS.map((t) => ({
      ...t,
      ...(t.progressSource ? { progressSource: { ...t.progressSource } } : {}),
    }));
  }

  const seen = new Set<string>();
  const cleaned: TaskDef[] = [];
  for (const item of list) {
    const task = sanitizeSingleTask(item as TaskConfigInput);
    if (!task || seen.has(task.key)) continue;
    seen.add(task.key);
    cleaned.push(task);
  }
  return cleaned;
}

export async function loadTasksConfig(
  getSetting: <T>(key: string) => Promise<T | null>,
): Promise<TaskDef[]> {
  const saved = await getSetting<TasksConfigPayload | TaskDef[]>('tasks_config');
  if (saved === null || saved === undefined) {
    return sanitizeTasksConfig(null);
  }
  return sanitizeTasksConfig(saved);
}

export function findTask(key: string, list: readonly TaskDef[] = TASKS): TaskDef | undefined {
  return list.find((task) => task.key === key);
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
