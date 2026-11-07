/**
 * 程序化生成扑克 / 筒子 / 骰子矢量素材。
 * 全部由代码绘制，无第三方素材，可自由商用。
 * 运行：node scripts/gen-cards.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'apps/lobby-web/public/assets/cards';
mkdirSync(OUT, { recursive: true });

const FONT = "Georgia,'Times New Roman',serif";

const SUIT_PATH = {
  S: 'M50 6C50 6 14 38 14 60c0 16 13 26 25 22 6-2 10-6 11-11 1 5 5 9 11 11 12 4 25-6 25-22C86 38 50 6 50 6Z M50 66c-3 10-7 20-9 30h18c-2-10-6-20-9-30Z',
  H: 'M50 94C50 94 8 66 8 39 8 21 21 10 34 10c8 0 14 5 16 13 2-8 8-13 16-13 13 0 26 11 26 29 0 27-42 55-42 55Z',
  D: 'M50 4l40 46-40 46L10 50Z',
  C: 'M50 6c-10 0-18 8-18 19 0 4 1 8 3 11-5-3-11-4-16-1C8 41 9 60 21 65c6 3 13 1 18-3-2 6-1 14 2 20h18c3-6 4-14 2-20 5 4 12 6 18 3 12-5 13-24 2-30-5-3-11-2-16 1 2-3 3-7 3-11 0-11-8-19-18-19Z M50 78c-3 7-5 13-6 18h12c-1-5-3-11-6-18Z',
};

const SUIT_COLOR = { S: '#151b2b', H: '#cf3140', D: '#cf3140', C: '#151b2b' };

const HEAD = (body, extra = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 134" width="96" height="134">${extra}${body}</svg>`;

function face(rankText, suit) {
  const color = SUIT_COLOR[suit];
  const sp = SUIT_PATH[suit];
  return HEAD(
    `
  <rect x="1.5" y="1.5" width="93" height="131" rx="7.5" fill="url(#paper)" stroke="#c2c8d8" stroke-width="1.4"/>
  <rect x="4.5" y="4.5" width="87" height="125" rx="5.5" fill="none" stroke="${color}" stroke-opacity="0.13"/>
  <text x="10" y="27" font-family="${FONT}" font-weight="700" font-size="20" fill="${color}">${rankText}</text>
  <path d="${sp}" transform="translate(10,31) scale(0.105)" fill="${color}"/>
  <path d="${sp}" transform="translate(25,44) scale(0.48)" fill="${color}" opacity="0.9"/>
  <g transform="rotate(180 48 67)">
    <text x="10" y="27" font-family="${FONT}" font-weight="700" font-size="20" fill="${color}">${rankText}</text>
    <path d="${sp}" transform="translate(10,31) scale(0.105)" fill="${color}"/>
  </g>`,
    `<defs>
    <linearGradient id="paper" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e7ecf6"/>
    </linearGradient>
  </defs>`,
  );
}

function court(rankText, suit) {
  const color = SUIT_COLOR[suit];
  const sp = SUIT_PATH[suit];
  return HEAD(
    `
  <rect x="1.5" y="1.5" width="93" height="131" rx="7.5" fill="url(#paper2)" stroke="#c2c8d8" stroke-width="1.4"/>
  <rect x="4.5" y="4.5" width="87" height="125" rx="5.5" fill="none" stroke="#c9a253" stroke-opacity="0.45"/>
  <text x="10" y="27" font-family="${FONT}" font-weight="700" font-size="20" fill="${color}">${rankText}</text>
  <path d="${sp}" transform="translate(10,31) scale(0.105)" fill="${color}"/>
  <circle cx="48" cy="67" r="26" fill="none" stroke="#c9a253" stroke-opacity="0.55" stroke-width="1.2"/>
  <circle cx="48" cy="67" r="21" fill="${color}" fill-opacity="0.06"/>
  <text x="48" y="79" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="34" fill="${color}">${rankText}</text>
  <path d="${sp}" transform="translate(35,100) scale(0.26)" fill="${color}" opacity="0.85"/>
  <g transform="rotate(180 48 67)">
    <text x="10" y="27" font-family="${FONT}" font-weight="700" font-size="20" fill="${color}">${rankText}</text>
    <path d="${sp}" transform="translate(10,31) scale(0.105)" fill="${color}"/>
  </g>`,
    `<defs>
    <linearGradient id="paper2" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stop-color="#fffdf7"/>
      <stop offset="1" stop-color="#ece6d6"/>
    </linearGradient>
  </defs>`,
  );
}

function joker(red) {
  const main = red ? '#cf3140' : '#1b2236';
  const accent = red ? '#e8b64c' : '#7b8fc0';
  return HEAD(
    `
  <rect x="1.5" y="1.5" width="93" height="131" rx="7.5" fill="url(#paper3)" stroke="#c2c8d8" stroke-width="1.4"/>
  <rect x="4.5" y="4.5" width="87" height="125" rx="5.5" fill="none" stroke="${accent}" stroke-opacity="0.6"/>
  <text x="12" y="26" font-family="${FONT}" font-weight="700" font-size="15" fill="${main}">J</text>
  <text x="12" y="41" font-family="${FONT}" font-weight="700" font-size="15" fill="${main}">O</text>
  <text x="12" y="56" font-family="${FONT}" font-weight="700" font-size="15" fill="${main}">K</text>
  <text x="12" y="71" font-family="${FONT}" font-weight="700" font-size="15" fill="${main}">E</text>
  <text x="12" y="86" font-family="${FONT}" font-weight="700" font-size="15" fill="${main}">R</text>
  <circle cx="52" cy="67" r="24" fill="${main}" fill-opacity="0.08" stroke="${accent}" stroke-opacity="0.7" stroke-width="1.3"/>
  <path d="${SUIT_PATH.H}" transform="translate(33,42) scale(0.22)" fill="${red ? '#cf3140' : '#8fa6d8'}" opacity="0.9"/>
  <path d="${SUIT_PATH.S}" transform="translate(33,66) scale(0.22)" fill="${red ? '#e8b64c' : '#1b2236'}" opacity="0.85"/>
  <text x="48" y="123" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="9" letter-spacing="1" fill="${accent}">${red ? 'BIG' : 'SMALL'}</text>`,
    `<defs>
    <linearGradient id="paper3" x1="0" y1="0" x2="0.25" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e9eef8"/>
    </linearGradient>
  </defs>`,
  );
}

function back() {
  return HEAD(
    `
  <rect x="1.5" y="1.5" width="93" height="131" rx="7.5" fill="url(#lattice)" stroke="#0b1220" stroke-width="1.6"/>
  <rect x="5" y="5" width="86" height="124" rx="5" fill="none" stroke="#d9a94a" stroke-opacity="0.42" stroke-width="1.1"/>
  <circle cx="48" cy="67" r="19" fill="#101a30" fill-opacity="0.85" stroke="#d9a94a" stroke-opacity="0.6" stroke-width="1.3"/>
  <path d="M48 55l9 12-9 12-9-12Z" fill="none" stroke="#e8c273" stroke-opacity="0.85" stroke-width="1.4"/>
  <circle cx="48" cy="67" r="2.6" fill="#e8c273" fill-opacity="0.9"/>`,
    `<defs>
    <pattern id="lattice" width="13" height="13" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="13" height="13" fill="#16213c"/>
      <path d="M0 6.5h13M6.5 0v13" stroke="#26375c" stroke-width="1.1"/>
      <circle cx="6.5" cy="6.5" r="1.5" fill="#3a5288"/>
    </pattern>
  </defs>`,
  );
}

/** 筒子牌：1-9 筒 */
const DOT_LAYOUT = {
  1: [[0, 0]],
  2: [
    [0, -1],
    [0, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
  7: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
    [0, 0],
  ],
  8: [
    [-1, -1],
    [1, -1],
    [-1, -0.34],
    [1, -0.34],
    [-1, 0.34],
    [1, 0.34],
    [-1, 1],
    [1, 1],
  ],
  9: [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [0, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ],
};

function dotTile(n) {
  const layout = DOT_LAYOUT[n] ?? [];
  const step = 25;
  const radius = n >= 7 ? 7 : 8.5;
  const dots = layout
    .map(
      ([cx, cy]) =>
        `<circle cx="${48 + cx * step}" cy="${67 + cy * step}" r="${radius}" fill="url(#dotG)"/>` +
        `<circle cx="${48 + cx * step}" cy="${67 + cy * step}" r="${radius * 0.62}" fill="none" stroke="#fff" stroke-opacity="0.28"/>`,
    )
    .join('');
  return HEAD(
    `
  <rect x="1.5" y="1.5" width="93" height="131" rx="7.5" fill="url(#bone)" stroke="#c9bda3" stroke-width="1.4"/>
  <rect x="5" y="5" width="86" height="124" rx="5" fill="none" stroke="#b23a2f" stroke-opacity="0.35"/>
  ${dots}
  <text x="48" y="124" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="9" fill="#a8927a">${n}</text>`,
    `<defs>
    <linearGradient id="bone" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#fffdf6"/>
      <stop offset="1" stop-color="#eee2c8"/>
    </linearGradient>
    <radialGradient id="dotG" cx="0.35" cy="0.3" r="0.8">
      <stop offset="0" stop-color="#4a5a78"/>
      <stop offset="1" stop-color="#101828"/>
    </radialGradient>
  </defs>`,
  );
}

/** 骰子：1-6 点 */
const DICE_LAYOUT = {
  1: [[0, 0]],
  2: [
    [-1, -1],
    [1, 1],
  ],
  3: [
    [-1, -1],
    [0, 0],
    [1, 1],
  ],
  4: [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ],
  5: [
    [-1, -1],
    [1, -1],
    [0, 0],
    [-1, 1],
    [1, 1],
  ],
  6: [
    [-1, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [1, 1],
  ],
};

function dice(n) {
  const dots = (DICE_LAYOUT[n] ?? [])
    .map(([cx, cy]) => `<circle cx="${32 + cx * 14}" cy="${32 + cy * 14}" r="5" fill="#151b2b"/>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="diceFace" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.55" stop-color="#f4f6fb"/>
      <stop offset="1" stop-color="#d9dfec"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="13" fill="url(#diceFace)" stroke="#b9c0d0" stroke-width="1.6"/>
  <rect x="6" y="6" width="52" height="52" rx="10" fill="none" stroke="#ffffff" stroke-opacity="0.9"/>
  ${dots}
</svg>`;
}

// ---- 生成 ----

/** 文件名直接用服务端的牌 id（如 S15），牌面文字按 rank 映射：15 表示 2 */
function rankText(rank) {
  if (rank === 15) return '2';
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  return String(rank);
}

let count = 0;

for (const suit of ['S', 'H', 'D', 'C']) {
  // 2..15 全覆盖：斗地主用 3-15（15 是 2），德州用 2-14
  for (let rank = 2; rank <= 15; rank += 1) {
    const label = rankText(rank);
    const isCourt = rank >= 11 && rank <= 13;
    const svg = isCourt ? court(label, suit) : face(label, suit);
    writeFileSync(`${OUT}/${suit}${rank}.svg`, svg, 'utf8');
    count += 1;
  }
}

writeFileSync(`${OUT}/JOKER_S.svg`, joker(false), 'utf8');
writeFileSync(`${OUT}/JOKER_B.svg`, joker(true), 'utf8');
writeFileSync(`${OUT}/back.svg`, back(), 'utf8');
count += 3;

for (let n = 1; n <= 9; n += 1) {
  writeFileSync(`${OUT}/dot${n}.svg`, dotTile(n), 'utf8');
  count += 1;
}

for (let n = 1; n <= 6; n += 1) {
  writeFileSync(`${OUT}/dice${n}.svg`, dice(n), 'utf8');
  count += 1;
}

console.log(`已生成 ${count} 张矢量素材 → ${OUT}`);
