import type { GameMeta, GameSnapshot } from '@cc/protocol';
import type { GameIntent, PlayerContext, RoomContext, SettlementInput } from '@cc/game-sdk';
import {
  BET_LIMITS,
  BaseGamePlugin,
  TicketBook,
  assertBetAmount,
  createCardDeck,
  shuffleWithSeed,
  type Card,
} from '@cc/game-sdk';

/**
 * 推筒子（平台庄家版）
 * - 平台坐庄，玩家只能在「天 / 地 / 人」三门下注，猜哪门比庄家大，赔率 1:1
 * - 常驻运行：不依赖人数，每 38 秒一局（30 秒下注 + 5 秒开牌 + 3 秒间隔）
 * - 每局给三门与庄家各发两张筒子牌，点数取个位
 */

const DOORS = ['heaven', 'earth', 'human'] as const;
type DoorKey = (typeof DOORS)[number];

const DOOR_LABEL: Record<DoorKey, string> = {
  heaven: '天',
  earth: '地',
  human: '人',
};

const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const BET_MS = 30_000;
const REVEAL_MS = 5_000;
const IDLE_MS = 3_000;

const { minBet: MIN_BET, maxBet: MAX_BET, maxTotal: MAX_TOTAL } = BET_LIMITS;
const HISTORY_LIMIT = 30;

type Phase = 'bet' | 'reveal' | 'idle';

interface DoorHand {
  cards: Card[];
  points: number;
}

interface PlayerBet {
  heaven: number;
  earth: number;
  human: number;
}

interface RoundResult {
  playerId: string;
  nickname: string;
  delta: number;
  detail: string;
}

interface HistoryItem {
  round: number;
  banker: number;
  heaven: number;
  earth: number;
  human: number;
  winningDoors: DoorKey[];
}

interface State {
  phase: Phase;
  phaseEndsAt: number;
  doors: Record<DoorKey, DoorHand>;
  banker: DoorHand;
  bets: Map<string, PlayerBet>;
  results: RoundResult[];
  history: HistoryItem[];
  roundNo: number;
  /** 连续命中次数，用于牌桌内的手感反馈 */
  streaks: Map<string, number>;
  /** 机器人按时间陆续下注的计划 */
  botPlans: BotPlan[];
  /** 真人下注的即时扣款凭证 */
  tickets: TicketBook;
}

interface BotPlan {
  playerId: string;
  door: DoorKey;
  amount: number;
  at: number;
  done: boolean;
}

function emptyHand(): DoorHand {
  return { cards: [], points: 0 };
}

function emptyState(): State {
  return {
    phase: 'bet',
    phaseEndsAt: 0,
    doors: { heaven: emptyHand(), earth: emptyHand(), human: emptyHand() },
    banker: emptyHand(),
    bets: new Map(),
    results: [],
    history: [],
    roundNo: 0,
    streaks: new Map(),
    botPlans: [],
    tickets: new TicketBook(),
  };
}

function pointsOf(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + card.rank, 0) % 10;
}

export class TuizhuanziPlugin extends BaseGamePlugin {
  override readonly commands = ['bet', 'clear'] as const;

  override readonly meta: GameMeta = {
    gameId: 'tuizhuanzi',
    name: '推筒子',
    description: '押天地人三门，比庄家点数大即赢，赔率 1:1',
    version: '2.0.0',
    clientBundle: '',
    minPlayers: 1,
    maxPlayers: 5,
    tags: ['牌九', '常驻', '下注'],
    category: 'live',
    persistent: true,
    icon: '🀄',
  };

  private state: State = emptyState();

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  override onRoundStart(ctx: RoomContext): void {
    const deck = shuffleWithSeed(createCardDeck(RANKS, false), `${ctx.config.seed}`);
    let cursor = 0;
    const takeHand = (): DoorHand => {
      const cards = [deck[cursor]!, deck[cursor + 1]!];
      cursor += 2;
      return { cards, points: pointsOf(cards) };
    };

    this.state.doors = { heaven: takeHand(), earth: takeHand(), human: takeHand() };
    this.state.banker = takeHand();
    this.state.bets = new Map();
    this.state.results = [];
    this.state.tickets = new TicketBook();
    // streaks 与 history 跨局保留
    this.state.phase = 'bet';
    this.state.phaseEndsAt = Date.now() + BET_MS;
    this.state.roundNo = ctx.config.round;
    this.planBotBets(ctx);
  }

