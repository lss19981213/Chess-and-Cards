import type { MouseEvent } from 'react';
import type { SnapshotEnvelope } from '../App';

interface GomokuSnapshot {
  size: number;
  cells: number[];
  turn: number;
  winner: number;
  lastMove: { x: number; y: number; side: number } | null;
  moveCount: number;
  mySide: number;
}

const CELL = 40;
const PAD = 30;
const STARS: Array<[number, number]> = [
  [3, 3],
  [11, 3],
  [3, 11],
  [11, 11],
  [7, 7],
];

interface Props {
  snapshot: SnapshotEnvelope | null;
  status: string;
  onPlace: (x: number, y: number) => void;
}

export function Gomoku({ snapshot, status, onPlace }: Props) {
  const data = snapshot?.snapshot as GomokuSnapshot | undefined;
  if (!data || !Array.isArray(data.cells)) {
    return <div className="board-placeholder">等待开局…</div>;
  }

  const n = data.size ?? 15;
  const total = PAD * 2 + CELL * (n - 1);
  const interactive = status === 'playing' && data.winner === 0 && data.mySide !== 0 && data.turn === data.mySide;

  const handleClick = (event: MouseEvent<SVGSVGElement>): void => {
    if (!interactive) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scale = total / rect.width;
    const x = Math.round(((event.clientX - rect.left) * scale - PAD) / CELL);
    const y = Math.round(((event.clientY - rect.top) * scale - PAD) / CELL);
    if (x < 0 || y < 0 || x >= n || y >= n) return;
    onPlace(x, y);
  };

  const statusText =
    data.winner === 0
      ? data.mySide === 0
        ? '观战中'
        : data.turn === data.mySide
          ? '轮到你落子'
          : '等待对手落子'
      : data.winner === 3
        ? '平局'
        : `${data.winner === 1 ? '黑方' : '白方'}获胜`;

  return (
    <div className="gomoku">
      <div className="gomoku__status">{statusText}</div>

      <svg
        viewBox={`0 0 ${total} ${total}`}
        className={`board ${interactive ? 'board--active' : ''}`}
        onClick={handleClick}
        role="presentation"
      >
        <rect width={total} height={total} fill="#d8a76a" rx="6" />
        <g stroke="#8a6234" strokeWidth="1">
          {Array.from({ length: n }, (_, i) => (
            <g key={i}>
              <line x1={PAD} y1={PAD + i * CELL} x2={total - PAD} y2={PAD + i * CELL} />
              <line x1={PAD + i * CELL} y1={PAD} x2={PAD + i * CELL} y2={total - PAD} />
            </g>
          ))}
        </g>
        <g fill="#8a6234">
          {STARS.map(([sx, sy]) => (
            <circle key={`${sx}-${sy}`} cx={PAD + sx * CELL} cy={PAD + sy * CELL} r="3.5" />
          ))}
        </g>
        <g>
          {data.cells.map((value, index) => {
            if (!value) return null;
            const x = index % n;
            const y = Math.floor(index / n);
            return (
              <circle
                key={index}
                cx={PAD + x * CELL}
                cy={PAD + y * CELL}
                r={CELL * 0.42}
                className={value === 1 ? 'stone stone--black' : 'stone stone--white'}
              />
            );
          })}
        </g>
        {data.lastMove && (
          <circle
            cx={PAD + data.lastMove.x * CELL}
            cy={PAD + data.lastMove.y * CELL}
            r="4"
            fill="#e5484d"
          />
        )}
      </svg>

      <div className="gomoku__legend">
        <span>你执{data.mySide === 1 ? '黑' : data.mySide === 2 ? '白' : '—'}</span>
        <span>第 {data.moveCount} 手</span>
      </div>
    </div>
  );
}
