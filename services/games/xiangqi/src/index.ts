import type { GameMeta, GameSnapshot } from '@cc/protocol';
import type { GameIntent, RoomContext } from '@cc/game-sdk';
import { BaseGamePlugin } from '@cc/game-sdk';

type PieceType = 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p';
type Color = 'r' | 'b';

interface Piece {
  type: PieceType;
  color: Color;
}

interface Square {
  c: number;
  r: number;
}

interface Move {
  from: Square;
  to: Square;
}

interface ResultRow {
  playerId: string;
  nickname: string;
  delta: number;
  detail: string;
}

interface State {
  board: Array<Piece | null>;
  turn: Color;
  winner: Color | null;
  results: ResultRow[];
  lastMove: Move | null;
}

const WIN_COIN = 100;
const COLS = 9;
const ROWS = 10;

const idx = (sq: Square): number => sq.r * COLS + sq.c;
const at = (board: Array<Piece | null>, c: number, r: number): Piece | null =>
  c < 0 || c > 8 || r < 0 || r > 9 ? null : board[r * COLS + c] ?? null;

function initialBoard(): Array<Piece | null> {
  const board: Array<Piece | null> = new Array(90).fill(null);
  const place = (type: PieceType, color: Color, c: number, r: number): void => {
    board[r * COLS + c] = { type, color };
  };
  // 黑方（上方，row 0）
  place('r', 'b', 0, 0);
  place('n', 'b', 1, 0);
  place('b', 'b', 2, 0);
  place('a', 'b', 3, 0);
  place('k', 'b', 4, 0);
  place('a', 'b', 5, 0);
  place('b', 'b', 6, 0);
  place('n', 'b', 7, 0);
  place('r', 'b', 8, 0);
  place('c', 'b', 1, 2);
  place('c', 'b', 7, 2);
  for (const c of [0, 2, 4, 6, 8]) place('p', 'b', c, 3);
  // 红方（下方，row 9）
  place('r', 'r', 0, 9);
  place('n', 'r', 1, 9);
  place('b', 'r', 2, 9);
  place('a', 'r', 3, 9);
  place('k', 'r', 4, 9);
  place('a', 'r', 5, 9);
  place('b', 'r', 6, 9);
  place('n', 'r', 7, 9);
  place('r', 'r', 8, 9);
  place('c', 'r', 1, 7);
  place('c', 'r', 7, 7);
  for (const c of [0, 2, 4, 6, 8]) place('p', 'r', c, 6);
  return board;
}

function emptyState(): State {
  return {
    board: initialBoard(),
    turn: 'r',
    winner: null,
    results: [],
    lastMove: null,
  };
}

/** 是否在九宫内 */
function inPalace(color: Color, c: number, r: number): boolean {
  if (c < 3 || c > 5) return false;
  return color === 'r' ? r >= 7 : r <= 2;
}

/** 是否已过河 */
function crossedRiver(color: Color, r: number): boolean {
  return color === 'r' ? r <= 4 : r >= 5;
}

/** 红方帅（黑方将）所在位置 */
function kingSquare(board: Array<Piece | null>, color: Color): Square | null {
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = board[r * COLS + c];
      if (piece && piece.color === color && piece.type === 'k') return { c, r };
    }
  }
  return null;
}

