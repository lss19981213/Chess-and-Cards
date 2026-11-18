import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT_DIR = join(process.cwd(), 'apps', 'lobby-web', 'public', 'assets', 'cards');

const SUITS = [
  {
    code: 'S',
    name: 'Spade',
    isRed: false,
    c1: '#1e293b',
    c2: '#090d16',
    accent: '#94a3b8',
    courtBg: '#f1f5f9',
    courtAccent: '#1e293b',
    path: 'M 0 -20 C -8 -10, -20 1, -20 10 C -20 17, -12 21, -5 16 C -2.5 14.5, -1 12.5, 0 10.5 C 1 12.5, 2.5 14.5, 5 16 C 12 21, 20 17, 20 10 C 20 1, 8 -10, 0 -20 Z M -3 13 C -2 18, -6 23, -9.5 25 L 9.5 25 C 6 23, 2 18, 3 13 Z',
  },
  {
    code: 'H',
    name: 'Heart',
    isRed: true,
    c1: '#ef233c',
    c2: '#990f1d',
    accent: '#fca5a5',
    courtBg: '#fff1f2',
    courtAccent: '#be123c',
    path: 'M 0 -8 C -4 -18, -21 -20, -21 -6 C -21 6, -9 15, 0 23 C 9 15, 21 6, 21 -6 C 21 -20, 4 -18, 0 -8 Z',
  },
  {
    code: 'D',
    name: 'Diamond',
    isRed: true,
    c1: '#f43f5e',
    c2: '#a81020',
    accent: '#fda4af',
    courtBg: '#fff1f2',
    courtAccent: '#be123c',
    path: 'M 0 -22 C 6 -12, 12 -5, 19 0 C 12 5, 6 12, 0 22 C -6 12, -12 5, -19 0 C -12 -5, -6 -12, 0 -22 Z',
  },
  {
    code: 'C',
    name: 'Club',
    isRed: false,
    c1: '#1e293b',
    c2: '#090d16',
    accent: '#94a3b8',
    courtBg: '#f1f5f9',
    courtAccent: '#1e293b',
    path: 'M 0 -20 C -7 -20, -11 -14, -10 -8 C -15 -9, -20 -4, -20 3 C -20 10, -14 14, -8 13 C -5 12.5, -2.5 11, -1.5 9.5 C -2 15, -5.5 22, -9 24.5 L 9 24.5 C 5.5 22, 2 15, 1.5 9.5 C 2.5 11, 5 12.5, 8 13 C 14 14, 20 10, 20 3 C 20 -4, 15 -9, 10 -8 C 11 -14, 7 -20, 0 -20 Z',
  },
];

// Standard casino pip coordinates inside 160x224 card (center box x: 46..114, y: 42..182)
const PIP_LAYOUTS = {
  2: [
    [80, 56, false],
    [80, 168, true],
  ],
  3: [
    [80, 52, false],
    [80, 112, false],
    [80, 172, true],
  ],
  4: [
    [56, 56, false],
    [104, 56, false],
    [56, 168, true],
    [104, 168, true],
  ],
  5: [
    [56, 56, false],
    [104, 56, false],
    [80, 112, false],
    [56, 168, true],
    [104, 168, true],
  ],
  6: [
    [56, 54, false],
    [104, 54, false],
    [56, 112, false],
    [104, 112, false],
    [56, 170, true],
    [104, 170, true],
  ],
  7: [
    [56, 52, false],
    [104, 52, false],
    [80, 82, false],
    [56, 112, false],
    [104, 112, false],
    [56, 172, true],
    [104, 172, true],
  ],
  8: [
    [56, 52, false],
    [104, 52, false],
    [80, 82, false],
    [56, 112, false],
    [104, 112, false],
    [80, 142, true],
    [56, 172, true],
    [104, 172, true],
  ],
  9: [
    [56, 50, false],
    [104, 50, false],
    [56, 90, false],
    [104, 90, false],
    [80, 112, false],
    [56, 134, true],
    [104, 134, true],
    [56, 174, true],
    [104, 174, true],
  ],
  10: [
    [56, 48, false],
    [104, 48, false],
    [80, 72, false],
    [56, 92, false],
    [104, 92, false],
    [56, 132, true],
    [104, 132, true],
    [80, 152, true],
    [56, 176, true],
    [104, 176, true],
  ],
};

