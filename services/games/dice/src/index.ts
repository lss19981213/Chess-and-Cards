import type { GameMeta, GameSnapshot } from '@cc/protocol';
import type { GameIntent, PlayerContext, RoomContext, SettlementInput } from '@cc/game-sdk';
import { BaseGamePlugin } from '@cc/game-sdk';

/**
 * 三颗骰子猜大小（平台庄家版）
 * - 可押：大 / 小 / 单 / 双 / 豹子 / 具体和值（4-17）
 * - 开豹子时大小单双和值和全部通杀，只赔豹子（1:24）
 * - 常驻运行：每 38 秒一局（30 秒下注 + 5 秒开牌 + 3 秒间隔）
 */

const BET_MS = 30_000;
const REVEAL_MS = 5_000;
const IDLE_MS = 3_000;

const MIN_BET = 10;
const MAX_BET = 2000;
const MAX_TOTAL = 6000;
const HISTORY_LIMIT = 30;

/** 和值赔率（净赔倍数） */
const SUM_ODDS: Record<number, number> = {
  4: 50,
  17: 50,
  5: 18,
  16: 18,
  6: 14,
  15: 14,
  7: 12,
  14: 12,
  8: 8,
  13: 8,
  9: 6,
  12: 6,
  10: 6,
  11: 6,
};

const TRIPLE_ODDS = 24;

type Area = 'big' | 'small' | 'odd' | 'even' | 'triple' | `sum-${number}`;

const FIXED_AREAS: Area[] = ['big', 'small', 'odd', 'even', 'triple'];
const SUM_AREAS: Area[] = Object.keys(SUM_ODDS).map((n) => `sum-${n}` as Area);

type Phase = 'bet' | 'reveal' | 'idle';

interface RoundResult {
  playerId: string;
  nickname: string;
  delta: number;
  detail: string;
}

interface HistoryItem {
  round: number;
  dice: number[];
  sum: number;
  triple: boolean;
  big: boolean;
}

interface State {
  phase: Phase;
  phaseEndsAt: number;
  dice: number[];
  bets: Map<string, Partial<Record<Area, number>>>;
  results: RoundResult[];
  history: HistoryItem[];
  roundNo: number;
  /** 连续命中次数 */
  streaks: Map<string, number>;
  botPlans: BotPlan[];
}

interface BotPlan {
  playerId: string;
  area: string;
  amount: number;
  at: number;
  done: boolean;
}

function emptyState(): State {
  return {
    phase: 'bet',
    phaseEndsAt: 0,
    dice: [0, 0, 0],
    bets: new Map(),
    results: [],
    history: [],
    roundNo: 0,
    streaks: new Map(),
    botPlans: [],
  };
}

function rollDice(seed: string): number[] {
  // 用种子派生的确定性随机，便于复现审计
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const dice: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822507);
    hash >>>= 0;
    dice.push((hash % 6) + 1);
  }
  return dice;
}

function areaOdds(area: Area): number {
  if (area === 'triple') return TRIPLE_ODDS;
  if (area.startsWith('sum-')) return SUM_ODDS[Number(area.slice(4))] ?? 0;
  return 1;
}

function areaWins(area: Area, dice: number[], sum: number, triple: boolean): boolean {
  if (area === 'triple') return triple;
  // 豹子通吃，除豹子外全输
  if (triple) return false;
  if (area === 'big') return sum >= 11;
  if (area === 'small') return sum <= 10;
  if (area === 'odd') return sum % 2 === 1;
  if (area === 'even') return sum % 2 === 0;
  if (area.startsWith('sum-')) return sum === Number(area.slice(4));
  return false;
}

export class DicePlugin extends BaseGamePlugin {
  override readonly apiVersion = 1;
  override readonly commands = ['bet', 'clear'] as const;

  override readonly meta: GameMeta = {
    gameId: 'dice',
    name: '骰宝',
    description: '三颗骰子比大小，押大/小/单/双/豹子/和值，赔率各不相同',
    version: '1.0.0',
    clientBundle: '',
    minPlayers: 1,
    maxPlayers: 5,
    tags: ['骰子', '常驻', '下注'],
    category: 'live',
    persistent: true,
    icon: '🎲',
  };

  private state: State = emptyState();

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  override onRoundStart(ctx: RoomContext): void {
    this.state = {
      ...emptyState(),
      phase: 'bet',
      phaseEndsAt: Date.now() + BET_MS,
      dice: rollDice(`${ctx.config.seed}:${ctx.config.round}`),
      roundNo: ctx.config.round,
      // 连胜跨局保留
      streaks: this.state.streaks,
    };
    this.planBotBets(ctx);
  }

  /** 机器人下注计划：分散到整个下注期，模拟玩家陆续进场 */
  private planBotBets(ctx: RoomContext): void {
    const now = Date.now();
    const areas: Area[] = ['big', 'small', 'odd', 'even', 'triple'];
    const amounts = [10, 20, 50, 100, 200];
    const plans: BotPlan[] = [];
    for (const bot of ctx.players) {
      if (!bot.isBot) continue;
      if (Math.random() > 0.6) continue;
      const count = Math.random() < 0.28 ? 2 : 1;
      for (let i = 0; i < count; i += 1) {
        plans.push({
          playerId: bot.playerId,
          area: areas[Math.floor(Math.random() * areas.length)]!,
          amount: amounts[Math.floor(Math.random() * amounts.length)]!,
          at: now + 600 + Math.random() * (BET_MS - 4600),
          done: false,
        });
      }
    }
    this.state.botPlans = plans;
  }