function isAttacked(board: Array<Piece | null>, sq: Square, by: Color): boolean {
  // 车 / 炮的直线
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as Array<[number, number]>) {
    let c = sq.c + dc;
    let r = sq.r + dr;
    let screens = 0;
    while (c >= 0 && c <= 8 && r >= 0 && r <= 9) {
      const piece = board[r * COLS + c];
      if (piece) {
        if (screens === 0) {
          if (piece.color === by && piece.type === 'r') return true;
        } else if (piece.color === by && piece.type === 'c') {
          return true;
        }
        screens += 1;
        if (screens > 1) break;
      }
      c += dc;
      r += dr;
    }
  }
  // 马（含蹩马腿）
  const KNIGHT: Array<[number, number, number, number]> = [
    [1, 2, 0, 1],
    [2, 1, 1, 0],
    [2, -1, 1, 0],
    [1, -2, 0, -1],
    [-1, -2, 0, -1],
    [-2, -1, -1, 0],
    [-2, 1, -1, 0],
    [-1, 2, 0, 1],
  ];
  for (const [dc, dr, lc, lr] of KNIGHT) {
    const c = sq.c + dc;
    const r = sq.r + dr;
    const piece = at(board, c, r);
    if (!piece || piece.color !== by || piece.type !== 'n') continue;
    const leg = at(board, sq.c + lc, sq.r + lr);
    if (!leg) return true;
  }
  // 象 / 相（含塞象眼）
  for (const [dc, dr] of [
    [2, 2],
    [2, -2],
    [-2, 2],
    [-2, -2],
  ] as Array<[number, number]>) {
    const c = sq.c + dc;
    const r = sq.r + dr;
    const piece = at(board, c, r);
    if (!piece || piece.color !== by || piece.type !== 'b') continue;
    if (!crossedRiver(by, r)) continue;
    const eye = at(board, sq.c + dc / 2, sq.r + dr / 2);
    if (!eye) return true;
  }
  // 士 / 仕
  for (const [dc, dr] of [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as Array<[number, number]>) {
    const piece = at(board, sq.c + dc, sq.r + dr);
    if (piece && piece.color === by && piece.type === 'a') return true;
  }
  // 将 / 帅（直线一步，含对脸）
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as Array<[number, number]>) {
    const piece = at(board, sq.c + dc, sq.r + dr);
    if (piece && piece.color === by && piece.type === 'k') return true;
  }
  // 兵 / 卒
  const pawnDir = by === 'r' ? -1 : 1;
  for (const dc of [-1, 1]) {
    const piece = at(board, sq.c + dc, sq.r + pawnDir);
    if (piece && piece.color === by && piece.type === 'p') return true;
  }
  const forward = at(board, sq.c, sq.r + pawnDir);
  if (forward && forward.color === by && forward.type === 'p') return true;
  return false;
}

function inCheck(board: Array<Piece | null>, color: Color): boolean {
  const king = kingSquare(board, color);
  if (!king) return true;
  return isAttacked(board, king, color === 'r' ? 'b' : 'r');
}

/** 将帅对脸：两王同列且中间无子，属非法局面 */
function kingsFacing(board: Array<Piece | null>): boolean {
  const red = kingSquare(board, 'r');
  const black = kingSquare(board, 'b');
  if (!red || !black || red.c !== black.c) return false;
  const min = Math.min(red.r, black.r);
  const max = Math.max(red.r, black.r);
  for (let r = min + 1; r < max; r += 1) {
    if (board[r * COLS + red.c]) return false;
  }
  return true;
}

