import type { BotDifficulty, GameMeta, GameSnapshot } from '@cc/protocol';
import type { GameIntent, RoomContext } from '@cc/game-sdk';
import {
  BaseGamePlugin,
  compareHandRank,
  createCardDeck,
  decidePokerBotAction,
  evaluateBestHand,
  shuffleWithSeed,
  type BestHand,
  type Card,
} from '@cc/game-sdk';

const ANTE = 50;
const RAISE_UNIT = 100;
const MAX_RAISES = 10;
const MAX_RAISE_ADD = Number.MAX_SAFE_INTEGER;

interface ResultRow {
  playerId: string;
  nickname: string;
  delta: number;
  handLabel: string;
  cards: Card[];
  folded: boolean;
}

interface State {
  deck: Card[];
  deckCursor: number;
  street: 1 | 2 | 3 | 4; // 1: 2张(1底1明), 2: 3张, 3: 4张, 4: 5张决战
  hands: Map<string, Card[]>;
  totalBet: Map<string, number>;
  roundBet: Map<string, number>;
  folded: Set<string>;
  acted: Set<string>;
  allIn: Set<string>;
  raises: Map<string, number>;
  currentBet: number;
  turn: string | null;
  dealerIndex: number;
  settled: boolean;
  results: ResultRow[];
  charged: Set<string>;
}

function emptyState(): State {
  return {
    deck: [],
    deckCursor: 0,
    street: 1,
    hands: new Map(),
    totalBet: new Map(),
    roundBet: new Map(),
    folded: new Set(),
    acted: new Set(),
    allIn: new Set(),
    raises: new Map(),
    currentBet: 0,
    turn: null,
    dealerIndex: 0,
    settled: false,
    results: [],
    charged: new Set(),
  };
}

/** 港式五张经典28张牌：8, 9, 10, J, Q, K, A 四门 */
function buildStudDeck(): Card[] {
  return createCardDeck([8, 9, 10, 11, 12, 13, 14], false);
}

const SUIT_WEIGHT: Record<string, number> = { S: 4, H: 3, C: 2, D: 1 };

function compareCards(a: Card, b: Card): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return (SUIT_WEIGHT[a.suit] ?? 0) - (SUIT_WEIGHT[b.suit] ?? 0);
}

