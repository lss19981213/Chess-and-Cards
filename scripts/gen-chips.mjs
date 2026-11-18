/**
 * 程序化生成赌场筹码矢量素材，按真实赌场配色规则。
 * 50W / 100W 采用独立定制的皇室鎏金镶钻至尊筹码造型。
 * 运行：node scripts/gen-chips.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'apps/lobby-web/public/assets/chips';
mkdirSync(OUT, { recursive: true });

/** 标准面额与配色（参考真实赌场筹码） */
const DENOMS = [
  { v: 1, base: '#eef2f8', edge: '#2b3142', label: '#2b3142' },
  { v: 5, base: '#cf3140', edge: '#ffffff', label: '#ffffff' },
  { v: 10, base: '#2f6fd0', edge: '#ffffff', label: '#ffffff' },
  { v: 20, base: '#2f9e6b', edge: '#ffffff', label: '#ffffff' },
  { v: 50, base: '#e08b2f', edge: '#ffffff', label: '#ffffff' },
  { v: 100, base: '#232830', edge: '#e8ecf3', label: '#e8ecf3' },
  { v: 300, base: '#6f45d8', edge: '#ffffff', label: '#ffffff' },
  { v: 500, base: '#8e3ac2', edge: '#ffd875', label: '#ffd875' },
  { v: 1000, base: '#e8b64c', edge: '#232830', label: '#232830' },
  { v: 2000, base: '#2aa6b8', edge: '#ffffff', label: '#ffffff' },
  { v: 5000, base: '#7a4a2b', edge: '#ffd875', label: '#ffd875' },
  { v: 10000, base: '#7d1a2e', edge: '#ffd875', label: '#ffd875' },
  { v: 50000, base: '#1d3b2a', edge: '#ffd875', label: '#ffd875' },
  { v: 100000, base: '#12151c', edge: '#f0c451', label: '#f0c451' },
];

function shortLabel(v) {
  if (v >= 10000) return `${v / 10000}W`;
  if (v >= 1000) return `${v / 1000}K`;
  return String(v);
}

