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
/** 单次加注/全压上限与钱包扣款接口对齐 */
const MAX_RAISE_ADD = 1_000_000;

interface ResultRow {
  playerId: string;
  nickname: string;
  delta: number;
  handLabel: string;
  cards: Card[];
  folded: boolean;
}

interface ActionTag {
  type: 'fold' | 'check' | 'call' | 'raise' | 'allin';
  label: string;
  amount?: number;
}

interface ActionEvent {
  seq: number;
  type: 'deal' | 'fold' | 'check' | 'call' | 'raise' | 'allin' | 'street' | 'showdown';
  playerId: string;
  nickname: string;
  amount?: number;
  detail?: string;
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
  actionTags: Map<string, ActionTag>;
  actionSeq: number;
  lastAction: ActionEvent | null;
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
    actionTags: new Map(),
    actionSeq: 0,
    lastAction: null,
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

function describePartialStudHand(cards: Card[]): string {
  if (cards.length === 0) return '';
  if (cards.length >= 5) return evaluateBestHand(cards).label;
  const counts = new Map<number, number>();
  for (const c of cards) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const vals = [...counts.values()].sort((a, b) => b - a);
  if (vals[0] === 4) return '四条';
  if (vals[0] === 3) return '三条';
  if (vals[0] === 2 && vals[1] === 2) return '两对';
  if (vals[0] === 2) return '一对';
  if (cards.length >= 3 && cards.every((c) => c.suit === cards[0]!.suit)) return '同花听牌';
  return '高牌';
}

export class StudPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta = {
    gameId: 'stud',
    name: '梭哈',
    description: '港式五张经典对决，分轮发牌，暗牌偷鸡，一键梭哈',
    icon: '🎴',
    minPlayers: 2,
    maxPlayers: 6,
    version: '1.1.0',
    clientBundle: '',
    tags: ['牌类', '多人', '竞技', '梭哈'],
    category: 'table',
  };

  override readonly commands = ['fold', 'check', 'call', 'raise', 'allin'] as const;

  private state: State = emptyState();

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  private emitAction(
    type: ActionEvent['type'],
    playerId: string,
    nickname: string,
    amount?: number,
    detail?: string,
  ): void {
    this.state.actionSeq += 1;
    this.state.lastAction = {
      seq: this.state.actionSeq,
      type,
      playerId,
      nickname,
      ...(amount !== undefined ? { amount } : {}),
      ...(detail !== undefined ? { detail } : {}),
    };
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
    this.emitAction('deal', '', '系统', ANTE, '第 1 轮 · 1底1明发牌');
    ctx.markDirty();
  }

  private findLeadPlayer(ctx: RoomContext): string {
    const alive = this.aliveIds(ctx).filter((id) => !this.state.allIn.has(id));
    const pool = alive.length > 0 ? alive : this.aliveIds(ctx);
    let bestPlayer = pool[0]!;
    let bestScore = -1;

    for (const id of pool) {
      const hand = this.state.hands.get(id) ?? [];
      const upcards = hand.slice(1);
      if (upcards.length === 0) continue;
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

    const actorName = ctx.getPlayer(playerId)?.nickname ?? '玩家';
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
        this.state.actionTags.set(playerId, { type: 'fold', label: '弃牌' });
        this.emitAction('fold', playerId, actorName);
        break;
      case 'check':
        if (toCall > 0) throw new Error(`需要跟注 ${toCall} 才能过牌`);
        this.state.acted.add(playerId);
        this.state.actionTags.set(playerId, { type: 'check', label: '过牌' });
        this.emitAction('check', playerId, actorName);
        break;
      case 'call': {
        if (toCall <= 0) throw new Error('当前无需跟注');
        await pay(toCall);
        this.commit(playerId, toCall);
        this.state.acted.add(playerId);
        this.state.actionTags.set(playerId, { type: 'call', label: `跟注 ${toCall}`, amount: toCall });
        this.emitAction('call', playerId, actorName, toCall);
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
          if (add > MAX_RAISE_ADD) throw new Error(`单次加注上限 ${MAX_RAISE_ADD}`);
        }
        const target = this.state.currentBet + add;
        const delta = Math.min(MAX_RAISE_ADD, target - (this.state.roundBet.get(playerId) ?? 0));
        if (delta <= 0) throw new Error('加注金额不合法');
        await pay(delta);
        this.commit(playerId, delta);
        this.state.currentBet = this.state.roundBet.get(playerId) ?? target;
        this.state.raises.set(playerId, used + 1);
        this.state.acted.clear();
        this.state.acted.add(playerId);
        this.state.actionTags.set(playerId, { type: 'raise', label: `加注 +${add}`, amount: delta });
        this.emitAction('raise', playerId, actorName, delta, `+${add}`);
        break;
      }
      case 'allin': {
        const rawAmt = Number(intent.payload?.amount ?? 0);
        const defaultPush = Math.max(toCall + RAISE_UNIT * 5, 500);
        const pushAmount =
          Number.isFinite(rawAmt) && rawAmt > 0
            ? Math.min(MAX_RAISE_ADD, Math.floor(rawAmt))
            : Math.min(MAX_RAISE_ADD, defaultPush);
        if (pushAmount <= 0) throw new Error('筹码不足，无法全压');
        await pay(pushAmount);
        this.commit(playerId, pushAmount);
        const newRoundBet = this.state.roundBet.get(playerId) ?? 0;
        if (newRoundBet > this.state.currentBet) {
          this.state.currentBet = newRoundBet;
          this.state.acted.clear();
        }
        this.state.allIn.add(playerId);
        this.state.acted.add(playerId);
        this.state.actionTags.set(playerId, { type: 'allin', label: `梭哈 ${pushAmount}`, amount: pushAmount });
        this.emitAction('allin', playerId, actorName, pushAmount, 'ALL-IN');
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
    this.state.actionTags.set(playerId, { type: 'fold', label: '离桌弃牌' });
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
      if (!this.state.folded.has(id) && !this.state.allIn.has(id)) return id;
    }
    return null;
  }

