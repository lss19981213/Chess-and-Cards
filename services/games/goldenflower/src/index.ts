import type { GameMeta, GameSnapshot } from '@cc/protocol';
import type { GameIntent, RoomContext } from '@cc/game-sdk';
import { BaseGamePlugin, createPokerDeck, shuffleWithSeed, type Card } from '@cc/game-sdk';

const ANTE = 50;
const RAISE_UNIT = 100;
const MAX_RAISES = 5;
const MAX_RAISE_ADD = 5000;
const HAND_SIZE = 3;

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
  hands: Map<string, Card[]>;
  totalBet: Map<string, number>;
  roundBet: Map<string, number>;
  folded: Set<string>;
  acted: Set<string>;
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
    hands: new Map(),
    totalBet: new Map(),
    roundBet: new Map(),
    folded: new Set(),
    acted: new Set(),
    raises: new Map(),
    currentBet: 0,
    turn: null,
    dealerIndex: 0,
    settled: false,
    results: [],
    charged: new Set(),
  };
}

/** 翻金花牌型：同花顺 > 金花 > 顺子 > 对子 > 散牌 */
function rankHand(cards: Card[]): { category: number; label: string; high: number } {
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const sameSuit = suits.every((s) => s === suits[0]);
  // A 既可当 1 也可当最大，顺子判定按 A-2-3 与 10-J-Q-K-A 两头算
  const lows = ranks.map((r) => (r === 14 ? 1 : r)).sort((a, b) => a - b);
  const [l0, l1, l2] = lows as [number, number, number];
  let consecutive = l0 + 1 === l1 && l1 + 1 === l2;
  if (!consecutive && ranks[0] === 14 && ranks[1] === 13 && ranks[2] === 12) consecutive = true;
  const high = ranks[0] === 14 && ranks[1] === 13 ? 14 : l2;

  if (sameSuit && consecutive) return { category: 5, label: '同花顺', high };
  if (sameSuit) return { category: 4, label: '金花', high };
  if (consecutive) return { category: 3, label: '顺子', high };
  if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) return { category: 2, label: '对子', high };
  return { category: 1, label: '散牌', high };
}

export class GoldenFlowerPlugin extends BaseGamePlugin {
  override readonly apiVersion = 1;

  override readonly meta: GameMeta = {
    gameId: 'goldenflower',
    name: '翻金花',
    description: '三张牌比大小，同花顺通杀',
    icon: '🌸',
    minPlayers: 2,
    maxPlayers: 6,
    version: '1.0.0',
    clientBundle: '',
    tags: ['牌类', '多人', '竞技'],
  };

  override readonly commands = ['fold', 'check', 'call', 'raise'] as const;

  private state: State = emptyState();

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  override onRoundStart(ctx: RoomContext): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    if (players.length < 2) return;

    this.state = emptyState();
    this.state.dealerIndex = (ctx.config.round - 1) % players.length;
    this.state.deck = shuffleWithSeed(createPokerDeck(), ctx.config.seed);

