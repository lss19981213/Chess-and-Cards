import type { GameMeta, GameSnapshot } from '@cc/protocol';
import type { GameIntent, RoomContext } from '@cc/game-sdk';
import { BaseGamePlugin } from '@cc/game-sdk';

type PieceType = 'p' | 'r' | 'n' | 'b' | 'q' | 'k';
type Color = 'w' | 'b';

interface Piece {
  type: PieceType;
  color: Color;
}

interface Square {
  f: number;
  r: number;
}

interface Move {
  from: Square;
  to: Square;
  promotion?: PieceType;
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
  castling: { wK: boolean; wQ: boolean; bK: boolean; bQ: boolean };
  /** 吃过路兵的可落子格 */
  ep: Square | null;
  /** 已移动过的棋子（王车易位判定），键为 `f,r` */
  moved: Set<string>;
  lastMove: Move | null;
  winner: Color | null;
  results: ResultRow[];
  /** 本局已即时扣款的真人 */
  charged: Set<string>;
}

const WIN_COIN = 100;
const FILES = 8;
const RANKS = 8;

const key = (sq: Square): string => `${sq.f},${sq.r}`;
const idx = (sq: Square): number => sq.r * FILES + sq.f;
const at = (board: Array<Piece | null>, f: number, r: number): Piece | null =>
  f < 0 || f > 7 || r < 0 || r > 7 ? null : board[r * FILES + f] ?? null;

function initialBoard(): Array<Piece | null> {
  const board: Array<Piece | null> = new Array(64).fill(null);
  const back: PieceType[] = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
  for (let f = 0; f < 8; f += 1) {
    board[0 * FILES + f] = { type: back[f]!, color: 'b' };
    board[7 * FILES + f] = { type: back[f]!, color: 'w' };
    board[1 * FILES + f] = { type: 'p', color: 'b' };
    board[6 * FILES + f] = { type: 'p', color: 'w' };
  }
  return board;
}

function emptyState(): State {
  return {
    board: initialBoard(),
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    ep: null,
    moved: new Set(),
    lastMove: null,
    winner: null,
    results: [],
    charged: new Set(),
  };
}

const SLIDES: Record<string, Array<[number, number]>> = {
  r: [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ],
  b: [
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ],
};
const KING_DIRS: Array<[number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
const KNIGHT_DIRS: Array<[number, number]> = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];

/** 某格是否被指定颜色攻击（用于将军判定） */
function isAttacked(board: Array<Piece | null>, sq: Square, by: Color): boolean {
  const pawnDir = by === 'w' ? -1 : 1;
  for (const df of [-1, 1]) {
    const piece = at(board, sq.f + df, sq.r + pawnDir);
    if (piece && piece.color === by && piece.type === 'p') return true;
  }
  for (const [df, dr] of KNIGHT_DIRS) {
    const piece = at(board, sq.f + df, sq.r + dr);
    if (piece && piece.color === by && piece.type === 'n') return true;
  }
  for (const [df, dr] of KING_DIRS) {
    const piece = at(board, sq.f + df, sq.r + dr);
    if (piece && piece.color === by && piece.type === 'k') return true;
  }
  for (const [df, dr] of SLIDES.r!) {
    let f = sq.f + df;
    let r = sq.r + dr;
    // 必须有边界：at() 越界返回 null，无限循环会把进程拖死
    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const piece = at(board, f, r);
      if (piece) {
        if (piece.color === by && (piece.type === 'q' || piece.type === 'r')) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }
  for (const [df, dr] of SLIDES.b!) {
    let f = sq.f + df;
    let r = sq.r + dr;
    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const piece = at(board, f, r);
      if (piece) {
        if (piece.color === by && (piece.type === 'q' || piece.type === 'b')) return true;
        break;
      }
      f += df;
      r += dr;
    }
  }
  return false;
}

function findKing(board: Array<Piece | null>, color: Color): Square | null {
  for (let r = 0; r < 8; r += 1) {
    for (let f = 0; f < 8; f += 1) {
      const piece = board[r * FILES + f];
      if (piece && piece.color === color && piece.type === 'k') return { f, r };
    }
  }
  return null;
}