  override onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): void {
    if (this.state.phase !== 'bet') throw new Error('本局已封盘，等下一局吧');

    // 撤注：传 area 只清该区，不传则清空全部
    if (intent.cmd === 'clear') {
      const area = String(intent.payload?.area ?? '');
      if (area) {
        const bet = this.state.bets.get(playerId);
        if (bet) delete bet[area as Area];
      } else {
        this.state.bets.delete(playerId);
      }
      ctx.markDirty();
      return;
    }
    if (intent.cmd !== 'bet') throw new Error(`不支持的操作: ${intent.cmd}`);

    const area = String(intent.payload?.area ?? '') as Area;
    if (![...FIXED_AREAS, ...SUM_AREAS].includes(area)) throw new Error('无效的下注区域');

    const amount = Number(intent.payload?.amount);
    if (!Number.isInteger(amount) || amount < MIN_BET) throw new Error(`单注至少 ${MIN_BET} 筹码`);
    if (amount > MAX_BET) throw new Error(`单注最多 ${MAX_BET} 筹码`);

    const current = this.state.bets.get(playerId) ?? {};
    let total = 0;
    for (const value of Object.values(current)) total += value ?? 0;
    if (total + amount > MAX_TOTAL) throw new Error(`本局总下注不能超过 ${MAX_TOTAL} 筹码`);

    current[area] = (current[area] ?? 0) + amount;
    this.state.bets.set(playerId, current);
    ctx.markDirty();
  }

  override onTick(ctx: RoomContext): void {
    const now = Date.now();

    // 到下点的机器人下注逐条落账，共押金额随时间增长
    if (this.state.phase === 'bet') {
      let changed = false;
      for (const plan of this.state.botPlans) {
        if (plan.done || plan.at > now) continue;
        plan.done = true;
        const bet = this.state.bets.get(plan.playerId) ?? {};
        bet[plan.area as Area] = (bet[plan.area as Area] ?? 0) + plan.amount;
        this.state.bets.set(plan.playerId, bet);
        changed = true;
      }
      if (changed) ctx.markDirty();
    }

    if (now < this.state.phaseEndsAt) return;

    if (this.state.phase === 'bet') {
      this.reveal(ctx);
      return;
    }
    if (this.state.phase === 'reveal') {
      this.state.phase = 'idle';
      this.state.phaseEndsAt = now + IDLE_MS;
      ctx.markDirty();
      return;
    }
    ctx.beginRound();
  }

  private reveal(ctx: RoomContext): void {
    const dice = this.state.dice;
    const sum = dice.reduce((a, b) => a + b, 0);
    const triple = dice[0] === dice[1] && dice[1] === dice[2];

    const entries: SettlementInput['entries'] = [];
    const results: RoundResult[] = [];

    for (const [playerId, bet] of this.state.bets) {
      let delta = 0;
      const hits: string[] = [];
      for (const [key, amount] of Object.entries(bet)) {
        if (!amount) continue;
        const area = key as Area;
        if (areaWins(area, dice, sum, triple)) {
          delta += amount * areaOdds(area);
          hits.push(`${area}+${amount * areaOdds(area)}`);
        } else {
          delta -= amount;
        }
      }
      if (delta === 0 && hits.length === 0) continue;

      const streak = delta > 0 ? (this.state.streaks.get(playerId) ?? 0) + 1 : 0;
      this.state.streaks.set(playerId, streak);

      const nickname = ctx.getPlayer(playerId)?.nickname ?? '玩家';
      results.push({ playerId, nickname, delta, detail: hits.join(' ') || '未命中' });
      // 机器人只参与展示，不写账本
      if (delta !== 0 && ctx.getPlayer(playerId)?.isBot !== true) {
        entries.push({ playerId, currency: 'coin', delta, reason: 'game.dice' });
      }
    }

    this.state.results = results;
    this.state.history = [
      ...this.state.history,
      { round: this.state.roundNo, dice: [...dice], sum, triple, big: sum >= 11 },
    ].slice(-HISTORY_LIMIT);

    this.state.phase = 'reveal';
    this.state.phaseEndsAt = Date.now() + REVEAL_MS;
    ctx.markDirty();

    ctx.settle({
      winners: results.filter((row) => row.delta > 0).map((row) => row.playerId),
      entries,
    });
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const revealed = this.state.phase !== 'bet';
    const zoneTotals: Record<string, number> = {};
    for (const bet of this.state.bets.values()) {
      for (const [key, value] of Object.entries(bet)) {
        zoneTotals[key] = (zoneTotals[key] ?? 0) + (value ?? 0);
      }
    }
    const sum = this.state.dice.reduce((a, b) => a + b, 0);
    const triple = this.state.dice[0] === this.state.dice[1] && this.state.dice[1] === this.state.dice[2];

    return {
      phase: this.state.phase,
      round: this.state.roundNo,
      remainMs: Math.max(0, this.state.phaseEndsAt - Date.now()),
      phaseDurationMs:
        this.state.phase === 'bet' ? BET_MS : this.state.phase === 'reveal' ? REVEAL_MS : IDLE_MS,
      dice: revealed ? this.state.dice : [0, 0, 0],
      sum: revealed ? sum : null,
      triple: revealed ? triple : false,
      big: revealed && !triple ? sum >= 11 : null,
      myBet: viewerId ? this.state.bets.get(viewerId) ?? {} : {},
      zoneTotals,
      myStreak: viewerId ? (this.state.streaks.get(viewerId) ?? 0) : 0,
      results: this.state.results,
      history: this.state.history,
      odds: {
        big: 1,
        small: 1,
        odd: 1,
        even: 1,
        triple: TRIPLE_ODDS,
        sums: SUM_ODDS,
      },
      limits: { min: MIN_BET, max: MAX_BET, total: MAX_TOTAL },
      players: ctx.players.map((p: PlayerContext) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        isBot: p.isBot,
      })),
    };
  }

  override getCurrentActor(): string | null {
    return null;
  }
}