function rankText(rank) {
  if (rank === 15) return '2';
  if (rank === 14) return 'A';
  if (rank === 13) return 'K';
  if (rank === 12) return 'Q';
  if (rank === 11) return 'J';
  return String(rank);
}

function buildCorner(label, suit) {
  const isTen = label === '10';
  const fontSize = isTen ? 31 : 37;
  const letterSpacing = isTen ? '-2.2' : '0';
  return `
    <text x="0" y="0" font-family="'Georgia', 'Times New Roman', 'Segoe UI', serif" font-size="${fontSize}" font-weight="900" letter-spacing="${letterSpacing}" text-anchor="middle" fill="url(#suitGrad)">${label}</text>
    <path d="${suit.path}" fill="url(#suitGrad)" transform="translate(0, 21) scale(0.56)" />
  `;
}

function buildAceCenter(suit) {
  const isSpade = suit.code === 'S';
  return `
    <g transform="translate(80, 112)">
      <circle cx="0" cy="0" r="46" fill="url(#aceHalo)" opacity="0.65"/>
      <circle cx="0" cy="0" r="44" fill="none" stroke="url(#goldGrad)" stroke-width="1.8" opacity="0.85"/>
      <circle cx="0" cy="0" r="38" fill="none" stroke="${suit.c1}" stroke-width="1" stroke-dasharray="3 3" opacity="0.45"/>
      ${
        isSpade
          ? `<g opacity="0.35" stroke="url(#goldGrad)" stroke-width="1.2">
               <line x1="0" y1="-44" x2="0" y2="-36"/>
               <line x1="0" y1="36" x2="0" y2="44"/>
               <line x1="-44" y1="0" x2="-36" y2="0"/>
               <line x1="36" y1="0" x2="44" y2="0"/>
             </g>`
          : ''
      }
      <path d="${suit.path}" fill="rgba(0,0,0,0.14)" transform="translate(2, 4) scale(1.95)" />
      <path d="${suit.path}" fill="url(#suitGrad)" stroke="url(#goldGrad)" stroke-width="${isSpade ? '1.1' : '0.6'}" transform="translate(0, -1) scale(1.95)" />
      <ellipse cx="-8" cy="-14" rx="7" ry="12" fill="#ffffff" opacity="0.16" transform="rotate(-20 -8 -14)"/>
    </g>
  `;
}

