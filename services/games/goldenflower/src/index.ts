import type { BotDifficulty, GameMeta, GameSnapshot } from '@cc/protocol';
import type { GameIntent, RoomContext } from '@cc/game-sdk';
import { BaseGamePlugin, createPokerDeck, decidePokerBotAction, shuffleWithSeed, type Card } from '@cc/game-sdk';

const ANTE = 50;
const RAISE_UNIT = 100;
const MAX_RAISES = 6;
/** 单次加注/全压上限与平台钱包单笔扣款限额对齐 */
const MAX_RAISE_ADD = 100_000_000;
const HAND_SIZE = 3;

interface ResultRow {
  playerId: string;
  nickname: string;
  delta: number;
  handLabel: string;
  cards: Card[];
  folded: boolean;
}

interface ActionTag {
  type: 'look' | 'fold' | 'check' | 'call' | 'raise' | 'allin';
  label: string;
  amount?: number;
}

interface ActionEvent {
  seq: number;
  type: 'deal' | 'look' | 'fold' | 'check' | 'call' | 'raise' | 'allin' | 'showdown';
  playerId: string;
  nickname: string;
  amount?: number;
  detail?: string;
}

interface State {
  deck: Card[];
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
  looked: Set<string>;
}

function emptyState(): State {
  return {
    deck: [],
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
    looked: new Set(),
  };
}

/** 翻金花牌型：豹子 > 同花顺 > 金花 > 顺子 > 对子 > 散牌 */
function rankHand(cards: Card[]): { category: number; label: string; high: number } {
  if (cards.length < 3) return { category: 0, label: '待发牌', high: 0 };
  const ranks = cards.map((c) => c.rank).sort((a, b) => b - a);
  const suits = cards.map((c) => c.suit);
  const sameSuit = suits.every((s) => s === suits[0]);
  if (ranks[0] === ranks[1] && ranks[1] === ranks[2]) {
    return { category: 6, label: '豹子', high: ranks[0]! };
  }
  const lows = ranks.map((r) => (r === 14 ? 1 : r)).sort((a, b) => a - b);
  const [l0, l1, l2] = lows as [number, number, number];
  let consecutive = l0 + 1 === l1 && l1 + 1 === l2;
  if (!consecutive && ranks[0] === 14 && ranks[1] === 13 && ranks[2] === 12) consecutive = true;
  const high = ranks[0] === 14 && ranks[1] === 13 ? 14 : l2;

  if (sameSuit && consecutive) return { category: 5, label: '同花顺', high };
  if (sameSuit) return { category: 4, label: '金花', high };
  if (consecutive) return { category: 3, label: '顺子', high };
  if (ranks[0] === ranks[1] || ranks[1] === ranks[2]) {
    const pairRank = ranks[0] === ranks[1] ? ranks[0]! : ranks[1]!;
    return { category: 2, label: '对子', high: pairRank };
  }
  return { category: 1, label: '散牌', high: ranks[0]! };
}

