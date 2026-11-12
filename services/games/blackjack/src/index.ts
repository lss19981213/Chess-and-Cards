import type { BotDifficulty, GameMeta, GameSnapshot } from '@cc/protocol';
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

const BET_MS = 25_000;
const PLAY_MS = 20_000;
const REVEAL_MS = 5_000;
const IDLE_MS = 3_000;
const { minBet: MIN_BET, maxBet: MAX_BET, maxTotal: MAX_TOTAL } = BET_LIMITS;
const HISTORY_LIMIT = 30;
/** 单手最多补几张牌 */
const MAX_HITS = 5;

type Phase = 'bet' | 'play' | 'reveal' | 'idle';
/** 下注区：赢、输、和、21 点 */
type Area = 'win' | 'lose' | 'tie' | 'bj';

const AREAS: Area[] = ['win', 'lose', 'tie', 'bj'];
const AREA_LABEL: Record<Area, string> = { win: '赢', lose: '输', tie: '和', bj: '21点' };
/** 各区净赔倍数 */
const AREA_ODDS: Record<Area, number> = { win: 1, lose: 1, tie: 8, bj: 2 };

interface Hand {
  cards: Card[];
  /** 玩家已停牌或爆牌 */
  done: boolean;
}

interface RoundResult {
  playerId: string;
  nickname: string;
  delta: number;
  detail: string;
}

interface HistoryItem {
  round: number;
  /** 每位玩家各自的最终点数（各人牌不同） */
  points: Record<string, number>;
  dealerPoints: number;
  outcome: string;
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
  dealer: Card[];
  hands: Map<string, Hand>;
  bets: Map<string, Partial<Record<Area, number>>>;
  results: RoundResult[];
  history: HistoryItem[];
  roundNo: number;
  streaks: Map<string, number>;
  botPlans: BotPlan[];
  tickets: TicketBook;
}

function emptyState(): State {
  return {
    phase: 'bet',
    phaseEndsAt: 0,
    dealer: [],
    hands: new Map(),
    bets: new Map(),
    results: [],
    history: [],
    roundNo: 0,
    streaks: new Map(),
    botPlans: [],
    tickets: new TicketBook(),
  };
}

/** 牌面值：A 可当 1 或 11 */
function pointsOf(cards: Card[]): number {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 14) {
      aces += 1;
      total += 11;
    } else if (card.rank >= 11) {
      total += 10;
    } else {
      total += card.rank;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function shouldBotHit(cards: Card[], dealerUpcard: Card | undefined, difficulty: BotDifficulty): boolean {
  const pts = pointsOf(cards);
  if (pts >= 21) return false;

  if (difficulty === 'low') {
    if (pts <= 14) return true;
    if (pts <= 17) return Math.random() < 0.35;
    return false;
  }

  if (difficulty === 'medium') {
    return pts < 17;
  }

  // 高难度：21点基础策略（Basic Strategy），区分软牌与硬牌并结合庄家明牌
  let hardSum = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.rank === 14) {
      aces += 1;
      hardSum += 1;
    } else {
      hardSum += Math.min(10, card.rank);
    }
  }
  const isSoft = aces > 0 && hardSum + 10 <= 21;
  const total = isSoft ? hardSum + 10 : hardSum;
  const up = dealerUpcard ? (dealerUpcard.rank === 14 ? 11 : Math.min(10, dealerUpcard.rank)) : 10;

  if (isSoft) {
    if (total >= 19) return false;
    if (total === 18) return up >= 9;
    return true;
  }
  if (total <= 11) return true;
  if (total === 12) return up < 4 || up > 6;
  if (total >= 13 && total <= 16) return up >= 7;
  return false;
}

/** 每个玩家一副独立的牌，牌堆由房间种子与玩家派生，互不干扰 */
function handDeck(seed: string, playerId: string): Card[] {
  return shuffleWithSeed(createCardDeck([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], false), `${seed}:${playerId}`);
}

export class BlackjackPlugin extends BaseGamePlugin {

  override readonly meta: GameMeta = {
    gameId: 'blackjack',
    name: '21点',
    description: '两张牌起手，凑到 21 点赢庄家',
    icon: '🃏',
    minPlayers: 1,
    maxPlayers: 5,
    version: '1.0.0',
    clientBundle: '',
    tags: ['牌类', '常驻', '下注'],
    category: 'live',
    persistent: true,
  };

  override readonly commands = ['bet', 'clear', 'hit', 'stand'] as const;

  private state: State = emptyState();

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  override onRoundStart(ctx: RoomContext): void {
    this.state = {
      ...emptyState(),
      phase: 'bet',
      phaseEndsAt: Date.now() + BET_MS,
      roundNo: ctx.config.round,
      streaks: this.state.streaks,
      history: this.state.history,
    };
    this.planBotBets(ctx);
  }

