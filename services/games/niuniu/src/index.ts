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

const BET_MS = 30_000;
const REVEAL_MS = 5_000;
const IDLE_MS = 3_000;
const { minBet: MIN_BET, maxBet: MAX_BET, maxTotal: MAX_TOTAL } = BET_LIMITS;
const HISTORY_LIMIT = 30;

/** 下注区：无牛、牛1~牛9、牛牛 */
type Area = 'none' | 'niu-n' | `niu-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`;

const AREAS: Area[] = [
  'none',
  'niu-1', 'niu-2', 'niu-3', 'niu-4', 'niu-5', 'niu-6', 'niu-7', 'niu-8', 'niu-9',
  'niu-n',
];

const AREA_LABEL: Record<Area, string> = {
  none: '无牛',
  'niu-n': '牛牛',
  'niu-1': '牛一', 'niu-2': '牛二', 'niu-3': '牛三', 'niu-4': '牛四', 'niu-5': '牛五',
  'niu-6': '牛六', 'niu-7': '牛七', 'niu-8': '牛八', 'niu-9': '牛九',
};

interface RoundResult {
  playerId: string;
  nickname: string;
  delta: number;
  detail: string;
}

interface HistoryItem {
  round: number;
  cards: number[];
  /** 0 表示无牛，1-9 表示牛几，10 表示牛牛 */
  niu: number;
  label: string;
}

interface BotPlan {
  playerId: string;
  area: Area;
  amount: number;
  at: number;
  done: boolean;
}

interface State {
  phase: Phase;
  phaseEndsAt: number;
  cards: Card[];
  /** 庄家牛点：0 无牛，1-9 牛几，10 牛牛 */
  niu: number;
  bets: Map<string, Partial<Record<Area, number>>>;
  results: RoundResult[];
  history: HistoryItem[];
  roundNo: number;
  streaks: Map<string, number>;
  botPlans: BotPlan[];
  /** 真人下注的即时扣款凭证 */
  tickets: TicketBook;
}

type Phase = 'bet' | 'reveal' | 'idle';

function emptyState(): State {
  return {
    phase: 'bet',
    phaseEndsAt: 0,
    cards: [],
    niu: 0,
    bets: new Map(),
    results: [],
    history: [],
    roundNo: 0,
    streaks: new Map(),
    botPlans: [],
    tickets: new TicketBook(),
  };
}

/** 牌面值：A=1，J/Q/K 按 11/12/13 */
function pointOf(card: Card): number {
  return card.rank >= 14 ? 1 : card.rank;
}

/** 三张牌算牛：和小于 10 为无牛，否则取尾数，尾数 0 记牛牛 */
function niuOf(cards: Card[]): number {
  const sum = cards.reduce((acc, card) => acc + pointOf(card), 0);
  if (sum < 10) return 0;
  const tail = sum % 10;
  return tail === 0 ? 10 : tail;
}

function areaOf(niu: number): Area {
  if (niu === 0) return 'none';
  if (niu === 10) return 'niu-n';
  return `niu-${niu}` as Area;
}

export class NiuniuPlugin extends BaseGamePlugin {

  override readonly meta: GameMeta = {
    gameId: 'niuniu',
    name: '斗牛',
    description: '极速三张算牛，单注押牛一至牛牛，高倍奖池火爆开奖',
    icon: '🐂',
    minPlayers: 1,
    maxPlayers: 5,
    version: '1.0.0',
    clientBundle: '',
    tags: ['牌类', '常驻', '下注'],
    category: 'live',
    persistent: true,
  };

  override readonly commands = ['bet', 'clear'] as const;

  private state: State = emptyState();

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  override onRoundStart(ctx: RoomContext): void {
    this.state = {
      ...emptyState(),
      phase: 'bet',
      phaseEndsAt: Date.now() + BET_MS,
      cards: [],
      roundNo: ctx.config.round,
      // 连胜与走势跨局保留
      streaks: this.state.streaks,
      history: this.state.history,
    };
    this.planBotBets(ctx);
  }

