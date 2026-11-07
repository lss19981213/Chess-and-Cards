import type { GameMeta, GameSnapshot } from '@cc/protocol';
import type { GameIntent, PlayerContext, RoomContext, SettlementInput } from '@cc/game-sdk';
import {
  BaseGamePlugin,
  createCardDeck,
  shuffleWithSeed,
  type Card,
} from '@cc/game-sdk';

/**
 * 推筒子（平台庄家版）
 * - 平台坐庄，玩家只能在「天 / 地 / 人」三门下注，猜哪门比庄家大，赔率 1:1
 * - 常驻运行：不依赖人数，每 60 秒一局（30 秒下注 + 6 秒开牌 + 24 秒展示）
 * - 每局给三门与庄家各发两张筒子牌，点数取个位
 */

const DOORS = ['heaven', 'earth', 'human'] as const;
type DoorKey = (typeof DOORS)[number];

const DOOR_LABEL: Record<DoorKey, string> = {
  heaven: '天',
  earth: '地',
  human: '人',
};

const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

const BET_MS = 30_000;
const REVEAL_MS = 6_000;
const IDLE_MS = 24_000;

const MIN_BET = 10;
const MAX_BET = 2000;
const MAX_TOTAL = 6000;
const HISTORY_LIMIT = 30;

type Phase = 'bet' | 'reveal' | 'idle';

interface DoorHand {
  cards: Card[];
  points: number;
}

interface PlayerBet {
  heaven: number;
  earth: number;
  human: number;
}

interface RoundResult {
  playerId: string;
  nickname: string;
  delta: number;
  detail: string;
}

interface HistoryItem {
  round: number;
  banker: number;
  heaven: number;
  earth: number;
  human: number;
  winningDoors: DoorKey[];
}

interface State {
  phase: Phase;
  phaseEndsAt: number;
  doors: Record<DoorKey, DoorHand>;
  banker: DoorHand;
  bets: Map<string, PlayerBet>;
  results: RoundResult[];
  history: HistoryItem[];
  roundNo: number;
  /** 连续命中次数，用于牌桌内的手感反馈 */
  streaks: Map<string, number>;
}

function emptyHand(): DoorHand {
  return { cards: [], points: 0 };
}

function emptyState(): State {
  return {
    phase: 'bet',
    phaseEndsAt: 0,
    doors: { heaven: emptyHand(), earth: emptyHand(), human: emptyHand() },
    banker: emptyHand(),
    bets: new Map(),
    results: [],
    history: [],
    roundNo: 0,
    streaks: new Map(),
  };
}

function pointsOf(cards: Card[]): number {
  return cards.reduce((sum, card) => sum + card.rank, 0) % 10;
}

export class TuizhuanziPlugin extends BaseGamePlugin {
  override readonly apiVersion = 1;
  override readonly commands = ['bet'] as const;

  override readonly meta: GameMeta = {
    gameId: 'tuizhuanzi',
    name: '推筒子',
    description: '押天地人三门，比庄家点数大即赢，赔率 1:1',
    version: '2.0.0',
    clientBundle: '',
    minPlayers: 1,
    maxPlayers: 5,
    tags: ['牌九', '常驻', '下注'],
    category: 'live',
    persistent: true,
    icon: '🀄',
  };

  private state: State = emptyState();

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  override onRoundStart(ctx: RoomContext): void {
    const deck = shuffleWithSeed(createCardDeck(RANKS, false), `${ctx.config.seed}`);
    let cursor = 0;
    const takeHand = (): DoorHand => {
      const cards = [deck[cursor]!, deck[cursor + 1]!];
      cursor += 2;
      return { cards, points: pointsOf(cards) };
    };

    this.state.doors = { heaven: takeHand(), earth: takeHand(), human: takeHand() };
    this.state.banker = takeHand();
    this.state.bets = new Map();
    this.state.results = [];
    // streaks 跨局保留
    this.state.phase = 'bet';
    this.state.phaseEndsAt = Date.now() + BET_MS;
    this.state.roundNo = ctx.config.round;
    this.seedBotBets(ctx);
  }

