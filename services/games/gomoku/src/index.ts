import type { BotDifficulty, GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';
import { badRequest, illegalAction } from '@cc/protocol';
import { BaseGamePlugin, type GameIntent, type RoomContext } from '@cc/game-sdk';

const SIZE = 15;
const BLACK = 1;
const WHITE = 2;
const DRAW = 3;
const WIN_COIN = 100;

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

interface BoardState {
  /** 长度 SIZE*SIZE，0 空 / 1 黑 / 2 白 */
  cells: number[];
  turn: number;
  winner: number;
  lastMove: { x: number; y: number; side: number } | null;
  moveCount: number;
}

function createState(): BoardState {
  return {
    cells: new Array<number>(SIZE * SIZE).fill(0),
    turn: BLACK,
    winner: 0,
    lastMove: null,
    moveCount: 0,
  };
}

function hasFive(cells: number[], x: number, y: number, side: number): boolean {
  for (const [dx, dy] of DIRECTIONS) {
    let count = 1;
    for (const sign of [1, -1] as const) {
      let nx = x + dx * sign;
      let ny = y + dy * sign;
      while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && cells[ny * SIZE + nx] === side) {
        count += 1;
        nx += dx * sign;
        ny += dy * sign;
      }
    }
    if (count >= 5) return true;
  }
  return false;
}

/** 五子棋插件：演示 GamePlugin 契约的完整实现（落子校验、胜负判定、结算） */
export class GomokuPlugin extends BaseGamePlugin {
  override readonly meta: GameMeta = {
    gameId: 'gomoku',
    name: '五子棋',
    description: '15 路经典五子棋，先连成五子者胜',
    icon: '⚫',
    minPlayers: 2,
    maxPlayers: 2,
    version: '1.0.0',
    clientBundle: 'builtin:gomoku',
    tags: ['棋类', '双人', '休闲'],
    category: 'board',
  };

  override readonly commands: readonly string[] = ['place'];

  private state: BoardState = createState();

  override onRoundStart(ctx: RoomContext): void {
    this.state = createState();
    // 奇数局黑先、偶数局白先，保证先后手公平轮换
    if (ctx.config.round % 2 === 0) this.state.turn = WHITE;
    ctx.markDirty();
  }

