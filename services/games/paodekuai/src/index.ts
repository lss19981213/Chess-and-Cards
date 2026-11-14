import type { BotDifficulty, GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';
import { badRequest, illegalAction } from '@cc/protocol';
import {
  BaseGamePlugin,
  PAODEKUAI_RULES,
  canBeat,
  createCardDeck,
  findAllBeatingMoves,
  decideCardBotAction,
  parseCombo,
  shuffleWithSeed,
  type Card,
  type Combo,
  type GameIntent,
  type RoomContext,
} from '@cc/game-sdk';

interface State {
  hands: Map<string, Card[]>;
  turn: string | null;
  lastCombo: Combo | null;
  lastPlayerId: string | null;
  passCount: number;
  finished: string[];
  settled: boolean;
  /** 本局已打出的全部牌，供高难度记牌 */
  playedCards: Card[];
  firstTrick: boolean;
  leadCardId: string | null;
}

function emptyState(): State {
  return {
    hands: new Map(),
    turn: null,
    lastCombo: null,
    lastPlayerId: null,
    passCount: 0,
    finished: [],
    settled: false,
    playedCards: [],
    firstTrick: false,
    leadCardId: null,
  };
}

/** 48 张牌：去掉大小王、3 张 2、1 张 A，三人各 16 张 */
function buildDeck(seed: string): Card[] {
  const full = createCardDeck([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], false);
  let removedTwos = 0;
  let removedAces = 0;
  const filtered = full.filter((card) => {
    if (card.rank === 15 && removedTwos < 3) {
      removedTwos += 1;
      return false;
    }
    if (card.rank === 14 && removedAces < 1) {
      removedAces += 1;
      return false;
    }
    return true;
  });
  return shuffleWithSeed(filtered, seed);
}

export class PaodekuaiPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta = {
    gameId: 'paodekuai',
    name: '跑得快',
    description: '16 张牌快节奏对局，先跑完者胜',
    icon: '💨',
    minPlayers: 3,
    maxPlayers: 3,
    version: '1.0.0',
    clientBundle: 'builtin:paodekuai',
    tags: ['牌类', '三人', '快节奏'],
    category: 'table',
  };

  override readonly commands: readonly string[] = ['play', 'pass'];

  private state: State = emptyState();

  override onRoundStart(ctx: RoomContext): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    this.state = emptyState();

    const deck = buildDeck(ctx.config.seed);
    players.forEach((player, index) => {
      const hand = deck.slice(index * 16, index * 16 + 16).sort((a, b) => b.rank - a.rank || a.suit.localeCompare(b.suit));
      this.state.hands.set(player.playerId, hand);
    });

    // 跑得快经典首出规则：手持黑桃3（若无则红桃3）的玩家首发，且首出的一手牌必须带此牌
    let leadPlayerId = players[0]?.playerId ?? null;
    let leadCardId: string | null = null;
    for (const [pid, hand] of this.state.hands) {
      const sp3 = hand.find((c) => c.rank === 3 && c.suit === 'S');
      if (sp3) {
        leadPlayerId = pid;
        leadCardId = sp3.id;
        break;
      }
    }
    if (!leadCardId) {
      for (const [pid, hand] of this.state.hands) {
        const h3 = hand.find((c) => c.rank === 3 && c.suit === 'H');
        if (h3) {
          leadPlayerId = pid;
          leadCardId = h3.id;
          break;
        }
      }
    }
    this.state.turn = leadPlayerId;
    this.state.firstTrick = true;
    this.state.leadCardId = leadCardId;
    ctx.markDirty();
  }

  override onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): void {
    if (this.state.settled) throw illegalAction('本局已结束');
    if (this.state.turn !== playerId) throw illegalAction('还没轮到你出牌');

    if (intent.cmd === 'pass') {
      if (!this.state.lastCombo || this.state.lastPlayerId === playerId) {
        throw illegalAction('新一轮必须出牌');
      }
      // 跑得快核心规则：能管必管，手中有可压制的牌型时不得过牌
      const myHand = this.state.hands.get(playerId) ?? [];
      const beating = findAllBeatingMoves(myHand, this.state.lastCombo, PAODEKUAI_RULES);
      if (beating.length > 0) {
        throw illegalAction('跑得快规则：能管必管，手中有牌可以大过上家，不能过牌');
      }
      this.state.passCount += 1;

      const activeCount = ctx.players.length;
      if (this.state.passCount >= activeCount - 1) {
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

    const combo = parseCombo(chosen, PAODEKUAI_RULES);
    if (!combo) {
      for (const card of chosen) hand.push(card);
      throw illegalAction('牌型不合法');
    }

    // 首出必须包含先手黑桃/红桃3
    if (this.state.firstTrick && this.state.leadCardId) {
      const hasLead = chosen.some((c) => c.id === this.state.leadCardId);
      if (!hasLead) {
        for (const card of chosen) hand.push(card);
        throw illegalAction('跑得快首出规则：首出的一手牌必须包含黑桃/红桃3');
      }
    }

    if (!canBeat(combo, this.state.lastCombo)) {
      for (const card of chosen) hand.push(card);
      throw illegalAction('出的牌压不过上家');
    }

    // 跑得快报单顶大规则：下家只剩1张牌时，出单张必须出手中最大的单张
    const nextPid = this.nextPlayer(ctx, playerId);
    const nextHand = nextPid ? this.state.hands.get(nextPid) ?? [] : [];
    if (nextHand.length === 1 && combo.kind === 'single') {
      const remainingSingles = hand.map((c) => c.rank);
      const maxSingleInHand = Math.max(combo.main, ...remainingSingles);
      if (combo.main < maxSingleInHand) {
        for (const card of chosen) hand.push(card);
        throw illegalAction('跑得快规则：下家已报单，出单张必须出手中最大的牌（报单顶大）');
      }
    }

    this.state.firstTrick = false;

    this.state.hands.set(playerId, hand);
    this.state.lastCombo = combo;
    this.state.lastPlayerId = playerId;
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
    this.settleWin(ctx, remaining[0]!.playerId);
    ctx.markDirty();
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const myHand = viewerId ? (this.state.hands.get(viewerId) ?? []) : [];

    return {
      turn: this.state.turn,
      myHand,
      handCounts: players.map((p) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        seat: p.seat,
        count: (this.state.hands.get(p.playerId) ?? []).length,
      })),
      lastCombo: this.state.lastCombo
        ? {
            kind: this.state.lastCombo.kind,
            main: this.state.lastCombo.main,
            size: this.state.lastCombo.size,
            cards: this.state.lastCombo.cards,
          }
        : null,
      lastPlayerId: this.state.lastPlayerId,
      passCount: this.state.passCount,
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

    const action = decideCardBotAction({
      hand,
      prevCombo: this.state.lastCombo,
      lastPlayerId: this.state.lastPlayerId,
      myId: playerId,
      rules: PAODEKUAI_RULES,
      difficulty,
      playedCards: this.state.playedCards,
      handCounts: ctx.players.map((p) => ({
        playerId: p.playerId,
        count: (this.state.hands.get(p.playerId) ?? []).length,
      })),
    });
    if (!action) return null;
    if (action.cmd === 'pass') return { cmd: 'pass', payload: {} };
    return { cmd: 'play', payload: { cards: action.cards.map((c) => c.id) } };
  }

  private settleWin(ctx: RoomContext, winnerId: string): void {
    if (this.state.settled) return;
    this.state.settled = true;
    const BASE_PER_CARD = 10;
    let totalWin = 0;
    const loserDeltas = new Map<string, number>();

    for (const p of ctx.players) {
      if (p.playerId === winnerId) continue;
      const leftCount = (this.state.hands.get(p.playerId) ?? []).length;
      // 若一张未出（全关/关门），扣分翻倍
      const multiplier = leftCount >= 16 ? 2 : 1;
      const loss = leftCount * BASE_PER_CARD * multiplier;
      loserDeltas.set(p.playerId, -loss);
      totalWin += loss;
    }

    const entries: SettlementEntry[] = ctx.players.map((p) => ({
      playerId: p.playerId,
      currency: 'coin' as const,
      delta: p.playerId === winnerId ? totalWin : (loserDeltas.get(p.playerId) ?? -100),
      reason: 'paodekuai.result',
    }));
    ctx.settle({ entries, winners: [winnerId] });
  }

  private nextPlayer(ctx: RoomContext, currentId: string): string | null {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const index = players.findIndex((p) => p.playerId === currentId);
    if (index < 0) return players[0]?.playerId ?? null;
    return players[(index + 1) % players.length]?.playerId ?? null;
  }
}

export default PaodekuaiPlugin;