  /** 场内机器人气氛下注：只影响展示，不写账本 */
  private seedBotBets(ctx: RoomContext): void {
    const areas: DoorKey[] = ['heaven', 'earth', 'human'];
    const amounts = [10, 20, 50, 100, 200, 500];
    for (const bot of ctx.players) {
      if (!bot.isBot) continue;
      if (Math.random() > 0.62) continue;
      const area = areas[Math.floor(Math.random() * areas.length)]!;
      const amount = amounts[Math.floor(Math.random() * amounts.length)]!;
      const bet = this.state.bets.get(bot.playerId) ?? { heaven: 0, earth: 0, human: 0 };
      bet[area] += amount;
      this.state.bets.set(bot.playerId, bet);
    }
  }

  override onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): void {
    if (intent.cmd !== 'bet') throw new Error(`不支持的操作: ${intent.cmd}`);
    if (this.state.phase !== 'bet') throw new Error('本局已停止下注，等下一局吧');

    const area = String(intent.payload?.area ?? '');
    if (!DOORS.includes(area as DoorKey)) throw new Error('只能押天、地、人三门');

    const amount = Number(intent.payload?.amount);
    if (!Number.isInteger(amount) || amount < MIN_BET) throw new Error(`单注至少 ${MIN_BET} 筹码`);
    if (amount > MAX_BET) throw new Error(`单注最多 ${MAX_BET} 筹码`);

    const current = this.state.bets.get(playerId) ?? { heaven: 0, earth: 0, human: 0 };
    const total = current.heaven + current.earth + current.human;
    if (total + amount > MAX_TOTAL) throw new Error(`本局总下注不能超过 ${MAX_TOTAL} 筹码`);

    current[area as DoorKey] += amount;
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
    // idle 结束，开下一局
    ctx.beginRound();
  }

  private reveal(ctx: RoomContext): void {
    const bankerPoints = this.state.banker.points;
    const winningDoors = DOORS.filter((door) => this.state.doors[door].points > bankerPoints);

    const entries: SettlementInput['entries'] = [];
    const results: RoundResult[] = [];

    for (const [playerId, bet] of this.state.bets) {
      let delta = 0;
      const hits: string[] = [];
      for (const door of DOORS) {
        const amount = bet[door];
        if (amount <= 0) continue;
        const doorPoints = this.state.doors[door].points;
        if (doorPoints > bankerPoints) {
          delta += amount;
          hits.push(`${DOOR_LABEL[door]}+${amount}`);
        } else if (doorPoints < bankerPoints) {
          delta -= amount;
        }
        // 点数相同视为和局，该门不输不赢
      }
      if (delta === 0 && hits.length === 0) continue;

      const streak = delta > 0 ? (this.state.streaks.get(playerId) ?? 0) + 1 : 0;
      this.state.streaks.set(playerId, streak);

      const nickname = ctx.getPlayer(playerId)?.nickname ?? '玩家';
      results.push({ playerId, nickname, delta, detail: hits.join(' ') || '未命中' });
      // 机器人只参与展示，不写账本
      if (delta !== 0 && ctx.getPlayer(playerId)?.isBot !== true) {
        entries.push({
          playerId,
          currency: 'coin',
          delta,
          reason: 'game.tuizhuanzi',
        });
      }
    }

    this.state.results = results;
    this.state.history = [
      ...this.state.history,
      {
        round: this.state.roundNo,
        banker: bankerPoints,
        heaven: this.state.doors.heaven.points,
        earth: this.state.doors.earth.points,
        human: this.state.doors.human.points,
        winningDoors,
      },
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
    const now = Date.now();
    const revealed = this.state.phase !== 'bet';
    const remainMs = Math.max(0, this.state.phaseEndsAt - now);

    const doorView = (door: DoorKey) => ({
      label: DOOR_LABEL[door],
      points: revealed ? this.state.doors[door].points : null,
      cards: revealed ? this.state.doors[door].cards.map((c) => ({ id: c.id, rank: c.rank })) : [],
    });

    const myBet = viewerId ? this.state.bets.get(viewerId) ?? null : null;

    return {
      phase: this.state.phase,
      round: this.state.roundNo,
      remainMs,
      betEndsAt: this.state.phase === 'bet' ? this.state.phaseEndsAt : 0,
      banker: {
        points: revealed ? this.state.banker.points : null,
        cards: revealed ? this.state.banker.cards.map((c) => ({ id: c.id, rank: c.rank })) : [],
      },
      doors: {
        heaven: doorView('heaven'),
        earth: doorView('earth'),
        human: doorView('human'),
      },
      myBet: myBet ?? { heaven: 0, earth: 0, human: 0 },
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
    // 下注制没有回合，由时间轴驱动
    return null;
  }
}