  override onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): void {
    if (this.state.winner !== 0) throw illegalAction('本局已经结束');

    const player = ctx.getPlayer(playerId);
    if (!player) throw illegalAction('你不在该房间内');
    if (player.seat > 1) throw illegalAction('观战者不能落子');

    const side = player.seat === 0 ? BLACK : WHITE;
    if (side !== this.state.turn) throw illegalAction('还没轮到你落子');

    const x = Number(intent.payload.x);
    const y = Number(intent.payload.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= SIZE || y >= SIZE) {
      throw badRequest('落子坐标非法');
    }

    const index = y * SIZE + x;
    if (this.state.cells[index] !== 0) throw illegalAction('该位置已有棋子');

    this.state.cells[index] = side;
    this.state.moveCount += 1;
    this.state.lastMove = { x, y, side };

    if (hasFive(this.state.cells, x, y, side)) {
      this.state.winner = side;
      this.settleWin(ctx, playerId);
    } else if (this.state.moveCount >= SIZE * SIZE) {
      this.state.winner = DRAW;
      ctx.settle({ entries: [], winners: [] });
    } else {
      this.state.turn = side === BLACK ? WHITE : BLACK;
    }

    ctx.markDirty();
  }

  override onPlayerLeave(ctx: RoomContext, playerId: string): void {
    // 只有真正开打后离场才判定胜负；在等待区离开不算
    if (this.state.winner !== 0 || this.state.moveCount === 0) return;
    const remaining = ctx.players.find((p) => p.playerId !== playerId);
    if (!remaining) return;
    this.state.winner = remaining.seat === 0 ? BLACK : WHITE;
    this.settleWin(ctx, remaining.playerId);
    ctx.markDirty();
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const viewer = viewerId ? ctx.getPlayer(viewerId) : undefined;
    const mySide = viewer ? (viewer.seat === 0 ? BLACK : WHITE) : 0;
    return {
      size: SIZE,
      cells: this.state.cells,
      turn: this.state.turn,
      winner: this.state.winner,
      lastMove: this.state.lastMove,
      moveCount: this.state.moveCount,
      mySide,
      seats: ctx.players.map((p) => ({
        playerId: p.playerId,
        seat: p.seat,
        nickname: p.nickname,
        side: p.seat === 0 ? BLACK : WHITE,
      })),
    };
  }

  override getCurrentActor(ctx: RoomContext): string | null {
    if (this.state.winner !== 0) return null;
    return ctx.players.find((p) => (p.seat === 0 ? BLACK : WHITE) === this.state.turn)?.playerId ?? null;
  }

  override botIntent(ctx: RoomContext, playerId: string, difficulty: BotDifficulty = 'medium'): GameIntent | null {
    if (this.state.winner !== 0) return null;
    const player = ctx.getPlayer(playerId);
    if (!player) return null;
    const side = player.seat === 0 ? BLACK : WHITE;
    if (side !== this.state.turn) return null;

    const level = difficulty ?? player.botDifficulty ?? 'medium';
    const spot = this.pickMove(side, level);
    return spot ? { cmd: 'place', payload: spot } : null;
  }

  /**
   * 评估在 (x, y) 落子 side 产生的 4 方向棋型得分（连五/活四/冲四/活三/眠三/活二）
   */
  private scoreSpotForSide(cells: number[], x: number, y: number, side: number): number {
    let total = 0;
    let openThrees = 0;
    let closedFours = 0;

    for (const [dx, dy] of DIRECTIONS) {
      let count = 1;
      let openEnds = 0;

      for (const sign of [1, -1] as const) {
        let nx = x + dx * sign;
        let ny = y + dy * sign;
        while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && cells[ny * SIZE + nx] === side) {
          count += 1;
          nx += dx * sign;
          ny += dy * sign;
        }
        if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && cells[ny * SIZE + nx] === 0) {
          // 查看间隔一格是否还能续连（跳三/跳四关键探测）
          openEnds += 1;
        }
      }

      if (count >= 5) {
        total += 10_000_000;
      } else if (count === 4) {
        if (openEnds === 2) total += 500_000;
        else if (openEnds === 1) {
          closedFours += 1;
          total += 25_000;
        }
      } else if (count === 3) {
        if (openEnds === 2) {
          openThrees += 1;
          total += 18_000;
        } else if (openEnds === 1) {
          total += 2_200;
        }
      } else if (count === 2) {
        if (openEnds === 2) total += 900;
        else if (openEnds === 1) total += 150;
      } else {
        total += openEnds * 15;
      }
    }

    // 复合杀招加分：冲四+活三、双活三、双冲四
    if (closedFours >= 2) total += 350_000;
    if (closedFours >= 1 && openThrees >= 1) total += 280_000;
    if (openThrees >= 2) total += 120_000;

    // 天元靠近加分
    const centerDist = Math.abs(x - 7) + Math.abs(y - 7);
    total += Math.max(0, 14 - centerDist) * 4;
    return total;
  }

  /** 获取周围 2 格内已有棋子的候选落点，并按局部攻防评分从高到低排序 */
  private getCandidateMoves(cells: number[], side: number, limit: number): Array<{ x: number; y: number; h: number }> {
    const opp = side === BLACK ? WHITE : BLACK;
    const list: Array<{ x: number; y: number; h: number }> = [];

    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (cells[y * SIZE + x] !== 0) continue;
        if (!this.hasNeighbor(cells, x, y)) continue;
        const atk = this.scoreSpotForSide(cells, x, y, side);
        const def = this.scoreSpotForSide(cells, x, y, opp);
        list.push({ x, y, h: atk + def * 0.95 });
      }
    }

    list.sort((a, b) => b.h - a.h);
    return list.slice(0, limit);
  }

  /** 全局静态估值（用于 Alpha-Beta 叶子节点） */
  private evaluateBoard(cells: number[], aiSide: number): number {
    const opp = aiSide === BLACK ? WHITE : BLACK;
    let aiBest = 0;
    let oppBest = 0;
    let aiSum = 0;
    let oppSum = 0;

    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (cells[y * SIZE + x] !== 0) continue;
        if (!this.hasNeighbor(cells, x, y)) continue;
        const a = this.scoreSpotForSide(cells, x, y, aiSide);
        const o = this.scoreSpotForSide(cells, x, y, opp);
        if (a > aiBest) aiBest = a;
        if (o > oppBest) oppBest = o;
        aiSum += a * 0.1;
        oppSum += o * 0.1;
      }
    }
    return aiBest + aiSum - (oppBest * 1.15 + oppSum * 1.1);
  }

  /** VCF（连续冲四必杀搜索） */
  private searchVCF(cells: number[], side: number, depth: number): { x: number; y: number } | null {
    if (depth <= 0) return null;
    const opp = side === BLACK ? WHITE : BLACK;
    const candidates = this.getCandidateMoves(cells, side, 10);

    for (const m of candidates) {
      const idx = m.y * SIZE + m.x;
      const myThreat = this.scoreSpotForSide(cells, m.x, m.y, side);
      // 必须形成至少冲四以上威胁才进入 VCF 分支
      if (myThreat < 25_000) break;

      cells[idx] = side;
      if (hasFive(cells, m.x, m.y, side) || myThreat >= 500_000) {
        cells[idx] = 0;
        return { x: m.x, y: m.y };
      }

      // 若形成冲四，对手只有唯一防守点能阻挡直接成五
      const oppBlocks = this.getCandidateMoves(cells, opp, 6).filter(
        (b) => this.scoreSpotForSide(cells, b.x, b.y, side) >= 10_000_000,
      );

      if (oppBlocks.length === 1) {
        const blk = oppBlocks[0]!;
        const blkIdx = blk.y * SIZE + blk.x;
        cells[blkIdx] = opp;
        const winFollow = this.searchVCF(cells, side, depth - 1);
        cells[blkIdx] = 0;
        if (winFollow) {
          cells[idx] = 0;
          return { x: m.x, y: m.y };
        }
      }
      cells[idx] = 0;
    }
    return null;
  }

  /** Minimax + Alpha-Beta 剪枝 */
  private alphaBeta(
    cells: number[],
    depth: number,
    alpha: number,
    beta: number,
    maximizing: boolean,
    turnSide: number,
    aiSide: number,
  ): number {
    if (depth <= 0) return this.evaluateBoard(cells, aiSide);

    const nextSide = turnSide === BLACK ? WHITE : BLACK;
    const moves = this.getCandidateMoves(cells, turnSide, depth >= 3 ? 8 : 6);
    if (moves.length === 0) return this.evaluateBoard(cells, aiSide);

    if (maximizing) {
      let best = -Infinity;
      for (const m of moves) {
        const idx = m.y * SIZE + m.x;
        cells[idx] = turnSide;
        if (hasFive(cells, m.x, m.y, turnSide)) {
          cells[idx] = 0;
          return 10_000_000 + depth * 1000;
        }
        const val = this.alphaBeta(cells, depth - 1, alpha, beta, false, nextSide, aiSide);
        cells[idx] = 0;
        if (val > best) best = val;
        if (best > alpha) alpha = best;
        if (beta <= alpha) break;
      }
      return best;
    }

    let best = Infinity;
    for (const m of moves) {
      const idx = m.y * SIZE + m.x;
      cells[idx] = turnSide;
      if (hasFive(cells, m.x, m.y, turnSide)) {
        cells[idx] = 0;
        return -10_000_000 - depth * 1000;
      }
      const val = this.alphaBeta(cells, depth - 1, alpha, beta, true, nextSide, aiSide);
      cells[idx] = 0;
      if (val < best) best = val;
      if (best < beta) beta = best;
      if (beta <= alpha) break;
    }
    return best;
  }

  private pickMove(side: number, difficulty: BotDifficulty): { x: number; y: number } | null {
    const center = Math.floor(SIZE / 2);
    if (this.state.moveCount === 0 && this.state.cells[center * SIZE + center] === 0) {
      return { x: center, y: center };
    }

    const cells = [...this.state.cells];
    const opp = side === BLACK ? WHITE : BLACK;
    const candidates = this.getCandidateMoves(cells, side, difficulty === 'high' ? 10 : difficulty === 'medium' ? 8 : 5);
    if (candidates.length === 0) return null;

    // 1. 直接五连必胜点（全难度均可识别）
    for (const m of candidates) {
      if (this.scoreSpotForSide(cells, m.x, m.y, side) >= 10_000_000) return { x: m.x, y: m.y };
    }

    // ================== 低难度：仅看局部得分+随机微扰 ==================
    if (difficulty === 'low') {
      // 偶尔漏防对手死四/活三
      const picked = candidates[Math.random() < 0.65 ? 0 : Math.min(2, candidates.length - 1)]!;
      return { x: picked.x, y: picked.y };
    }

    // 2. 对手有即将五连点必堵
    const oppWins = this.getCandidateMoves(cells, opp, 4).filter(
      (m) => this.scoreSpotForSide(cells, m.x, m.y, opp) >= 10_000_000,
    );
    if (oppWins[0]) return { x: oppWins[0].x, y: oppWins[0].y };

    // 3. 高难度启用 VCF 连续冲四算杀
    if (difficulty === 'high') {
      const vcfMove = this.searchVCF(cells, side, 8);
      if (vcfMove) return vcfMove;
    }

    // 4. 己方活四直接下单杀
    for (const m of candidates) {
      if (this.scoreSpotForSide(cells, m.x, m.y, side) >= 500_000) return { x: m.x, y: m.y };
    }

    // 5. 对手必防活四
    const oppOpenFour = this.getCandidateMoves(cells, opp, 4).find(
      (m) => this.scoreSpotForSide(cells, m.x, m.y, opp) >= 500_000,
    );
    if (oppOpenFour) return { x: oppOpenFour.x, y: oppOpenFour.y };

    // 6. 中等 2 层 / 高级 3~4 层 Alpha-Beta 剪枝
    const depth = difficulty === 'high' ? 3 : 1;
    let bestMove = candidates[0]!;
    let bestVal = -Infinity;

    for (const m of candidates) {
      const idx = m.y * SIZE + m.x;
      cells[idx] = side;
      const val = this.alphaBeta(cells, depth, -Infinity, Infinity, false, opp, side);
      cells[idx] = 0;
      if (val > bestVal) {
        bestVal = val;
        bestMove = m;
      }
    }

    return { x: bestMove.x, y: bestMove.y };
  }

  private hasNeighbor(cells: number[], x: number, y: number): boolean {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && cells[ny * SIZE + nx] !== 0) {
          return true;
        }
      }
    }
    return false;
  }

  private settleWin(ctx: RoomContext, winnerId: string): void {
    const entries: SettlementEntry[] = ctx.players.map((p) => ({
      playerId: p.playerId,
      currency: 'coin' as const,
      delta: p.playerId === winnerId ? WIN_COIN : -WIN_COIN,
      reason: 'gomoku.result',
    }));
    ctx.settle({ entries, winners: [winnerId] });
  }
}

export default GomokuPlugin;