function inCheck(board: Array<Piece | null>, color: Color): boolean {
  const king = findKing(board, color);
  if (!king) return true;
  return isAttacked(board, king, color === 'w' ? 'b' : 'w');
}

/** 走子是否合法（不将军自己） */
function isLegal(state: State, move: Move): boolean {
  const board = state.board.map((p) => (p ? { ...p } : null));
  const piece = board[idx(move.from)];
  if (!piece) return false;

  board[idx(move.to)] = piece;
  board[idx(move.from)] = null;
  // 吃过路兵：移除被吃掉的兵
  if (piece.type === 'p' && move.from.f !== move.to.f) {
    const captured = board[idx({ f: move.to.f, r: move.from.r })];
    if (captured && captured.type === 'p') board[idx({ f: move.to.f, r: move.from.r })] = null;
  }
  if (move.promotion) board[idx(move.to)] = { type: move.promotion, color: piece.color };

  return !inCheck(board, piece.color);
}

/** 生成某棋子的伪合法走法 */
function pseudoMoves(state: State, from: Square): Move[] {
  const piece = state.board[idx(from)];
  if (!piece) return [];
  const moves: Move[] = [];
  const add = (f: number, r: number, promotion?: PieceType): void => {
    const target = state.board[r * FILES + f];
    if (target && target.color === piece.color) return;
    moves.push({ from, to: { f, r }, ...(promotion ? { promotion } : {}) });
  };

  if (piece.type === 'p') {
    const dir = piece.color === 'w' ? 1 : -1;
    const startRow = piece.color === 'w' ? 1 : 6;
    const lastRow = piece.color === 'w' ? 7 : 0;
    const one = { f: from.f, r: from.r + dir };
    if (one.r >= 0 && one.r <= 7 && !state.board[idx(one)]) {
      if (one.r === lastRow) {
        for (const t of ['q', 'r', 'b', 'n'] as PieceType[]) add(one.f, one.r, t);
      } else {
        add(one.f, one.r);
      }
      const two = { f: from.f, r: from.r + dir * 2 };
      if (from.r === startRow && !state.board[idx(two)]) add(two.f, two.r);
    }
    for (const df of [-1, 1]) {
      const f = from.f + df;
      const r = from.r + dir;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      const target = state.board[r * FILES + f];
      if (target && target.color !== piece.color) add(f, r);
      else if (!target && state.ep && state.ep.f === f && state.ep.r === r) add(f, r);
    }
    return moves;
  }

  if (piece.type === 'n' || piece.type === 'k') {
    const dirs = piece.type === 'n' ? KNIGHT_DIRS : KING_DIRS;
    for (const [df, dr] of dirs) {
      const f = from.f + df;
      const r = from.r + dr;
      if (f < 0 || f > 7 || r < 0 || r > 7) continue;
      const target = state.board[r * FILES + f];
      if (target && target.color === piece.color) continue;
      moves.push({ from, to: { f, r } });
    }
    return moves;
  }

  const dirs = piece.type === 'b' ? SLIDES.b! : piece.type === 'r' ? SLIDES.r! : KING_DIRS;
  for (const [df, dr] of dirs) {
    let f = from.f + df;
    let r = from.r + dr;
    while (f >= 0 && f <= 7 && r >= 0 && r <= 7) {
      const target = state.board[r * FILES + f];
      if (!target) {
        moves.push({ from, to: { f, r } });
      } else {
        if (target.color !== piece.color) moves.push({ from, to: { f, r } });
        break;
      }
      f += df;
      r += dr;
    }
  }
  return moves;
}