    let cursor = 0;
    for (const player of players) {
      const cards: Card[] = [];
      for (let i = 0; i < HAND_SIZE; i += 1) cards.push(this.state.deck[cursor++]!);
      this.state.hands.set(player.playerId, cards);
      this.state.totalBet.set(player.playerId, ANTE);
      this.state.roundBet.set(player.playerId, ANTE);
      this.state.raises.set(player.playerId, 0);
    }
    this.state.currentBet = ANTE;
    this.state.turn = this.nextAlive(ctx, this.state.dealerIndex);
    ctx.markDirty();
  }

  override async onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): Promise<void> {
    if (this.state.settled) throw new Error('本局已结束');
    if (this.state.folded.has(playerId)) throw new Error('你已弃牌');
    if (this.state.turn !== playerId) throw new Error('还没轮到你行动');

    const toCall = this.state.currentBet - (this.state.roundBet.get(playerId) ?? 0);
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
        let target = this.state.currentBet + RAISE_UNIT;
        if (rawAdd !== undefined && rawAdd !== null) {
          const add = Number(rawAdd);
          if (!Number.isInteger(add) || add < RAISE_UNIT) throw new Error(`加注至少 ${RAISE_UNIT}`);
          if (add > MAX_RAISE_ADD) throw new Error(`单次加注最多 ${MAX_RAISE_ADD}`);
          target = this.state.currentBet + add;
        }
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
    const allActed = alive.every((id) => this.state.acted.has(id));
    const matched = alive.every((id) => (this.state.roundBet.get(id) ?? 0) === this.state.currentBet);
    if (allActed && matched) {
      this.settleShowdown(ctx);
      return;
    }
    const order = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.playerId);
    this.state.turn = this.nextAlive(ctx, Math.max(0, order.indexOf(playerId)));
    ctx.markDirty();
  }

  private settleShowdown(ctx: RoomContext): void {
    this.state.settled = true;
    this.state.turn = null;

    const pot = [...this.state.totalBet.values()].reduce((sum, value) => sum + value, 0);
    const alive = this.aliveIds(ctx);
    let best: { category: number; high: number } | null = null;
    const winners: string[] = [];
    for (const id of alive) {
      const ranked = rankHand(this.state.hands.get(id) ?? []);
      if (!best || ranked.category > best.category || (ranked.category === best.category && ranked.high > best.high)) {
        best = { category: ranked.category, high: ranked.high };
        winners.length = 0;
        winners.push(id);
      } else if (ranked.category === best.category && ranked.high === best.high) {
        winners.push(id);
      }
    }

    const share = winners.length > 0 ? Math.floor(pot / winners.length) : 0;
    const results: ResultRow[] = [...ctx.players].map((p) => {
      const hand = this.state.hands.get(p.playerId) ?? [];
      const ranked = rankHand(hand);
      const bet = this.state.totalBet.get(p.playerId) ?? 0;
      const isWinner = winners.includes(p.playerId);
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        delta: (isWinner ? share : 0) - bet,
        handLabel: ranked.label,
        cards: hand,
        folded: this.state.folded.has(p.playerId),
      };
    });
    this.state.results = results;

    const entries = results
      .filter((r) => (r.delta !== 0 || this.state.charged.has(r.playerId)) && ctx.getPlayer(r.playerId)?.isBot !== true)
      .map((r) => ({ playerId: r.playerId, currency: 'coin' as const, delta: r.delta, reason: 'goldenflower.result' }));

    ctx.markDirty();
    ctx.settle({ entries, winners });
  }

  override botIntent(ctx: RoomContext, playerId: string): GameIntent | null {
    if (this.state.settled || this.state.turn !== playerId) return null;
    if (this.state.folded.has(playerId)) return null;
    const toCall = this.state.currentBet - (this.state.roundBet.get(playerId) ?? 0);
    const strength = rankHand(this.state.hands.get(playerId) ?? []).category;
    if (toCall <= 0) {
      if (strength >= 4 && Math.random() < 0.45) return { cmd: 'raise', payload: {} };
      return { cmd: 'check', payload: {} };
    }
    if (strength >= 4 && Math.random() < 0.55) return { cmd: 'raise', payload: {} };
    if (strength >= 2) return { cmd: 'call', payload: {} };
    if (Math.random() < 0.25) return { cmd: 'fold', payload: {} };
    return { cmd: 'call', payload: {} };
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
        ? this.state.currentBet - (this.state.roundBet.get(viewerId) ?? 0)
        : this.state.currentBet,
      raiseUnit: RAISE_UNIT,
      maxRaiseAdd: MAX_RAISE_ADD,
      players: ctx.players.map((p) => {
        const hand = this.state.hands.get(p.playerId) ?? [];
        return {
          playerId: p.playerId,
          nickname: p.nickname,
          seat: p.seat,
          isBot: p.isBot,
          folded: this.state.folded.has(p.playerId),
          cards: revealAll || p.playerId === viewerId
            ? hand.map((c) => ({ id: c.id, rank: c.rank, suit: c.suit }))
            : [],
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
      handSize: HAND_SIZE,
    };
  }

  override getCurrentActor(): string | null {
    return this.state.settled ? null : this.state.turn;
  }
}

export default GoldenFlowerPlugin;