function buildCourtCenter(rank, suit) {
  const label = rankText(rank);
  const crown =
    rank === 13
      ? `<path d="M-24,-10 L-26,-32 L-11,-20 L0,-38 L11,-20 L26,-32 L24,-10 Z" fill="url(#goldGrad)" stroke="#78350f" stroke-width="1.5"/>
         <circle cx="-26" cy="-34" r="3" fill="#fef08a"/>
         <circle cx="0" cy="-40" r="3.6" fill="#fef08a"/>
         <circle cx="26" cy="-34" r="3" fill="#fef08a"/>
         <rect x="-24" y="-10" width="48" height="6" rx="2" fill="url(#goldGrad)" stroke="#78350f" stroke-width="1.1"/>`
      : rank === 12
        ? `<path d="M-22,-10 L-25,-28 L-10,-18 L0,-35 L10,-18 L25,-28 L22,-10 Z" fill="url(#goldGrad)" stroke="#78350f" stroke-width="1.4"/>
           <circle cx="0" cy="-36" r="3.4" fill="#fb7185" stroke="#fef08a" stroke-width="1.2"/>
           <circle cx="-13" cy="-25" r="2.3" fill="#fef08a"/>
           <circle cx="13" cy="-25" r="2.3" fill="#fef08a"/>
           <rect x="-22" y="-10" width="44" height="5.5" rx="2.5" fill="url(#goldGrad)" stroke="#78350f" stroke-width="1"/>`
        : `<path d="M-19,-10 L-16,-28 L0,-22 L16,-28 L19,-10 Z" fill="url(#goldGrad)" stroke="#78350f" stroke-width="1.4"/>
           <polygon points="0,-36 5,-25 0,-18 -5,-25" fill="#fef08a" stroke="#78350f" stroke-width="1"/>
           <rect x="-20" y="-10" width="40" height="5" rx="2" fill="url(#goldGrad)" stroke="#78350f" stroke-width="1"/>`;

  const titleCn = rank === 13 ? 'KING' : rank === 12 ? 'QUEEN' : 'JACK';
  return `
    <g transform="translate(80, 112)">
      <rect x="-39" y="-66" width="78" height="132" rx="10" fill="${suit.courtBg}" stroke="url(#goldGrad)" stroke-width="2.2"/>
      <rect x="-34" y="-61" width="68" height="122" rx="7" fill="none" stroke="${suit.c1}" stroke-width="1.1" opacity="0.45"/>
      <path d="M-34,-26 L34,-26 M-34,26 L34,26" stroke="url(#goldGrad)" stroke-width="0.9" opacity="0.45"/>
      <path d="M-28,-55 L28,55 M28,-55 L-28,55" stroke="${suit.accent}" stroke-width="0.7" opacity="0.22"/>
      <circle cx="0" cy="4" r="29" fill="#ffffff" stroke="url(#goldGrad)" stroke-width="1.8" opacity="0.95"/>
      <g transform="translate(0, -16)">${crown}</g>
      <text x="0" y="15" font-family="'Georgia', 'Times New Roman', serif" font-size="34" font-weight="900" text-anchor="middle" fill="url(#suitGrad)">${label}</text>
      <text x="0" y="29" font-family="'Segoe UI', sans-serif" font-size="8.5" font-weight="800" letter-spacing="2.2" text-anchor="middle" fill="#92400e">${titleCn}</text>
      <path d="${suit.path}" fill="url(#suitGrad)" transform="translate(0, 46) scale(0.68)"/>
      <path d="${suit.path}" fill="url(#suitGrad)" opacity="0.28" transform="translate(-22, -46) scale(0.42)"/>
      <path d="${suit.path}" fill="url(#suitGrad)" opacity="0.28" transform="translate(22, 46) rotate(180) scale(0.42)"/>
    </g>
  `;
}

function buildNumberPips(rank, suit) {
  const num = rank === 15 ? 2 : rank;
  const coords = PIP_LAYOUTS[num] ?? [];
  const scale = num <= 4 ? 0.92 : num <= 7 ? 0.82 : 0.74;
  return coords
    .map(([x, y, flip]) => {
      const rot = flip ? ' rotate(180)' : '';
      return `
        <g transform="translate(${x}, ${y})${rot}">
          <path d="${suit.path}" fill="rgba(0,0,0,0.12)" transform="translate(1.2, 2) scale(${scale})"/>
          <path d="${suit.path}" fill="url(#suitGrad)" transform="scale(${scale})"/>
        </g>
      `;
    })
    .join('\n');
}