function chip({ v, base, edge, label }) {
  const text = shortLabel(v);
  const fontSize = text.length >= 4 ? 21 : text.length >= 3 ? 25 : 32;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <linearGradient id="gloss" x1="0.15" y1="0" x2="0.8" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="0.42" stop-color="#ffffff" stop-opacity="0"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.3"/>
    </linearGradient>
  </defs>
  <circle cx="64" cy="64" r="62" fill="${base}"/>
  <circle cx="64" cy="64" r="56" fill="none" stroke="${edge}" stroke-width="13" stroke-dasharray="10 19.3" stroke-opacity="0.95"/>
  <circle cx="64" cy="64" r="45.5" fill="${base}"/>
  <circle cx="64" cy="64" r="45.5" fill="none" stroke="${edge}" stroke-width="2" stroke-opacity="0.5"/>
  <circle cx="64" cy="64" r="37" fill="none" stroke="${edge}" stroke-width="1.4" stroke-opacity="0.32"/>
  <text x="64" y="75" text-anchor="middle" font-family="'Segoe UI',Arial,Helvetica,sans-serif" font-weight="800" font-size="${fontSize}" fill="${label}" letter-spacing="0.5">${text}</text>
  <circle cx="64" cy="64" r="62" fill="url(#gloss)"/>
  <circle cx="64" cy="64" r="61" fill="none" stroke="#000000" stroke-opacity="0.35" stroke-width="2"/>
</svg>`;
}

/** 50W 紫金皇冠镶钻尊享筹码 */
function chip50W() {
  const gems = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 * Math.PI) / 180;
    const cx = (64 + Math.cos(angle) * 53.5).toFixed(2);
    const cy = (64 + Math.sin(angle) * 53.5).toFixed(2);
    const rot = i * 30;
    if (i % 2 === 0) {
      return `<polygon points="0,-5.5 4.2,0 0,5.5 -4.2,0" transform="translate(${cx},${cy}) rotate(${rot})" fill="url(#diamond50)" stroke="#fff7dc" stroke-width="0.7"/>`;
    }
    return `<rect x="-2.4" y="-5" width="4.8" height="10" rx="1.6" transform="translate(${cx},${cy}) rotate(${rot})" fill="url(#roseGold50)" stroke="#4c1d95" stroke-width="0.6"/>`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <radialGradient id="violetCore50" cx="38%" cy="30%" r="72%">
      <stop offset="0%" stop-color="#6d28d9"/>
      <stop offset="45%" stop-color="#3b0764"/>
      <stop offset="100%" stop-color="#140624"/>
    </radialGradient>
    <linearGradient id="roseGold50" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fff4c4"/>
      <stop offset="28%" stop-color="#f7c86a"/>
      <stop offset="55%" stop-color="#e79772"/>
      <stop offset="82%" stop-color="#fce09b"/>
      <stop offset="100%" stop-color="#a86424"/>
    </linearGradient>
    <linearGradient id="diamond50" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="45%" stop-color="#e9d5ff"/>
      <stop offset="100%" stop-color="#c084fc"/>
    </linearGradient>
    <linearGradient id="textGold50" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#fffbe6"/>
      <stop offset="48%" stop-color="#fde08d"/>
      <stop offset="100%" stop-color="#d98b2b"/>
    </linearGradient>
    <linearGradient id="gloss50" x1="0.12" y1="0" x2="0.82" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.38"/>
      <stop offset="38%" stop-color="#ffffff" stop-opacity="0.04"/>
      <stop offset="100%" stop-color="#090213" stop-opacity="0.42"/>
    </linearGradient>
  </defs>
  <!-- 外圈奢华紫金戒环 -->
  <circle cx="64" cy="64" r="62.5" fill="url(#roseGold50)"/>
  <circle cx="64" cy="64" r="59.5" fill="#1d0b36"/>
  <circle cx="64" cy="64" r="59.5" fill="none" stroke="url(#roseGold50)" stroke-width="2.2"/>
  <!-- 12枚交替钻石与玫瑰金镶片 -->
  <g>
    ${gems}
  </g>
  <!-- 中心皇家丝绒紫盘面 -->
  <circle cx="64" cy="64" r="46" fill="url(#roseGold50)"/>
  <circle cx="64" cy="64" r="43.5" fill="url(#violetCore50)"/>
  <circle cx="64" cy="64" r="39.5" fill="none" stroke="url(#roseGold50)" stroke-width="1.3" stroke-dasharray="3.5 3.5" stroke-opacity="0.78"/>
  <circle cx="64" cy="64" r="35.5" fill="none" stroke="#f5d0fe" stroke-width="0.8" stroke-opacity="0.35"/>
  <!-- 顶部皇冠徽章 -->
  <path d="M51 44 L54.5 34.5 L60 39.5 L64 32 L68 39.5 L73.5 34.5 L77 44 Z" fill="url(#roseGold50)" stroke="#fff7d6" stroke-width="0.7"/>
  <circle cx="64" cy="31.5" r="1.7" fill="#ffffff"/>
  <circle cx="54.2" cy="34.2" r="1.2" fill="#f5d0fe"/>
  <circle cx="73.8" cy="34.2" r="1.2" fill="#f5d0fe"/>
  <!-- 浮雕主面额 50W -->
  <text x="64" y="75.5" text-anchor="middle" font-family="'Segoe UI',Arial,Helvetica,sans-serif" font-weight="900" font-size="27" fill="#1b0630" opacity="0.75" dx="0" dy="1.8">50W</text>
  <text x="64" y="75.5" text-anchor="middle" font-family="'Segoe UI',Arial,Helvetica,sans-serif" font-weight="900" font-size="27" fill="url(#textGold50)" letter-spacing="0.5">50W</text>
  <!-- 底部至尊标识 -->
  <text x="64" y="92" text-anchor="middle" font-family="'Segoe UI',Arial,sans-serif" font-weight="800" font-size="7.5" fill="#f5d0fe" letter-spacing="2.2" opacity="0.9">ROYAL VIP</text>
  <circle cx="64" cy="64" r="62" fill="url(#gloss50)"/>
  <circle cx="64" cy="64" r="61.8" fill="none" stroke="#fff2bf" stroke-opacity="0.55" stroke-width="1.2"/>
</svg>`;
}

