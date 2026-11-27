import type { BotDifficulty, GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';
import { badRequest, illegalAction } from '@cc/protocol';
import {
  BaseGamePlugin,
  DOUDIZHU_RULES,
  canBeat,
  createCardDeck,
  decideCardBotAction,
  parseCombo,
  shuffleWithSeed,
  type Card,
  type Combo,
  type GameIntent,
  type RoomContext,
} from '@cc/game-sdk';

const BASE_STAKE = 100;

type DdzPhase = 'bidding' | 'doubling' | 'playing' | 'settled';

interface State {
  phase: DdzPhase;
  hands: Map<string, Card[]>;
  bottomCards: Card[];
  landlordId: string | null;
  turn: string | null;
  bidOrder: string[];
  bids: Map<string, number>;
  highestBid: number;
  highestBidder: string | null;
  doubleOrder: string[];
  doubles: Map<string, number>;
  bombCount: number;
  landlordPlays: number;
  farmerPlays: number;
  lastCombo: Combo | null;
  lastPlayerId: string | null;
  passCount: number;
  finished: string[];
  settled: boolean;
  /** 各家已出牌记录，用于前端展示上一手 */
  lastPlays: Map<string, string[]>;
  /** 本局已打出的全部牌，供高难度记牌与客户端记牌器 */
  playedCards: Card[];
}

function emptyState(): State {
  return {
    phase: 'bidding',
    hands: new Map(),
    bottomCards: [],
    landlordId: null,
    turn: null,
    bidOrder: [],
    bids: new Map(),
    highestBid: 0,
    highestBidder: null,
    doubleOrder: [],
    doubles: new Map(),
    bombCount: 0,
    landlordPlays: 0,
    farmerPlays: 0,
    lastCombo: null,
    lastPlayerId: null,
    passCount: 0,
    finished: [],
    settled: false,
    lastPlays: new Map(),
    playedCards: [],
  };
}

function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => b.rank - a.rank || a.suit.localeCompare(b.suit));
}

/** 评估起手叫分强度（大小王、2、炸弹、A） */
function evaluateBidScore(hand: readonly Card[]): number {
  let pts = 0;
  const counts = new Map<number, number>();
  for (const c of hand) {
    counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
    if (c.rank === 17) pts += 4;
    else if (c.rank === 16) pts += 3;
    else if (c.rank === 15) pts += 2;
    else if (c.rank === 14) pts += 0.6;
  }
  for (const n of counts.values()) {
    if (n === 4) pts += 4;
  }
  if (counts.has(16) && counts.has(17)) pts += 3;
  if (pts >= 10) return 3;
  if (pts >= 6.5) return 2;
  if (pts >= 3.5) return 1;
  return 0;
}

/**
 * 经典三人斗地主：
 * 完整支持 叫分抢地主（1/2/3分/不叫）→ 农民与地主加倍（×2）→ 炸弹/王炸翻倍 → 春天/反春天翻倍，
 * 并按房间底注档位倍率（stakeMultiplier）结算。
 */