/** 王车易位 */
function castlingMoves(state: State, color: Color): Move[] {
  const moves: Move[] = [];
  const row = color === 'w' ? 7 : 0;
  const kingFrom = { f: 4, r: row };
  if (state.board[idx(kingFrom)]?.type !== 'k') return moves;
  if (state.moved.has(key(kingFrom))) return moves;
  const enemy = color === 'w' ? 'b' : 'w';

  const kingSide = color === 'w' ? 'wK' : 'bK';
  const queenSide = color === 'w' ? 'wQ' : 'bQ';
  const rookF = color === 'w' ? 7 : 0;
  const queenF = color === 'w' ? 0 : 7;

  if (state.castling[kingSide]) {
    const rook = state.board[idx({ f: rookF, r: row })];
    if (rook && rook.type === 'r' && !state.moved.has(key({ f: rookF, r: row }))) {
      const empty = !state.board[idx({ f: 5, r: row })] && !state.board[idx({ f: 6, r: row })];
      if (empty && !isAttacked(state.board, kingFrom, enemy) && !isAttacked(state.board, { f: 5, r: row }, enemy) && !isAttacked(state.board, { f: 6, r: row }, enemy)) {
        moves.push({ from: kingFrom, to: { f: 6, r: row } });
      }
    }
  }
  if (state.castling[queenSide]) {
    const rook = state.board[idx({ f: queenF, r: row })];
    if (rook && rook.type === 'r' && !state.moved.has(key({ f: queenF, r: row }))) {
      const empty = !state.board[idx({ f: 1, r: row })] && !state.board[idx({ f: 2, r: row })] && !state.board[idx({ f: 3, r: row })];
      if (empty && !isAttacked(state.board, kingFrom, enemy) && !isAttacked(state.board, { f: 3, r: row }, enemy) && !isAttacked(state.board, { f: 2, r: row }, enemy)) {
        moves.push({ from: kingFrom, to: { f: 2, r: row } });
      }
    }
  }
  return moves;
}

function legalMoves(state: State, color: Color): Move[] {
  const moves: Move[] = [];
  for (let r = 0; r < 8; r += 1) {
    for (let f = 0; f < 8; f += 1) {
      const piece = state.board[r * FILES + f];
      if (!piece || piece.color !== color) continue;
      for (const move of pseudoMoves(state, { f, r })) {
        if (isLegal(state, move)) moves.push(move);
      }
    }
  }
  if (!inCheck(state.board, color)) {
    for (const move of castlingMoves(state, color)) {
      if (isLegal(state, move)) moves.push(move);
    }
  }
  return moves;
}

function applyMove(state: State, move: Move): void {
  const piece = state.board[idx(move.from)];
  if (!piece) return;
  const captured = state.board[idx(move.to)];
  state.moved.add(key(move.from));

  // 王车易位时同步移动车
  if (piece.type === 'k' && Math.abs(move.to.f - move.from.f) === 2) {
    const row = move.from.r;
    const rookFrom = { f: move.to.f > move.from.f ? 7 : 0, r: row };
    const rookTo = { f: move.to.f > move.from.f ? 5 : 3, r: row };
    state.board[idx(rookTo)] = state.board[idx(rookFrom)] ?? null;
    state.board[idx(rookFrom)] = null;
    state.moved.add(key(rookFrom));
  }

  state.board[idx(move.from)] = null;
  state.board[idx(move.to)] = move.promotion ? { type: move.promotion, color: piece.color } : piece ?? null;

  // 吃过路兵
  if (piece.type === 'p' && captured === null && move.from.f !== move.to.f) {
    state.board[idx({ f: move.to.f, r: move.from.r })] = null;
  }

  // 王车易位权限
  if (piece.type === 'k') {
    if (piece.color === 'w') {
      state.castling.wK = false;
      state.castling.wQ = false;
    } else {
      state.castling.bK = false;
      state.castling.bQ = false;
    }
  }
  if (piece.type === 'r') {
    if (move.from.r === 7 && move.from.f === 0) state.castling.wQ = false;
    if (move.from.r === 7 && move.from.f === 7) state.castling.wK = false;
    if (move.from.r === 0 && move.from.f === 0) state.castling.bQ = false;
    if (move.from.r === 0 && move.from.f === 7) state.castling.bK = false;
  }

  // 吃过路兵目标格
  state.ep = null;
  if (piece.type === 'p' && Math.abs(move.to.r - move.from.r) === 2) {
    state.ep = { f: move.from.f, r: (move.from.r + move.to.r) / 2 };
  }

  state.lastMove = move;
  state.turn = piece.color === 'w' ? 'b' : 'w';
}