export class StudPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta = {
    gameId: 'stud',
    name: '梭哈',
    description: '港式五张经典对决，分轮发牌，暗牌偷鸡，一键梭哈',
    icon: '🎴',
    minPlayers: 2,
    maxPlayers: 6,
    version: '1.0.0',
    clientBundle: '',
    tags: ['牌类', '多人', '竞技', '梭哈'],
    category: 'table',
  };

  override readonly commands = ['fold', 'check', 'call', 'raise', 'allin'] as const;

  private state: State = emptyState();

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  override onRoundStart(ctx: RoomContext): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    if (players.length < 2) return;

    this.state = emptyState();
    this.state.dealerIndex = (ctx.config.round - 1) % players.length;
    this.state.deck = shuffleWithSeed(buildStudDeck(), ctx.config.seed);
    this.state.street = 1;

    let cursor = 0;
    // 第1轮发2张牌：第1张底牌(暗)，第2张明牌
    for (const player of players) {
      const cards: Card[] = [this.state.deck[cursor++]!, this.state.deck[cursor++]!];
      this.state.hands.set(player.playerId, cards);
      this.state.totalBet.set(player.playerId, ANTE);
      this.state.roundBet.set(player.playerId, ANTE);
      this.state.raises.set(player.playerId, 0);
    }
    this.state.deckCursor = cursor;
    this.state.currentBet = ANTE;

    // 明牌(第2张牌)最大者首位行动
    this.state.turn = this.findLeadPlayer(ctx);
    ctx.markDirty();
  }

  private findLeadPlayer(ctx: RoomContext): string {
    const alive = this.aliveIds(ctx);
    let bestPlayer = alive[0]!;
    let bestScore = -1;

    for (const id of alive) {
      const hand = this.state.hands.get(id) ?? [];
      const upcards = hand.slice(1);
      if (upcards.length === 0) continue;
      // 评估可见明牌组合
      const evalResult = upcards.length >= 5 ? evaluateBestHand(upcards) : null;
      let score = 0;
      if (evalResult) {
        score = evalResult.category * 1000 + (evalResult.values[0] ?? 0);
      } else {
        const topCard = [...upcards].sort(compareCards).reverse()[0];
        if (topCard) score = topCard.rank * 10 + (SUIT_WEIGHT[topCard.suit] ?? 0);
      }
      if (score > bestScore) {
        bestScore = score;
        bestPlayer = id;
      }
    }
    return bestPlayer;
  }

  override async onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): Promise<void> {
    if (this.state.settled) throw new Error('本局已结束');
    if (this.state.folded.has(playerId)) throw new Error('你已弃牌');
    if (this.state.turn !== playerId) throw new Error('还没轮到你行动');

    const toCall = Math.max(0, this.state.currentBet - (this.state.roundBet.get(playerId) ?? 0));
    const isBot = ctx.getPlayer(playerId)?.isBot === true;
    const pay = async (amount: number): Promise<void> => {
      if (isBot || amount <= 0) return;
      await ctx.charge(playerId, amount);
      this.state.charged.add(playerId);
    };

    switch (intent.cmd) {
      case 'fold':
        this.state.folded.add(playerId);
        this.state.acted.add(playerId);
        break;
      case 'check':
        if (toCall > 0) throw new Error(`需要跟注 ${toCall} 才能过牌`);
        this.state.acted.add(playerId);
        break;
      case 'call': {
        if (toCall <= 0) throw new Error('当前无需跟注');
        await pay(toCall);
        this.commit(playerId, toCall);
        this.state.acted.add(playerId);
        break;
      }
      case 'raise': {
        const used = this.state.raises.get(playerId) ?? 0;
        if (used >= MAX_RAISES) throw new Error('本局加注次数已达上限');
        const rawAdd = intent.payload?.amount;
        let add = RAISE_UNIT;
        if (rawAdd !== undefined && rawAdd !== null) {
          add = Number(rawAdd);
          if (!Number.isInteger(add) || add < RAISE_UNIT) throw new Error(`加注至少 ${RAISE_UNIT}`);
        }
        const target = this.state.currentBet + add;
        const delta = target - (this.state.roundBet.get(playerId) ?? 0);
        if (delta <= 0) throw new Error('加注金额不合法');
        await pay(delta);
        this.commit(playerId, delta);
        this.state.currentBet = target;
        this.state.raises.set(playerId, used + 1);
        this.state.acted.clear();
        this.state.acted.add(playerId);
        break;
      }
      case 'allin': {
        // 梭哈！推入大注
        const allInAdd = Math.max(500, RAISE_UNIT * 5);
        const target = this.state.currentBet + allInAdd;
        const delta = target - (this.state.roundBet.get(playerId) ?? 0);
        await pay(delta);
        this.commit(playerId, delta);
        this.state.currentBet = target;
        this.state.allIn.add(playerId);
        this.state.acted.clear();
        this.state.acted.add(playerId);
        break;
      }
      default:
        throw new Error(`未知操作: ${intent.cmd}`);
    }

    this.afterAction(ctx, playerId);
  }

  override onPlayerLeave(ctx: RoomContext, playerId: string): void {
    if (this.state.settled) return;
    if (this.state.folded.has(playerId)) return;
    this.state.folded.add(playerId);
    this.state.acted.add(playerId);
    if (this.state.turn === playerId) this.afterAction(ctx, playerId);
  }

  private commit(playerId: string, amount: number): void {
    this.state.totalBet.set(playerId, (this.state.totalBet.get(playerId) ?? 0) + amount);
    this.state.roundBet.set(playerId, (this.state.roundBet.get(playerId) ?? 0) + amount);
  }

  private aliveIds(ctx: RoomContext): string[] {
    return [...ctx.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.playerId)
      .filter((id) => !this.state.folded.has(id));
  }

  private nextAlive(ctx: RoomContext, fromIndex: number): string | null {
    const order = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.playerId);
    for (let step = 1; step <= order.length; step += 1) {
      const id = order[(fromIndex + step) % order.length]!;
      if (!this.state.folded.has(id)) return id;
    }
    return null;
  }

  private afterAction(ctx: RoomContext, playerId: string): void {
    const alive = this.aliveIds(ctx);
    if (alive.length <= 1) {
      this.settleShowdown(ctx);
      return;
    }

    // 检查本轮是否所有活人均已行动且下注平齐
    const allActed = alive.every((id) => this.state.acted.has(id));
    const matched = alive.every((id) => (this.state.roundBet.get(id) ?? 0) === this.state.currentBet);

    if (allActed && matched) {
      // 本轮下注结束，判断是否继续发下一张明牌
      if (this.state.street < 4) {
        this.advanceToNextStreet(ctx);
        return;
      } else {
        // 第4轮(共5张)下注结束，开牌比胜负
        this.settleShowdown(ctx);
        return;
      }
    }

    const order = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.playerId);
    this.state.turn = this.nextAlive(ctx, Math.max(0, order.indexOf(playerId)));
    ctx.markDirty();
  }

  private advanceToNextStreet(ctx: RoomContext): void {
    this.state.street = (this.state.street + 1) as 1 | 2 | 3 | 4;
    const alive = this.aliveIds(ctx);

    // 为存活玩家各发 1 张明牌
    let cursor = this.state.deckCursor;
    for (const id of alive) {
      const hand = this.state.hands.get(id) ?? [];
      if (cursor < this.state.deck.length) {
        hand.push(this.state.deck[cursor++]!);
      }
      this.state.hands.set(id, hand);
    }
    this.state.deckCursor = cursor;

    // 重置本轮注额
    this.state.roundBet.clear();
    this.state.acted.clear();
    this.state.currentBet = 0;

    // 明牌最大者先行
    this.state.turn = this.findLeadPlayer(ctx);
    ctx.markDirty();
  }

  private settleShowdown(ctx: RoomContext): void {
    this.state.settled = true;
    this.state.turn = null;

    const pot = [...this.state.totalBet.values()].reduce((sum, value) => sum + value, 0);
    const alive = this.aliveIds(ctx);
    let bestHand: BestHand | null = null;
    const winners: string[] = [];

    for (const id of alive) {
      const hand = this.state.hands.get(id) ?? [];
      const ev = evaluateBestHand(hand);
      if (!bestHand || compareHandRank(ev, bestHand) > 0) {
        bestHand = ev;
        winners.length = 0;
        winners.push(id);
      } else if (compareHandRank(ev, bestHand) === 0) {
        winners.push(id);
      }
    }

    const share = winners.length > 0 ? Math.floor(pot / winners.length) : 0;
    const results: ResultRow[] = [...ctx.players].map((p) => {
      const hand = this.state.hands.get(p.playerId) ?? [];
      const ev = evaluateBestHand(hand);
      const bet = this.state.totalBet.get(p.playerId) ?? 0;
      const isWinner = winners.includes(p.playerId);
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        delta: (isWinner ? share : 0) - bet,
        handLabel: ev.label,
        cards: hand,
        folded: this.state.folded.has(p.playerId),
      };
    });
    this.state.results = results;

    const entries = results
      .filter((r) => (r.delta !== 0 || this.state.charged.has(r.playerId)) && ctx.getPlayer(r.playerId)?.isBot !== true)
      .map((r) => ({
        playerId: r.playerId,
        currency: 'coin' as const,
        delta: r.delta,
        reason: 'stud.result',
      }));

    ctx.markDirty();
    ctx.settle({ entries, winners });
  }

  override botIntent(ctx: RoomContext, playerId: string, difficulty: BotDifficulty = 'medium'): GameIntent | null {
    if (this.state.settled || this.state.turn !== playerId) return null;
    if (this.state.folded.has(playerId)) return null;

    const toCall = Math.max(0, this.state.currentBet - (this.state.roundBet.get(playerId) ?? 0));
    const hand = this.state.hands.get(playerId) ?? [];
    const pot = [...this.state.totalBet.values()].reduce((sum, value) => sum + value, 0);
    const canRaise = (this.state.raises.get(playerId) ?? 0) < MAX_RAISES;
    const opponents = Math.max(1, this.aliveIds(ctx).filter((id) => id !== playerId).length);

    return decidePokerBotAction({
      mode: 'stud',
      holeCards: hand.slice(0, 1),
      communityCards: hand.slice(1),
      knownDeadCards: hand,
      pot,
      toCall,
      canRaise,
      raiseUnit: RAISE_UNIT,
      opponents,
      difficulty,
    });
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const revealAll = this.state.settled;
    return {
      phase: this.state.settled ? 'settled' : 'playing',
      round: ctx.config.round,
      remainMs: 0,
      phaseDurationMs: 0,
      turn: this.state.turn,
      currentBet: this.state.currentBet,
      pot: [...this.state.totalBet.values()].reduce((sum, value) => sum + value, 0),
      myCards: (viewerId ? this.state.hands.get(viewerId) ?? [] : []).map((c) => ({
        id: c.id,
        rank: c.rank,
        suit: c.suit,
      })),
      myTotalBet: viewerId ? this.state.totalBet.get(viewerId) ?? 0 : 0,
      toCall: viewerId
        ? Math.max(0, this.state.currentBet - (this.state.roundBet.get(viewerId) ?? 0))
        : this.state.currentBet,
      raiseUnit: RAISE_UNIT,
      maxRaiseAdd: MAX_RAISE_ADD,
      street: this.state.street,
      allIn: [...this.state.allIn],
      players: ctx.players.map((p) => {
        const hand = this.state.hands.get(p.playerId) ?? [];
        return {
          playerId: p.playerId,
          nickname: p.nickname,
          seat: p.seat,
          isBot: p.isBot,
          folded: this.state.folded.has(p.playerId),
          cards: hand.map((c, idx) => {
            // 第1张(idx === 0)是暗牌底牌，仅本人或结算时可见
            if (revealAll || p.playerId === viewerId || idx > 0) {
              return { id: c.id, rank: c.rank, suit: c.suit };
            }
            return { id: 'back', rank: 0, suit: '' };
          }),
          cardCount: hand.length,
          totalBet: this.state.totalBet.get(p.playerId) ?? 0,
        };
      }),
      results: this.state.results.map((r) => ({
        playerId: r.playerId,
        nickname: r.nickname,
        delta: r.delta,
        handLabel: r.handLabel,
        folded: r.folded,
        cards: r.cards.map((c) => ({ id: c.id, rank: c.rank, suit: c.suit })),
      })),
      handSize: 5,
    };
  }

  override getCurrentActor(): string | null {
    return this.state.settled ? null : this.state.turn;
  }
}

export default StudPlugin;
