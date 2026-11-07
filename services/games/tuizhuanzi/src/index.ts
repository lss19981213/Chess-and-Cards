import type { GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';
import { badRequest, illegalAction } from '@cc/protocol';
import {
  BaseGamePlugin,
  createCardDeck,
  shuffleWithSeed,
  type Card,
  type GameIntent,
  type RoomContext,
} from '@cc/game-sdk';

export const BET_OPTIONS = [100, 200, 300] as const;
const DEFAULT_BET = 100;
const BET_TIMEOUT_MS = 20_000;
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

interface RoundResult {
  playerId: string;
  points: number;
  cards: Card[];
  isBanker: boolean;
  delta: number;
}

interface State {
  phase: 'bet' | 'reveal';
  bankerId: string | null;
  bets: Map<string, number>;
  hands: Map<string, Card[]>;
  points: Map<string, number>;
  deadline: number;
  /** 押注阶段开始时间，用于给机器人留出思考延迟 */
  startAt: number;
  results: RoundResult[];
  settled: boolean;
}

function emptyState(): State {
  return {
    phase: 'bet',
    bankerId: null,
    bets: new Map(),
    hands: new Map(),
    points: new Map(),
    deadline: 0,
    startAt: 0,
    results: [],
    settled: false,
  };
}

/**
 * 推筒子（简化规则）：
 * 庄家固定为座位最小者，闲家先押注，随后每人两张牌比点数（两牌之和取个位，0 点最小）。
 * 点数相同视为庄家胜，符合「庄闲对决、庄家吃平」的惯例。
 */
export class TuizhuanziPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta = {
    gameId: 'tuizhuanzi',
    name: '推筒子',
    description: '两张牌比点数，庄闲对决一局定胜负',
    icon: '🎴',
    minPlayers: 2,
    maxPlayers: 5,
    version: '1.0.0',
    clientBundle: 'builtin:tuizhuanzi',
    tags: ['牌类', '多人', '刺激'],
  };

  override readonly commands: readonly string[] = ['bet'];

  private state: State = emptyState();

  override onRoundStart(ctx: RoomContext): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    this.state = emptyState();
    this.state.bankerId = players[0]?.playerId ?? null;
    this.state.startAt = Date.now();
    this.state.deadline = Date.now() + BET_TIMEOUT_MS;
    ctx.markDirty();
    // 只有庄家一人时无法比牌，直接结束本局
    if (players.length < 2) {
      ctx.settle({ entries: [], winners: [] });
    }
  }

  override onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): void {
    if (this.state.phase !== 'bet') throw illegalAction('当前不在押注阶段');
    if (playerId === this.state.bankerId) throw illegalAction('庄家不能押注');

    const amount = Number(intent.payload.amount ?? DEFAULT_BET);
    if (!BET_OPTIONS.includes(amount as (typeof BET_OPTIONS)[number])) {
      throw badRequest('押注金额不合法');
    }

    this.state.bets.set(playerId, amount);
    ctx.markDirty();

    if (this.allBetsPlaced(ctx)) this.reveal(ctx);
  }

  override onTick(ctx: RoomContext): void {
    if (this.state.phase !== 'bet' || this.state.settled) return;

    // 机器人押注：给一点思考延迟，避免瞬间开牌
    if (Date.now() - this.state.startAt >= 1200) {
      let changed = false;
      for (const player of ctx.players) {
        if (!player.isBot || player.playerId === this.state.bankerId) continue;
        if (this.state.bets.has(player.playerId)) continue;
        this.state.bets.set(player.playerId, DEFAULT_BET);
        changed = true;
      }
      if (changed) ctx.markDirty();
      if (this.allBetsPlaced(ctx)) {
        this.reveal(ctx);
        return;
      }
    }

    if (Date.now() < this.state.deadline) return;

    for (const player of ctx.players) {
      if (player.playerId === this.state.bankerId) continue;
      if (!this.state.bets.has(player.playerId)) {
        this.state.bets.set(player.playerId, DEFAULT_BET);
      }
    }
    this.reveal(ctx);
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const revealed = this.state.phase === 'reveal';

    return {
      phase: this.state.phase,
      bankerId: this.state.bankerId,
      betOptions: BET_OPTIONS,
      deadline: this.state.deadline,
      myBet: viewerId ? (this.state.bets.get(viewerId) ?? null) : null,
      myPoints: viewerId ? (this.state.points.get(viewerId) ?? null) : null,
      results: this.state.results,
      players: players.map((p) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        seat: p.seat,
        isBanker: p.playerId === this.state.bankerId,
        bet: this.state.bets.get(p.playerId) ?? null,
        points: revealed ? (this.state.points.get(p.playerId) ?? null) : null,
        cards: revealed ? (this.state.hands.get(p.playerId) ?? []).map((c) => ({ id: c.id, rank: c.rank })) : [],
      })),
    };
  }

  private allBetsPlaced(ctx: RoomContext): boolean {
    return ctx.players
      .filter((p) => p.playerId !== this.state.bankerId)
      .every((p) => this.state.bets.has(p.playerId));
  }

  private reveal(ctx: RoomContext): void {
    if (this.state.settled) return;
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const bankerId = this.state.bankerId;
    if (!bankerId) {
      ctx.settle({ entries: [], winners: [] });
      return;
    }

    const deck = shuffleWithSeed(createCardDeck(RANKS, false), ctx.config.seed);
    let cursor = 0;
    for (const player of players) {
      const first = deck[cursor];
      const second = deck[cursor + 1];
      cursor += 2;
      if (!first || !second) continue;
      this.state.hands.set(player.playerId, [first, second]);
      this.state.points.set(player.playerId, (first.rank + second.rank) % 10);
    }

    const bankerPoints = this.state.points.get(bankerId) ?? 0;
    const deltas = new Map<string, number>();
    const winners: string[] = [];

    for (const player of players) {
      if (player.playerId === bankerId) continue;
      const bet = this.state.bets.get(player.playerId) ?? DEFAULT_BET;
      const points = this.state.points.get(player.playerId) ?? 0;
      const challengerWins = points > bankerPoints;
      const delta = challengerWins ? bet : -bet;

      deltas.set(player.playerId, (deltas.get(player.playerId) ?? 0) + delta);
      deltas.set(bankerId, (deltas.get(bankerId) ?? 0) - delta);
      if (challengerWins) winners.push(player.playerId);
    }

    this.state.results = players.map((p) => ({
      playerId: p.playerId,
      points: this.state.points.get(p.playerId) ?? 0,
      cards: this.state.hands.get(p.playerId) ?? [],
      isBanker: p.playerId === bankerId,
      delta: deltas.get(p.playerId) ?? 0,
    }));

    const entries: SettlementEntry[] = [...deltas.entries()]
      .filter(([, delta]) => delta !== 0)
      .map(([playerId, delta]) => ({
        playerId,
        currency: 'coin' as const,
        delta,
        reason: 'tuizhuanzi.result',
      }));

    this.state.phase = 'reveal';
    this.state.settled = true;
    ctx.markDirty();
    ctx.settle({ entries, winners: winners.length > 0 ? winners : [bankerId] });
  }
}

export default TuizhuanziPlugin;
