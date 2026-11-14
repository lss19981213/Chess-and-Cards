import type { GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';
import type { GameIntent, RoomContext } from '@cc/game-sdk';
import { BaseGamePlugin } from '@cc/game-sdk';

export type SlotSymbol =
  | 'WILD'
  | 'SEVEN'
  | 'DIAMOND'
  | 'BELL'
  | 'BAR'
  | 'MELON'
  | 'GRAPE'
  | 'ORANGE'
  | 'CHERRY'
  | 'SCATTER';

export interface PaylineWin {
  lineIndex: number;
  symbol: SlotSymbol;
  count: number;
  payout: number;
}

export const PAYTABLE: Record<SlotSymbol, Record<number, number>> = {
  SEVEN: { 3: 50, 4: 200, 5: 1000 },
  DIAMOND: { 3: 30, 4: 100, 5: 500 },
  BELL: { 3: 20, 4: 60, 5: 250 },
  BAR: { 3: 15, 4: 40, 5: 150 },
  MELON: { 3: 10, 4: 25, 5: 100 },
  GRAPE: { 3: 8, 4: 20, 5: 80 },
  ORANGE: { 3: 5, 4: 15, 5: 60 },
  CHERRY: { 2: 2, 3: 5, 4: 10, 5: 40 },
  WILD: { 3: 50, 4: 250, 5: 1500 },
  SCATTER: { 3: 5, 4: 20, 5: 100 },
};

export const PAYLINES: number[][] = [
  [1, 1, 1, 1, 1], // 1: 中间水平
  [0, 0, 0, 0, 0], // 2: 顶部水平
  [2, 2, 2, 2, 2], // 3: 底部水平
  [0, 1, 2, 1, 0], // 4: V形
  [2, 1, 0, 1, 2], // 5: 倒V形
  [0, 0, 1, 0, 0], // 6: 顶折线
  [2, 2, 1, 2, 2], // 7: 底折线
  [0, 1, 1, 1, 2], // 8: 下阶梯
  [2, 1, 1, 1, 0], // 9: 上阶梯
];

const WEIGHTED_REEL: SlotSymbol[] = [
  'CHERRY', 'CHERRY', 'CHERRY', 'CHERRY', 'CHERRY',
  'ORANGE', 'ORANGE', 'ORANGE', 'ORANGE',
  'GRAPE', 'GRAPE', 'GRAPE', 'GRAPE',
  'MELON', 'MELON', 'MELON',
  'BAR', 'BAR', 'BAR',
  'BELL', 'BELL',
  'DIAMOND', 'DIAMOND',
  'SEVEN', 'SEVEN',
  'WILD',
  'SCATTER',
];

interface SpinResult {
  playerId: string;
  grid: SlotSymbol[][]; // 5 reels x 3 rows
  totalBet: number;
  totalWin: number;
  wins: PaylineWin[];
  scatterCount: number;
  jackpotHit: boolean;
}

interface State {
  grid: SlotSymbol[][];
  lastSpin: SpinResult | null;
  jackpot: number;
  history: SpinResult[];
}

function randomSymbol(): SlotSymbol {
  return WEIGHTED_REEL[Math.floor(Math.random() * WEIGHTED_REEL.length)]!;
}

function generateRandomGrid(): SlotSymbol[][] {
  const grid: SlotSymbol[][] = [];
  for (let r = 0; r < 5; r++) {
    grid.push([randomSymbol(), randomSymbol(), randomSymbol()]);
  }
  return grid;
}

export class SlotsPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta = {
    gameId: 'slots',
    name: '疯狂老虎机',
    description: '拉斯维加斯经典 777 豪华水果机，25线连环爆奖，百万金币奖池',
    icon: '🎰',
    minPlayers: 1,
    maxPlayers: 5,
    version: '1.0.0',
    clientBundle: '',
    tags: ['老虎机', '娱乐', '常驻', '单人/多人', '下注'],
    category: 'live',
    persistent: true,
  };

  override readonly commands = ['spin'] as const;

  private state: State = {
    grid: generateRandomGrid(),
    lastSpin: null,
    jackpot: 888888,
    history: [],
  };

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = {
      grid: generateRandomGrid(),
      lastSpin: null,
      jackpot: 888888,
      history: [],
    };
  }

  override onRoundStart(_ctx: RoomContext): void {
    // 独立即时旋转玩法，状态持久化
  }

  override async onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): Promise<void> {
    if (intent.cmd !== 'spin') throw new Error(`不支持的操作: ${intent.cmd}`);

    const betPerLine = Math.max(1, Math.floor(Number(intent.payload?.betPerLine ?? 10)));
    const linesCount = Math.min(PAYLINES.length, Math.max(1, Math.floor(Number(intent.payload?.lines ?? PAYLINES.length))));
    const totalBet = betPerLine * linesCount;

    const isBot = ctx.getPlayer(playerId)?.isBot === true;
    if (!isBot) {
      await ctx.charge(playerId, totalBet);
    }

    // 随机摇奖 5 列 x 3 行
    const grid = generateRandomGrid();
    const activeLines = PAYLINES.slice(0, linesCount);
    const wins: PaylineWin[] = [];
    let lineWinTotal = 0;

    for (let i = 0; i < activeLines.length; i++) {
      const line = activeLines[i]!;
      // line has 5 row indices for the 5 reels: [r0, r1, r2, r3, r4]
      const symbolsOnLine: SlotSymbol[] = [
        grid[0]![line[0]!]!,
        grid[1]![line[1]!]!,
        grid[2]![line[2]!]!,
        grid[3]![line[3]!]!,
        grid[4]![line[4]!]!,
      ];

      // 判定从左到右匹配 (考虑 WILD 百搭)
      let matchSymbol: SlotSymbol = symbolsOnLine[0]!;
      let matchCount = 0;

      // 如果首张是 WILD，寻找第一个非 WILD 符号
      for (const s of symbolsOnLine) {
        if (s !== 'WILD' && s !== 'SCATTER') {
          matchSymbol = s;
          break;
        }
      }

      for (let c = 0; c < 5; c++) {
        const s = symbolsOnLine[c]!;
        if (s === matchSymbol || s === 'WILD') {
          matchCount++;
        } else {
          break;
        }
      }

      if (matchCount >= 3 || (matchSymbol === 'CHERRY' && matchCount >= 2)) {
        const mult = PAYTABLE[matchSymbol]?.[matchCount] ?? 0;
        if (mult > 0) {
          const payout = betPerLine * mult;
          lineWinTotal += payout;
          wins.push({ lineIndex: i, symbol: matchSymbol, count: matchCount, payout });
        }
      }
    }

    // 检查 Scatter (全盘分散奖励)
    let scatterCount = 0;
    for (let r = 0; r < 5; r++) {
      for (let row = 0; row < 3; row++) {
        if (grid[r]![row] === 'SCATTER') scatterCount++;
      }
    }
    let scatterWin = 0;
    if (scatterCount >= 3) {
      const mult = PAYTABLE.SCATTER[scatterCount] ?? 5;
      scatterWin = totalBet * mult;
    }

    const totalWin = lineWinTotal + scatterWin;
    const netDelta = totalWin - totalBet;

    // 累积奖池贡献
    this.state.jackpot += Math.floor(totalBet * 0.05);

    const spinResult: SpinResult = {
      playerId,
      grid,
      totalBet,
      totalWin,
      wins,
      scatterCount,
      jackpotHit: totalWin > totalBet * 50,
    };

    this.state.grid = grid;
    this.state.lastSpin = spinResult;
    this.state.history = [spinResult, ...this.state.history].slice(0, 20);

    ctx.markDirty();

    if (!isBot) {
      const entries: SettlementEntry[] = [
        {
          playerId,
          currency: 'coin' as const,
          delta: netDelta,
          reason: 'slots.spin',
        },
      ];
      ctx.settle({
        entries,
        winners: totalWin > 0 ? [playerId] : [],
      });
    }
  }

  override getSnapshot(ctx: RoomContext, _viewerId: string | null): GameSnapshot {
    return {
      phase: 'ready',
      round: ctx.config.round,
      grid: this.state.grid,
      lastSpin: this.state.lastSpin,
      jackpot: this.state.jackpot,
      paylines: PAYLINES,
      paytable: PAYTABLE,
      players: ctx.players.map((p) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        isBot: p.isBot,
      })),
      history: this.state.history.slice(0, 10),
    };
  }

  override getCurrentActor(): string | null {
    return null;
  }
}

export default SlotsPlugin;