function buildCardSvg(rank, suit) {
  const label = rankText(rank);
  const center =
    rank === 14
      ? buildAceCenter(suit)
      : rank >= 11 && rank <= 13
        ? buildCourtCenter(rank, suit)
        : buildNumberPips(rank, suit);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 224" width="160" height="224">
  <defs>
    <linearGradient id="cardFace" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="55%" stop-color="#fdfbf7"/>
      <stop offset="100%" stop-color="#f1ebe0"/>
    </linearGradient>
    <linearGradient id="gloss" x1="0%" y1="0%" x2="80%" y2="80%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.72"/>
      <stop offset="45%" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="48%" stop-color="#d4af37"/>
      <stop offset="100%" stop-color="#92600a"/>
    </linearGradient>
    <linearGradient id="suitGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${suit.c1}"/>
      <stop offset="100%" stop-color="${suit.c2}"/>
    </linearGradient>
    <radialGradient id="aceHalo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${suit.isRed ? '#fecdd3' : '#e2e8f0'}" stop-opacity="0.85"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Thick 3D Luxury Card Base -->
  <rect x="2" y="2" width="156" height="220" rx="14" fill="#d6cbb8"/>
  <rect x="2" y="1" width="156" height="218" rx="14" fill="url(#cardFace)" stroke="#c7b28a" stroke-width="1.8"/>
  <rect x="7" y="6" width="146" height="208" rx="10" fill="none" stroke="url(#goldGrad)" stroke-width="1" opacity="0.58"/>
  <path d="M 14 2 L 146 2 Q 158 2 158 14 L 158 76 Q 75 56 2 118 L 2 14 Q 2 2 14 2 Z" fill="url(#gloss)"/>

  <!-- Top Left Jumbo Index -->
  <g transform="translate(22, 37)">
    ${buildCorner(label, suit)}
  </g>

  <!-- Centerpiece Art -->
  ${center}

  <!-- Bottom Right Jumbo Index -->
  <g transform="translate(138, 185) rotate(180)">
    ${buildCorner(label, suit)}
  </g>
</svg>`;
}

function buildJokerSvg(isBig) {
  const c1 = isBig ? '#ef233c' : '#1e3a8a';
  const c2 = isBig ? '#991b1b' : '#0f172a';
  const bg = isBig ? '#fff1f2' : '#eff6ff';
  const title = isBig ? '大王' : '小王';
  const sub = isBig ? 'RED JOKER' : 'BLACK JOKER';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 224" width="160" height="224">
  <defs>
    <linearGradient id="cardFace" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="60%" stop-color="#fdfbf7"/>
      <stop offset="100%" stop-color="#f1ebe0"/>
    </linearGradient>
    <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="50%" stop-color="#d4af37"/>
      <stop offset="100%" stop-color="#92600a"/>
    </linearGradient>
    <linearGradient id="jokerGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="156" height="220" rx="14" fill="#d6cbb8"/>
  <rect x="2" y="1" width="156" height="218" rx="14" fill="url(#cardFace)" stroke="#c7b28a" stroke-width="1.8"/>
  <rect x="7" y="6" width="146" height="208" rx="10" fill="none" stroke="url(#goldGrad)" stroke-width="1.2" opacity="0.72"/>

  <g transform="translate(22, 34)">
    <text x="0" y="0" font-family="'Microsoft YaHei', sans-serif" font-size="18" font-weight="900" text-anchor="middle" fill="url(#jokerGrad)">${title[0]}</text>
    <text x="0" y="20" font-family="'Microsoft YaHei', sans-serif" font-size="18" font-weight="900" text-anchor="middle" fill="url(#jokerGrad)">${title[1]}</text>
    <polygon points="0,28 3,35 10,35 4.5,39.5 6.5,46 0,42 -6.5,46 -4.5,39.5 -10,35 -3,35" fill="url(#goldGrad)"/>
  </g>

  <g transform="translate(80, 112)">
    <rect x="-40" y="-66" width="80" height="132" rx="11" fill="${bg}" stroke="url(#goldGrad)" stroke-width="2.2"/>
    <circle cx="0" cy="-4" r="32" fill="#ffffff" stroke="url(#goldGrad)" stroke-width="2"/>
    <path d="M-24,-10 C-26,-32 -12,-36 -4,-18 C0,-38 0,-38 4,-18 C12,-36 26,-32 24,-10 Z" fill="url(#jokerGrad)" stroke="url(#goldGrad)" stroke-width="1.5"/>
    <circle cx="-24" cy="-30" r="4" fill="url(#goldGrad)"/>
    <circle cx="0" cy="-38" r="4.5" fill="url(#goldGrad)"/>
    <circle cx="24" cy="-30" r="4" fill="url(#goldGrad)"/>
    <text x="0" y="16" font-family="'Microsoft YaHei', serif" font-size="24" font-weight="900" text-anchor="middle" fill="url(#jokerGrad)">${title}</text>
    <text x="0" y="46" font-family="'Segoe UI', sans-serif" font-size="9" font-weight="900" letter-spacing="1.6" text-anchor="middle" fill="#92400e">${sub}</text>
  </g>

  <g transform="translate(138, 188) rotate(180)">
    <text x="0" y="0" font-family="'Microsoft YaHei', sans-serif" font-size="18" font-weight="900" text-anchor="middle" fill="url(#jokerGrad)">${title[0]}</text>
    <text x="0" y="20" font-family="'Microsoft YaHei', sans-serif" font-size="18" font-weight="900" text-anchor="middle" fill="url(#jokerGrad)">${title[1]}</text>
    <polygon points="0,28 3,35 10,35 4.5,39.5 6.5,46 0,42 -6.5,46 -4.5,39.5 -10,35 -3,35" fill="url(#goldGrad)"/>
  </g>
</svg>`;
}

function buildBackSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 224" width="160" height="224">
  <defs>
    <linearGradient id="velvet" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7f1d1d"/>
      <stop offset="48%" stop-color="#450a0a"/>
      <stop offset="100%" stop-color="#1c0609"/>
    </linearGradient>
    <linearGradient id="gold" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fef08a"/>
      <stop offset="50%" stop-color="#eab308"/>
      <stop offset="100%" stop-color="#a16207"/>
    </linearGradient>
    <pattern id="royalGrid" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="16" height="16" fill="transparent"/>
      <path d="M0 8 H16 M8 0 V16" stroke="#facc15" stroke-width="0.7" opacity="0.28"/>
      <circle cx="8" cy="8" r="1.8" fill="#fde047" opacity="0.45"/>
    </pattern>
  </defs>
  <rect x="2" y="2" width="156" height="220" rx="14" fill="#f8f5ee" stroke="#c7b28a" stroke-width="1.6"/>
  <rect x="8" y="8" width="144" height="208" rx="10" fill="url(#velvet)" stroke="url(#gold)" stroke-width="2.2"/>
  <rect x="13" y="13" width="134" height="198" rx="7" fill="url(#royalGrid)" stroke="url(#gold)" stroke-width="1.1" opacity="0.9"/>
  <rect x="18" y="18" width="124" height="188" rx="5" fill="none" stroke="url(#gold)" stroke-width="1" stroke-dasharray="3 2" opacity="0.65"/>

  <g transform="translate(80, 112)">
    <circle cx="0" cy="0" r="38" fill="#2a070b" stroke="url(#gold)" stroke-width="2.4"/>
    <circle cx="0" cy="0" r="32" fill="none" stroke="url(#gold)" stroke-width="1.1" stroke-dasharray="3 3" opacity="0.85"/>
    <path d="M-16,4 L-18,-12 L-7,-4 L0,-18 L7,-4 L18,-12 L16,4 Z" fill="url(#gold)"/>
    <rect x="-16" y="6" width="32" height="4" rx="1.5" fill="url(#gold)"/>
    <text x="0" y="22" font-family="'Georgia', serif" font-size="9" font-weight="900" letter-spacing="2.4" text-anchor="middle" fill="#fef08a">ROYAL</text>
  </g>
</svg>`;
}

let count = 0;
for (const suit of SUITS) {
  for (let rank = 2; rank <= 15; rank += 1) {
    const file = join(OUT_DIR, `${suit.code}${rank}.svg`);
    writeFileSync(file, buildCardSvg(rank, suit), 'utf8');
    count += 1;
  }
}

writeFileSync(join(OUT_DIR, 'JOKER16.svg'), buildJokerSvg(false), 'utf8');
writeFileSync(join(OUT_DIR, 'JOKER_S.svg'), buildJokerSvg(false), 'utf8');
writeFileSync(join(OUT_DIR, 'JOKER17.svg'), buildJokerSvg(true), 'utf8');
writeFileSync(join(OUT_DIR, 'JOKER_B.svg'), buildJokerSvg(true), 'utf8');
writeFileSync(join(OUT_DIR, 'back.svg'), buildBackSvg(), 'utf8');
count += 5;

console.log(`Generated ${count} luxury Casino Royale poker card SVGs in ${OUT_DIR}`);