  /** 机器人下注计划：按难度区分稳健分散注码与激进随机注码 */
  private planBotBets(ctx: RoomContext): void {
    const now = Date.now();
    const doors: DoorKey[] = ['heaven', 'earth', 'human'];
    const plans: BotPlan[] = [];

    for (const bot of ctx.players) {
      if (!bot.isBot) continue;
      if (Math.random() > 0.62) continue;
      const diff = bot.botDifficulty ?? 'medium';
      const count = diff === 'high' ? 2 : Math.random() < 0.28 ? 2 : 1;
      const amounts = diff === 'high' ? [20, 50, 100] : diff === 'low' ? [10, 100, 500] : [10, 20, 50, 100, 200];
      for (let i = 0; i < count; i += 1) {
        plans.push({
          playerId: bot.playerId,
          door: doors[Math.floor(Math.random() * doors.length)]!,
          amount: amounts[Math.floor(Math.random() * amounts.length)]!,
          // 开局 0.6 秒后开始，到倒数 4 秒结束
          at: now + 600 + Math.random() * (BET_MS - 4600),
          done: false,
        });
      }
    }
    this.state.botPlans = plans;
  }

  override async onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): Promise<void> {
    if (this.state.phase !== 'bet') throw new Error('本局已停止下注，等下一局吧');

    // 撤注：先按凭证逐笔退款，全部成功后才改注单
    if (intent.cmd === 'clear') {
      const raw = String(intent.payload?.area ?? '');
      const area = DOORS.includes(raw as DoorKey) ? raw : '';
      const dropped = this.state.tickets.peek(playerId, area || undefined);
      for (const ticket of dropped) await ctx.refund(playerId, ticket.ref);
      this.state.tickets.take(playerId, area || undefined);
      if (!area) {
        this.state.bets.delete(playerId);
      } else {
        const bet = this.state.bets.get(playerId);
        if (bet) {
          for (const ticket of dropped) bet[ticket.area as DoorKey] -= ticket.amount;
          if (bet[area as DoorKey] < 0) bet[area as DoorKey] = 0;
        }
      }
      ctx.markDirty();
      return;
    }
    if (intent.cmd !== 'bet') throw new Error(`不支持的操作: ${intent.cmd}`);

    const area = String(intent.payload?.area ?? '');
    if (!DOORS.includes(area as DoorKey)) throw new Error('只能押天、地、人三门');

    const amount = assertBetAmount(intent.payload?.amount);

    const before = this.state.bets.get(playerId) ?? { heaven: 0, earth: 0, human: 0 };
    if (before.heaven + before.earth + before.human + amount > MAX_TOTAL) {
      throw new Error(`本局总下注不能超过 ${MAX_TOTAL} 筹码`);
    }

    const isBot = ctx.getPlayer(playerId)?.isBot === true;
    const roundBefore = this.state.roundNo;
    const ref = isBot ? '' : await ctx.charge(playerId, amount);

    // 扣款是异步的，期间可能已经封盘甚至开下一局，迟到的注必须退回
    if (this.state.roundNo !== roundBefore || this.state.phase !== 'bet') {
      if (ref) await ctx.refund(playerId, ref);
      throw new Error('本局已封盘，请等待下一局');
    }

    const current = this.state.bets.get(playerId) ?? { heaven: 0, earth: 0, human: 0 };
    if (current.heaven + current.earth + current.human + amount > MAX_TOTAL) {
      if (ref) await ctx.refund(playerId, ref);
      throw new Error(`本局总下注不能超过 ${MAX_TOTAL} 筹码`);
    }
    current[area as DoorKey] += amount;
    this.state.bets.set(playerId, current);
    if (ref) this.state.tickets.add(playerId, { ref, area, amount });
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
        const bet = this.state.bets.get(plan.playerId) ?? { heaven: 0, earth: 0, human: 0 };
        bet[plan.door] += plan.amount;
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
    // idle 结束，开下一局
    ctx.beginRound();
  }

  private reveal(ctx: RoomContext): void {
    const bankerPoints = this.state.banker.points;
    const winningDoors = DOORS.filter((door) => this.state.doors[door].points > bankerPoints);

    const entries: SettlementInput['entries'] = [];
    const results: RoundResult[] = [];

    for (const [playerId, bet] of this.state.bets) {
      let delta = 0;
      const hits: string[] = [];
      for (const door of DOORS) {
        const amount = bet[door];
        if (amount <= 0) continue;
        const doorPoints = this.state.doors[door].points;
        if (doorPoints > bankerPoints) {
          delta += amount;
          hits.push(`${DOOR_LABEL[door]}+${amount}`);
        } else if (doorPoints < bankerPoints) {
          delta -= amount;
        }
        // 点数相同视为和局，该门不输不赢
      }
      // 和局时净盈亏为 0，但有即时扣款凭证的真人必须入账，否则本金退不回来
      const staked = this.state.tickets.peek(playerId).length > 0;
      if (delta === 0 && hits.length === 0 && !staked) continue;

      const streak = delta > 0 ? (this.state.streaks.get(playerId) ?? 0) + 1 : 0;
      this.state.streaks.set(playerId, streak);

      const nickname = ctx.getPlayer(playerId)?.nickname ?? '玩家';
      results.push({ playerId, nickname, delta, detail: hits.join(' ') || '未命中' });
      // 机器人只参与展示，不写账本
      if (staked && ctx.getPlayer(playerId)?.isBot !== true) {
        entries.push({
          playerId,
          currency: 'coin',
          delta,
          reason: 'game.tuizhuanzi',
        });
      }
    }

    this.state.results = results;
    this.state.history = [
      ...this.state.history,
      {
        round: this.state.roundNo,
        banker: bankerPoints,
        heaven: this.state.doors.heaven.points,
        earth: this.state.doors.earth.points,
        human: this.state.doors.human.points,
        winningDoors,
      },
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
    const now = Date.now();
    const revealed = this.state.phase !== 'bet';
    const remainMs = Math.max(0, this.state.phaseEndsAt - now);

    const doorView = (door: DoorKey) => ({
      label: DOOR_LABEL[door],
      points: revealed ? this.state.doors[door].points : null,
      cards: revealed ? this.state.doors[door].cards.map((c) => ({ id: c.id, rank: c.rank })) : [],
    });

    const myBet = viewerId ? this.state.bets.get(viewerId) ?? null : null;

    // 各门累计下注（含场内机器人），用于展示「别人也在下注」
    const doorTotals: Record<DoorKey, number> = { heaven: 0, earth: 0, human: 0 };
    for (const bet of this.state.bets.values()) {
      for (const door of DOORS) doorTotals[door] += bet[door];
    }

    return {
      phase: this.state.phase,
      round: this.state.roundNo,
      remainMs,
      phaseDurationMs:
        this.state.phase === 'bet' ? BET_MS : this.state.phase === 'reveal' ? REVEAL_MS : IDLE_MS,
      betEndsAt: this.state.phase === 'bet' ? this.state.phaseEndsAt : 0,
      banker: {
        points: revealed ? this.state.banker.points : null,
        cards: revealed ? this.state.banker.cards.map((c) => ({ id: c.id, rank: c.rank })) : [],
      },
      doors: {
        heaven: doorView('heaven'),
        earth: doorView('earth'),
        human: doorView('human'),
      },
      myBet: myBet ?? { heaven: 0, earth: 0, human: 0 },
      doorTotals,
      myStreak: viewerId ? (this.state.streaks.get(viewerId) ?? 0) : 0,
      results: this.state.results,
      history: this.state.history,
      limits: { min: MIN_BET, max: MAX_BET, total: MAX_TOTAL },
      // 机器人明细不下发，减少快照体积
      players: ctx.players
        .filter((p: PlayerContext) => !p.isBot)
        .map((p: PlayerContext) => ({
          playerId: p.playerId,
          nickname: p.nickname,
          isBot: p.isBot,
        })),
    };
  }

  override getCurrentActor(): string | null {
    // 下注制没有回合，由时间轴驱动
    return null;
  }
}
