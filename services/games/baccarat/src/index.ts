import type { GameMeta, GameSnapshot } from '@cc/protocol';
import type { GameIntent, PlayerContext, RoomContext, SettlementInput } from '@cc/game-sdk';
import { BaseGamePlugin, createCardDeck, shuffleWithSeed, type Card } from '@cc/game-sdk';

/**
 * 百家乐（平台庄家版）
 * - 押闲 / 庄 / 和，标准 Punto Banco 补牌规则
 * - 闲 1:1，庄 1:0.95（抽水 5%），和 8:1
 * - 常驻运行：每 60 秒一局（30 秒下注 + 6 秒开牌 + 24 秒展示）
 */

const BET_MS = 30_000;
const REVEAL_MS = 6_000;
const IDLE_MS = 24_000;

const MIN_BET = 10;
const MAX_BET = 2000;
const MAX_TOTAL = 6000;
const HISTORY_LIMIT = 30;
const DECK_COUNT = 8;

const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

type Area = 'player' | 'banker' | 'tie';
type Phase = 'bet' | 'reveal' | 'idle';
type Outcome = 'player' | 'banker' | 'tie';

interface PlayerBet {
  player: number;
  banker: number;
  tie: number;
}

interface RoundResult {
  playerId: string;
  nickname: string;
  delta: number;
  detail: string;
}

interface HistoryItem {
  round: number;
  playerPoints: number;
  bankerPoints: number;
  outcome: Outcome;
}

interface State {
  phase: Phase;
  phaseEndsAt: number;
  playerCards: Card[];
  bankerCards: Card[];
  playerPoints: number;
  bankerPoints: number;
  outcome: Outcome | null;
  bets: Map<string, PlayerBet>;
  results: RoundResult[];
  history: HistoryItem[];
  roundNo: number;
  streaks: Map<string, number>;
}

/** 牌面点数：A=1，10/J/Q/K=0，其余按面值 */
function cardPoints(rank: number): number {
  if (rank >= 10 && rank <= 13) return 0;
  if (rank === 14) return 1;
  return rank;
}

function totalPoints(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + cardPoints(card.rank), 0) % 10;
}

function emptyState(): State {
  return {
    phase: 'bet',
    phaseEndsAt: 0,
    playerCards: [],
    bankerCards: [],
    playerPoints: 0,
    bankerPoints: 0,
    outcome: null,
    bets: new Map(),
    results: [],
    history: [],
    roundNo: 0,
    streaks: new Map(),
  };
}

export class BaccaratPlugin extends BaseGamePlugin {
  override readonly apiVersion = 1;
  override readonly commands = ['bet'] as const;

  override readonly meta: GameMeta = {
    gameId: 'baccarat',
    name: '百家乐',
    description: '押闲、押庄或押和，标准补牌规则，庄赢抽水 5%',
    version: '1.0.0',
    clientBundle: '',
    minPlayers: 1,
    maxPlayers: 5,
    tags: ['牌类', '常驻', '下注'],
    category: 'live',
    persistent: true,
    icon: '🃏',
  };

  private state: State = emptyState();

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  override onRoundStart(ctx: RoomContext): void {
    const deck = shuffleWithSeed(
      Array.from({ length: DECK_COUNT }, () => createCardDeck(RANKS, false)).flat(),
      `${ctx.config.seed}:${ctx.config.round}`,
    );

    let cursor = 0;
    const draw = (): Card => {
      const card = deck[cursor % deck.length]!;
      cursor += 1;
      return card;
    };

    const playerCards = [draw(), draw()];
    const bankerCards = [draw(), draw()];

    const pNatural = totalPoints(playerCards);
    const bNatural = totalPoints(bankerCards);

    // 天生 8 或 9 直接停牌
    if (pNatural < 8 && bNatural < 8) {
      let playerThird: Card | null = null;
      if (pNatural <= 5) {
        playerThird = draw();
        playerCards.push(playerThird);
      }

      const bankerPoints = totalPoints(bankerCards);
      const thirdValue = playerThird ? cardPoints(playerThird.rank) : null;

      let bankerDraws = false;
      if (playerThird === null) {
        // 闲家停牌：庄 0-5 补
        bankerDraws = bankerPoints <= 5;
      } else if (bankerPoints <= 2) {
        bankerDraws = true;
      } else if (bankerPoints === 3) {
        bankerDraws = thirdValue !== 8;
      } else if (bankerPoints === 4) {
        bankerDraws = thirdValue !== null && thirdValue >= 2 && thirdValue <= 7;
      } else if (bankerPoints === 5) {
        bankerDraws = thirdValue !== null && thirdValue >= 4 && thirdValue <= 7;
      } else if (bankerPoints === 6) {
        bankerDraws = thirdValue !== null && (thirdValue === 6 || thirdValue === 7);
      }

      if (bankerDraws) bankerCards.push(draw());
    }

    this.state = {
      ...emptyState(),
      phase: 'bet',
      phaseEndsAt: Date.now() + BET_MS,
      playerCards,
      bankerCards,
      playerPoints: totalPoints(playerCards),
      bankerPoints: totalPoints(bankerCards),
      roundNo: ctx.config.round,
      streaks: this.state.streaks,
    };
  }

