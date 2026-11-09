/**
 * 程序化生成棋类棋子矢量素材。
 * - 中国象棋：木质圆盘 + 双环 + 汉字
 * - 国际象棋：Staunton 风格几何剪影
 * 运行：node scripts/gen-pieces.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'apps/lobby-web/public/assets/pieces';
mkdirSync(OUT, { recursive: true });

const XQ_FACE = { r: '#b3271e', b: '#221c14' };
const XQ_GLYPH = {
  r: { k: '帅', a: '仕', b: '相', n: '马', r: '车', c: '炮', p: '兵' },
  b: { k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒' },
};

/** 中国象棋棋子：木盘 + 双环 + 汉字 */
function xiangqiPiece(color, type) {
  const glyph = XQ_GLYPH[color][type];
  const ink = XQ_FACE[color];
  const board = color === 'r' ? '#f3e0bd' : '#f0dcb6';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <radialGradient id="disc" cx="0.34" cy="0.26" r="0.85">
      <stop offset="0" stop-color="#fffaf0"/>
      <stop offset="0.55" stop-color="${board}"/>
      <stop offset="1" stop-color="#c9a877"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8a6134"/>
      <stop offset="1" stop-color="#5d3f1e"/>
    </linearGradient>
  </defs>
  <circle cx="50" cy="52" r="46" fill="#000000" fill-opacity="0.28"/>
  <circle cx="50" cy="48" r="46" fill="url(#rim)"/>
  <circle cx="50" cy="48" r="42" fill="url(#disc)"/>
  <circle cx="50" cy="48" r="37" fill="none" stroke="${ink}" stroke-width="2.4" stroke-opacity="0.8"/>
  <circle cx="50" cy="48" r="33.5" fill="none" stroke="${ink}" stroke-width="1" stroke-opacity="0.35"/>
  <text x="50" y="48" text-anchor="middle" dominant-baseline="central"
        font-family="'Songti SC','STSong','SimSun',serif" font-weight="700"
        font-size="42" fill="${ink}">${glyph}</text>
  <ellipse cx="36" cy="26" rx="16" ry="9" fill="#ffffff" fill-opacity="0.22" transform="rotate(-24 36 26)"/>
</svg>`;
}

/** 国际象棋棋子：几何剪影，fill 为主色，stroke 为轮廓色 */
function chessPiece(color, type) {
  const isWhite = color === 'w';
  const fill = isWhite ? '#f6f1e4' : '#242a33';
  const line = isWhite ? '#8c7c5f' : '#05070a';
  const base = `<rect x="24" y="74" width="52" height="10" rx="4"/>`;

  const shapes = {
    p: `<circle cx="50" cy="30" r="13"/>
        <path d="M39 43c0 6 5 9 5 15 0 6-6 10-6 16h24c0-6-6-10-6-16 0-6 5-9 5-15z"/>`,
    r: `<path d="M28 22h9v9h9v-9h8v9h9v-9h9v20l-8 8v16H36V50l-8-8z"/>`,
    b: `<circle cx="50" cy="17" r="6.5"/>
        <path d="M50 25c-11 9-17 17-17 25 0 6 6 10 17 10s17-4 17-10c0-8-6-16-17-25z"/>
        <rect x="34" y="62" width="32" height="8" rx="4"/>`,
    n: `<path d="M62 20c2 0 3 2 2 4l-5 10c8 3 13 10 13 20v16H34c0-12 3-21 9-28 5-6 9-9 14-11l3-9c0-1 1-2 2-2z"/>`,
    q: `<circle cx="27" cy="25" r="5"/><circle cx="38" cy="18" r="5"/>
        <circle cx="50" cy="14" r="6"/><circle cx="62" cy="18" r="5"/><circle cx="73" cy="25" r="5"/>
        <path d="M27 32h46l-6 30H33z"/>
        <rect x="26" y="64" width="48" height="8" rx="4"/>`,
    k: `<path d="M45 8h10v8h8v9h-8v8H45v-8h-8v-9h8z"/>
        <path d="M33 40h34l-4 24H37z"/>
        <rect x="28" y="64" width="44" height="8" rx="4"/>`,
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <g fill="${fill}" stroke="${line}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">
    ${shapes[type]}
    ${base}
  </g>
  <path d="M50 20c-6 0-10 4-10 9 0 3 1 5 3 7" fill="none" stroke="#ffffff" stroke-opacity="${
    isWhite ? '0.55' : '0.18'
  }" stroke-width="3" stroke-linecap="round"/>
</svg>`;
}

let count = 0;
for (const color of ['r', 'b']) {
  for (const type of Object.keys(XQ_GLYPH[color])) {
    writeFileSync(`${OUT}/xiangqi-${color}-${type}.svg`, xiangqiPiece(color, type), 'utf8');
    count += 1;
  }
}
for (const color of ['w', 'b']) {
  for (const type of ['k', 'q', 'r', 'b', 'n', 'p']) {
    writeFileSync(`${OUT}/chess-${color}-${type}.svg`, chessPiece(color, type), 'utf8');
    count += 1;
  }
}

console.log(`已生成 ${count} 枚棋子 → ${OUT}`);