export class ChessPlugin extends BaseGamePlugin {
  override readonly apiVersion = 1;

  override readonly meta: GameMeta = {
    gameId: 'chess',
    name: '国际象棋',
    description: '楚汉对决，王将争锋',
    icon: '♞',
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

    const fromRaw = (intent.payload?.from ?? {}) as { f?: number; r?: number };
    const toRaw = (intent.payload?.to ?? {}) as { f?: number; r?: number };
    const from = { f: Number(fromRaw.f), r: Number(fromRaw.r) };
    const to = { f: Number(toRaw.f), r: Number(toRaw.r) };
    if (!Number.isInteger(from.f) || !Number.isInteger(from.r) || !Number.isInteger(to.f) || !Number.isInteger(to.r)) {
      throw new Error('走子参数不合法');
    }

    const moves = legalMoves(this.state, color);
    const match = moves.find((m) => m.from.f === from.f && m.from.r === from.r && m.to.f === to.f && m.to.r === to.r);
    if (!match) throw new Error('这一步不合法');

    applyMove(this.state, match);

    const opponent = color === 'w' ? 'b' : 'w';
    if (legalMoves(this.state, opponent).length === 0) {
      this.state.winner = color;
      this.settle(ctx, color === 'w' ? 'w' : 'b');
      return;
    }
    ctx.markDirty();
  }

  /** 白方为房主（seat 最小），黑方为另一位 */
  private colorOf(ctx: RoomContext, playerId: string): Color | null {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const index = players.findIndex((p) => p.playerId === playerId);
    if (index < 0) return null;
    return index === 0 ? 'w' : 'b';
  }

  private settle(ctx: RoomContext, winnerColor: Color): void {
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const results: ResultRow[] = players.map((p, index) => {
      const color: Color = index === 0 ? 'w' : 'b';
      const win = color === winnerColor;
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        delta: win ? WIN_COIN : -WIN_COIN,
        detail: win ? '将死对手' : '被将死',
      };
    });
    this.state.results = results;
    const entries = results
      .filter((r) => ctx.getPlayer(r.playerId)?.isBot !== true)
      .map((r) => ({ playerId: r.playerId, currency: 'coin' as const, delta: r.delta, reason: 'chess.result' }));
    ctx.settle({ entries, winners: results.filter((r) => r.delta > 0).map((r) => r.playerId) });
  }

  override botIntent(ctx: RoomContext, playerId: string): GameIntent | null {
    const color = this.colorOf(ctx, playerId);
    if (!color || this.state.winner || this.state.turn !== color) return null;
    const moves = legalMoves(this.state, color);
    if (moves.length === 0) return null;
    // 优先吃子，其次随机
    const captures = moves.filter((m) => this.state.board[idx(m.to)]);
    const pool = captures.length > 0 && Math.random() < 0.7 ? captures : moves;
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
        f: i % FILES,
        r: Math.floor(i / FILES),
        piece: piece ? { type: piece.type, color: piece.color } : null,
      })),
      moves: moves.map((m) => ({ from: { f: m.from.f, r: m.from.r }, to: { f: m.to.f, r: m.to.r } })),
      lastMove: this.state.lastMove
        ? {
            from: { f: this.state.lastMove.from.f, r: this.state.lastMove.from.r },
            to: { f: this.state.lastMove.to.f, r: this.state.lastMove.to.r },
          }
        : null,
      winner: this.state.winner,
      results: this.state.results,
      players: [...ctx.players]
        .sort((a, b) => a.seat - b.seat)
        .map((p, index) => ({
          playerId: p.playerId,
          nickname: p.nickname,
          color: (index === 0 ? 'w' : 'b') as Color,
          isBot: p.isBot,
        })),
    };
  }

  override getCurrentActor(ctx: RoomContext): string | null {
    if (this.state.winner) return null;
    const players = [...ctx.players].sort((a, b) => a.seat - b.seat);
    const index = this.state.turn === 'w' ? 0 : 1;
    return players[index]?.playerId ?? null;
  }
}

export default ChessPlugin;