export class GoldenFlowerPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta = {
    gameId: 'goldenflower',
    name: '翻金花',
    description: '三张牌比大小，豹子同花顺通杀',
    icon: '🌸',
    minPlayers: 2,
    maxPlayers: 6,
    version: '1.1.0',
    clientBundle: '',
    tags: ['牌类', '多人', '竞技'],
    category: 'table',
  };

  override readonly commands = ['fold', 'check', 'call', 'raise', 'look', 'allin', 'compare'] as const;

  private state: State = emptyState();

  private stakeMult(ctx: RoomContext): number {
    return ctx.config.stakeMultiplier ?? 1;
  }

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
    this.state.deck = shuffleWithSeed(createPokerDeck(), ctx.config.seed);

    const ante = ANTE * this.stakeMult(ctx);
    let cursor = 0;
    for (const player of players) {
      const cards: Card[] = [];
      for (let i = 0; i < HAND_SIZE; i += 1) cards.push(this.state.deck[cursor++]!);
      this.state.hands.set(player.playerId, cards);
      this.state.totalBet.set(player.playerId, ante);
      this.state.roundBet.set(player.playerId, ante);
      this.state.raises.set(player.playerId, 0);
    }
    this.state.currentBet = ante;
    this.state.turn = this.nextAlive(ctx, this.state.dealerIndex);
    this.emitAction('deal', '', '系统', ante, '新局发牌 · 各下底注');
    ctx.markDirty();
  }

  override async onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): Promise<void> {
    if (this.state.settled) throw new Error('本局已结束');
    if (this.state.folded.has(playerId)) throw new Error('你已弃牌');

    const actorName = ctx.getPlayer(playerId)?.nickname ?? '玩家';

    // 看牌可在任意时刻由存活玩家触发，看牌后下注翻倍（明注）
    if (intent.cmd === 'look') {
      if (this.state.looked.has(playerId)) throw new Error('你已经看过手牌了');
      this.state.looked.add(playerId);
      this.state.actionTags.set(playerId, { type: 'look', label: '已看牌' });
      this.emitAction('look', playerId, actorName, undefined, '翻牌偷看');
      ctx.markDirty();
      return;
    }

    if (this.state.turn !== playerId) throw new Error('还没轮到你行动');

    const mult = this.state.looked.has(playerId) ? 2 : 1;
    const reqBet = this.state.currentBet * mult;
    const toCall = Math.max(0, reqBet - (this.state.roundBet.get(playerId) ?? 0));

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
        const unit = RAISE_UNIT * this.stakeMult(ctx);
        const rawAdd = intent.payload?.amount;
        let add = unit;
        if (rawAdd !== undefined && rawAdd !== null) {
          add = Number(rawAdd);
          if (!Number.isInteger(add) || add < unit) throw new Error(`加注至少 ${unit}`);
          if (add > MAX_RAISE_ADD) throw new Error(`单次加注上限 ${MAX_RAISE_ADD}`);
        }
        const nextBase = this.state.currentBet + add;
        const target = nextBase * mult;
        const delta = Math.min(MAX_RAISE_ADD, target - (this.state.roundBet.get(playerId) ?? 0));
        if (delta <= 0) throw new Error('加注金额不合法');
        await pay(delta);
        this.commit(playerId, delta);
        this.state.currentBet = nextBase;
        this.state.raises.set(playerId, used + 1);
        this.state.acted.clear();
        this.state.acted.add(playerId);
        this.state.actionTags.set(playerId, { type: 'raise', label: `加注 +${add}`, amount: delta });
        this.emitAction('raise', playerId, actorName, delta, `+${add}`);
        break;
      }
      case 'compare': {
        const others = this.aliveIds(ctx).filter((id) => id !== playerId);
        if (others.length === 0) throw new Error('没有可比牌的对手');
        const requestedTarget = typeof intent.payload?.targetId === 'string' ? intent.payload.targetId : '';
        const targetId = others.includes(requestedTarget) ? requestedTarget : others[0]!;
        const pkCost = Math.max(toCall, this.state.currentBet * mult);
        await pay(pkCost);
        this.commit(playerId, pkCost);
        const myRank = rankHand(this.state.hands.get(playerId) ?? []);
        const oppRank = rankHand(this.state.hands.get(targetId) ?? []);
        const iWin =
          myRank.category > oppRank.category ||
          (myRank.category === oppRank.category && myRank.high > oppRank.high);
        const loserId = iWin ? targetId : playerId;
        const loserName = ctx.getPlayer(loserId)?.nickname ?? '玩家';
        const targetName = ctx.getPlayer(targetId)?.nickname ?? '对手';
        this.state.folded.add(loserId);
        this.state.acted.add(playerId);
        this.state.actionTags.set(loserId, { type: 'fold', label: '比牌淘汰' });
        this.state.actionTags.set(playerId, {
          type: iWin ? 'call' : 'fold',
          label: iWin ? `PK胜 ${targetName}` : '比牌淘汰',
          amount: pkCost,
        });
        this.emitAction('call', playerId, actorName, pkCost, `⚔️ 比牌 ${targetName} · ${loserName} 淘汰`);
        break;
      }
      case 'allin': {
        const unit = RAISE_UNIT * this.stakeMult(ctx);
        const rawAmt = Number(intent.payload?.amount ?? 0);
        const defaultPush = Math.max(toCall + unit * 5, 500 * this.stakeMult(ctx));
        const pushAmount =
          Number.isFinite(rawAmt) && rawAmt > 0
            ? Math.min(MAX_RAISE_ADD, Math.floor(rawAmt))
            : Math.min(MAX_RAISE_ADD, defaultPush);
        if (pushAmount <= 0) throw new Error('筹码不足，无法全压');
        await pay(pushAmount);
        this.commit(playerId, pushAmount);
        const newRoundBet = this.state.roundBet.get(playerId) ?? 0;
        const impliedBase = Math.ceil(newRoundBet / mult);
        if (impliedBase > this.state.currentBet) {
          this.state.currentBet = impliedBase;
          this.state.acted.clear();
        }
        this.state.allIn.add(playerId);
        this.state.acted.add(playerId);
        this.state.actionTags.set(playerId, { type: 'allin', label: `全压 ${pushAmount}`, amount: pushAmount });
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

  private afterAction(ctx: RoomContext, playerId: string): void {
    const alive = this.aliveIds(ctx);
    if (alive.length <= 1) {
      this.settleShowdown(ctx);
      return;
    }
    const actionable = alive.filter((id) => !this.state.allIn.has(id));
    const allActed = actionable.every((id) => this.state.acted.has(id));
    const matched = actionable.every((id) => {
      const expected = this.state.currentBet * (this.state.looked.has(id) ? 2 : 1);
      return (this.state.roundBet.get(id) ?? 0) >= expected;
    });
    if (actionable.length === 0 || (allActed && matched)) {
      this.settleShowdown(ctx);
      return;
    }
    const order = [...ctx.players].sort((a, b) => a.seat - b.seat).map((p) => p.playerId);
    this.state.turn = this.nextAlive(ctx, Math.max(0, order.indexOf(playerId)));
    if (!this.state.turn) {
      this.settleShowdown(ctx);
      return;
    }
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

    const winNames = results
      .filter((r) => winners.includes(r.playerId))
      .map((r) => `${r.nickname}(${r.handLabel})`)
      .join('、');
    this.emitAction('showdown', winners[0] ?? '', winNames || '摊牌', pot, '开牌比大小');

    const entries = results
      .filter((r) => (r.delta !== 0 || this.state.charged.has(r.playerId)) && ctx.getPlayer(r.playerId)?.isBot !== true)
      .map((r) => ({ playerId: r.playerId, currency: 'coin' as const, delta: r.delta, reason: 'goldenflower.result' }));

    ctx.markDirty();
    ctx.settle({ entries, winners });
  }

  override botIntent(ctx: RoomContext, playerId: string, difficulty: BotDifficulty = 'medium'): GameIntent | null {
    if (this.state.settled || this.state.turn !== playerId) return null;
    if (this.state.folded.has(playerId) || this.state.allIn.has(playerId)) return null;
    const mult = this.state.looked.has(playerId) ? 2 : 1;
    const toCall = Math.max(0, this.state.currentBet * mult - (this.state.roundBet.get(playerId) ?? 0));
    const hand = this.state.hands.get(playerId) ?? [];
    const pot = [...this.state.totalBet.values()].reduce((sum, value) => sum + value, 0);
    const canRaise = (this.state.raises.get(playerId) ?? 0) < MAX_RAISES;
    const opponents = Math.max(1, this.aliveIds(ctx).filter((id) => id !== playerId).length);

    return decidePokerBotAction({
      mode: 'goldenflower',
      holeCards: hand,
      communityCards: [],
      knownDeadCards: hand,
      pot,
      toCall,
      canRaise,
      raiseUnit: RAISE_UNIT * this.stakeMult(ctx),
      opponents,
      difficulty,
    });
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const revealAll = this.state.settled;
    const viewerLooked = viewerId ? this.state.looked.has(viewerId) : false;
    const myRawHand = viewerId ? this.state.hands.get(viewerId) ?? [] : [];
    const showMyHand = revealAll || viewerLooked;
    const myHandLabel = showMyHand && myRawHand.length >= 3 ? rankHand(myRawHand).label : '';

    return {
      gameVariant: 'goldenflower',
      canLook: true,
      phase: this.state.settled ? 'settled' : 'playing',
      round: ctx.config.round,
      remainMs: 0,
      phaseDurationMs: 0,
      turn: this.state.turn,
      currentBet: this.state.currentBet,
      pot: [...this.state.totalBet.values()].reduce((sum, value) => sum + value, 0),
      myCards: showMyHand
        ? myRawHand.map((c) => ({ id: c.id, rank: c.rank, suit: c.suit }))
        : [],
      myHandLabel,
      looked: viewerLooked,
      lookedPlayers: [...this.state.looked],
      allIn: [...this.state.allIn],
      lastAction: this.state.lastAction,
      myTotalBet: viewerId ? this.state.totalBet.get(viewerId) ?? 0 : 0,
      toCall: viewerId
        ? Math.max(0, this.state.currentBet * (viewerLooked ? 2 : 1) - (this.state.roundBet.get(viewerId) ?? 0))
        : this.state.currentBet,
      raiseUnit: RAISE_UNIT * this.stakeMult(ctx),
      maxRaiseAdd: MAX_RAISE_ADD,
      players: ctx.players.map((p) => {
        const hand = this.state.hands.get(p.playerId) ?? [];
        const canSeeCards = revealAll || (p.playerId === viewerId && viewerLooked);
        return {
          playerId: p.playerId,
          nickname: p.nickname,
          seat: p.seat,
          isBot: p.isBot,
          folded: this.state.folded.has(p.playerId),
          isAllIn: this.state.allIn.has(p.playerId),
          actionTag: this.state.actionTags.get(p.playerId) ?? null,
          cards: canSeeCards
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