/** 100W 帝皇黑金 24K 纯金星钻至尊筹码 */
function chip100W() {
  const rays = Array.from({ length: 24 }, (_, i) => {
    const a = (i * 15 * Math.PI) / 180;
    const x1 = (64 + Math.cos(a) * 34).toFixed(2);
    const y1 = (64 + Math.sin(a) * 34).toFixed(2);
    const x2 = (64 + Math.cos(a) * 43).toFixed(2);
    const y2 = (64 + Math.sin(a) * 43).toFixed(2);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fde68a" stroke-width="${i % 2 === 0 ? '1.3' : '0.6'}" stroke-opacity="${i % 2 === 0 ? '0.45' : '0.2'}"/>`;
  }).join('\n    ');

  const edgeJewels = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 * Math.PI) / 180;
    const cx = (64 + Math.cos(angle) * 53.5).toFixed(2);
    const cy = (64 + Math.sin(angle) * 53.5).toFixed(2);
    const rot = i * 30;
    if (i % 3 === 0) {
      // 四大主位红宝石皇室菱钻
      return `<polygon points="0,-6.4 5,0 0,6.4 -5,0" transform="translate(${cx},${cy}) rotate(${rot})" fill="url(#ruby100)" stroke="#fff7c2" stroke-width="1"/>`;
    }
    // 鎏金镶边与白钻
    return `<g transform="translate(${cx},${cy}) rotate(${rot})">
      <rect x="-3.4" y="-5.2" width="6.8" height="10.4" rx="2" fill="url(#goldRim100)" stroke="#451a03" stroke-width="0.6"/>
      <polygon points="0,-2.8 2,0 0,2.8 -2,0" fill="#ffffff" opacity="0.92"/>
    </g>`;
  }).join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <radialGradient id="obsidianCore100" cx="42%" cy="28%" r="74%">
      <stop offset="0%" stop-color="#3b270c"/>
      <stop offset="38%" stop-color="#171108"/>
      <stop offset="78%" stop-color="#09080b"/>
      <stop offset="100%" stop-color="#020204"/>
    </radialGradient>
    <linearGradient id="goldRim100" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fffbeb"/>
      <stop offset="22%" stop-color="#fde047"/>
      <stop offset="50%" stop-color="#eab308"/>
      <stop offset="76%" stop-color="#fef08a"/>
      <stop offset="100%" stop-color="#92400e"/>
    </linearGradient>
    <linearGradient id="ruby100" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffe4e6"/>
      <stop offset="35%" stop-color="#fb7185"/>
      <stop offset="75%" stop-color="#be123c"/>
      <stop offset="100%" stop-color="#4c0519"/>
    </linearGradient>
    <linearGradient id="textGold100" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="36%" stop-color="#fef08a"/>
      <stop offset="72%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
    <linearGradient id="gloss100" x1="0.1" y1="0" x2="0.85" y2="1">
      <stop offset="0%" stop-color="#fffbeb" stop-opacity="0.4"/>
      <stop offset="35%" stop-color="#ffffff" stop-opacity="0.03"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.45"/>
    </linearGradient>
  </defs>
  <!-- 24K 纯金多层次皇室厚边 -->
  <circle cx="64" cy="64" r="63" fill="url(#goldRim100)"/>
  <circle cx="64" cy="64" r="59.2" fill="#140d05"/>
  <circle cx="64" cy="64" r="59.2" fill="none" stroke="url(#goldRim100)" stroke-width="2.6"/>
  <!-- 四向红宝石 + 鎏金镶钻外圈 -->
  <g>
    ${edgeJewels}
  </g>
  <!-- 中心黑金太阳芒帝皇盘 -->
  <circle cx="64" cy="64" r="46.5" fill="url(#goldRim100)"/>
  <circle cx="64" cy="64" r="43.5" fill="url(#obsidianCore100)"/>
  <g>
    ${rays}
  </g>
  <circle cx="64" cy="64" r="39" fill="none" stroke="url(#goldRim100)" stroke-width="1.5" stroke-opacity="0.85"/>
  <circle cx="64" cy="64" r="34.5" fill="none" stroke="#fde68a" stroke-width="0.8" stroke-dasharray="2 3" stroke-opacity="0.55"/>
  <!-- 顶部帝皇五尖皇冠 + 红宝石主钻 -->
  <path d="M48.5 44 L51.5 33.5 L57.5 39 L64 30 L70.5 39 L76.5 33.5 L79.5 44 Z" fill="url(#goldRim100)" stroke="#fffbeb" stroke-width="0.8"/>
  <polygon points="64,34 66.4,37.8 64,41.6 61.6,37.8" fill="url(#ruby100)" stroke="#fff7d6" stroke-width="0.5"/>
  <circle cx="64" cy="29.5" r="2" fill="#ffffff"/>
  <circle cx="51.2" cy="33" r="1.3" fill="#fef08a"/>
  <circle cx="76.8" cy="33" r="1.3" fill="#fef08a"/>
  <!-- 至尊主面额 100W -->
  <text x="64" y="75" text-anchor="middle" font-family="'Segoe UI',Arial,Helvetica,sans-serif" font-weight="900" font-size="24.5" fill="#000000" opacity="0.85" dy="2">100W</text>
  <text x="64" y="75" text-anchor="middle" font-family="'Segoe UI',Arial,Helvetica,sans-serif" font-weight="900" font-size="24.5" fill="url(#textGold100)" letter-spacing="0.2">100W</text>
  <!-- 底部铭文 -->
  <text x="64" y="91.5" text-anchor="middle" font-family="'Segoe UI',Arial,sans-serif" font-weight="900" font-size="7.2" fill="#fde047" letter-spacing="2.4">SUPREME</text>
  <!-- 星芒高光点缀 -->
  <path d="M35 39 L36.6 34.5 L38.2 39 L42.7 40.6 L38.2 42.2 L36.6 46.7 L35 42.2 L30.5 40.6 Z" fill="#ffffff" opacity="0.9"/>
  <circle cx="64" cy="64" r="62.2" fill="url(#gloss100)"/>
  <circle cx="64" cy="64" r="62" fill="none" stroke="#fffbeb" stroke-opacity="0.72" stroke-width="1.3"/>
</svg>`;
}

for (const denom of DENOMS) {
  writeFileSync(`${OUT}/chip-${denom.v}.svg`, chip(denom), 'utf8');
}
writeFileSync(`${OUT}/chip-500000.svg`, chip50W(), 'utf8');
writeFileSync(`${OUT}/chip-1000000.svg`, chip100W(), 'utf8');

console.log(`已生成 ${DENOMS.length + 2} 枚筹码（含 50W / 100W 至尊筹码） → ${OUT}`);
