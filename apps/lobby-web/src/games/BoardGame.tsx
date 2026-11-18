import { useEffect, useMemo, useRef, useState } from 'react';
import { audio } from '../audio';

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
  w: { k: '白王', q: '白后', r: '白车', b: '白象', n: '白马', p: '白兵' },
  b: { k: '黑王', q: '黑后', r: '黑车', b: '黑象', n: '黑马', p: '黑兵' },
};

const XQ_GLYPH: Record<string, Record<string, string>> = {
  r: { k: '帅', a: '仕', b: '相', n: '马', r: '车', c: '炮', p: '兵' },
  b: { k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒' },
};

/** 棋子矢量素材，由 scripts/gen-pieces.mjs 生成 */
function pieceArt(variant: 'chess' | 'xiangqi', color: string, type: string): string {
  return `${import.meta.env.BASE_URL}assets/pieces/${variant}-${color}-${type}.svg`;
}

// ─── 象棋 SVG 棋盘（棋子落在十字交叉点上）────────────────────────────────────
function XiangqiBoard({
  data,
  myId,
  myTurn,
  selected,
  targets,
  cellOf,
  onClickCell,
}: {
  data: BoardSnapshot;
  myId: string;
  myTurn: boolean;
  selected: string | null;
  targets: Set<string>;
  cellOf: (cell: { f?: number; c?: number; r: number }) => { x: number; y: number };
  onClickCell: (x: number, y: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  // 棋盘格子数（线与线之间）
  const COLS = 8; // 9条竖线 → 8格
  const ROWS = 9; // 10条横线 → 9格

  // SVG 内部坐标：每格 60px，边距 36px
  const GAP = 60;
  const PAD = 36;
  const W = COLS * GAP + PAD * 2; // 480 + 72 = 552
  const H = ROWS * GAP + PAD * 2; // 540 + 72 = 612

  // 交叉点像素坐标（col=0..8, row=0..9，row=0 在上方 → 对应黑方）
  const px = (col: number) => PAD + col * GAP;
  const py = (row: number) => PAD + row * GAP;

  // 上下半场边界
  const riverTop = py(4);
  const riverBot = py(5);

  // 生成所有格线
  const hLines = Array.from({ length: 10 }, (_, i) => i);
  const vLines = Array.from({ length: 9 }, (_, i) => i);

  // 宫位斜线（上方：col 3-5, row 0-2）（下方：col 3-5, row 7-9）
  const palaceLines = [
    // 上宫
    { x1: px(3), y1: py(0), x2: px(5), y2: py(2) },
    { x1: px(5), y1: py(0), x2: px(3), y2: py(2) },
    // 下宫
    { x1: px(3), y1: py(7), x2: px(5), y2: py(9) },
    { x1: px(5), y1: py(7), x2: px(3), y2: py(9) },
  ];

  // 棋子半径
  const R = GAP * 0.42;

  // 获取棋子信息
  const pieceAt = (col: number, row: number): BoardPiece | null => {
    const item = data.board.find((cell) => {
      const pos = cellOf(cell);
      return pos.x === col && pos.y === row;
    });
    return item?.piece ?? null;
  };

  const isLast = (col: number, row: number): boolean => {
    if (!data.lastMove) return false;
    const f = cellOf(data.lastMove.from);
    const t = cellOf(data.lastMove.to);
    return (f.x === col && f.y === row) || (t.x === col && t.y === row);
  };

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    // 找最近的交叉点
    const col = Math.round((mx - PAD) / GAP);
    const row = Math.round((my - PAD) / GAP);
    if (col < 0 || col > 8 || row < 0 || row > 9) return;

    // 检查点击是否在交叉点附近（半径容差）
    const dx = mx - px(col);
    const dy = my - py(row);
    if (Math.sqrt(dx * dx + dy * dy) > GAP * 0.52) return;

    onClickCell(col, row);
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: '100%', cursor: myTurn ? 'pointer' : 'default', userSelect: 'none' }}
      onClick={handleSvgClick}
    >
      {/* 棋盘背景 */}
      <rect x={0} y={0} width={W} height={H} fill="#c8902e" rx={8} />
      <rect x={PAD - 4} y={PAD - 4} width={COLS * GAP + 8} height={ROWS * GAP + 8} fill="#b87333" rx={4} />

      {/* 横线（楚河汉界处断开） */}
      {hLines.map((row) =>
        row === 4 || row === 5 ? (
          // 楚河汉界行：只画两端短线
          <g key={`h${row}`}>
            <line x1={px(0)} y1={py(row)} x2={px(0)} y2={py(row)} stroke="#5a2d0c" strokeWidth={1} />
            <line x1={px(0)} y1={py(row)} x2={px(0) + GAP * 0.6} y2={py(row)} stroke="#5a2d0c" strokeWidth={1} />
            <line x1={px(8) - GAP * 0.6} y1={py(row)} x2={px(8)} y2={py(row)} stroke="#5a2d0c" strokeWidth={1} />
          </g>
        ) : (
          <line key={`h${row}`} x1={px(0)} y1={py(row)} x2={px(8)} y2={py(row)} stroke="#5a2d0c" strokeWidth={1} />
        ),
      )}

      {/* 竖线（楚河汉界内侧，两端线贯通，中间6根只画半格）*/}
      {vLines.map((col) =>
        col === 0 || col === 8 ? (
          // 最外两条竖线贯通
          <line key={`v${col}`} x1={px(col)} y1={py(0)} x2={px(col)} y2={py(9)} stroke="#5a2d0c" strokeWidth={1} />
        ) : (
          // 内部竖线在楚河处断开（只画上下半场，不穿越楚河）
          <g key={`v${col}`}>
            <line x1={px(col)} y1={py(0)} x2={px(col)} y2={riverTop} stroke="#5a2d0c" strokeWidth={1} />
            <line x1={px(col)} y1={riverBot} x2={px(col)} y2={py(9)} stroke="#5a2d0c" strokeWidth={1} />
          </g>
        ),
      )}

      {/* 宫位斜线 */}
      {palaceLines.map((l, i) => (
        <line key={`palace${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#5a2d0c" strokeWidth={1} />
      ))}

      {/* 楚河汉界文字 */}
      <text
        x={W / 2 - GAP}
        y={(riverTop + riverBot) / 2 + 7}
        textAnchor="middle"
        fontSize={22}
        fill="#5a2d0c"
        fontWeight="bold"
        fontFamily="serif"
        letterSpacing={8}
      >
        楚河
      </text>
      <text
        x={W / 2 + GAP}
        y={(riverTop + riverBot) / 2 + 7}
        textAnchor="middle"
        fontSize={22}
        fill="#5a2d0c"
        fontWeight="bold"
        fontFamily="serif"
        letterSpacing={8}
      >
        汉界
      </text>

      {/* 炮/兵位标记（小十字） */}
      {[
        // 炮位（上方: row=2, col=1,7）（下方: row=7, col=1,7）
        { col: 1, row: 2 }, { col: 7, row: 2 },
        { col: 1, row: 7 }, { col: 7, row: 7 },
        // 兵位（上方: row=3, col=0,2,4,6,8）（下方: row=6, col=0,2,4,6,8）
        { col: 0, row: 3 }, { col: 2, row: 3 }, { col: 4, row: 3 }, { col: 6, row: 3 }, { col: 8, row: 3 },
        { col: 0, row: 6 }, { col: 2, row: 6 }, { col: 4, row: 6 }, { col: 6, row: 6 }, { col: 8, row: 6 },
      ].map(({ col, row }) => {
        const cx = px(col);
        const cy = py(row);
        const d = 6; // 标记尺寸
        const inner = 3;
        // 只在棋盘内侧方向画角标
        const left = col > 0;
        const right = col < 8;
        const up = row > 0;
        const down = row < 9;
        return (
          <g key={`mark-${col}-${row}`} stroke="#5a2d0c" strokeWidth={1} fill="none">
            {left && up && <><line x1={cx - inner} y1={cy - d} x2={cx - inner} y2={cy - inner} /><line x1={cx - d} y1={cy - inner} x2={cx - inner} y2={cy - inner} /></>}
            {right && up && <><line x1={cx + inner} y1={cy - d} x2={cx + inner} y2={cy - inner} /><line x1={cx + d} y1={cy - inner} x2={cx + inner} y2={cy - inner} /></>}
            {left && down && <><line x1={cx - inner} y1={cy + d} x2={cx - inner} y2={cy + inner} /><line x1={cx - d} y1={cy + inner} x2={cx - inner} y2={cy + inner} /></>}
            {right && down && <><line x1={cx + inner} y1={cy + d} x2={cx + inner} y2={cy + inner} /><line x1={cx + d} y1={cy + inner} x2={cx + inner} y2={cy + inner} /></>}
          </g>
        );
      })}

      {/* 上次落子高亮 */}
      {Array.from({ length: 9 }, (_, col) =>
        Array.from({ length: 10 }, (_, row) => {
          if (!isLast(col, row)) return null;
          return (
            <circle
              key={`last-${col}-${row}`}
              cx={px(col)}
              cy={py(row)}
              r={R + 3}
              fill="rgba(255,220,0,0.35)"
              stroke="rgba(255,180,0,0.6)"
              strokeWidth={2}
            />
          );
        }),
      )}

      {/* 可移动目标高亮 */}
      {Array.from({ length: 9 }, (_, col) =>
        Array.from({ length: 10 }, (_, row) => {
          if (!targets.has(`${col},${row}`)) return null;
          const hasPiece = !!pieceAt(col, row);
          return hasPiece ? (
            // 目标位有子 → 红色提示圆圈
            <circle
              key={`tgt-${col}-${row}`}
              cx={px(col)}
              cy={py(row)}
              r={R + 4}
              fill="none"
              stroke="rgba(255,60,60,0.85)"
              strokeWidth={3}
            />
          ) : (
            // 空位 → 绿色小圆点
            <circle
              key={`tgt-${col}-${row}`}
              cx={px(col)}
              cy={py(row)}
              r={8}
              fill="rgba(80,220,80,0.75)"
            />
          );
        }),
      )}

      {/* 棋子 */}
      {Array.from({ length: 9 }, (_, col) =>
        Array.from({ length: 10 }, (_, row) => {
          const piece = pieceAt(col, row);
          if (!piece) return null;
          const cx = px(col);
          const cy = py(row);
          const isSelected = selected === `${col},${row}`;
          const isRed = piece.color === 'r';
          return (
            <g key={`piece-${col}-${row}`}>
              {/* 选中光晕 */}
              {isSelected && (
                <circle cx={cx} cy={cy} r={R + 5} fill="rgba(255,215,0,0.5)" stroke="gold" strokeWidth={2} />
              )}
              {/* 棋子底盘 */}
              <circle
                cx={cx}
                cy={cy}
                r={R}
                fill={isRed ? '#fdf0e0' : '#1a1a1a'}
                stroke={isRed ? '#c0392b' : '#888'}
                strokeWidth={2.5}
              />
              {/* 内圆装饰 */}
              <circle
                cx={cx}
                cy={cy}
                r={R * 0.82}
                fill="none"
                stroke={isRed ? '#c0392b' : '#aaa'}
                strokeWidth={1.2}
              />
              {/* 棋子图片（SVG assets）*/}
              <image
                href={pieceArt('xiangqi', piece.color, piece.type)}
                x={cx - R * 0.72}
                y={cy - R * 0.72}
                width={R * 1.44}
                height={R * 1.44}
              />
            </g>
          );
        }),
      )}
    </svg>
  );
}

// ─── 国际象棋棋盘（棋子落在格子中央）──────────────────────────────────────────
function ChessBoard({
  data,
  myId,
  myTurn,
  selected,
  targets,
  cellOf,
  onClickCell,
}: {
  data: BoardSnapshot;
  myId: string;
  myTurn: boolean;
  selected: string | null;
  targets: Set<string>;
  cellOf: (cell: { f?: number; c?: number; r: number }) => { x: number; y: number };
  onClickCell: (x: number, y: number) => void;
}) {
  const cols = 8;
  const rows = 8;
  const cells = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      cells.push({ x, y });
    }
  }

  return (
    <div
      className="boardgame__board"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        aspectRatio: `${cols} / ${rows}`,
        height: 'calc(100dvh - 84px)',
        width: 'auto',
        maxWidth: '100%',
        margin: '0 auto',
      }}
    >
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
        const dark = (x + y) % 2 === 1;
        return (
          <button
            key={`${x},${y}`}
            type="button"
            className={`boardgame__cell${dark ? ' is-dark' : ''}${isTarget ? ' is-target' : ''}${
              last ? ' is-last' : ''
            }${selected === `${x},${y}` ? ' is-selected' : ''}`}
            onClick={() => onClickCell(x, y)}
          >
            {piece && (
              <span className={`boardgame__piece is-${piece.color}`}>
                <img
                  src={pieceArt('chess', piece.color, piece.type)}
                  alt={CHESS_GLYPH[piece.color]?.[piece.type] ?? piece.type}
                  draggable={false}
                />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────────────────
export function BoardGame({ snapshot, myId, status, variant, onAction }: Props) {
  const data = snapshot as unknown as BoardSnapshot | undefined;
  const [selected, setSelected] = useState<string | null>(null);

  const isXq = variant === 'xiangqi';
  const rows = isXq ? 10 : 8;
  const glyph = isXq ? XQ_GLYPH : CHESS_GLYPH;

  // 将军震撼音效
  useEffect(() => {
    if (data?.inCheck && !data?.winner) {
      audio.play('alert');
    }
  }, [data?.inCheck, data?.winner]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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
        audio.play('chip_clack');
        onAction('move', {
          from: isXq ? { c: from.from.c, r: from.from.r } : { f: from.from.f, r: from.from.r },
          to: isXq ? { c: from.to.c, r: from.to.r } : { f: from.to.f, r: from.to.r },
        });
      }
      setSelected(null);
      return;
    }

    if (piece && piece.color === data.myColor) {
      audio.play('click');
      setSelected(cell);
      return;
    }
    setSelected(null);
  };

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
        {data.inCheck && !data.winner && <span className="boardgame__check">⚠️ 将军！</span>}
        <span className="boardgame__seats">
          {otherPlayer && <em>{otherPlayer.nickname}（{otherPlayer.color === 'w' || otherPlayer.color === 'r' ? '先手' : '后手'}）</em>}
          {myPlayer && <em>我（{myPlayer.color === 'w' || myPlayer.color === 'r' ? '先手' : '后手'}）</em>}
        </span>
      </div>

      {isXq ? (
        // 象棋：SVG棋盘，棋子落在十字交叉点上
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            height: 'calc(100dvh - 84px)',
          }}
        >
          <div style={{ width: 'min(90vw, calc((100dvh - 84px) * 552 / 612))', aspectRatio: '552/612' }}>
            <XiangqiBoard
              data={data}
              myId={myId}
              myTurn={myTurn}
              selected={selected}
              targets={targets}
              cellOf={cellOf}
              onClickCell={handleClick}
            />
          </div>
        </div>
      ) : (
        // 国际象棋：传统CSS格子棋盘
        <ChessBoard
          data={data}
          myId={myId}
          myTurn={myTurn}
          selected={selected}
          targets={targets}
          cellOf={cellOf}
          onClickCell={handleClick}
        />
      )}

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