  override onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): void {
    if (intent.cmd !== 'bet') throw new Error(`不支持的操作: ${intent.cmd}`);
    if (this.state.phase !== 'bet') throw new Error('本局已封盘，等下一局吧');

    const area = String(intent.payload?.area ?? '') as Area;
    if (!['player', 'banker', 'tie'].includes(area)) throw new Error('只能押闲、庄或和');

    const amount = Number(intent.payload?.amount);
    if (!Number.isInteger(amount) || amount < MIN_BET) throw new Error(`单注至少 ${MIN_BET} 筹码`);
    if (amount > MAX_BET) throw new Error(`单注最多 ${MAX_BET} 筹码`);

    const current = this.state.bets.get(playerId) ?? { player: 0, banker: 0, tie: 0 };
    const total = current.player + current.banker + current.tie;
    if (total + amount > MAX_TOTAL) throw new Error(`本局总下注不能超过 ${MAX_TOTAL} 筹码`);

    current[area] += amount;
    this.state.bets.set(playerId, current);
    ctx.markDirty();
  }

  override onTick(ctx: RoomContext): void {
    const now = Date.now();
    if (now < this.state.phaseEndsAt) return;

    if (this.state.phase === 'bet') {
      this.reveal(ctx);
      return;
    }
    if (this.state.phase === 'reveal') {
      this.state.phase = 'idle';
      this.state.phaseEndsAt = now + IDLE_MS;
      ctx.markDirty();
      return;
    }
    ctx.beginRound();
  }

  private reveal(ctx: RoomContext): void {
    const p = this.state.playerPoints;
    const b = this.state.bankerPoints;
    const outcome: Outcome = p > b ? 'player' : b > p ? 'banker' : 'tie';
    this.state.outcome = outcome;

    const entries: SettlementInput['entries'] = [];
    const results: RoundResult[] = [];

    for (const [playerId, bet] of this.state.bets) {
      let delta = 0;
      const hits: string[] = [];

      if (bet.player > 0) {
        if (outcome === 'player') {
          delta += bet.player;
          hits.push(`闲+${bet.player}`);
        } else delta -= bet.player;
      }
      if (bet.banker > 0) {
        if (outcome === 'banker') {
          const win = Math.floor(bet.banker * 0.95);
          delta += win;
          hits.push(`庄+${win}`);
        } else delta -= bet.banker;
      }
      if (bet.tie > 0) {
        if (outcome === 'tie') {
          delta += bet.tie * 8;
          hits.push(`和+${bet.tie * 8}`);
        } else delta -= bet.tie;
      }

      if (delta === 0 && hits.length === 0) continue;

      const streak = delta > 0 ? (this.state.streaks.get(playerId) ?? 0) + 1 : 0;
      this.state.streaks.set(playerId, streak);

      const nickname = ctx.getPlayer(playerId)?.nickname ?? '玩家';
      results.push({ playerId, nickname, delta, detail: hits.join(' ') || '未命中' });
      if (delta !== 0) {
        entries.push({ playerId, currency: 'coin', delta, reason: 'game.baccarat' });
      }
    }

    this.state.results = results;
    this.state.history = [
      ...this.state.history,
      { round: this.state.roundNo, playerPoints: p, bankerPoints: b, outcome },
    ].slice(-HISTORY_LIMIT);

    this.state.phase = 'reveal';
    this.state.phaseEndsAt = Date.now() + REVEAL_MS;
    ctx.markDirty();

    ctx.settle({
      winners: results.filter((row) => row.delta > 0).map((row) => row.playerId),
      entries,
    });
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const revealed = this.state.phase !== 'bet';
    const myBet = viewerId ? this.state.bets.get(viewerId) ?? null : null;

    const mapCards = (cards: Card[]) =>
      revealed ? cards.map((card) => ({ id: card.id, rank: card.rank, suit: card.suit })) : [];

    return {
      phase: this.state.phase,
      round: this.state.roundNo,
      remainMs: Math.max(0, this.state.phaseEndsAt - Date.now()),
      player: {
        points: revealed ? this.state.playerPoints : null,
        cards: mapCards(this.state.playerCards),
      },
      banker: {
        points: revealed ? this.state.bankerPoints : null,
        cards: mapCards(this.state.bankerCards),
      },
      outcome: revealed ? this.state.outcome : null,
      myBet: myBet ?? { player: 0, banker: 0, tie: 0 },
      myStreak: viewerId ? (this.state.streaks.get(viewerId) ?? 0) : 0,
      results: this.state.results,
      history: this.state.history,
      limits: { min: MIN_BET, max: MAX_BET, total: MAX_TOTAL },
      players: ctx.players.map((p: PlayerContext) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        isBot: p.isBot,
      })),
    };
  }

  override getCurrentActor(): string | null {
    return null;
  }
}