function pseudoMoves(state: State, from: Square): Move[] {
  const piece = state.board[idx(from)];
  if (!piece) return [];
  const moves: Move[] = [];
  const push = (c: number, r: number): void => {
    if (c < 0 || c > 8 || r < 0 || r > 9) return;
    const target = state.board[r * COLS + c];
    if (target && target.color === piece.color) return;
    moves.push({ from, to: { c, r } });
  };

  switch (piece.type) {
    case 'r': {
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as Array<[number, number]>) {
        let c = from.c + dc;
        let r = from.r + dr;
        while (c >= 0 && c <= 8 && r >= 0 && r <= 9) {
          const target = state.board[r * COLS + c];
          if (!target) {
            push(c, r);
          } else {
            if (target.color !== piece.color) push(c, r);
            break;
          }
          c += dc;
          r += dr;
        }
      }
      break;
    }
    case 'c': {
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as Array<[number, number]>) {
        let c = from.c + dc;
        let r = from.r + dr;
        let screens = 0;
        while (c >= 0 && c <= 8 && r >= 0 && r <= 9) {
          const target = state.board[r * COLS + c];
          if (!target) {
            if (screens === 0) push(c, r);
          } else {
            screens += 1;
            if (screens === 2) {
              if (target.color !== piece.color) push(c, r);
              break;
            }
          }
          c += dc;
          r += dr;
        }
      }
      break;
    }
    case 'n': {
      const KNIGHT: Array<[number, number, number, number]> = [
        [1, 2, 0, 1],
        [2, 1, 1, 0],
        [2, -1, 1, 0],
        [1, -2, 0, -1],
        [-1, -2, 0, -1],
        [-2, -1, -1, 0],
        [-2, 1, -1, 0],
        [-1, 2, 0, 1],
      ];
      for (const [dc, dr, lc, lr] of KNIGHT) {
        const leg = at(state.board, from.c + lc, from.r + lr);
        if (leg) continue;
        push(from.c + dc, from.r + dr);
      }
      break;
    }
    case 'b': {
      for (const [dc, dr] of [
        [2, 2],
        [2, -2],
        [-2, 2],
        [-2, -2],
      ] as Array<[number, number]>) {
        const c = from.c + dc;
        const r = from.r + dr;
        if (!crossedRiver(piece.color, r)) continue;
        const eye = at(state.board, from.c + dc / 2, from.r + dr / 2);
        if (eye) continue;
        push(c, r);
      }
      break;
    }
    case 'a': {
      for (const [dc, dr] of [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ] as Array<[number, number]>) {
        const c = from.c + dc;
        const r = from.r + dr;
        if (!inPalace(piece.color, c, r)) continue;
        push(c, r);
      }
      break;
    }
    case 'k': {
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as Array<[number, number]>) {
        const c = from.c + dc;
        const r = from.r + dr;
        if (!inPalace(piece.color, c, r)) continue;
        push(c, r);
      }
      break;
    }
    case 'p': {
      const dir = piece.color === 'r' ? -1 : 1;
      const startRow = piece.color === 'r' ? 6 : 3;
      const c = from.c;
      const r = from.r + dir;
      if (r >= 0 && r <= 9 && !state.board[idx({ c, r })]) push(c, r);
      if (from.r === startRow) {
        const two = from.r + dir * 2;
        if (two >= 0 && two <= 9 && !state.board[idx({ c, r: two })]) push(c, two);
      }
      if (crossedRiver(piece.color, from.r)) {
        for (const dc of [-1, 1]) push(from.c + dc, from.r);
      }
      break;
    }
  }
  return moves;
}

function isLegal(state: State, move: Move): boolean {
  const board = state.board.map((p) => (p ? { ...p } : null));
  const piece = board[idx(move.from)];
  if (!piece) return false;
  board[idx(move.to)] = piece;
  board[idx(move.from)] = null;
  if (inCheck(board, piece.color)) return false;
  return !kingsFacing(board);
}

function legalMoves(state: State, color: Color): Move[] {
  const moves: Move[] = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const piece = state.board[r * COLS + c];
      if (!piece || piece.color !== color) continue;
      for (const move of pseudoMoves(state, { c, r })) {
        if (isLegal(state, move)) moves.push(move);
      }
    }
  }
  return moves;
}

function applyMove(state: State, move: Move): void {
  const piece = state.board[idx(move.from)];
  if (!piece) return;
  state.board[idx(move.from)] = null;
  state.board[idx(move.to)] = piece;
  state.lastMove = move;
  state.turn = piece.color === 'r' ? 'b' : 'r';
}

export class XiangqiPlugin extends BaseGamePlugin {
  override readonly apiVersion = 1;

  override readonly meta: GameMeta = {
    gameId: 'xiangqi',
    name: '中国象棋',
    description: '楚河汉界，炮马纵横',
    icon: '🐘',
    minPlayers: 2,
    maxPlayers: 2,
    version: '1.0.0',
    clientBundle: '',
    tags: ['棋类', '双人', '竞技'],
    category: 'board',
  };

  override readonly commands = ['move'] as const;

  private state: State = emptyState();

  override onRoomCreate(_ctx: RoomContext): void {
    this.state = emptyState();
  }

  override onRoundStart(ctx: RoomContext): void {
    this.state = emptyState();
    ctx.markDirty();
  }

