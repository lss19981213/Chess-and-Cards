import type { GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';
import { badRequest, illegalAction } from '@cc/protocol';
import {
  BaseGamePlugin,
  DOUDIZHU_RULES,
  canBeat,
  createCardDeck,
  parseCombo,
  shuffleWithSeed,
  type Card,
  type Combo,
  type GameIntent,
  type RoomContext,
} from '@cc/game-sdk';

const LANDLORD_WIN = 200;
const FARMER_LOSE = 100;

interface State {
  hands: Map<string, Card[]>;
  bottomCards: Card[];
  landlordId: string | null;
  turn: string | null;
  lastCombo: Combo | null;
  lastPlayerId: string | null;
  passCount: number;
  finished: string[];
  settled: boolean;
  /** 各家已出牌记录，用于前端展示上一手 */
  lastPlays: Map<string, string[]>;
}

function emptyState(): State {
  return {
    hands: new Map(),
    bottomCards: [],
    landlordId: null,
    turn: null,
    lastCombo: null,
    lastPlayerId: null,
    passCount: 0,
    finished: [],
    settled: false,
    lastPlays: new Map(),
  };
}

function sortHand(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => b.rank - a.rank || a.suit.localeCompare(b.suit));
}

/**
 * 斗地主（简化版）：
 * 座位最小者为地主并直接获得三张底牌，其余为农民，地主先出。
 * 省略叫地主与加倍环节，聚焦出牌与牌型判定。
 */
export class DoudizhuPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta = {
    gameId: 'doudizhu',
    name: '斗地主',
    description: '经典三人斗地主，地主对战两名农民',
    icon: '🃏',
    minPlayers: 3,
    maxPlayers: 3,
    version: '1.0.0',
    clientBundle: 'builtin:doudizhu',
    tags: ['牌类', '三人', '热门'],
  };

  override readonly commands: readonly string[] = ['play', 'pass'];

  private state: State = emptyState();

  override onRoundStart(ctx: RoomContext): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    this.state = emptyState();

    const deck = shuffleWithSeed(createCardDeck([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], true), ctx.config.seed);
    players.forEach((player, index) => {
      this.state.hands.set(player.playerId, sortHand(deck.slice(index * 17, index * 17 + 17)));
    });
    this.state.bottomCards = deck.slice(51, 54);

    const landlord = players[0]?.playerId ?? null;
    this.state.landlordId = landlord;
    if (landlord) {
      const hand = this.state.hands.get(landlord) ?? [];
      this.state.hands.set(landlord, sortHand([...hand, ...this.state.bottomCards]));
    }
    this.state.turn = landlord;
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

    this.state.hands.set(playerId, hand);
    this.state.lastCombo = combo;
    this.state.lastPlayerId = playerId;
    this.state.lastPlays.set(playerId, chosen.map((c) => c.id));
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
    if (this.state.settled || !this.state.landlordId) return;
    const remaining = ctx.players.filter((p) => p.playerId !== playerId);
    if (remaining.length === 0) return;
    // 地主逃跑则农民胜，农民逃跑则地主胜
    const winner = playerId === this.state.landlordId ? remaining[0]!.playerId : this.state.landlordId;
    this.settleWin(ctx, winner);
    ctx.markDirty();
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const myHand = viewerId ? (this.state.hands.get(viewerId) ?? []) : [];
    const viewerIsLandlord = viewerId !== null && viewerId === this.state.landlordId;

    return {
      turn: this.state.turn,
      myHand,
      landlordId: this.state.landlordId,
      viewerIsLandlord,
      bottomCards: this.state.bottomCards,
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
      })),
      finished: this.state.finished,
    };
  }

  private settleWin(ctx: RoomContext, winnerId: string): void {
    if (this.state.settled) return;
    this.state.settled = true;

    const landlordId = this.state.landlordId;
    const landlordWins = winnerId === landlordId;

    const entries: SettlementEntry[] = ctx.players.map((p) => {
      if (p.playerId === landlordId) {
        return {
          playerId: p.playerId,
          currency: 'coin' as const,
          delta: landlordWins ? LANDLORD_WIN : -LANDLORD_WIN,
          reason: 'doudizhu.result',
        };
      }
      return {
        playerId: p.playerId,
        currency: 'coin' as const,
        delta: landlordWins ? -FARMER_LOSE : FARMER_LOSE,
        reason: 'doudizhu.result',
      };
    });

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
