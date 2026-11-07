import type { GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';
import { badRequest, illegalAction } from '@cc/protocol';
import {
  BaseGamePlugin,
  PAODEKUAI_RULES,
  canBeat,
  createCardDeck,
  parseCombo,
  shuffleWithSeed,
  type Card,
  type Combo,
  type GameIntent,
  type RoomContext,
} from '@cc/game-sdk';

const WIN_COIN = 200;
const LOSE_COIN = 100;

interface State {
  hands: Map<string, Card[]>;
  turn: string | null;
  lastCombo: Combo | null;
  lastPlayerId: string | null;
  passCount: number;
  finished: string[];
  settled: boolean;
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

    // 由种子决定首家，保证每局可复现
    const startIndex = Number.parseInt(ctx.config.seed.slice(0, 2), 16) % Math.max(players.length, 1);
    this.state.turn = players[startIndex]?.playerId ?? null;
    ctx.markDirty();
  }

  override onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): void {
    if (this.state.settled) throw illegalAction('本局已结束');
    if (this.state.turn !== playerId) throw illegalAction('还没轮到你出牌');

    if (intent.cmd === 'pass') {
      if (!this.state.lastCombo || this.state.lastPlayerId === playerId) {
        throw illegalAction('新一轮必须出牌');
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
      // 回滚
      for (const card of chosen) hand.push(card);
      throw illegalAction('牌型不合法');
    }
    if (!canBeat(combo, this.state.lastCombo)) {
      for (const card of chosen) hand.push(card);
      throw illegalAction('出的牌压不过上家');
    }

    this.state.hands.set(playerId, hand);
    this.state.lastCombo = combo;
    this.state.lastPlayerId = playerId;
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

  override botIntent(ctx: RoomContext, playerId: string): GameIntent | null {
    if (this.state.settled || this.state.turn !== playerId) return null;

    const hand = this.state.hands.get(playerId) ?? [];
    if (hand.length === 0) return null;

    const prev = this.state.lastCombo;
    const isLead = !prev || this.state.lastPlayerId === playerId;

    if (isLead) {
      const smallest = [...hand].sort((a, b) => a.rank - b.rank)[0];
      return smallest ? { cmd: 'play', payload: { cards: [smallest.id] } } : null;
    }

    const byRank = new Map<number, Card[]>();
    for (const card of hand) {
      const list = byRank.get(card.rank) ?? [];
      list.push(card);
      byRank.set(card.rank, list);
    }
    const ranks = [...byRank.keys()].sort((a, b) => a - b);

    const valid = (cards: Card[]): Card[] | null => {
      const combo = parseCombo(cards, PAODEKUAI_RULES);
      return combo && canBeat(combo, prev) ? cards : null;
    };

    if (prev.kind === 'single' || prev.kind === 'pair' || prev.kind === 'triple') {
      const need = prev.kind === 'single' ? 1 : prev.kind === 'pair' ? 2 : 3;
      for (const rank of ranks) {
        if (rank <= prev.main) continue;
        const cards = byRank.get(rank) ?? [];
        if (cards.length < need) continue;
        const picked = valid(cards.slice(0, need));
        if (picked) return { cmd: 'play', payload: { cards: picked.map((card) => card.id) } };
      }
    }

    for (const rank of ranks) {
      const cards = byRank.get(rank) ?? [];
      if (cards.length !== 4) continue;
      if (prev.kind === 'bomb' && rank <= prev.main) continue;
      const picked = valid(cards);
      if (picked) return { cmd: 'play', payload: { cards: picked.map((card) => card.id) } };
    }

    return { cmd: 'pass', payload: {} };
  }

  private settleWin(ctx: RoomContext, winnerId: string): void {
    if (this.state.settled) return;
    this.state.settled = true;
    const entries: SettlementEntry[] = ctx.players.map((p) => ({
      playerId: p.playerId,
      currency: 'coin' as const,
      delta: p.playerId === winnerId ? WIN_COIN : -LOSE_COIN,
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
