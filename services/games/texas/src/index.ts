import type { GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';
import { badRequest, illegalAction } from '@cc/protocol';
import {
  BaseGamePlugin,
  compareHandRank,
  createPokerDeck,
  evaluateBestHand,
  shuffleWithSeed,
  type Card,
  type GameIntent,
  type RoomContext,
} from '@cc/game-sdk';

const SMALL_BLIND = 50;
const BIG_BLIND = 100;
const RAISE_UNIT = 100;
const MAX_RAISES = 5;
/** 自定义加注上限，防止一次把底池顶爆 */
const MAX_RAISE_ADD = 5000;

type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

interface ResultRow {
  playerId: string;
  nickname: string;
  delta: number;
  folded: boolean;
  handLabel: string;
  cards: Card[];
}

interface State {
  phase: Phase;
  deck: Card[];
  hands: Map<string, Card[]>;
  community: Card[];
  /** 本局累计投入，用于结算 */
  totalBet: Map<string, number>;
  /** 当前下注轮投入，用于跟注判断 */
  roundBet: Map<string, number>;
  folded: Set<string>;
  acted: Set<string>;
  raises: Map<string, number>;
  currentBet: number;
  turn: string | null;
  dealerIndex: number;
  settled: boolean;
  results: ResultRow[];
}

function emptyState(): State {
  return {
    phase: 'preflop',
    deck: [],
    hands: new Map(),
    community: [],
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
  };
}

const PHASE_LABEL: Record<Phase, string> = {
  preflop: '翻牌前',
  flop: '翻牌',
  turn: '转牌',
  river: '河牌',
  showdown: '摊牌',
};

/**
 * 德州扑克（单局制）：
 * 每局独立结算，不做跨局筹码累积，因此不存在边池问题。
 * 盲注 50/100，加注固定 100，每人每局最多加注 5 次。
 */
export class TexasPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta = {
    gameId: 'texas',
    name: '德州扑克',
    description: '两张底牌加五张公共牌，比牌型大小',
    icon: '♠️',
    minPlayers: 2,
    maxPlayers: 6,
    version: '1.0.0',
    clientBundle: 'builtin:texas',
    tags: ['牌类', '多人', '竞技'],
    category: 'table',
  };

  override readonly commands: readonly string[] = ['fold', 'check', 'call', 'raise'];

  private state: State = emptyState();

  override onRoundStart(ctx: RoomContext): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    this.state = emptyState();
    this.state.dealerIndex = (ctx.config.round - 1) % Math.max(players.length, 1);
    this.state.deck = shuffleWithSeed(createPokerDeck(), ctx.config.seed);

    let cursor = 0;
    for (const player of players) {
      const hand = [this.state.deck[cursor], this.state.deck[cursor + 1]].filter((c): c is Card => Boolean(c));
      cursor += 2;
      this.state.hands.set(player.playerId, hand);
      this.state.totalBet.set(player.playerId, 0);
      this.state.roundBet.set(player.playerId, 0);
      this.state.raises.set(player.playerId, 0);
    }
    this.state.deck = this.state.deck.slice(cursor);

    const order = players.map((p) => p.playerId);
    const n = order.length;
    if (n < 2) {
      ctx.settle({ entries: [], winners: [] });
      return;
    }

    const dealerPos = this.state.dealerIndex % n;
    const isHeadsUp = n === 2;
    const sbPos = isHeadsUp ? dealerPos : (dealerPos + 1) % n;
    const bbPos = (sbPos + 1) % n;
    const firstPos = isHeadsUp ? dealerPos : (bbPos + 1) % n;

    this.postBlind(order[sbPos], SMALL_BLIND);
    this.postBlind(order[bbPos], BIG_BLIND);
    this.state.currentBet = BIG_BLIND;
    this.state.turn = order[firstPos] ?? null;
    ctx.markDirty();
  }

  override onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): void {
    if (this.state.settled) throw illegalAction('本局已结束');
    if (this.state.folded.has(playerId)) throw illegalAction('你已弃牌');
    if (this.state.turn !== playerId) throw illegalAction('还没轮到你行动');

    const toCall = this.state.currentBet - (this.state.roundBet.get(playerId) ?? 0);

    switch (intent.cmd) {
      case 'fold':
        this.state.folded.add(playerId);
        this.state.acted.add(playerId);
        break;

      case 'check':
        if (toCall > 0) throw illegalAction(`需要跟注 ${toCall} 才能过牌`);
        this.state.acted.add(playerId);
        break;

      case 'call': {
        if (toCall <= 0) throw illegalAction('当前无需跟注');
        this.commit(playerId, toCall);
        this.state.acted.add(playerId);
        break;
      }

      case 'raise': {
        const used = this.state.raises.get(playerId) ?? 0;
        if (used >= MAX_RAISES) throw illegalAction('本局加注次数已达上限');

        // 支持自定义加注：payload.amount 为「在跟注基础上额外加多少」
        const rawAdd = intent.payload?.amount;
        let target = this.state.currentBet + RAISE_UNIT;
        if (rawAdd !== undefined && rawAdd !== null) {
          const add = Number(rawAdd);
          if (!Number.isInteger(add) || add < RAISE_UNIT) {
            throw badRequest(`加注至少 ${RAISE_UNIT}`);
          }
          if (add > MAX_RAISE_ADD) throw badRequest(`单次加注最多 ${MAX_RAISE_ADD}`);
          target = this.state.currentBet + add;
        }

        const delta = target - (this.state.roundBet.get(playerId) ?? 0);
        if (delta <= 0) throw badRequest('加注金额不合法');

        this.commit(playerId, delta);
        this.state.currentBet = target;
        this.state.raises.set(playerId, used + 1);

        // 加注后其他人需要重新行动
        this.state.acted.clear();
        this.state.acted.add(playerId);
        break;
      }

      default:
        throw badRequest(`未知操作: ${intent.cmd}`);
    }

    this.afterAction(ctx, playerId);
  }

  override onPlayerLeave(ctx: RoomContext, playerId: string): void {
    if (this.state.settled) return;
    this.state.folded.add(playerId);
    const alive = this.aliveIds(ctx);
    if (alive.length <= 1) {
      this.settleShowdown(ctx);
      return;
    }
    if (this.state.turn === playerId) {
      this.afterAction(ctx, playerId);
    } else {
      ctx.markDirty();
    }
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const myRound = viewerId ? (this.state.roundBet.get(viewerId) ?? 0) : 0;
    const myHand = viewerId ? (this.state.hands.get(viewerId) ?? []) : [];

    return {
      phase: this.state.phase,
      phaseLabel: PHASE_LABEL[this.state.phase],
      community: this.state.community,
      pot: this.pot(),
      currentBet: this.state.currentBet,
      toCall: Math.max(0, this.state.currentBet - myRound),
      turn: this.state.turn,
      dealerId: [...ctx.players].sort((a, b) => a.seat - b.seat)[this.state.dealerIndex]?.playerId ?? null,
      myHand,
      myTotalBet: viewerId ? (this.state.totalBet.get(viewerId) ?? 0) : 0,
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
      raiseUnit: RAISE_UNIT,
      maxRaiseAdd: MAX_RAISE_ADD,
      results: this.state.results,
      players: players.map((p) => {
        const folded = this.state.folded.has(p.playerId);
        const reveal = this.state.settled || folded;
        return {
          playerId: p.playerId,
          nickname: p.nickname,
          seat: p.seat,
          folded,
          totalBet: this.state.totalBet.get(p.playerId) ?? 0,
          isDealer: p.playerId === ([...ctx.players].sort((a, b) => a.seat - b.seat)[this.state.dealerIndex]?.playerId ?? null),
          cards: reveal ? (this.state.hands.get(p.playerId) ?? []) : [],
        };
      }),
    };
  }

  private postBlind(playerId: string | undefined, amount: number): void {
    if (!playerId) return;
    this.commit(playerId, amount);
  }

  private commit(playerId: string, amount: number): void {
    this.state.totalBet.set(playerId, (this.state.totalBet.get(playerId) ?? 0) + amount);
    this.state.roundBet.set(playerId, (this.state.roundBet.get(playerId) ?? 0) + amount);
  }

  private pot(): number {
    let total = 0;
    for (const value of this.state.totalBet.values()) total += value;
    return total;
  }

  private aliveIds(ctx: RoomContext): string[] {
    return [...ctx.players]
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.playerId)
      .filter((id) => !this.state.folded.has(id));
  }

  private nextAlive(ctx: RoomContext, fromId: string): string | null {
    const order = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.playerId);
    const start = order.indexOf(fromId);
    if (start < 0) return null;
    for (let i = 1; i <= order.length; i += 1) {
      const id = order[(start + i) % order.length];
      if (id && !this.state.folded.has(id)) return id;
    }
    return null;
  }

  private afterAction(ctx: RoomContext, playerId: string): void {
    const alive = this.aliveIds(ctx);
    if (alive.length <= 1) {
      this.settleShowdown(ctx);
      return;
    }

    const roundDone = alive.every(
      (id) => this.state.acted.has(id) && (this.state.roundBet.get(id) ?? 0) === this.state.currentBet,
    );

    if (roundDone) {
      this.advancePhase(ctx);
      return;
    }

    this.state.turn = this.nextAlive(ctx, playerId);
    ctx.markDirty();
  }

  private advancePhase(ctx: RoomContext): void {
    if (this.state.phase === 'river') {
      this.settleShowdown(ctx);
      return;
    }

    if (this.state.phase === 'preflop') {
      this.state.community.push(...this.state.deck.splice(0, 3));
      this.state.phase = 'flop';
    } else if (this.state.phase === 'flop') {
      this.state.community.push(...this.state.deck.splice(0, 1));
      this.state.phase = 'turn';
    } else if (this.state.phase === 'turn') {
      this.state.community.push(...this.state.deck.splice(0, 1));
      this.state.phase = 'river';
    }

    this.state.roundBet.clear();
    for (const player of ctx.players) this.state.roundBet.set(player.playerId, 0);
    this.state.currentBet = 0;
    this.state.acted.clear();

    const order = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.playerId);
    const dealerPos = this.state.dealerIndex % Math.max(order.length, 1);
    const first = this.nextAlive(ctx, order[dealerPos] ?? '');
    this.state.turn = first;
    ctx.markDirty();
  }

  override getCurrentActor(): string | null {
    return this.state.settled ? null : this.state.turn;
  }

  override botIntent(ctx: RoomContext, playerId: string): GameIntent | null {
    if (this.state.settled || this.state.turn !== playerId) return null;
    if (this.state.folded.has(playerId)) return null;

    const hand = this.state.hands.get(playerId) ?? [];
    const best = evaluateBestHand([...hand, ...this.state.community]);
    const toCall = this.state.currentBet - (this.state.roundBet.get(playerId) ?? 0);
    const strength = best.category;
    const canRaise = (this.state.raises.get(playerId) ?? 0) < MAX_RAISES;

    if (toCall <= 0) {
      if (canRaise && strength >= 3 && Math.random() < 0.55) return { cmd: 'raise', payload: {} };
      return { cmd: 'check', payload: {} };
    }
    if (strength >= 5 && canRaise) return { cmd: 'raise', payload: {} };
    if (strength >= 2) return { cmd: 'call', payload: {} };
    if (toCall <= 100 && Math.random() < 0.35) return { cmd: 'call', payload: {} };
    return { cmd: 'fold', payload: {} };
  }

  private settleShowdown(ctx: RoomContext): void {
    if (this.state.settled) return;
    this.state.settled = true;
    this.state.phase = 'showdown';

    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const alive = this.aliveIds(ctx);
    const pot = this.pot();

    const scored = alive.map((id) => {
      const hand = this.state.hands.get(id) ?? [];
      const best = evaluateBestHand([...hand, ...this.state.community]);
      return { id, best };
    });

    let winners: string[] = [];
    if (scored.length > 0) {
      let top = scored[0]!;
      for (const item of scored) {
        if (compareHandRank(item.best, top.best) > 0) top = item;
      }
      winners = scored.filter((item) => compareHandRank(item.best, top.best) === 0).map((item) => item.id);
    }

    const share = winners.length > 0 ? Math.floor(pot / winners.length) : 0;

    const results: ResultRow[] = players.map((p) => {
      const hand = this.state.hands.get(p.playerId) ?? [];
      const best = evaluateBestHand([...hand, ...this.state.community]);
      const bet = this.state.totalBet.get(p.playerId) ?? 0;
      const isWinner = winners.includes(p.playerId);
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        delta: (isWinner ? share : 0) - bet,
        folded: this.state.folded.has(p.playerId),
        handLabel: best.label,
        cards: hand,
      };
    });

    this.state.results = results;
    this.state.turn = null;

    const entries: SettlementEntry[] = results
      .filter((r) => r.delta !== 0)
      .map((r) => ({
        playerId: r.playerId,
        currency: 'coin' as const,
        delta: r.delta,
        reason: 'texas.result',
      }));

    ctx.markDirty();
    ctx.settle({ entries, winners });
  }
}

export default TexasPlugin;
