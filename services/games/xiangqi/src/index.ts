import type { BotDifficulty, GameMeta, GameSnapshot } from '@cc/protocol';
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
  // 车 / 炮的直线攻击
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

  // 马攻击：检查能跳到 sq 的对方马并检验蹩马腿
  for (const [dc, dr] of [
    [1, 2], [1, -2], [-1, 2], [-1, -2],
    [2, 1], [2, -1], [-2, 1], [-2, -1],
  ] as Array<[number, number]>) {
    const horseC = sq.c + dc;
    const horseR = sq.r + dr;
    const piece = at(board, horseC, horseR);
    if (!piece || piece.color !== by || piece.type !== 'n') continue;
    // 马腿位置：从马的位置沿长轴朝 sq 迈出 1 格
    const legC = Math.abs(dc) === 2 ? horseC - Math.sign(dc) : horseC;
    const legR = Math.abs(dr) === 2 ? horseR - Math.sign(dr) : horseR;
    if (!at(board, legC, legR)) return true;
  }

  // 象 / 相攻击（含塞象眼，象不能过河）
  for (const [dc, dr] of [
    [2, 2], [2, -2], [-2, 2], [-2, -2],
  ] as Array<[number, number]>) {
    const elephantC = sq.c + dc;
    const elephantR = sq.r + dr;
    const piece = at(board, elephantC, elephantR);
    if (!piece || piece.color !== by || piece.type !== 'b') continue;
    if (crossedRiver(by, sq.r)) continue; // 象不可过河
    const eyeC = sq.c + dc / 2;
    const eyeR = sq.r + dr / 2;
    if (!at(board, eyeC, eyeR)) return true;
  }

  // 士 / 仕攻击（九宫斜走）
  for (const [dc, dr] of [
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ] as Array<[number, number]>) {
    const piece = at(board, sq.c + dc, sq.r + dr);
    if (piece && piece.color === by && piece.type === 'a') return true;
  }

  // 将 / 帅攻击（九宫直走一步）
  for (const [dc, dr] of [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ] as Array<[number, number]>) {
    const piece = at(board, sq.c + dc, sq.r + dr);
    if (piece && piece.color === by && piece.type === 'k') return true;
  }

  // 兵 / 卒攻击：前进方向为 pawnDir，只能前进一步；过河后可横走一步
  const pawnDir = by === 'r' ? -1 : 1;
  const fromFront = at(board, sq.c, sq.r - pawnDir);
  if (fromFront && fromFront.color === by && fromFront.type === 'p') return true;

  if (crossedRiver(by, sq.r)) {
    for (const dc of [-1, 1]) {
      const fromSide = at(board, sq.c + dc, sq.r);
      if (fromSide && fromSide.color === by && fromSide.type === 'p') return true;
    }
  }

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
      // 象飞田，不能过河，塞象眼不能走
      for (const [dc, dr] of [
        [2, 2],
        [2, -2],
        [-2, 2],
        [-2, -2],
      ] as Array<[number, number]>) {
        const c = from.c + dc;
        const r = from.r + dr;
        if (crossedRiver(piece.color, r)) continue; // 象不能过河！
        const eye = at(state.board, from.c + dc / 2, from.r + dr / 2);
        if (eye) continue; // 塞象眼
        push(c, r);
      }
      break;
    }
    case 'a': {
      // 士走斜线，不出九宫
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
      // 将帅走直步，不出九宫
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
      // 兵卒前进一步，吃子与移动同向；过河后可左右移动一步，绝不可走两步
      const dir = piece.color === 'r' ? -1 : 1;
      push(from.c, from.r + dir);
      if (crossedRiver(piece.color, from.r)) {
        push(from.c - 1, from.r);
        push(from.c + 1, from.r);
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

// --- 象棋博弈搜索引擎（PST + MVV-LVA + Alpha-Beta + 静态搜索） ---

const XQ_VAL: Record<PieceType, number> = {
  k: 10000,
  r: 900,
  c: 450,
  n: 400,
  b: 200,
  a: 200,
  p: 100,
};

// 红方视角（r=9为底线，r=0为敌方底线）；黑方以 9-r 镜像查表
const XQ_PAWN_PST = [
  [9, 9, 9, 11, 13, 11, 9, 9, 9],
  [39, 48, 56, 65, 70, 65, 56, 48, 39],
  [38, 46, 54, 62, 68, 62, 54, 46, 38],
  [30, 38, 44, 52, 56, 52, 44, 38, 30],
  [18, 24, 30, 36, 40, 36, 30, 24, 18],
  [4, 0, 8, 0, 12, 0, 8, 0, 4],
  [2, 0, 4, 0, 8, 0, 4, 0, 2],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const XQ_ROOK_PST = [
  [14, 14, 12, 18, 16, 18, 12, 14, 14],
  [16, 20, 18, 24, 26, 24, 18, 20, 16],
  [12, 16, 14, 20, 22, 20, 14, 16, 12],
  [12, 16, 14, 20, 22, 20, 14, 16, 12],
  [12, 16, 16, 22, 24, 22, 16, 16, 12],
  [10, 14, 12, 18, 20, 18, 12, 14, 10],
  [6, 10, 10, 14, 16, 14, 10, 10, 6],
  [4, 8, 8, 12, 14, 12, 8, 8, 4],
  [8, 12, 10, 14, 12, 14, 10, 12, 8],
  [-2, 8, 4, 12, 10, 12, 4, 8, -2],
];

const XQ_KNIGHT_PST = [
  [4, 8, 16, 12, 4, 12, 16, 8, 4],
  [4, 10, 22, 16, 14, 16, 22, 10, 4],
  [8, 16, 24, 26, 20, 26, 24, 16, 8],
  [6, 14, 20, 24, 26, 24, 20, 14, 6],
  [4, 12, 18, 20, 24, 20, 18, 12, 4],
  [2, 10, 14, 18, 20, 18, 14, 10, 2],
  [0, 8, 12, 14, 16, 14, 12, 8, 0],
  [-4, 4, 10, 8, 12, 8, 10, 4, -4],
  [-6, 0, 4, 6, 4, 6, 4, 0, -6],
  [-8, -4, 0, 2, 0, 2, 0, -4, -8],
];

const XQ_CANNON_PST = [
  [6, 4, 0, -4, -6, -4, 0, 4, 6],
  [4, 4, 2, 4, 6, 4, 2, 4, 4],
  [2, 4, 6, 10, 14, 10, 6, 4, 2],
  [2, 2, 4, 8, 12, 8, 4, 2, 2],
  [0, 2, 4, 10, 16, 10, 4, 2, 0],
  [0, 2, 4, 8, 12, 8, 4, 2, 0],
  [0, 4, 4, 6, 10, 6, 4, 4, 0],
  [2, 6, 8, 10, 18, 10, 8, 6, 2],
  [0, 2, 2, 4, 8, 4, 2, 2, 0],
  [0, 0, 2, 4, 6, 4, 2, 0, 0],
];

function xqPst(piece: Piece, c: number, r: number): number {
  const row = piece.color === 'r' ? r : 9 - r;
  switch (piece.type) {
    case 'p':
      return XQ_PAWN_PST[row]![c]!;
    case 'r':
      return XQ_ROOK_PST[row]![c]!;
    case 'n':
      return XQ_KNIGHT_PST[row]![c]!;
    case 'c':
      return XQ_CANNON_PST[row]![c]!;
    case 'k':
      return row >= 8 && c === 4 ? 10 : 0;
    case 'a':
      return c === 4 && row === 8 ? 10 : 4;
    case 'b':
      return row >= 7 && (c === 2 || c === 6) ? 8 : 2;
  }
}

function evalXiangqi(board: Array<Piece | null>, side: Color): number {
  let score = 0;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const p = board[r * COLS + c];
      if (!p) continue;
      const v = XQ_VAL[p.type] + xqPst(p, c, r);
      score += p.color === side ? v : -v;
    }
  }
  return score;
}

function xqSearchMoves(dummy: State, color: Color, capturesOnly: boolean): Array<{ move: Move; order: number }> {
  const result: Array<{ move: Move; order: number }> = [];
  const board = dummy.board;
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const p = board[r * COLS + c];
      if (!p || p.color !== color) continue;
      for (const move of pseudoMoves(dummy, { c, r })) {
        const victim = board[idx(move.to)] ?? null;
        if (capturesOnly && !victim) continue;
        // 原地试走并检查被将军/将帅对脸
        const fromIdx = idx(move.from);
        const toIdx = idx(move.to);
        board[toIdx] = p;
        board[fromIdx] = null;
        const ok = !inCheck(board, color) && !kingsFacing(board);
        board[fromIdx] = p;
        board[toIdx] = victim ?? null;
        if (!ok) continue;

        const mvvLva = victim ? XQ_VAL[victim.type] * 10 - XQ_VAL[p.type] + 2000 : 0;
        const posGain = xqPst(p, move.to.c, move.to.r) - xqPst(p, move.from.c, move.from.r);
        result.push({ move, order: mvvLva + posGain });
      }
    }
  }
  result.sort((a, b) => b.order - a.order);
  return result;
}