  override onIntent(ctx: RoomContext, playerId: string, intent: GameIntent): void {
    if (this.state.winner) throw new Error('本局已结束');
    const color = this.colorOf(ctx, playerId);
    if (!color) throw new Error('你不在本局中');
    if (this.state.turn !== color) throw new Error('还没轮到你走');

    const fromRaw = (intent.payload?.from ?? {}) as { c?: number; r?: number };
    const toRaw = (intent.payload?.to ?? {}) as { c?: number; r?: number };
    const from = { c: Number(fromRaw.c), r: Number(fromRaw.r) };
    const to = { c: Number(toRaw.c), r: Number(toRaw.r) };
    if (!Number.isInteger(from.c) || !Number.isInteger(from.r) || !Number.isInteger(to.c) || !Number.isInteger(to.r)) {
      throw new Error('走子参数不合法');
    }

    const moves = legalMoves(this.state, color);
    const match = moves.find((m) => m.from.c === from.c && m.from.r === from.r && m.to.c === to.c && m.to.r === to.r);
    if (!match) throw new Error('这一步不合法');

    applyMove(this.state, match);

    const opponent = color === 'r' ? 'b' : 'r';
    if (legalMoves(this.state, opponent).length === 0) {
      this.state.winner = color;
      this.settle(ctx, color);
      return;
    }
    ctx.markDirty();
  }

  /** 红方为 seat 最小的一方 */
  private colorOf(ctx: RoomContext, playerId: string): Color | null {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const index = players.findIndex((p) => p.playerId === playerId);
    if (index < 0) return null;
    return index === 0 ? 'r' : 'b';
  }

  private settle(ctx: RoomContext, winnerColor: Color): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const results: ResultRow[] = players.map((p, index) => {
      const color: Color = index === 0 ? 'r' : 'b';
      const win = color === winnerColor;
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        delta: win ? WIN_COIN : -WIN_COIN,
        detail: win ? '绝杀对手' : '被绝杀',
      };
    });
    this.state.results = results;
    const entries = results
      .filter((r) => ctx.getPlayer(r.playerId)?.isBot !== true)
      .map((r) => ({ playerId: r.playerId, currency: 'coin' as const, delta: r.delta, reason: 'xiangqi.result' }));
    ctx.settle({ entries, winners: results.filter((r) => r.delta > 0).map((r) => r.playerId) });
  }

  override botIntent(ctx: RoomContext, playerId: string): GameIntent | null {
    const color = this.colorOf(ctx, playerId);
    if (!color || this.state.winner || this.state.turn !== color) return null;
    const moves = legalMoves(this.state, color);
    if (moves.length === 0) return null;
    const captures = moves.filter((m) => this.state.board[idx(m.to)]);
    const pool = captures.length > 0 && Math.random() < 0.75 ? captures : moves;
    const move = pool[Math.floor(Math.random() * pool.length)]!;
    return { cmd: 'move', payload: { from: move.from, to: move.to } };
  }

  override getSnapshot(ctx: RoomContext, viewerId: string | null): GameSnapshot {
    const color = viewerId ? this.colorOf(ctx, viewerId) : null;
    const moves = color && !this.state.winner ? legalMoves(this.state, color) : [];
    return {
      phase: this.state.winner ? 'settled' : 'playing',
      round: ctx.config.round,
      remainMs: 0,
      phaseDurationMs: 0,
      turn: this.state.turn,
      myColor: color,
      inCheck: color ? inCheck(this.state.board, color) : false,
      board: this.state.board.map((piece, i) => ({
        c: i % COLS,
        r: Math.floor(i / COLS),
        piece: piece ? { type: piece.type, color: piece.color } : null,
      })),
      moves: moves.map((m) => ({ from: { c: m.from.c, r: m.from.r }, to: { c: m.to.c, r: m.to.r } })),
      lastMove: this.state.lastMove
        ? {
            from: { c: this.state.lastMove.from.c, r: this.state.lastMove.from.r },
            to: { c: this.state.lastMove.to.c, r: this.state.lastMove.to.r },
          }
        : null,
      winner: this.state.winner,
      results: this.state.results,
      players: [...ctx.players]
        .sort((a, b) => a.seat - b.seat)
        .map((p, index) => ({
          playerId: p.playerId,
          nickname: p.nickname,
          color: (index === 0 ? 'r' : 'b') as Color,
          isBot: p.isBot,
        })),
    };
  }

  override getCurrentActor(ctx: RoomContext): string | null {
    if (this.state.winner) return null;
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const index = this.state.turn === 'r' ? 0 : 1;
    return players[index]?.playerId ?? null;
  }
}

export default XiangqiPlugin;