  override async onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): Promise<void> {
    if (intent.cmd === 'bet' || intent.cmd === 'clear') {
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
      return;
    }

    if (intent.cmd === 'hit' || intent.cmd === 'stand') {
      if (this.state.phase !== 'play') throw new Error('现在不能要牌');
      const hand = this.state.hands.get(playerId);
      if (!hand) throw new Error('你还没有参与本局');
      if (hand.done) throw new Error('本轮已经停牌了');
      if (intent.cmd === 'stand') {
        hand.done = true;
        ctx.markDirty();
        return;
      }
      if (hand.cards.length >= 2 + MAX_HITS) throw new Error('最多只能补 5 张牌');
      const deck = handDeck(`${ctx.config.seed}:${ctx.config.round}`, playerId);
      const card = deck[hand.cards.length];
      if (!card) throw new Error('牌不够了');
      hand.cards.push(card);
      if (pointsOf(hand.cards) > 21) hand.done = true;
      ctx.markDirty();
      return;
    }

    throw new Error(`不支持的操作: ${intent.cmd}`);
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

    // 机器人手牌：按低/中/高难度执行不同要牌策略（高难度遵循 Basic Strategy）
    if (this.state.phase === 'play') {
      let changed = false;
      const dealerUpcard = this.state.dealer[0];
      for (const [playerId, hand] of this.state.hands) {
        if (hand.done) continue;
        const player = ctx.getPlayer(playerId);
        if (player?.isBot !== true) continue;
        const diff = player.botDifficulty ?? 'medium';
        if (shouldBotHit(hand.cards, dealerUpcard, diff) && hand.cards.length < 2 + MAX_HITS) {
          const deck = handDeck(`${ctx.config.seed}:${ctx.config.round}`, playerId);
          const card = deck[hand.cards.length];
          if (card) {
            hand.cards.push(card);
            if (pointsOf(hand.cards) > 21) hand.done = true;
            changed = true;
          } else {
            hand.done = true;
            changed = true;
          }
        } else {
          hand.done = true;
          changed = true;
        }
      }
      if (changed) ctx.markDirty();

      // 所有真人手牌都已停牌或爆牌时不必干等计时器，直接开结
      const pendingHuman = [...this.state.hands.entries()].some(
        ([pid, hand]) => !hand.done && ctx.getPlayer(pid)?.isBot !== true,
      );
      if (!pendingHuman) {
        this.settle(ctx);
        return;
      }
    }

    if (now < this.state.phaseEndsAt) return;

    if (this.state.phase === 'bet') {
      this.deal(ctx);
      return;
    }
    if (this.state.phase === 'play') {
      this.settle(ctx);
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

  /** 发牌：庄家一张明牌，每位有注单的真人两张底牌 */
  private deal(ctx: RoomContext): void {
    const seed = `${ctx.config.seed}:${ctx.config.round}`;
    const dealerDeck = shuffleWithSeed(
      createCardDeck([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], false),
      `${seed}:dealer`,
    );
    this.state.dealer = [dealerDeck[0]!, dealerDeck[1]!];

    const hands = new Map<string, Hand>();
    for (const [playerId, bet] of this.state.bets) {
      let staked = 0;
      for (const value of Object.values(bet)) staked += value ?? 0;
      if (staked <= 0) continue;
      const deck = handDeck(seed, playerId);
      hands.set(playerId, { cards: [deck[0]!, deck[1]!], done: false });
    }
    this.state.hands = hands;
    this.state.phase = 'play';
    this.state.phaseEndsAt = Date.now() + PLAY_MS;
    ctx.markDirty();
  }

  /** 庄家补牌并结算 */
  private settle(ctx: RoomContext): void {
    const dealer = this.state.dealer;
    let dealerCards = [...dealer];
    while (pointsOf(dealerCards) < 17 && dealerCards.length < 6) {
      const deck = shuffleWithSeed(
        createCardDeck([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], false),
        `${ctx.config.seed}:${ctx.config.round}:dealer:${dealerCards.length}`,
      );
      dealerCards.push(deck[0]!);
    }
    const dealerPoints = pointsOf(dealerCards);

    const entries: SettlementInput['entries'] = [];
    const results: RoundResult[] = [];

    for (const [playerId, bet] of this.state.bets) {
      const hand = this.state.hands.get(playerId);
      if (!hand) continue;
      const playerPoints = pointsOf(hand.cards);
      const playerBust = playerPoints > 21;
      const dealerBust = dealerPoints > 21;
      const isBlackjack = playerPoints === 21;

      let outcome: 'win' | 'lose' | 'tie' = 'lose';
      if (playerBust) outcome = 'lose';
      else if (dealerBust) outcome = 'win';
      else if (playerPoints === dealerPoints) outcome = 'tie';
      else if (playerPoints > dealerPoints) outcome = 'win';

      let delta = 0;
      const hits: string[] = [];
      for (const [key, amount] of Object.entries(bet)) {
        if (!amount) continue;
        const area = key as Area;
        const won =
          (area === 'win' && outcome === 'win') ||
          (area === 'lose' && outcome === 'lose') ||
          (area === 'tie' && outcome === 'tie') ||
          (area === 'bj' && isBlackjack);
        if (won) {
          delta += amount * AREA_ODDS[area];
          hits.push(`${AREA_LABEL[area]}+${amount * AREA_ODDS[area]}`);
        } else {
          delta -= amount;
        }
      }

      const staked = this.state.tickets.peek(playerId).length > 0;
      if (delta === 0 && hits.length === 0 && !staked) continue;

      const streak = delta > 0 ? (this.state.streaks.get(playerId) ?? 0) + 1 : 0;
      this.state.streaks.set(playerId, streak);

      const nickname = ctx.getPlayer(playerId)?.nickname ?? '玩家';
      const detail = hits.join(' ') || (playerBust ? '爆牌' : outcome === 'tie' ? '和局' : '未命中');
      results.push({ playerId, nickname, delta, detail });
      if (staked && ctx.getPlayer(playerId)?.isBot !== true) {
        entries.push({ playerId, currency: 'coin', delta, reason: 'game.blackjack' });
      }
    }

    this.state.dealer = dealerCards;
    this.state.results = results;
    const points: Record<string, number> = {};
    for (const [pid, hand] of this.state.hands) points[pid] = pointsOf(hand.cards);
    this.state.history = [
      ...this.state.history,
      {
        round: this.state.roundNo,
        points,
        dealerPoints,
        outcome: dealerPoints > 21 ? '庄爆' : dealerPoints === 21 ? '庄21' : `庄${dealerPoints}`,
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
      const diff = seat.botDifficulty ?? 'medium';
      const r = Math.random();
      let area: Area;
      let amount: number;
      if (diff === 'low') {
        area = AREAS[Math.floor(Math.random() * AREAS.length)]!;
        amount = MIN_BET * (1 + Math.floor(Math.random() * 25));
      } else if (diff === 'high') {
        area = r < 0.58 ? 'win' : r < 0.9 ? 'lose' : 'bj';
        amount = MIN_BET * (2 + Math.floor(Math.random() * 8));
      } else {
        area = r < 0.42 ? 'win' : r < 0.78 ? 'lose' : r < 0.9 ? 'bj' : 'tie';
        amount = MIN_BET * (1 + Math.floor(Math.random() * 15));
      }
      plans.push({ playerId: seat.playerId, area, amount, at: now + 800 + Math.random() * 12_000, done: false });
    }
    this.state.botPlans = plans;
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const revealed = this.state.phase === 'reveal' || this.state.phase === 'idle';
    const dealerVisible = this.state.phase !== 'bet';
    const myHand = viewerId ? this.state.hands.get(viewerId) : undefined;
    const myPoints = myHand ? pointsOf(myHand.cards) : null;

    const others = [...this.state.hands.entries()]
      .filter(([playerId]) => playerId !== viewerId)
      .map(([playerId, hand]) => ({ playerId, count: hand.cards.length, done: hand.done }));

    return {
      phase: this.state.phase,
      round: this.state.roundNo,
      remainMs: Math.max(0, this.state.phaseEndsAt - Date.now()),
      phaseDurationMs:
        this.state.phase === 'bet'
          ? BET_MS
          : this.state.phase === 'play'
            ? PLAY_MS
            : this.state.phase === 'reveal'
              ? REVEAL_MS
              : IDLE_MS,
      dealerCards: dealerVisible
        ? this.state.dealer.map((c, i) => (revealed || i === 0 ? { id: c.id, rank: c.rank, suit: c.suit } : null))
        : [],
      dealerPoints: revealed ? pointsOf(this.state.dealer) : null,
      myCards: myHand ? myHand.cards.map((c) => ({ id: c.id, rank: c.rank, suit: c.suit })) : [],
      myPoints,
      myDone: myHand?.done ?? false,
      others,
      myBet: viewerId ? this.state.bets.get(viewerId) ?? {} : {},
      zoneTotals: this.zoneTotals(),
      results: this.state.results,
      history: this.state.history.map((item) => ({
        round: item.round,
        playerPoints: viewerId ? item.points[viewerId] ?? null : null,
        dealerPoints: item.dealerPoints,
        outcome: item.outcome,
      })),
      limits: { min: MIN_BET, max: MAX_BET, total: MAX_TOTAL },
      areas: AREAS.map((area) => ({ area, label: AREA_LABEL[area], odds: AREA_ODDS[area] })),
      players: ctx.players
        .filter((p: PlayerContext) => !p.isBot)
        .map((p: PlayerContext) => ({ playerId: p.playerId, nickname: p.nickname })),
    };
  }

  private zoneTotals(): Record<string, number> {
    const totals: Record<string, number> = {};
    for (const bet of this.state.bets.values()) {
      for (const [key, value] of Object.entries(bet)) {
        totals[key] = (totals[key] ?? 0) + (value ?? 0);
      }
    }
    return totals;
  }

  override getCurrentActor(): string | null {
    return null;
  }
}

export default BlackjackPlugin;
