import type { GameMeta, GameSnapshot, SettlementEntry } from '@cc/protocol';
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

  override botIntent(ctx: RoomContext, playerId: string): GameIntent | null {
    if (this.state.winner !== 0) return null;
    const player = ctx.getPlayer(playerId);
    if (!player) return null;
    const side = player.seat === 0 ? BLACK : WHITE;
    if (side !== this.state.turn) return null;

    const spot = this.pickMove(side);
    return spot ? { cmd: 'place', payload: spot } : null;
  }

  /** 简单启发式：兼顾自己连子与封堵对手 */
  private pickMove(side: number): { x: number; y: number } | null {
    const opponent = side === BLACK ? WHITE : BLACK;
    let best: { x: number; y: number; score: number } | null = null;

    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) {
        if (this.state.cells[y * SIZE + x] !== 0) continue;
        if (!this.hasNeighbor(x, y)) continue;
        const score = this.evalPoint(x, y, side, opponent);
        if (!best || score > best.score) best = { x, y, score };
      }
    }

    if (best) return { x: best.x, y: best.y };

    const center = Math.floor(SIZE / 2);
    if (this.state.cells[center * SIZE + center] === 0) return { x: center, y: center };
    return null;
  }

  private hasNeighbor(x: number, y: number): boolean {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && this.state.cells[ny * SIZE + nx] !== 0) {
          return true;
        }
      }
    }
    return false;
  }

  private evalPoint(x: number, y: number, side: number, opponent: number): number {
    let score = 0;
    for (const [dx, dy] of DIRECTIONS) {
      let own = 1;
      let block = 1;
      for (const sign of [1, -1] as const) {
        let nx = x + dx * sign;
        let ny = y + dy * sign;
        while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && this.state.cells[ny * SIZE + nx] === side) {
          own += 1;
          nx += dx * sign;
          ny += dy * sign;
        }
        nx = x + dx * sign;
        ny = y + dy * sign;
        while (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE && this.state.cells[ny * SIZE + nx] === opponent) {
          block += 1;
          nx += dx * sign;
          ny += dy * sign;
        }
      }
      score += 8 ** own + 7.5 ** block;
    }
    return score;
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