interface XqSearchCtx {
  dummy: State;
  deadline: number;
  aborted: boolean;
}

function xqQuiesce(ctx: XqSearchCtx, side: Color, alpha: number, beta: number, qDepth: number): number {
  const standPat = evalXiangqi(ctx.dummy.board, side);
  if (standPat >= beta) return beta;
  let a = Math.max(alpha, standPat);
  if (qDepth <= 0 || Date.now() >= ctx.deadline) return a;

  const caps = xqSearchMoves(ctx.dummy, side, true);
  const nextSide: Color = side === 'r' ? 'b' : 'r';
  for (const { move } of caps) {
    const fromIdx = idx(move.from);
    const toIdx = idx(move.to);
    const piece = ctx.dummy.board[fromIdx]!;
    const captured = ctx.dummy.board[toIdx] ?? null;
    ctx.dummy.board[toIdx] = piece;
    ctx.dummy.board[fromIdx] = null;
    const score = -xqQuiesce(ctx, nextSide, -beta, -a, qDepth - 1);
    ctx.dummy.board[fromIdx] = piece;
    ctx.dummy.board[toIdx] = captured;
    if (score >= beta) return beta;
    if (score > a) a = score;
  }
  return a;
}

function xqNegamax(
  ctx: XqSearchCtx,
  side: Color,
  depth: number,
  ply: number,
  alpha: number,
  beta: number,
  useQuiesce: boolean,
): number {
  if (Date.now() >= ctx.deadline) {
    ctx.aborted = true;
    return evalXiangqi(ctx.dummy.board, side);
  }
  if (depth <= 0) {
    return useQuiesce ? xqQuiesce(ctx, side, alpha, beta, 2) : evalXiangqi(ctx.dummy.board, side);
  }
  const moves = xqSearchMoves(ctx.dummy, side, false);
  if (moves.length === 0) return -9500 + ply;

  const nextSide: Color = side === 'r' ? 'b' : 'r';
  let a = alpha;
  for (const { move } of moves) {
    const fromIdx = idx(move.from);
    const toIdx = idx(move.to);
    const piece = ctx.dummy.board[fromIdx]!;
    const captured = ctx.dummy.board[toIdx] ?? null;
    ctx.dummy.board[toIdx] = piece;
    ctx.dummy.board[fromIdx] = null;
    const score = -xqNegamax(ctx, nextSide, depth - 1, ply + 1, -beta, -a, useQuiesce);
    ctx.dummy.board[fromIdx] = piece;
    ctx.dummy.board[toIdx] = captured;
    if (ctx.aborted) return a;
    if (score >= beta) return beta;
    if (score > a) a = score;
  }
  return a;
}

