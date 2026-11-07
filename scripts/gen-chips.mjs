/**
 * 程序化生成赌场筹码矢量素材，按真实赌场配色规则。
 * 运行：node scripts/gen-chips.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'apps/lobby-web/public/assets/chips';
mkdirSync(OUT, { recursive: true });

/** 面额与配色（参考真实赌场筹码） */
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
];

function shortLabel(v) {
  if (v >= 10000) return `${v / 1000}K`;
  if (v >= 1000) return `${v / 1000}K`;
  return String(v);
}

function chip({ v, base, edge, label }) {
  const text = shortLabel(v);
  const fontSize = text.length >= 3 ? 24 : 32;

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

for (const denom of DENOMS) {
  writeFileSync(`${OUT}/chip-${denom.v}.svg`, chip(denom), 'utf8');
}

console.log(`已生成 ${DENOMS.length} 枚筹码 → ${OUT}`);
