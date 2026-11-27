import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
  isDraw?: boolean;
  drawOfferBy?: string | null;
  canUndo?: boolean;
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

interface MoveFxEvent {
  id: number;
  kind: 'move' | 'capture';
  from: { x: number; y: number };
  to: { x: number; y: number };
  mover: BoardPiece | null;
  captured: BoardPiece | null;
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

// 预计算落子与吃子火花粒子轨迹，确保每次爆发层次丰满
const MOVE_SPARKS = Array.from({ length: 8 }, (_, i) => {
  const angle = (i * Math.PI * 2) / 8 + Math.PI / 8;
  const dist = 34 + (i % 2) * 10;
  return {
    dx: Math.round(Math.cos(angle) * dist),
    dy: Math.round(Math.sin(angle) * dist),
    r: i % 2 === 0 ? 3.2 : 2.3,
    color: i % 2 === 0 ? '#ffe79e' : '#f5c04f',
  };
});

const CAPTURE_SPARKS = Array.from({ length: 14 }, (_, i) => {
  const angle = (i * Math.PI * 2) / 14 + (i % 3) * 0.11;
  const dist = 48 + (i % 3) * 17;
  const palette = ['#ff4d36', '#ffd666', '#ff8c2b', '#fff2bd'];
  return {
    dx: Math.round(Math.cos(angle) * dist),
    dy: Math.round(Math.sin(angle) * dist),
    r: i % 3 === 0 ? 4.6 : i % 3 === 1 ? 3.4 : 2.6,
    color: palette[i % palette.length]!,
  };
});

const RED_FILE_LABELS = ['九', '八', '七', '六', '五', '四', '三', '二', '一'];
const BLACK_FILE_LABELS = ['１', '２', '３', '４', '５', '６', '７', '８', '９'];

// ─── 典藏国风中国象棋 SVG 棋盘（棋子落在十字交叉点 + 落子/吃子华丽特效）──────
function XiangqiBoard({
  data,
  myTurn,
  selected,
  targets,
  cellOf,
  onClickCell,
}: {
  data: BoardSnapshot;
  myTurn: boolean;
  selected: string | null;
  targets: Set<string>;
  cellOf: (cell: { f?: number; c?: number; r: number }) => { x: number; y: number };
  onClickCell: (x: number, y: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  // 若执黑方，翻转棋盘使己方始终在下方，对弈视角更自然
  const flipped = data.myColor === 'b';

  // 9条竖线(8格) × 10条横线(9格)
  const COLS = 8;
  const ROWS = 9;
  const GAP = 64;
  const PAD_X = 54;
  const PAD_Y = 60;
  const W = COLS * GAP + PAD_X * 2; // 620
  const H = ROWS * GAP + PAD_Y * 2; // 696

  // 棋子半径（略小于半格，排布紧致大气且互不遮挡）
  const R = GAP * 0.455;

  // 逻辑坐标(col 0..8, row 0..9) -> 视图坐标
  const toView = (col: number, row: number) => ({
    vx: flipped ? 8 - col : col,
    vy: flipped ? 9 - row : row,
  });

  const px = (vx: number) => PAD_X + vx * GAP;
  const py = (vy: number) => PAD_Y + vy * GAP;

  const boardMap = useMemo(() => {
    const map = new Map<string, BoardPiece>();
    for (const item of data.board) {
      if (!item.piece) continue;
      const pos = cellOf(item);
      map.set(`${pos.x},${pos.y}`, item.piece);
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.board]);

  // 监听每一步落子与吃子变化（含己方与对手落子）
  const prevBoardRef = useRef<Map<string, BoardPiece> | null>(null);
  const prevMoveKeyRef = useRef<string | null>(null);
  const prevCheckKeyRef = useRef<string>('');
  const fxIdRef = useRef<number>(1);
  const fxTimerRef = useRef<number | null>(null);
  const shakeTimerRef = useRef<number | null>(null);
  const checkTimerRef = useRef<number | null>(null);
  const [fxEvent, setFxEvent] = useState<MoveFxEvent | null>(null);
  const [shaking, setShaking] = useState(false);
  const [checkBannerId, setCheckBannerId] = useState<number>(0);

  // 组件卸载时统一清理所有动效定时器
  useEffect(() => {
    return () => {
      if (fxTimerRef.current !== null) window.clearTimeout(fxTimerRef.current);
      if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current);
      if (checkTimerRef.current !== null) window.clearTimeout(checkTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const lm = data.lastMove;
    const moveKey = lm
      ? `${data.round}:${lm.from.c ?? lm.from.f},${lm.from.r}->${lm.to.c ?? lm.to.f},${lm.to.r}:${data.turn}`
      : `${data.round}:init`;

    if (prevBoardRef.current === null) {
      prevBoardRef.current = new Map(boardMap);
      prevMoveKeyRef.current = moveKey;
      return;
    }

    if (lm && moveKey !== prevMoveKeyRef.current) {
      const from = cellOf(lm.from);
      const to = cellOf(lm.to);
      const captured = prevBoardRef.current.get(`${to.x},${to.y}`) ?? null;
      const mover = boardMap.get(`${to.x},${to.y}`) ?? null;
      const isCapture = Boolean(captured && mover && captured.color !== mover.color);
      const nextId = fxIdRef.current++;

      if (fxTimerRef.current !== null) window.clearTimeout(fxTimerRef.current);
      if (shakeTimerRef.current !== null) window.clearTimeout(shakeTimerRef.current);

      setFxEvent({
        id: nextId,
        kind: isCapture ? 'capture' : 'move',
        from,
        to,
        mover,
        captured: isCapture ? captured : null,
      });

      if (isCapture) {
        audio.play('xiangqi_capture');
        setShaking(true);
        shakeTimerRef.current = window.setTimeout(() => {
          setShaking(false);
          shakeTimerRef.current = null;
        }, 340);
        fxTimerRef.current = window.setTimeout(() => {
          setFxEvent((curr) => (curr?.id === nextId ? null : curr));
          fxTimerRef.current = null;
        }, 960);
      } else {
        audio.play('xiangqi_move');
        setShaking(false);
        fxTimerRef.current = window.setTimeout(() => {
          setFxEvent((curr) => (curr?.id === nextId ? null : curr));
          fxTimerRef.current = null;
        }, 640);
      }
    }

    prevBoardRef.current = new Map(boardMap);
    prevMoveKeyRef.current = moveKey;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardMap, data.lastMove, data.round, data.turn]);

  // 将军横幅特效
  useEffect(() => {
    const key = `${data.round}:${data.turn}:${data.inCheck ? '1' : '0'}`;
    if (data.inCheck && !data.winner && prevCheckKeyRef.current !== key) {
      prevCheckKeyRef.current = key;
      const id = fxIdRef.current++;
      if (checkTimerRef.current !== null) window.clearTimeout(checkTimerRef.current);
      setCheckBannerId(id);
      checkTimerRef.current = window.setTimeout(() => {
        setCheckBannerId((curr) => (curr === id ? 0 : curr));
        checkTimerRef.current = null;
      }, 1380);
    } else if (!data.inCheck) {
      prevCheckKeyRef.current = key;
    }
  }, [data.inCheck, data.winner, data.round, data.turn]);

  const riverTop = py(4);
  const riverBot = py(5);
  const riverMid = (riverTop + riverBot) / 2;

  const hLines = Array.from({ length: 10 }, (_, i) => i);
  const vLines = Array.from({ length: 9 }, (_, i) => i);

  // 九宫斜线（上宫 & 下宫）
  const palaceLines = [
    { x1: px(3), y1: py(0), x2: px(5), y2: py(2) },
    { x1: px(5), y1: py(0), x2: px(3), y2: py(2) },
    { x1: px(3), y1: py(7), x2: px(5), y2: py(9) },
    { x1: px(5), y1: py(7), x2: px(3), y2: py(9) },
  ];

  // 炮位 / 兵位花星（视图坐标对称，翻转不变）
  const starPoints = [
    { col: 1, row: 2 }, { col: 7, row: 2 },
    { col: 1, row: 7 }, { col: 7, row: 7 },
    { col: 0, row: 3 }, { col: 2, row: 3 }, { col: 4, row: 3 }, { col: 6, row: 3 }, { col: 8, row: 3 },
    { col: 0, row: 6 }, { col: 2, row: 6 }, { col: 4, row: 6 }, { col: 6, row: 6 }, { col: 8, row: 6 },
  ];

  // 四角鎏金回纹装饰路径生成
  const renderCornerOrnament = (cx: number, cy: number, sx: number, sy: number, key: string) => (
    <g key={key} transform={`translate(${cx}, ${cy}) scale(${sx}, ${sy})`} fill="none" stroke="url(#xq-gold-stroke)" strokeWidth={1.6} strokeLinecap="square">
      <path d="M 0 26 L 0 0 L 26 0" strokeWidth={2.2} />
      <path d="M 5 20 L 5 5 L 20 5" opacity={0.85} />
      <path d="M 10 14 L 10 10 L 14 10" opacity={0.75} />
      <circle cx={14} cy={14} r={1.4} fill="#f4d484" stroke="none" />
    </g>
  );

  // 战术四角框（用于上步落点与可吃目标锁定）
  const renderBrackets = (cx: number, cy: number, half: number, arm: number, color: string, strokeWidth = 2.6) => (
    <g stroke={color} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M ${cx - half} ${cy - half + arm} L ${cx - half} ${cy - half} L ${cx - half + arm} ${cy - half}`} />
      <path d={`M ${cx + half - arm} ${cy - half} L ${cx + half} ${cy - half} L ${cx + half} ${cy - half + arm}`} />
      <path d={`M ${cx - half} ${cy + half - arm} L ${cx - half} ${cy + half} L ${cx - half + arm} ${cy + half}`} />
      <path d={`M ${cx + half - arm} ${cy + half} L ${cx + half} ${cy + half} L ${cx + half} ${cy + half - arm}`} />
    </g>
  );

  const lastFrom = data.lastMove ? cellOf(data.lastMove.from) : null;
  const lastTo = data.lastMove ? cellOf(data.lastMove.to) : null;

  const handleSvgClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scaleY = H / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    const vx = Math.round((mx - PAD_X) / GAP);
    const vy = Math.round((my - PAD_Y) / GAP);
    if (vx < 0 || vx > 8 || vy < 0 || vy > 9) return;

    const dx = mx - px(vx);
    const dy = my - py(vy);
    if (Math.hypot(dx, dy) > GAP * 0.54) return;

    const col = flipped ? 8 - vx : vx;
    const row = flipped ? 9 - vy : vy;
    onClickCell(col, row);
  };

  // 将所有棋子整理为渲染列表，让选中的和刚落下的棋子渲染在最上层
  const pieces = useMemo(() => {
    const list: Array<{ col: number; row: number; piece: BoardPiece; z: number }> = [];
    for (let row = 0; row < 10; row += 1) {
      for (let col = 0; col < 9; col += 1) {
        const piece = boardMap.get(`${col},${row}`);
        if (!piece) continue;
        const isSel = selected === `${col},${row}`;
        const isLanding = fxEvent !== null && fxEvent.to.x === col && fxEvent.to.y === row;
        list.push({
          col,
          row,
          piece,
          z: isLanding ? 3 : isSel ? 2 : 1,
        });
      }
    }
    list.sort((a, b) => a.z - b.z);
    return list;
  }, [boardMap, selected, fxEvent]);

  const topFileLabels = flipped ? RED_FILE_LABELS.slice().reverse() : BLACK_FILE_LABELS;
  const bottomFileLabels = flipped ? BLACK_FILE_LABELS.slice().reverse() : RED_FILE_LABELS;

  return (
    <div className="xq-stage-wrap">
      <div className={`xq-board-frame${shaking ? ' is-shaking' : ''}`}>
        <svg
          ref={svgRef}
          className="xq-board-svg"
          viewBox={`0 0 ${W} ${H}`}
          style={{ cursor: myTurn ? 'pointer' : 'default' }}
          onClick={handleSvgClick}
        >
          <defs>
            {/* 紫檀深木外框渐变 */}
            <linearGradient id="xq-frame-wood" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#5c2b14" />
              <stop offset="45%" stopColor="#3b190b" />
              <stop offset="100%" stopColor="#230d05" />
            </linearGradient>

            {/* 鎏金描边渐变 */}
            <linearGradient id="xq-gold-stroke" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#fae2a2" />
              <stop offset="50%" stopColor="#c79540" />
              <stop offset="100%" stopColor="#f5d380" />
            </linearGradient>

            {/* 黄花梨温润盘面渐变 */}
            <radialGradient id="xq-surface-glow" cx="50%" cy="46%" r="68%">
              <stop offset="0%" stopColor="#f7e3b2" />
              <stop offset="55%" stopColor="#e8c380" />
              <stop offset="100%" stopColor="#cf9b52" />
            </radialGradient>

            {/* 盘面内凹阴影渐变 */}
            <linearGradient id="xq-inner-bevel" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#261005" stopOpacity="0.34" />
              <stop offset="5%" stopColor="#261005" stopOpacity="0" />
              <stop offset="95%" stopColor="#261005" stopOpacity="0" />
              <stop offset="100%" stopColor="#261005" stopOpacity="0.28" />
            </linearGradient>

            {/* 细腻天然木纹叠加图案 */}
            <pattern id="xq-wood-grain" width="160" height="40" patternUnits="userSpaceOnUse">
              <path d="M0 6 Q40 3 80 6 T160 6" fill="none" stroke="#8c541f" strokeWidth="0.7" opacity="0.09" />
              <path d="M0 16 Q50 19 100 15 T160 16" fill="none" stroke="#6b3c12" strokeWidth="0.6" opacity="0.07" />
              <path d="M0 28 Q35 25 85 29 T160 27" fill="none" stroke="#996126" strokeWidth="0.8" opacity="0.08" />
              <path d="M0 36 Q60 39 120 35 T160 36" fill="none" stroke="#fff3d1" strokeWidth="0.5" opacity="0.12" />
            </pattern>

            {/* 楚河汉界水墨光泽 */}
            <linearGradient id="xq-river-tint" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#7a4c1d" stopOpacity="0.05" />
              <stop offset="50%" stopColor="#fff4d6" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#7a4c1d" stopOpacity="0.05" />
            </linearGradient>

            {/* 落子/吃子轨迹渐变 */}
            <linearGradient id="xq-trail-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ffe58f" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#ffd25a" stopOpacity="0.95" />
            </linearGradient>
            <linearGradient id="xq-trail-crimson" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#ff7a45" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#ff2e1f" stopOpacity="0.95" />
            </linearGradient>

            {/* 落子核心光晕 */}
            <radialGradient id="xq-flash-gold" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#fff9db" stopOpacity="0.95" />
              <stop offset="45%" stopColor="#f7c852" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#f7c852" stopOpacity="0" />
            </radialGradient>

            {/* 吃子烈焰核心光晕 */}
            <radialGradient id="xq-flash-crimson" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.98" />
              <stop offset="32%" stopColor="#ffcb47" stopOpacity="0.88" />
              <stop offset="68%" stopColor="#e82a1a" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#a80e06" stopOpacity="0" />
            </radialGradient>

            {/* 吃子朱砂印章背景 */}
            <radialGradient id="xq-seal-bg" cx="35%" cy="30%" r="75%">
              <stop offset="0%" stopColor="#e83525" />
              <stop offset="65%" stopColor="#b0140c" />
              <stop offset="100%" stopColor="#6e0703" />
            </radialGradient>

            {/* 棋子柔和立体投影 */}
            <filter id="xq-piece-shadow" x="-25%" y="-25%" width="150%" height="160%">
              <feDropShadow dx="0" dy="3.2" stdDeviation="2.8" floodColor="#1c0a03" floodOpacity="0.48" />
            </filter>

            {/* 选中棋子浮空深阴影 + 微金辉 */}
            <filter id="xq-piece-selected-shadow" x="-35%" y="-35%" width="170%" height="180%">
              <feDropShadow dx="0" dy="8" stdDeviation="5" floodColor="#120602" floodOpacity="0.62" />
              <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#ffd56b" floodOpacity="0.55" />
            </filter>

            {/* 光效柔光滤镜 */}
            <filter id="xq-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* 1. 紫檀红木外框 + 鎏金双细边 */}
          <rect x={0} y={0} width={W} height={H} rx={16} fill="url(#xq-frame-wood)" />
          <rect x={5} y={5} width={W - 10} height={H - 10} rx={12} fill="none" stroke="url(#xq-gold-stroke)" strokeWidth={1.6} opacity={0.78} />
          <rect x={10} y={10} width={W - 20} height={H - 20} rx={9} fill="none" stroke="#180802" strokeWidth={1.2} opacity={0.7} />

          {/* 四角传统回纹鎏金角饰 */}
          {renderCornerOrnament(14, 14, 1, 1, 'corner-tl')}
          {renderCornerOrnament(W - 14, 14, -1, 1, 'corner-tr')}
          {renderCornerOrnament(14, H - 14, 1, -1, 'corner-bl')}
          {renderCornerOrnament(W - 14, H - 14, -1, -1, 'corner-br')}

          {/* 2. 黄花梨盘面底板 + 天然木纹 + 内凹光影 */}
          <rect x={24} y={28} width={W - 48} height={H - 56} rx={6} fill="url(#xq-surface-glow)" stroke="#734018" strokeWidth={1.5} />
          <rect x={24} y={28} width={W - 48} height={H - 56} rx={6} fill="url(#xq-wood-grain)" />
          <rect x={24} y={28} width={W - 48} height={H - 56} rx={6} fill="url(#xq-inner-bevel)" />

          {/* 顶部/底部传统棋谱路数坐标 */}
          {topFileLabels.map((lbl, idx) => (
            <text
              key={`top-f-${idx}`}
              x={px(idx)}
              y={44}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={12}
              fontFamily="'Songti SC','STSong','SimSun',serif"
              fontWeight="700"
              fill="#6a3a16"
              opacity={0.78}
            >
              {lbl}
            </text>
          ))}
          {bottomFileLabels.map((lbl, idx) => (
            <text
              key={`bot-f-${idx}`}
              x={px(idx)}
              y={H - 44}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={12.5}
              fontFamily="'Songti SC','STSong','SimSun',serif"
              fontWeight="700"
              fill="#6a3a16"
              opacity={0.82}
            >
              {lbl}
            </text>
          ))}

          {/* 3. 棋盘外粗内细双框 */}
          <rect
            x={px(0) - 6.5}
            y={py(0) - 6.5}
            width={COLS * GAP + 13}
            height={ROWS * GAP + 13}
            fill="none"
            stroke="#42200a"
            strokeWidth={3.2}
          />
          <rect
            x={px(0) - 3.5}
            y={py(0) - 3.5}
            width={COLS * GAP + 7}
            height={ROWS * GAP + 7}
            fill="none"
            stroke="#b57d34"
            strokeWidth={0.7}
            opacity={0.65}
          />

          {/* 4. 楚河汉界水墨河道与云水暗纹 */}
          <rect x={px(0)} y={riverTop} width={COLS * GAP} height={GAP} fill="url(#xq-river-tint)" />
          <g fill="none" stroke="#85511f" strokeWidth={0.9} opacity={0.2}>
            <path d={`M ${px(0) + 18} ${riverMid - 12} q 18 -7 36 0 t 36 0 t 36 0`} />
            <path d={`M ${px(0) + 28} ${riverMid + 14} q 18 -7 36 0 t 36 0`} />
            <path d={`M ${px(8) - 162} ${riverMid - 14} q 18 -7 36 0 t 36 0 t 36 0`} />
            <path d={`M ${px(8) - 126} ${riverMid + 12} q 18 -7 36 0 t 36 0`} />
          </g>

          {/* 5. 全部 10 条完整横线（row 0..9，楚河两岸横线贯通） */}
          {hLines.map((row) => (
            <line
              key={`h-${row}`}
              x1={px(0)}
              y1={py(row)}
              x2={px(8)}
              y2={py(row)}
              stroke="#47230b"
              strokeWidth={row === 0 || row === 9 || row === 4 || row === 5 ? 1.8 : 1.35}
            />
          ))}

          {/* 6. 竖线（最外侧两条贯通，中间 7 条在楚河汉界处优雅断开） */}
          {vLines.map((col) =>
            col === 0 || col === 8 ? (
              <line
                key={`v-${col}`}
                x1={px(col)}
                y1={py(0)}
                x2={px(col)}
                y2={py(9)}
                stroke="#47230b"
                strokeWidth={1.8}
              />
            ) : (
              <g key={`v-${col}`}>
                <line x1={px(col)} y1={py(0)} x2={px(col)} y2={riverTop} stroke="#47230b" strokeWidth={1.35} />
                <line x1={px(col)} y1={riverBot} x2={px(col)} y2={py(9)} stroke="#47230b" strokeWidth={1.35} />
              </g>
            ),
          )}

          {/* 7. 九宫斜线与九宫中心菱形暗饰 */}
          {palaceLines.map((l, i) => (
            <line
              key={`palace-${i}`}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="#522a0f"
              strokeWidth={1.35}
              opacity={0.88}
            />
          ))}
          {[1, 8].map((centerRow) => (
            <polygon
              key={`palace-center-${centerRow}`}
              points={`${px(4)},${py(centerRow) - 6} ${px(4) + 6},${py(centerRow)} ${px(4)},${py(centerRow) + 6} ${px(4) - 6},${py(centerRow)}`}
              fill="none"
              stroke="#8c5420"
              strokeWidth={1}
              opacity={0.45}
            />
          ))}

          {/* 8. 楚河 · 漢界 书法刻字 + 迷你朱印 */}
          <g fontFamily="'STKaiti','KaiTi','FangSong','Songti SC','SimSun',serif" fontWeight="700" fontSize={30}>
            {/* 柔和阴刻浅金高光 */}
            <text x={px(2)} y={riverMid + 1.5} textAnchor="middle" dominantBaseline="central" fill="#fff5da" opacity={0.55} letterSpacing={14}>
              楚河
            </text>
            <text x={px(6)} y={riverMid + 1.5} textAnchor="middle" dominantBaseline="central" fill="#fff5da" opacity={0.55} letterSpacing={14}>
              漢界
            </text>
            {/* 深褐墨迹主字 */}
            <text x={px(2)} y={riverMid} textAnchor="middle" dominantBaseline="central" fill="#4f270c" opacity={0.88} letterSpacing={14}>
              楚河
            </text>
            <text x={px(6)} y={riverMid} textAnchor="middle" dominantBaseline="central" fill="#4f270c" opacity={0.88} letterSpacing={14}>
              漢界
            </text>
          </g>
          {/* 河道中央雅致菱形印饰 */}
          <g transform={`translate(${px(4)}, ${riverMid})`} opacity={0.52}>
            <polygon points="0,-10 10,0 0,10 -10,0" fill="none" stroke="#9b2718" strokeWidth={1.2} />
            <polygon points="0,-5 5,0 0,5 -5,0" fill="#9b2718" opacity={0.55} />
          </g>

          {/* 9. 炮位/兵位星位花纹（精细折角准星） */}
          {starPoints.map(({ col, row }) => {
            const cx = px(col);
            const cy = py(row);
            const inner = 5;
            const outer = 13.5;
            const left = col > 0;
            const right = col < 8;
            return (
              <g key={`star-${col}-${row}`} stroke="#4a240c" strokeWidth={1.45} fill="none" strokeLinecap="square">
                {left && (
                  <>
                    <path d={`M ${cx - outer} ${cy - inner} L ${cx - inner} ${cy - inner} L ${cx - inner} ${cy - outer}`} />
                    <path d={`M ${cx - outer} ${cy + inner} L ${cx - inner} ${cy + inner} L ${cx - inner} ${cy + outer}`} />
                  </>
                )}
                {right && (
                  <>
                    <path d={`M ${cx + outer} ${cy - inner} L ${cx + inner} ${cy - inner} L ${cx + inner} ${cy - outer}`} />
                    <path d={`M ${cx + outer} ${cy + inner} L ${cx + inner} ${cy + inner} L ${cx + inner} ${cy + outer}`} />
                  </>
                )}
              </g>
            );
          })}

          {/* 10. 上一步起止点标记（清晰醒目但不杂乱） */}
          {lastFrom && (() => {
            const v = toView(lastFrom.x, lastFrom.y);
            return (
              <g opacity={0.85}>
                <circle cx={px(v.vx)} cy={py(v.vy)} r={11} fill="rgba(246, 200, 86, 0.2)" stroke="#c7831a" strokeWidth={1.8} strokeDasharray="4 3" />
                <circle cx={px(v.vx)} cy={py(v.vy)} r={3.5} fill="#c7831a" />
              </g>
            );
          })()}

          {lastTo && (() => {
            const v = toView(lastTo.x, lastTo.y);
            return renderBrackets(px(v.vx), py(v.vy), R + 2, 10, '#f3b738', 2.4);
          })()}

          {/* 11. 落子 / 吃子 底层轨迹与冲击波特效 */}
          {fxEvent && (() => {
            const vf = toView(fxEvent.from.x, fxEvent.from.y);
            const vt = toView(fxEvent.to.x, fxEvent.to.y);
            const x1 = px(vf.vx);
            const y1 = py(vf.vy);
            const x2 = px(vt.vx);
            const y2 = py(vt.vy);
            const isCap = fxEvent.kind === 'capture';
            return (
              <g key={`fx-under-${fxEvent.id}`} style={{ pointerEvents: 'none' }}>
                {/* 轨迹光束 */}
                <line
                  className="xq-move-trail"
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={isCap ? 'url(#xq-trail-crimson)' : 'url(#xq-trail-gold)'}
                  strokeLinecap="round"
                  filter="url(#xq-glow)"
                />
                {/* 落点瞬间闪光 */}
                <circle
                  className="xq-impact-flash"
                  cx={x2}
                  cy={y2}
                  r={isCap ? R * 1.45 : R * 1.05}
                  fill={isCap ? 'url(#xq-flash-crimson)' : 'url(#xq-flash-gold)'}
                />
                {/* 扩散冲击波（双层） */}
                <circle
                  className="xq-ripple-ring"
                  cx={x2}
                  cy={y2}
                  r={R * 0.85}
                  fill="none"
                  stroke={isCap ? '#ff4d36' : '#f7d060'}
                  strokeWidth={isCap ? 4 : 2.6}
                  filter="url(#xq-glow)"
                />
                <circle
                  className="xq-ripple-ring xq-ripple-ring--delay"
                  cx={x2}
                  cy={y2}
                  r={R * 0.72}
                  fill="none"
                  stroke={isCap ? '#ffe07d' : '#a8f0c6'}
                  strokeWidth={isCap ? 2.6 : 1.8}
                />
              </g>
            );
          })()}

          {/* 12. 合法空位可走提示点 */}
          {Array.from(targets).map((key) => {
            const [cs, rs] = key.split(',');
            const col = Number(cs);
            const row = Number(rs);
            if (boardMap.has(key)) return null;
            const v = toView(col, row);
            const cx = px(v.vx);
            const cy = py(v.vy);
            return (
              <g key={`tgt-empty-${key}`} className="xq-target-dot" style={{ pointerEvents: 'none' }}>
                <circle cx={cx} cy={cy} r={11} fill="rgba(46, 184, 108, 0.25)" />
                <circle cx={cx} cy={cy} r={6.5} fill="#36d37e" stroke="#fff7d6" strokeWidth={1.8} />
              </g>
            );
          })}

          {/* 13. 被吃棋子的残影碎散动画（位于新落子下方略偏移） */}
          {fxEvent && fxEvent.kind === 'capture' && fxEvent.captured && (() => {
            const vt = toView(fxEvent.to.x, fxEvent.to.y);
            const cx = px(vt.vx);
            const cy = py(vt.vy);
            return (
              <g key={`fx-ghost-${fxEvent.id}`} className="xq-captured-ghost" style={{ pointerEvents: 'none' }}>
                <image
                  href={pieceArt('xiangqi', fxEvent.captured.color, fxEvent.captured.type)}
                  x={cx - R}
                  y={cy - R}
                  width={R * 2}
                  height={R * 2}
                />
              </g>
            );
          })()}

          {/* 14. 全部 3D 精雕实体棋子 */}
          {pieces.map(({ col, row, piece }) => {
            const key = `${col},${row}`;
            const v = toView(col, row);
            const cx = px(v.vx);
            const cy = py(v.vy);
            const isSelected = selected === key;
            const isCaptureTarget = targets.has(key);
            const isMovable = myTurn && piece.color === data.myColor;
            const isLanding = fxEvent !== null && fxEvent.to.x === col && fxEvent.to.y === row;

            let glideStyle: CSSProperties | undefined;
            if (isLanding && fxEvent) {
              const vf = toView(fxEvent.from.x, fxEvent.from.y);
              glideStyle = {
                '--xq-dx': `${px(vf.vx) - cx}px`,
                '--xq-dy': `${py(vf.vy) - cy}px`,
              } as CSSProperties;
            }

            const cls = [
              'xq-piece-group',
              isMovable ? 'is-movable' : '',
              isSelected ? 'is-selected' : '',
              isLanding ? (fxEvent?.kind === 'capture' ? 'is-capturing-land' : 'is-landing') : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <g
                key={isLanding && fxEvent ? `piece-${key}-fx-${fxEvent.id}` : `piece-${key}`}
                className={cls}
                style={glideStyle}
              >
                {/* 选中鎏金光环 + 旋转星轨 */}
                {isSelected && (
                  <g style={{ pointerEvents: 'none' }}>
                    <circle
                      className="xq-select-aura"
                      cx={cx}
                      cy={cy}
                      r={R + 5}
                      fill="rgba(255, 214, 92, 0.24)"
                      stroke="#ffe07a"
                      strokeWidth={2.2}
                    />
                    <circle
                      className="xq-select-orbit"
                      cx={cx}
                      cy={cy}
                      r={R + 8.5}
                      fill="none"
                      stroke="#ffd25a"
                      strokeWidth={1.6}
                      strokeDasharray="8 6"
                      opacity={0.9}
                    />
                  </g>
                )}

                {/* 棋子矢量精绘圆盘（无双层冗余外框，立体投影自然通透） */}
                <image
                  href={pieceArt('xiangqi', piece.color, piece.type)}
                  x={cx - R}
                  y={cy - R}
                  width={R * 2}
                  height={R * 2}
                  filter={isSelected ? 'url(#xq-piece-selected-shadow)' : 'url(#xq-piece-shadow)'}
                />

                {/* 可吃敌方棋子：脉冲赤金锁定准星 */}
                {isCaptureTarget && (
                  <g className="xq-capture-reticle" style={{ pointerEvents: 'none' }}>
                    <circle
                      cx={cx}
                      cy={cy}
                      r={R + 2.5}
                      fill="rgba(232, 42, 26, 0.14)"
                      stroke="#ff412c"
                      strokeWidth={2.4}
                    />
                    {renderBrackets(cx, cy, R + 6, 11, '#ffdd6b', 2.8)}
                  </g>
                )}
              </g>
            );
          })}

          {/* 15. 顶层落子火星 + 吃子剑气斩击 + 吃子朱砂「吃」印章 */}
          {fxEvent && (() => {
            const vt = toView(fxEvent.to.x, fxEvent.to.y);
            const cx = px(vt.vx);
            const cy = py(vt.vy);
            const isCap = fxEvent.kind === 'capture';
            const sparks = isCap ? CAPTURE_SPARKS : MOVE_SPARKS;
            const capturedChar = fxEvent.captured
              ? XQ_GLYPH[fxEvent.captured.color]?.[fxEvent.captured.type] ?? ''
              : '';
            // 防止吃子印章在最顶行被裁切
            const stampY = vt.vy <= 1 ? cy + R + 24 : cy - R - 18;

            return (
              <g key={`fx-over-${fxEvent.id}`} style={{ pointerEvents: 'none' }}>
                {/* 吃子交叉赤金剑气斩击 */}
                {isCap && (
                  <g filter="url(#xq-glow)">
                    <path
                      className="xq-slash-arc"
                      d={`M ${cx - 42} ${cy - 34} Q ${cx} ${cy - 8} ${cx + 44} ${cy + 36}`}
                      fill="none"
                      stroke="#fff0a6"
                      strokeWidth={4.5}
                      strokeLinecap="round"
                    />
                    <path
                      className="xq-slash-arc xq-slash-arc--second"
                      d={`M ${cx + 42} ${cy - 34} Q ${cx} ${cy - 8} ${cx - 44} ${cy + 36}`}
                      fill="none"
                      stroke="#ff4b33"
                      strokeWidth={4}
                      strokeLinecap="round"
                    />
                  </g>
                )}

                {/* 飞溅星尘 / 烈焰火星 */}
                {sparks.map((s, idx) => (
                  <circle
                    key={`sp-${idx}`}
                    className={`xq-spark${isCap ? ' xq-spark--capture' : ''}`}
                    cx={cx}
                    cy={cy}
                    r={s.r}
                    fill={s.color}
                    filter="url(#xq-glow)"
                    style={{ '--sx': `${s.dx}px`, '--sy': `${s.dy}px` } as CSSProperties}
                  />
                ))}

                {/* 吃子御制朱砂金边「吃」印章（外层定位，内层弹性动画，避免 CSS transform 覆盖坐标） */}
                {isCap && (
                  <g transform={`translate(${cx}, ${stampY})`}>
                    <g className="xq-capture-stamp">
                      <circle cx={0} cy={0} r={24} fill="url(#xq-seal-bg)" stroke="#ffe082" strokeWidth={2.5} filter="url(#xq-piece-shadow)" />
                      <circle cx={0} cy={0} r={19.5} fill="none" stroke="#ffd25a" strokeWidth={1} opacity={0.75} />
                      <text
                        x={0}
                        y={capturedChar ? -2 : 1}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontFamily="'STKaiti','KaiTi','Songti SC',serif"
                        fontWeight="900"
                        fontSize={22}
                        fill="#fff5cc"
                      >
                        吃
                      </text>
                      {capturedChar && (
                        <text
                          x={0}
                          y={13}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontFamily="'Songti SC','SimSun',serif"
                          fontWeight="700"
                          fontSize={9.5}
                          fill="#ffd670"
                        >
                          {capturedChar}
                        </text>
                      )}
                    </g>
                  </g>
                )}
              </g>
            );
          })()}
        </svg>

        {/* 将军霸气横幅特效 */}
        {checkBannerId > 0 && (
          <div key={`check-${checkBannerId}`} className="xq-check-banner">
            将 军
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 国际象棋棋盘（棋子落在格子中央）──────────────────────────────────────────
function ChessBoard({
  data,
  selected,
  targets,
  cellOf,
  onClickCell,
}: {
  data: BoardSnapshot;
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
  const [confirmResign, setConfirmResign] = useState(false);

  const isXq = variant === 'xiangqi';
  const rows = isXq ? 10 : 8;

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
        if (!isXq) audio.play('chip_clack');
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
            ? data.isDraw || data.winner === 'draw'
              ? '双方和棋'
              : `${data.winner === data.myColor ? '你赢了' : '对方赢了'}`
            : myTurn
              ? '轮到你走'
              : '等待对方走…'}
        </span>
        {data.inCheck && !data.winner && <span className="boardgame__check">⚠️ 将军！</span>}
        <span className="boardgame__seats">
          {otherPlayer && (
            <em>
              {otherPlayer.nickname}（{isXq ? (otherPlayer.color === 'r' ? '红方' : '黑方') : otherPlayer.color === 'w' ? '白方' : '黑方'}）
            </em>
          )}
          {myPlayer && (
            <em>
              我（{isXq ? (myPlayer.color === 'r' ? '红方' : '黑方') : myPlayer.color === 'w' ? '白方' : '黑方'}）
            </em>
          )}
        </span>
        {status === 'playing' && !data.winner && data.myColor && (
          <div className="board-actions-bar">
            {data.canUndo && (
              <button
                type="button"
                className="btn-board-act"
                onClick={() => {
                  audio.play('click');
                  setConfirmResign(false);
                  onAction('undo');
                }}
              >
                ↩️ 悔棋
              </button>
            )}
            <button
              type="button"
              className="btn-board-act"
              disabled={data.drawOfferBy === myId}
              onClick={() => {
                audio.play('click');
                setConfirmResign(false);
                onAction('draw_offer');
              }}
            >
              {data.drawOfferBy === myId ? '已提和…' : '🤝 求和'}
            </button>
            {confirmResign ? (
              <button
                type="button"
                className="btn-board-act is-danger-confirm"
                onClick={() => {
                  audio.play('alert');
                  setConfirmResign(false);
                  onAction('resign');
                }}
                onBlur={() => setConfirmResign(false)}
              >
                确认认输?
              </button>
            ) : (
              <button
                type="button"
                className="btn-board-act is-danger"
                onClick={() => {
                  audio.play('click');
                  setConfirmResign(true);
                }}
              >
                🏳️ 认输
              </button>
            )}
          </div>
        )}
      </div>

      {status === 'playing' && !data.winner && data.drawOfferBy && data.drawOfferBy !== myId && (
        <div className="board-draw-offer-banner">
          <span>🤝 对手请求和棋，是否同意？</span>
          <button
            type="button"
            className="btn-board-mini is-accept"
            onClick={() => {
              audio.play('click');
              onAction('draw_accept');
            }}
          >
            同意和棋
          </button>
          <button
            type="button"
            className="btn-board-mini is-decline"
            onClick={() => {
              audio.play('click');
              onAction('draw_decline');
            }}
          >
            拒绝
          </button>
        </div>
      )}

      {isXq ? (
        <XiangqiBoard
          data={data}
          myTurn={myTurn}
          selected={selected}
          targets={targets}
          cellOf={cellOf}
          onClickCell={handleClick}
        />
      ) : (
        <ChessBoard
          data={data}
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