  private dealRemainingStreetsToShowdown(ctx: RoomContext): void {
    const alive = this.aliveIds(ctx);
    let cursor = this.state.deckCursor;
    while (this.state.street < 4) {
      this.state.street = (this.state.street + 1) as 1 | 2 | 3 | 4;
      for (const id of alive) {
        const hand = this.state.hands.get(id) ?? [];
        if (cursor < this.state.deck.length) {
          hand.push(this.state.deck[cursor++]!);
        }
        this.state.hands.set(id, hand);
      }
    }
    this.state.deckCursor = cursor;
    this.settleShowdown(ctx);
  }

  private afterAction(ctx: RoomContext, playerId: string): void {
    const alive = this.aliveIds(ctx);
    if (alive.length <= 1) {
      this.settleShowdown(ctx);
      return;
    }

    const actionable = alive.filter((id) => !this.state.allIn.has(id));
    const allActed = actionable.every((id) => this.state.acted.has(id));
    const matched = actionable.every((id) => (this.state.roundBet.get(id) ?? 0) >= this.state.currentBet);

    if (actionable.length === 0 || (allActed && matched)) {
      if (actionable.length <= 1 && this.state.street < 4) {
        this.dealRemainingStreetsToShowdown(ctx);
        return;
      }
      if (this.state.street < 4) {
        this.advanceToNextStreet(ctx);
        return;
      }
      this.settleShowdown(ctx);
      return;
    }

    const order = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.playerId);
    this.state.turn = this.nextAlive(ctx, Math.max(0, order.indexOf(playerId)));
    if (!this.state.turn) {
      this.dealRemainingStreetsToShowdown(ctx);
      return;
    }
    ctx.markDirty();
  }

  private advanceToNextStreet(ctx: RoomContext): void {
    this.state.street = (this.state.street + 1) as 1 | 2 | 3 | 4;
    const alive = this.aliveIds(ctx);

    let cursor = this.state.deckCursor;
    for (const id of alive) {
      const hand = this.state.hands.get(id) ?? [];
      if (cursor < this.state.deck.length) {
        hand.push(this.state.deck[cursor++]!);
      }
      this.state.hands.set(id, hand);
    }
    this.state.deckCursor = cursor;

    this.state.roundBet.clear();
    this.state.acted.clear();
    this.state.currentBet = 0;
    // 清理普通动作标签，保留弃牌/全压
    for (const [id, tag] of this.state.actionTags.entries()) {
      if (tag.type !== 'fold' && tag.type !== 'allin') {
        this.state.actionTags.delete(id);
      }
    }

    this.state.turn = this.findLeadPlayer(ctx);
    this.emitAction('street', '', '荷官', undefined, `派发第 ${this.state.street + 1} 张明牌`);
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

    const winNames = results
      .filter((r) => winners.includes(r.playerId))
      .map((r) => `${r.nickname}(${r.handLabel})`)
      .join('、');
    this.emitAction('showdown', winners[0] ?? '', winNames || '摊牌', pot, '五张决战开牌');

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
    if (this.state.folded.has(playerId) || this.state.allIn.has(playerId)) return null;

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
    const myRawHand = viewerId ? this.state.hands.get(viewerId) ?? [] : [];
    const myHandLabel = describePartialStudHand(myRawHand);

    return {
      gameVariant: 'stud',
      canLook: false,
      phase: this.state.settled ? 'settled' : 'playing',
      round: ctx.config.round,
      remainMs: 0,
      phaseDurationMs: 0,
      turn: this.state.turn,
      currentBet: this.state.currentBet,
      pot: [...this.state.totalBet.values()].reduce((sum, value) => sum + value, 0),
      myCards: myRawHand.map((c) => ({
        id: c.id,
        rank: c.rank,
        suit: c.suit,
      })),
      myHandLabel,
      myTotalBet: viewerId ? this.state.totalBet.get(viewerId) ?? 0 : 0,
      toCall: viewerId
        ? Math.max(0, this.state.currentBet - (this.state.roundBet.get(viewerId) ?? 0))
        : this.state.currentBet,
      raiseUnit: RAISE_UNIT,
      maxRaiseAdd: MAX_RAISE_ADD,
      street: this.state.street,
      allIn: [...this.state.allIn],
      lastAction: this.state.lastAction,
      players: ctx.players.map((p) => {
        const hand = this.state.hands.get(p.playerId) ?? [];
        return {
          playerId: p.playerId,
          nickname: p.nickname,
          seat: p.seat,
          isBot: p.isBot,
          folded: this.state.folded.has(p.playerId),
          isAllIn: this.state.allIn.has(p.playerId),
          actionTag: this.state.actionTags.get(p.playerId) ?? null,
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