  override async onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): Promise<void> {
    if (this.state.phase !== 'bet') throw new Error('本局已封盘，等下一局吧');

    if (intent.cmd === 'clear') {
      const area = String(intent.payload?.area ?? '');
      const dropped = this.state.tickets.peek(playerId, area || undefined);
      for (const ticket of dropped) await ctx.refund(playerId, ticket.ref);
      this.state.tickets.take(playerId, area || undefined);
      if (!area) {
        this.state.bets.delete(playerId);
      } else {
        const bet = this.state.bets.get(playerId);
        if (bet) {
          for (const ticket of dropped) {
            const left = (bet[ticket.area as Area] ?? 0) - ticket.amount;
            if (left > 0) bet[ticket.area as Area] = left;
            else delete bet[ticket.area as Area];
          }
        }
      }
      ctx.markDirty();
      return;
    }
    if (intent.cmd !== 'bet') throw new Error(`不支持的操作: ${intent.cmd}`);

    const area = String(intent.payload?.area ?? '') as Area;
    if (!AREAS.includes(area)) throw new Error('无效的下注区域');

    const amount = assertBetAmount(intent.payload?.amount);

    const before = this.state.bets.get(playerId) ?? {};
    let total = 0;
    for (const value of Object.values(before)) total += value ?? 0;
    if (total + amount > MAX_TOTAL) throw new Error(`本局总下注不能超过 ${MAX_TOTAL} 筹码`);

    const isBot = ctx.getPlayer(playerId)?.isBot === true;
    const roundBefore = this.state.roundNo;
    const ref = isBot ? '' : await ctx.charge(playerId, amount);

    // 扣款是异步的，期间可能已经封盘甚至开下一局，迟到的注必须退回
    if (this.state.roundNo !== roundBefore || this.state.phase !== 'bet') {
      if (ref) await ctx.refund(playerId, ref);
      throw new Error('本局已封盘，请等待下一局');
    }

    const current = this.state.bets.get(playerId) ?? {};
    let currentTotal = 0;
    for (const value of Object.values(current)) currentTotal += value ?? 0;
    if (currentTotal + amount > MAX_TOTAL) {
      if (ref) await ctx.refund(playerId, ref);
      throw new Error(`本局总下注不能超过 ${MAX_TOTAL} 筹码`);
    }

    current[area] = (current[area] ?? 0) + amount;
    this.state.bets.set(playerId, current);
    if (ref) this.state.tickets.add(playerId, { ref, area, amount });
    ctx.markDirty();
  }

  override onTick(ctx: RoomContext): void {
    const now = Date.now();

    if (this.state.phase === 'bet') {
      let changed = false;
      for (const plan of this.state.botPlans) {
        if (plan.done || plan.at > now) continue;
        plan.done = true;
        const bet = this.state.bets.get(plan.playerId) ?? {};
        bet[plan.area] = (bet[plan.area] ?? 0) + plan.amount;
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
    const deck = shuffleWithSeed(
      createCardDeck([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], false),
      `${ctx.config.seed}:${ctx.config.round}`,
    );
    const cards = [deck[0]!, deck[1]!, deck[2]!];
    const niu = niuOf(cards);
    const hit = areaOf(niu);

    const entries: SettlementInput['entries'] = [];
    const results: RoundResult[] = [];

    for (const [playerId, bet] of this.state.bets) {
      let delta = 0;
      const hits: string[] = [];
      for (const [key, amount] of Object.entries(bet)) {
        if (!amount) continue;
        if (key === hit) {
          delta += amount;
          hits.push(`${AREA_LABEL[key as Area]}+${amount}`);
        } else {
          delta -= amount;
        }
      }
      const staked = this.state.tickets.peek(playerId).length > 0;
      if (delta === 0 && hits.length === 0 && !staked) continue;

      const streak = delta > 0 ? (this.state.streaks.get(playerId) ?? 0) + 1 : 0;
      this.state.streaks.set(playerId, streak);

      const nickname = ctx.getPlayer(playerId)?.nickname ?? '玩家';
      results.push({ playerId, nickname, delta, detail: hits.join(' ') || '未命中' });
      if (staked && ctx.getPlayer(playerId)?.isBot !== true) {
        entries.push({ playerId, currency: 'coin', delta, reason: 'game.niuniu' });
      }
    }

    this.state.cards = cards;
    this.state.niu = niu;
    this.state.results = results;
    this.state.history = [
      ...this.state.history,
      {
        round: this.state.roundNo,
        cards: cards.map((c) => c.rank),
        niu,
        label: AREA_LABEL[hit],
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

  private planBotBets(ctx: RoomContext): void {
    const plans: BotPlan[] = [];
    const now = Date.now();
    const seats = ctx.players.filter((p) => p.isBot).slice(0, 30);
    for (const seat of seats) {
      const area = AREAS[Math.floor(Math.random() * AREAS.length)]!;
      const diff = seat.botDifficulty ?? 'medium';
      const mult =
        diff === 'high'
          ? 2 + Math.floor(Math.random() * 8)
          : diff === 'low'
            ? 1 + Math.floor(Math.random() * 25)
            : 1 + Math.floor(Math.random() * 18);
      const amount = MIN_BET * mult;
      plans.push({ playerId: seat.playerId, area, amount, at: now + 800 + Math.random() * 12_000, done: false });
    }
    this.state.botPlans = plans;
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const revealed = this.state.phase !== 'bet';
    const zoneTotals: Record<string, number> = {};
    for (const bet of this.state.bets.values()) {
      for (const [key, value] of Object.entries(bet)) {
        zoneTotals[key] = (zoneTotals[key] ?? 0) + (value ?? 0);
      }
    }
    const myBet = viewerId ? this.state.bets.get(viewerId) ?? {} : {};

    return {
      phase: this.state.phase,
      round: this.state.roundNo,
      remainMs: Math.max(0, this.state.phaseEndsAt - Date.now()),
      phaseDurationMs:
        this.state.phase === 'bet' ? BET_MS : this.state.phase === 'reveal' ? REVEAL_MS : IDLE_MS,
      cards: revealed ? this.state.cards.map((c) => ({ id: c.id, rank: c.rank, suit: c.suit })) : [],
      niu: revealed ? this.state.niu : null,
      label: revealed ? AREA_LABEL[areaOf(this.state.niu)] : '',
      myBet,
      zoneTotals,
      myStreak: viewerId ? (this.state.streaks.get(viewerId) ?? 0) : 0,
      results: this.state.results,
      history: this.state.history,
      limits: { min: MIN_BET, max: MAX_BET, total: MAX_TOTAL },
      areas: AREAS.map((area) => ({ area, label: AREA_LABEL[area] })),
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
    return null;
  }
}

export default NiuniuPlugin;
