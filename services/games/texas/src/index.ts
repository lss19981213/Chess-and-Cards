import type { BotDifficulty, GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';
import { badRequest, illegalAction } from '@cc/protocol';
import {
  BaseGamePlugin,
  compareHandRank,
  createPokerDeck,
  decidePokerBotAction,
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
/** 单次下注/全压风控上限 */
const MAX_RAISE_ADD = 100_000_000;

type Phase = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface TexasActionEvent {
  seq: number;
  type: 'deal' | 'fold' | 'check' | 'call' | 'raise' | 'allin' | 'street' | 'showdown';
  playerId: string;
  nickname: string;
  amount?: number;
  detail?: string;
}

interface PlayerActionTag {
  type: 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'raise' | 'allin';
  label: string;
  amount?: number;
}

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
  allIn: Set<string>;
  acted: Set<string>;
  raises: Map<string, number>;
  currentBet: number;
  turn: string | null;
  dealerIndex: number;
  smallBlindId: string | null;
  bigBlindId: string | null;
  lastAction: TexasActionEvent | null;
  actionSeq: number;
  playerActionTags: Map<string, PlayerActionTag>;
  settled: boolean;
  results: ResultRow[];
  /** 本局已即时扣款的真人玩家，结算时必须入账以便返还本金 */
  charged: Set<string>;
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
    allIn: new Set(),
    acted: new Set(),
    raises: new Map(),
    currentBet: 0,
    turn: null,
    dealerIndex: 0,
    smallBlindId: null,
    bigBlindId: null,
    lastAction: null,
    actionSeq: 0,
    playerActionTags: new Map(),
    settled: false,
    results: [],
    charged: new Set(),
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

  override readonly commands: readonly string[] = ['fold', 'check', 'call', 'raise', 'allin'];

  private state: State = emptyState();

  private recordAction(
    ctx: RoomContext,
    type: TexasActionEvent['type'],
    playerId: string,
    extra?: { amount?: number; detail?: string },
  ): void {
    const nickname = ctx.players.find((p) => p.playerId === playerId)?.nickname ?? '牌手';
    this.state.actionSeq += 1;
    this.state.lastAction = {
      seq: this.state.actionSeq,
      type,
      playerId,
      nickname,
      ...(extra?.amount !== undefined ? { amount: extra.amount } : {}),
      ...(extra?.detail ? { detail: extra.detail } : {}),
    };
  }

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

    const sbId = order[sbPos] ?? null;
    const bbId = order[bbPos] ?? null;
    this.state.smallBlindId = sbId;
    this.state.bigBlindId = bbId;

    this.postBlind(sbId ?? undefined, SMALL_BLIND);
    this.postBlind(bbId ?? undefined, BIG_BLIND);
    if (sbId) this.state.playerActionTags.set(sbId, { type: 'sb', label: `小盲 ${SMALL_BLIND}`, amount: SMALL_BLIND });
    if (bbId) this.state.playerActionTags.set(bbId, { type: 'bb', label: `大盲 ${BIG_BLIND}`, amount: BIG_BLIND });

    this.state.currentBet = BIG_BLIND;
    this.state.turn = order[firstPos] ?? null;
    this.recordAction(ctx, 'deal', order[dealerPos] ?? order[0]!, {
      detail: `第 ${ctx.config.round} 手发牌 · 盲注 ${SMALL_BLIND}/${BIG_BLIND}`,
    });
    ctx.markDirty();
  }

  override async onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): Promise<void> {
    if (this.state.settled) throw illegalAction('本局已结束');
    if (this.state.folded.has(playerId)) throw illegalAction('你已弃牌');
    if (this.state.turn !== playerId) throw illegalAction('还没轮到你行动');

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
        this.state.playerActionTags.set(playerId, { type: 'fold', label: '已弃牌' });
        this.recordAction(ctx, 'fold', playerId);
        break;

      case 'check':
        if (toCall > 0) throw illegalAction(`需要跟注 ${toCall} 才能过牌`);
        this.state.acted.add(playerId);
        this.state.playerActionTags.set(playerId, { type: 'check', label: '过牌' });
        this.recordAction(ctx, 'check', playerId);
        break;

      case 'call': {
        if (toCall <= 0) throw illegalAction('当前无需跟注');
        await pay(toCall);
        this.commit(playerId, toCall);
        this.state.acted.add(playerId);
        this.state.playerActionTags.set(playerId, { type: 'call', label: `跟注 ${toCall}`, amount: toCall });
        this.recordAction(ctx, 'call', playerId, { amount: toCall });
        break;
      }

      case 'raise': {
        const used = this.state.raises.get(playerId) ?? 0;
        if (used >= MAX_RAISES) throw illegalAction('本局加注次数已达上限');

        const rawAdd = intent.payload?.amount;
        let target = this.state.currentBet + RAISE_UNIT;
        if (rawAdd !== undefined && rawAdd !== null) {
          const add = Math.floor(Number(rawAdd));
          if (!Number.isFinite(add) || add < RAISE_UNIT) {
            throw badRequest(`加注至少 ${RAISE_UNIT}`);
          }
          target = this.state.currentBet + Math.min(add, MAX_RAISE_ADD);
        }

        const delta = target - (this.state.roundBet.get(playerId) ?? 0);
        if (delta <= 0) throw badRequest('加注金额不合法');
        if (delta > MAX_RAISE_ADD) throw badRequest(`单次下注上限为 ${MAX_RAISE_ADD.toLocaleString()}`);

        await pay(delta);
        this.commit(playerId, delta);
        this.state.currentBet = target;
        this.state.raises.set(playerId, used + 1);
        this.state.playerActionTags.set(playerId, { type: 'raise', label: `加注至 ${target}`, amount: delta });
        this.recordAction(ctx, 'raise', playerId, { amount: delta, detail: `加注至 ${target}` });

        this.state.acted.clear();
        this.state.acted.add(playerId);
        break;
      }

      case 'allin': {
        const rawAmt = Math.floor(Number(intent.payload?.amount ?? 0));
        const commitAmount = Math.min(MAX_RAISE_ADD, Math.max(0, rawAmt));
        if (commitAmount <= 0) throw badRequest('筹码不足，无法全压');

        const myRound = this.state.roundBet.get(playerId) ?? 0;
        const newTarget = myRound + commitAmount;

        await pay(commitAmount);
        this.commit(playerId, commitAmount);
        this.state.allIn.add(playerId);
        this.state.playerActionTags.set(playerId, {
          type: 'allin',
          label: `ALL-IN ${commitAmount.toLocaleString()}`,
          amount: commitAmount,
        });
        this.recordAction(ctx, 'allin', playerId, {
          amount: commitAmount,
          detail: `全压 ${commitAmount.toLocaleString()} 筹码！`,
        });

        if (newTarget > this.state.currentBet) {
          this.state.currentBet = newTarget;
          this.state.acted.clear();
          this.state.acted.add(playerId);
        } else {
          this.state.acted.add(playerId);
        }
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
    const dealerId = players[this.state.dealerIndex % Math.max(players.length, 1)]?.playerId ?? null;
    const myHandLabel =
      myHand.length > 0
        ? evaluateBestHand([...myHand, ...this.state.community]).label
        : '';

    return {
      round: ctx.config.round,
      phase: this.state.phase,
      phaseLabel: PHASE_LABEL[this.state.phase],
      community: this.state.community,
      pot: this.pot(),
      currentBet: this.state.currentBet,
      toCall: Math.max(0, this.state.currentBet - myRound),
      turn: this.state.turn,
      dealerId,
      smallBlindId: this.state.smallBlindId,
      bigBlindId: this.state.bigBlindId,
      myHand,
      myHandLabel,
      myTotalBet: viewerId ? (this.state.totalBet.get(viewerId) ?? 0) : 0,
      myRoundBet: myRound,
      smallBlind: SMALL_BLIND,
      bigBlind: BIG_BLIND,
      raiseUnit: RAISE_UNIT,
      maxRaiseAdd: MAX_RAISE_ADD,
      lastAction: this.state.lastAction,
      results: this.state.results,
      players: players.map((p) => {
        const folded = this.state.folded.has(p.playerId);
        const reveal = this.state.settled;
        return {
          playerId: p.playerId,
          nickname: p.nickname,
          seat: p.seat,
          folded,
          isAllIn: this.state.allIn.has(p.playerId),
          totalBet: this.state.totalBet.get(p.playerId) ?? 0,
          roundBet: this.state.roundBet.get(p.playerId) ?? 0,
          isDealer: p.playerId === dealerId,
          isSmallBlind: p.playerId === this.state.smallBlindId,
          isBigBlind: p.playerId === this.state.bigBlindId,
          actionTag: this.state.playerActionTags.get(p.playerId) ?? null,
          cards: reveal && !folded ? (this.state.hands.get(p.playerId) ?? []) : [],
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

  private nextCanAct(ctx: RoomContext, fromId: string): string | null {
    const order = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.playerId);
    const start = order.indexOf(fromId);
    if (start < 0) return null;
    for (let i = 1; i <= order.length; i += 1) {
      const id = order[(start + i) % order.length];
      if (id && !this.state.folded.has(id) && !this.state.allIn.has(id)) return id;
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
      (id) =>
        this.state.allIn.has(id) ||
        (this.state.acted.has(id) && (this.state.roundBet.get(id) ?? 0) === this.state.currentBet),
    );

    if (roundDone) {
      this.advancePhase(ctx);
      return;
    }

    const next = this.nextCanAct(ctx, playerId);
    if (!next) {
      this.advancePhase(ctx);
      return;
    }
    this.state.turn = next;
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
    // 清除上一条街的普通行动气泡，保留弃牌与 ALL-IN 状态
    for (const [pid, tag] of this.state.playerActionTags.entries()) {
      if (tag.type !== 'fold' && tag.type !== 'allin') {
        this.state.playerActionTags.delete(pid);
      }
    }

    // 若场上可继续下注的非全压玩家 <= 1 人，自动发完所有公共牌并进入摊牌！
    const canStillBet = this.aliveIds(ctx).filter((id) => !this.state.allIn.has(id));
    if (canStillBet.length <= 1) {
      while (this.state.community.length < 5 && this.state.deck.length > 0) {
        const nextCard = this.state.deck.shift();
        if (nextCard) this.state.community.push(nextCard);
      }
      this.settleShowdown(ctx);
      return;
    }

    const order = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.playerId);
    const dealerPos = this.state.dealerIndex % Math.max(order.length, 1);
    const first = this.nextCanAct(ctx, order[dealerPos] ?? '');
    this.state.turn = first;
    this.recordAction(ctx, 'street', first ?? order[dealerPos] ?? '', {
      detail: `发${PHASE_LABEL[this.state.phase]}`,
    });
    ctx.markDirty();
  }

  override getCurrentActor(): string | null {
    return this.state.settled ? null : this.state.turn;
  }

  override botIntent(ctx: RoomContext, playerId: string, difficulty: BotDifficulty = 'medium'): GameIntent | null {
    if (this.state.settled || this.state.turn !== playerId) return null;
    if (this.state.folded.has(playerId)) return null;

    const hand = this.state.hands.get(playerId) ?? [];
    const toCall = this.state.currentBet - (this.state.roundBet.get(playerId) ?? 0);
    const canRaise = (this.state.raises.get(playerId) ?? 0) < MAX_RAISES;
    const opponents = Math.max(1, this.aliveIds(ctx).filter((id) => id !== playerId).length);

    return decidePokerBotAction({
      mode: 'texas',
      holeCards: hand,
      communityCards: this.state.community,
      knownDeadCards: [...hand, ...this.state.community],
      pot: this.pot(),
      toCall,
      canRaise,
      raiseUnit: RAISE_UNIT,
      opponents,
      difficulty,
    });
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
    this.recordAction(ctx, 'showdown', winners[0] ?? players[0]?.playerId ?? '', {
      amount: share,
      detail: winners.length > 0 ? '摊牌结算' : '本手结束',
    });

    // 已即时扣款的真人必须入账（哪怕净盈亏为 0），否则本金退不回来；机器人不写账本
    const entries: SettlementEntry[] = results
      .filter(
        (r) =>
          (r.delta !== 0 || this.state.charged.has(r.playerId)) &&
          ctx.getPlayer(r.playerId)?.isBot !== true,
      )
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
