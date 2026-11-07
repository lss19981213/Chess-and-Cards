import { useMemo, useState } from 'react';

interface BoardPiece {
  type: string;
  color: string;
}

interface BoardSnapshot {
  phase: string;
  round: number;
  turn: string;
  myColor: string | null;
  inCheck: boolean;
  board: Array<{ f?: number; c?: number; r: number; piece: BoardPiece | null }>;
  moves: Array<{
    from: { f?: number; c?: number; r: number };
    to: { f?: number; c?: number; r: number };
  }>;
  lastMove: { from: { f?: number; c?: number; r: number }; to: { f?: number; c?: number; r: number } } | null;
  winner: string | null;
  results: Array<{ playerId: string; nickname: string; delta: number; detail: string }>;
  players: Array<{ playerId: string; nickname: string; color: string; isBot: boolean }>;
}

interface Props {
  snapshot: Record<string, unknown> | null;
  myId: string;
  status: string;
  variant: 'chess' | 'xiangqi';
  onAction: (cmd: string, payload?: Record<string, unknown>) => void;
}

const CHESS_GLYPH: Record<string, Record<string, string>> = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' },
};

const XQ_GLYPH: Record<string, Record<string, string>> = {
  r: { k: '帅', a: '仕', b: '相', n: '马', r: '车', c: '炮', p: '兵' },
  b: { k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒' },
};

export function BoardGame({ snapshot, myId, status, variant, onAction }: Props) {
  const data = snapshot as unknown as BoardSnapshot | undefined;
  const [selected, setSelected] = useState<string | null>(null);

  const isXq = variant === 'xiangqi';
  const cols = isXq ? 9 : 8;
  const rows = isXq ? 10 : 8;
  const glyph = isXq ? XQ_GLYPH : CHESS_GLYPH;

  const cellOf = (cell: { f?: number; c?: number; r: number }): { x: number; y: number } => ({
    x: isXq ? (cell.c ?? 0) : (cell.f ?? 0),
    y: isXq ? cell.r : rows - 1 - cell.r,
  });

  const targets = useMemo(() => {
    if (!data || !selected) return new Set<string>();
    const set = new Set<string>();
    for (const move of data.moves) {
      const from = cellOf(move.from);
      if (`${from.x},${from.y}` !== selected) continue;
      const to = cellOf(move.to);
      set.add(`${to.x},${to.y}`);
    }
    return set;
  }, [data, selected, isXq]);

  if (!data) return <div className="board-placeholder">等待对局…</div>;

  const myTurn = data.turn === data.myColor && status === 'playing' && !data.winner;

  const handleClick = (x: number, y: number): void => {
    if (!myTurn) return;
    const cell = `${x},${y}`;
    const piece = data.board.find((item) => {
      const pos = cellOf(item);
      return pos.x === x && pos.y === y;
    })?.piece;

    if (selected && targets.has(cell)) {
      const from = data.moves.find((move) => {
        const f = cellOf(move.from);
        const t = cellOf(move.to);
        return `${f.x},${f.y}` === selected && `${t.x},${t.y}` === cell;
      });
      if (from) {
        onAction('move', {
          from: isXq ? { c: from.from.c, r: from.from.r } : { f: from.from.f, r: from.from.r },
          to: isXq ? { c: from.to.c, r: from.to.r } : { f: from.to.f, r: from.to.r },
        });
      }
      setSelected(null);
      return;
    }

    if (piece && piece.color === data.myColor) {
      setSelected(cell);
      return;
    }
    setSelected(null);
  };

  const cells = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      cells.push({ x, y });
    }
  }

  const myPlayer = data.players.find((p) => p.playerId === myId);
  const otherPlayer = data.players.find((p) => p.playerId !== myId);

  return (
    <div className={`boardgame boardgame--${variant}`}>
      <div className="boardgame__bar">
        <span className="boardgame__turn">
          {data.winner
            ? `${data.winner === data.myColor ? '你赢了' : '对方赢了'}`
            : myTurn
              ? '轮到你走'
              : '等待对方走…'}
        </span>
        {data.inCheck && !data.winner && <span className="boardgame__check">将军！</span>}
        <span className="boardgame__seats">
          {otherPlayer && <em>{otherPlayer.nickname}（{otherPlayer.color === 'w' || otherPlayer.color === 'r' ? '先手' : '后手'}）</em>}
          {myPlayer && <em>我（{myPlayer.color === 'w' || myPlayer.color === 'r' ? '先手' : '后手'}）</em>}
        </span>
      </div>

      <div className="boardgame__board" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {cells.map(({ x, y }) => {
          const item = data.board.find((cell) => {
            const pos = cellOf(cell);
            return pos.x === x && pos.y === y;
          });
          const piece = item?.piece;
          const isTarget = targets.has(`${x},${y}`);
          const last =
            data.lastMove &&
            (() => {
              const f = cellOf(data.lastMove!.from);
              const t = cellOf(data.lastMove!.to);
              return (f.x === x && f.y === y) || (t.x === x && t.y === y);
            })();
          const dark = isXq
            ? (x + y) % 2 === 1
            : (x + y) % 2 === 1;
          return (
            <button
              key={`${x},${y}`}
              type="button"
              className={`boardgame__cell${dark ? ' is-dark' : ''}${isTarget ? ' is-target' : ''}${
                last ? ' is-last' : ''
              }${selected === `${x},${y}` ? ' is-selected' : ''}`}
              onClick={() => handleClick(x, y)}
            >
              {piece && (
                <span className={`boardgame__piece is-${piece.color}`}>
                  {glyph[piece.color]?.[piece.type] ?? piece.type}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {data.results.length > 0 && (
        <div className="reveal-list">
          {data.results.map((row) => (
            <div key={row.playerId} className="reveal-row">
              <span className="reveal-row__name">{row.nickname}</span>
              <span className="reveal-row__pt muted">{row.detail}</span>
              <span className={row.delta > 0 ? 'up' : row.delta < 0 ? 'down' : 'muted'}>
                {row.delta > 0 ? `+${row.delta}` : row.delta}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