function chooseXiangqiBotMove(state: State, color: Color, difficulty: BotDifficulty): Move | null {
  const boardCopy = state.board.map((p) => (p ? { ...p } : null));
  const dummy: State = { board: boardCopy, turn: color, winner: null, results: [], lastMove: null };
  const rootMoves = xqSearchMoves(dummy, color, false);
  if (rootMoves.length === 0) return null;

  const targetDepth = difficulty === 'low' ? 1 : difficulty === 'medium' ? 2 : 3;
  const useQuiesce = difficulty === 'high';
  const deadline = Date.now() + (difficulty === 'high' ? 32 : 16);
  const nextSide: Color = color === 'r' ? 'b' : 'r';

  let scored: Array<{ move: Move; score: number }> = rootMoves.map((m) => ({ move: m.move, score: 0 }));

  for (let depth = 1; depth <= targetDepth; depth += 1) {
    const ctx: XqSearchCtx = { dummy, deadline, aborted: false };
    const nextScored: Array<{ move: Move; score: number }> = [];
    for (const item of scored) {
      const fromIdx = idx(item.move.from);
      const toIdx = idx(item.move.to);
      const piece = dummy.board[fromIdx]!;
      const captured = dummy.board[toIdx] ?? null;
      dummy.board[toIdx] = piece;
      dummy.board[fromIdx] = null;
      const score = -xqNegamax(ctx, nextSide, depth - 1, 1, -20000, 20000, useQuiesce);
      dummy.board[fromIdx] = piece;
      dummy.board[toIdx] = captured;
      if (ctx.aborted) break;
      nextScored.push({ move: item.move, score });
    }
    if (!ctx.aborted && nextScored.length === scored.length) {
      nextScored.sort((a, b) => b.score - a.score);
      scored = nextScored;
    } else {
      break;
    }
  }

  if (difficulty === 'low') {
    // 初级：偶发小失误，从分差合理的候选里带噪声抽取
    const bestScore = scored[0]!.score;
    const pool = scored.filter((m) => bestScore - m.score <= 180).slice(0, 4);
    return pool[Math.floor(Math.random() * pool.length)]!.move;
  }

  if (difficulty === 'medium') {
    const bestScore = scored[0]!.score;
    const pool = scored.filter((m) => bestScore - m.score <= 15).slice(0, 2);
    return pool[Math.floor(Math.random() * pool.length)]!.move;
  }

  return scored[0]!.move;
}

export class XiangqiPlugin extends BaseGamePlugin {

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

  override botIntent(ctx: RoomContext, playerId: string, difficulty: BotDifficulty = 'medium'): GameIntent | null {
    const color = this.colorOf(ctx, playerId);
    if (!color || this.state.winner || this.state.turn !== color) return null;
    const move = chooseXiangqiBotMove(this.state, color, difficulty);
    if (!move) return null;
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