export class DoudizhuPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta = {
    gameId: 'doudizhu',
    name: '斗地主',
    description: '经典三人斗地主，完整叫分抢地主、加倍与春天翻倍对抗',
    icon: '🃏',
    minPlayers: 3,
    maxPlayers: 3,
    version: '1.2.0',
    clientBundle: 'builtin:doudizhu',
    tags: ['牌类', '三人', '热门'],
    category: 'table',
  };

  override readonly commands: readonly string[] = ['bid', 'double', 'play', 'pass'];

  private state: State = emptyState();

  override onRoundStart(ctx: RoomContext): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    this.state = emptyState();

    const deck = shuffleWithSeed(createCardDeck([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], true), ctx.config.seed);
    players.forEach((player, index) => {
      this.state.hands.set(player.playerId, sortHand(deck.slice(index * 17, index * 17 + 17)));
    });
    this.state.bottomCards = deck.slice(51, 54);

    if (players.length > 0) {
      const startIdx = Math.max(0, ctx.config.round - 1) % players.length;
      const order: string[] = [];
      for (let i = 0; i < players.length; i += 1) {
        order.push(players[(startIdx + i) % players.length]!.playerId);
      }
      this.state.bidOrder = order;
      this.state.phase = 'bidding';
      this.state.turn = order[0] ?? null;
    }
    ctx.markDirty();
  }

  private finalizeBidding(ctx: RoomContext): void {
    const landlord = this.state.highestBidder ?? this.state.bidOrder[0] ?? ctx.players[0]?.playerId ?? null;
    if (this.state.highestBid <= 0) this.state.highestBid = 1;
    this.state.landlordId = landlord;
    if (landlord) {
      const hand = this.state.hands.get(landlord) ?? [];
      this.state.hands.set(landlord, sortHand([...hand, ...this.state.bottomCards]));
    }
    const farmers = ctx.players
      .filter((p) => p.playerId !== landlord)
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.playerId);
    this.state.doubleOrder = landlord ? [...farmers, landlord] : farmers;
    this.state.phase = 'doubling';
    this.state.turn = this.state.doubleOrder[0] ?? landlord;
  }

  override onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): void {
    if (this.state.settled) throw illegalAction('本局已结束');
    if (this.state.turn !== playerId) throw illegalAction('还没轮到你行动');

    if (intent.cmd === 'bid') {
      if (this.state.phase !== 'bidding') throw illegalAction('当前不在叫分阶段');
      const score = Math.floor(Number(intent.payload.score ?? 0));
      if (![0, 1, 2, 3].includes(score)) throw badRequest('叫分只能为 0（不叫）、1、2、3 分');
      if (score > 0 && score <= this.state.highestBid) {
        throw illegalAction(`必须叫出高于当前 ${this.state.highestBid} 分的叫分`);
      }

      this.state.bids.set(playerId, score);
      if (score > this.state.highestBid) {
        this.state.highestBid = score;
        this.state.highestBidder = playerId;
      }

      if (score === 3 || this.state.bids.size >= this.state.bidOrder.length) {
        this.finalizeBidding(ctx);
      } else {
        const idx = this.state.bidOrder.indexOf(playerId);
        this.state.turn = this.state.bidOrder[(idx + 1) % this.state.bidOrder.length] ?? null;
      }
      ctx.markDirty();
      return;
    }

    if (intent.cmd === 'double') {
      if (this.state.phase !== 'doubling') throw illegalAction('当前不在加倍阶段');
      const factor = Number(intent.payload.factor) === 2 ? 2 : 1;
      this.state.doubles.set(playerId, factor);

      if (this.state.doubles.size >= this.state.doubleOrder.length) {
        this.state.phase = 'playing';
        this.state.turn = this.state.landlordId;
      } else {
        const idx = this.state.doubleOrder.indexOf(playerId);
        this.state.turn = this.state.doubleOrder[(idx + 1) % this.state.doubleOrder.length] ?? this.state.landlordId;
      }
      ctx.markDirty();
      return;
    }

    if (this.state.phase !== 'playing') throw illegalAction('请先完成叫分与加倍阶段');

    if (intent.cmd === 'pass') {
      if (!this.state.lastCombo || this.state.lastPlayerId === playerId) {
        throw illegalAction('新一轮必须出牌');
      }
      this.state.passCount += 1;
      this.state.lastPlays.set(playerId, []);

      if (this.state.passCount >= ctx.players.length - 1) {
        this.state.lastCombo = null;
        this.state.passCount = 0;
        this.state.turn = this.state.lastPlayerId ?? this.nextPlayer(ctx, playerId);
        this.state.lastPlayerId = null;
      } else {
        this.state.turn = this.nextPlayer(ctx, playerId);
      }
      ctx.markDirty();
      return;
    }

    if (intent.cmd !== 'play') throw badRequest(`未知指令: ${intent.cmd}`);

    const rawIds = Array.isArray(intent.payload.cards) ? intent.payload.cards : [];
    const ids = rawIds.filter((id): id is string => typeof id === 'string');
    if (ids.length === 0) throw badRequest('请选择要出的牌');

    const hand = this.state.hands.get(playerId) ?? [];
    const chosen: Card[] = [];
    for (const id of ids) {
      const index = hand.findIndex((card) => card.id === id);
      if (index < 0) throw illegalAction('手牌中没有该牌');
      const [card] = hand.splice(index, 1);
      if (card) chosen.push(card);
    }

    const combo = parseCombo(chosen, DOUDIZHU_RULES);
    if (!combo) {
      hand.push(...chosen);
      throw illegalAction('牌型不合法');
    }
    if (!canBeat(combo, this.state.lastCombo)) {
      hand.push(...chosen);
      throw illegalAction('出的牌压不过上家');
    }

    if (combo.kind === 'bomb' || combo.kind === 'rocket') {
      this.state.bombCount += 1;
    }
    if (playerId === this.state.landlordId) this.state.landlordPlays += 1;
    else this.state.farmerPlays += 1;

    this.state.hands.set(playerId, hand);
    this.state.lastCombo = combo;
    this.state.lastPlayerId = playerId;
    this.state.lastPlays.set(playerId, chosen.map((c) => c.id));
    this.state.playedCards.push(...chosen);
    this.state.passCount = 0;

    if (hand.length === 0) {
      this.state.finished = [playerId];
      this.settleWin(ctx, playerId);
      ctx.markDirty();
      return;
    }

    this.state.turn = this.nextPlayer(ctx, playerId);
    ctx.markDirty();
  }

  override onPlayerLeave(ctx: RoomContext, playerId: string): void {
    if (this.state.settled) return;
    const remaining = ctx.players.filter((p) => p.playerId !== playerId);
    if (remaining.length === 0) return;
    if (!this.state.landlordId) {
      this.state.landlordId = this.state.highestBidder ?? this.state.bidOrder[0] ?? remaining[0]!.playerId;
      if (this.state.highestBid <= 0) this.state.highestBid = 1;
    }
    // 地主逃跑则农民胜，农民逃跑则地主胜
    const winner = playerId === this.state.landlordId ? remaining[0]!.playerId : this.state.landlordId;
    this.settleWin(ctx, winner);
    ctx.markDirty();
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const myHand = viewerId ? (this.state.hands.get(viewerId) ?? []) : [];
    const viewerIsLandlord = viewerId !== null && viewerId === this.state.landlordId;
    const landlordRevealed = this.state.phase === 'doubling' || this.state.phase === 'playing' || this.state.settled;
    const bidMult = Math.max(1, this.state.highestBid);
    const bombMult = Math.pow(2, this.state.bombCount);
    const springMult = this.isSpring() ? 2 : 1;
    const landlordDouble = this.state.landlordId ? (this.state.doubles.get(this.state.landlordId) ?? 1) : 1;

    return {
      phase: this.state.phase,
      turn: this.state.turn,
      myHand,
      landlordId: this.state.landlordId,
      viewerIsLandlord,
      bottomCards: landlordRevealed ? this.state.bottomCards : [],
      highestBid: this.state.highestBid,
      bids: [...this.state.bids.entries()].map(([playerId, score]) => ({ playerId, score })),
      doubles: [...this.state.doubles.entries()].map(([playerId, factor]) => ({ playerId, factor })),
      bombCount: this.state.bombCount,
      multiplier: bidMult * bombMult * springMult * landlordDouble,
      stakeMultiplier: ctx.config.stakeMultiplier ?? 1,
      playedCards: this.state.playedCards,
      lastCombo: this.state.lastCombo
        ? {
            kind: this.state.lastCombo.kind,
            main: this.state.lastCombo.main,
            size: this.state.lastCombo.size,
            cards: this.state.lastCombo.cards,
          }
        : null,
      lastPlayerId: this.state.lastPlayerId,
      lastPlays: [...this.state.lastPlays.entries()].map(([playerId, cards]) => ({ playerId, cards })),
      handCounts: players.map((p) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        seat: p.seat,
        count: (this.state.hands.get(p.playerId) ?? []).length,
        isLandlord: p.playerId === this.state.landlordId,
        bid: this.state.bids.get(p.playerId) ?? null,
        doubled: (this.state.doubles.get(p.playerId) ?? 1) === 2,
      })),
      finished: this.state.finished,
    };
  }

  override getCurrentActor(): string | null {
    return this.state.settled ? null : this.state.turn;
  }

  override botIntent(ctx: RoomContext, playerId: string, difficulty: BotDifficulty = 'medium'): GameIntent | null {
    if (this.state.settled || this.state.turn !== playerId) return null;

    const hand = this.state.hands.get(playerId) ?? [];
    if (hand.length === 0) return null;

    if (this.state.phase === 'bidding') {
      const wanted = evaluateBidScore(hand);
      const score = wanted > this.state.highestBid ? wanted : 0;
      return { cmd: 'bid', payload: { score } };
    }

    if (this.state.phase === 'doubling') {
      const wanted = evaluateBidScore(hand);
      const factor = wanted >= 2 ? 2 : 1;
      return { cmd: 'double', payload: { factor } };
    }

    const action = decideCardBotAction({
      hand,
      prevCombo: this.state.lastCombo,
      lastPlayerId: this.state.lastPlayerId,
      myId: playerId,
      rules: DOUDIZHU_RULES,
      difficulty,
      playedCards: this.state.playedCards,
      landlordId: this.state.landlordId,
      handCounts: ctx.players.map((p) => ({
        playerId: p.playerId,
        count: (this.state.hands.get(p.playerId) ?? []).length,
        isLandlord: p.playerId === this.state.landlordId,
      })),
    });
    if (!action) return null;
    if (action.cmd === 'pass') return { cmd: 'pass', payload: {} };
    return { cmd: 'play', payload: { cards: action.cards.map((c) => c.id) } };
  }

  private isSpring(): boolean {
    if (!this.state.settled || this.state.finished.length === 0) return false;
    const winnerId = this.state.finished[0];
    if (winnerId === this.state.landlordId) {
      return this.state.farmerPlays === 0;
    }
    return this.state.landlordPlays <= 1;
  }

  private settleWin(ctx: RoomContext, winnerId: string): void {
    if (this.state.settled) return;
    this.state.settled = true;
    this.state.phase = 'settled';

    const landlordId = this.state.landlordId;
    const landlordWins = winnerId === landlordId;
    const stakeMult = ctx.config.stakeMultiplier ?? 1;
    const bidMult = Math.max(1, this.state.highestBid);
    const bombMult = Math.pow(2, this.state.bombCount);
    const springMult = this.isSpring() ? 2 : 1;
    const landlordDouble = landlordId ? (this.state.doubles.get(landlordId) ?? 1) : 1;

    let landlordTotal = 0;
    const farmerEntries: SettlementEntry[] = [];
    for (const p of ctx.players) {
      if (p.playerId === landlordId) continue;
      const farmerDouble = this.state.doubles.get(p.playerId) ?? 1;
      const magnitude = BASE_STAKE * stakeMult * bidMult * bombMult * springMult * landlordDouble * farmerDouble;
      const delta = landlordWins ? -magnitude : magnitude;
      landlordTotal -= delta;
      farmerEntries.push({
        playerId: p.playerId,
        currency: 'coin' as const,
        delta,
        reason: 'doudizhu.result',
      });
    }

    const entries: SettlementEntry[] = [
      ...(landlordId
        ? [
            {
              playerId: landlordId,
              currency: 'coin' as const,
              delta: landlordTotal,
              reason: 'doudizhu.result',
            },
          ]
        : []),
      ...farmerEntries,
    ];

    const winners = landlordWins
      ? [landlordId ?? winnerId]
      : ctx.players.filter((p) => p.playerId !== landlordId).map((p) => p.playerId);

    ctx.settle({ entries, winners });
  }

  private nextPlayer(ctx: RoomContext, currentId: string): string | null {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const index = players.findIndex((p) => p.playerId === currentId);
    if (index < 0) return players[0]?.playerId ?? null;
    return players[(index + 1) % players.length]?.playerId ?? null;
  }
}

export default DoudizhuPlugin;
