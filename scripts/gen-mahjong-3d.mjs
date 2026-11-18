/**
 * 全平台 3D 立体雕花麻将素材生成器
 * 生成 35 张高精 3D 立体翡翠绿背 + 温润象牙白骨面麻将矢量图：
 * - 万子 wan1..wan9
 * - 条子 bamboo1..bamboo9（一条带精绘彩雀幺鸡）
 * - 筒子 dot1..dot9（一筒带精绘八瓣盛莲大饼）
 * - 风牌 east / south / west / north（東南西北）
 * - 箭牌 zhong / fa / bai（中發白）
 * - 牌背 back（立体翡翠背）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '../apps/lobby-web/public/assets/mahjong');

fs.mkdirSync(OUT_DIR, { recursive: true });

const CN_NUMS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 3D 立体麻将底座与通用渐变滤镜（翡翠顶侧厚度 + 象牙白瓷面 + 立体微凸高光） */
function wrapFrontTile(innerSvg, cornerLabel = '', cornerColor = '#991b1b') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 116 158" width="116" height="158">
  <defs>
    <!-- 3D 翡翠绿背厚度层（顶部 + 右侧立体拔模） -->
    <linearGradient id="jadeTop" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#34e073"/>
      <stop offset="50%" stop-color="#19a84b"/>
      <stop offset="100%" stop-color="#0f6d31"/>
    </linearGradient>
    <linearGradient id="jadeSide" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#1cb854"/>
      <stop offset="60%" stop-color="#107835"/>
      <stop offset="100%" stop-color="#07441d"/>
    </linearGradient>
    <!-- 3D 象牙白中层过渡厚度 -->
    <linearGradient id="ivorySide" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#f2eadb"/>
      <stop offset="100%" stop-color="#c4b59a"/>
    </linearGradient>
    <!-- 正面温润象牙白玉面 -->
    <linearGradient id="ivoryFace" x1="12%" y1="4%" x2="88%" y2="96%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="48%" stop-color="#fdf9f0"/>
      <stop offset="86%" stop-color="#f0e6d2"/>
      <stop offset="100%" stop-color="#dfd1b8"/>
    </linearGradient>
    <!-- 瓷面玻璃高光 -->
    <linearGradient id="gloss" x1="0%" y1="0%" x2="60%" y2="85%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.72"/>
      <stop offset="35%" stop-color="#ffffff" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <!-- 立体雕花色系 -->
    <radialGradient id="cRed" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#f84242"/>
      <stop offset="65%" stop-color="#c81e1e"/>
      <stop offset="100%" stop-color="#7f1010"/>
    </radialGradient>
    <radialGradient id="cGreen" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#22c55e"/>
      <stop offset="65%" stop-color="#15803d"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </radialGradient>
    <radialGradient id="cBlue" cx="35%" cy="30%" r="70%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="65%" stop-color="#1d4ed8"/>
      <stop offset="100%" stop-color="#172554"/>
    </radialGradient>
    <linearGradient id="bamGreen" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#0d6630"/>
      <stop offset="38%" stop-color="#22c55e"/>
      <stop offset="72%" stop-color="#15803d"/>
      <stop offset="100%" stop-color="#064e24"/>
    </linearGradient>
    <linearGradient id="bamRed" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#8c1515"/>
      <stop offset="40%" stop-color="#ef4444"/>
      <stop offset="100%" stop-color="#7f1010"/>
    </linearGradient>
    <linearGradient id="bamBlue" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#1e3a8a"/>
      <stop offset="42%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#172554"/>
    </linearGradient>
    <filter id="engrave" x="-8%" y="-8%" width="116%" height="116%">
      <feDropShadow dx="0" dy="1.1" stdDeviation="0.5" flood-color="#ffffff" flood-opacity="0.75"/>
    </filter>
  </defs>

  <!-- 底部落地柔影 -->
  <rect x="7" y="14" width="106" height="142" rx="15" fill="#03140b" opacity="0.34"/>

  <!-- 3D 翡翠绿背厚度块（向右上方立体突出） -->
  <rect x="8" y="2" width="104" height="142" rx="14" fill="url(#jadeSide)" stroke="#073d1a" stroke-width="1.4"/>
  <!-- 翡翠顶部反光带 -->
  <path d="M18 3.5 H100 Q109 3.5 110 12 V18 Q108 10 99 10 H16 Q10 10 9 16 V12 Q10 3.5 18 3.5 Z" fill="url(#jadeTop)" opacity="0.95"/>

  <!-- 中层象牙白骨质侧厚 -->
  <rect x="5" y="7" width="102" height="142" rx="13" fill="url(#ivorySide)" stroke="#b3a184" stroke-width="1"/>

  <!-- 正面象牙白精抛光瓷面 -->
  <rect x="2.5" y="10.5" width="100" height="142" rx="12" fill="url(#ivoryFace)" stroke="#cfc0a6" stroke-width="1.5"/>

  <!-- 瓷面微凹刻槽边框 -->
  <rect x="8" y="16" width="89" height="131" rx="8" fill="none" stroke="#e5d9c3" stroke-width="1.2"/>

  <!-- 左上角弧形瓷釉高光 -->
  <path d="M14 12 H90 Q100 12 100 22 V48 Q56 62 4 38 V22 Q4 12 14 12 Z" fill="url(#gloss)"/>

  <!-- 牌面内容（位于正面 x:2.5..102.5, y:10.5..152.5，中心 52.5, 81.5） -->
  <g filter="url(#engrave)">
    ${innerSvg}
  </g>

  ${
    cornerLabel
      ? `<text x="92" y="29" text-anchor="end" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="800" fill="${cornerColor}" opacity="0.72">${cornerLabel}</text>`
      : ''
  }
</svg>`;
}

/** 3D 立体翡翠牌背 */
function makeBackTile() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 116 158" width="116" height="158">
  <defs>
    <linearGradient id="backIvory" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="65%" stop-color="#e8decb"/>
      <stop offset="100%" stop-color="#bda98b"/>
    </linearGradient>
    <linearGradient id="backJade" x1="12%" y1="6%" x2="90%" y2="94%">
      <stop offset="0%" stop-color="#2de06d"/>
      <stop offset="48%" stop-color="#179b45"/>
      <stop offset="100%" stop-color="#095224"/>
    </linearGradient>
    <linearGradient id="backGloss" x1="0%" y1="0%" x2="65%" y2="85%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.45"/>
      <stop offset="45%" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="7" y="14" width="106" height="142" rx="15" fill="#021109" opacity="0.38"/>
  <!-- 底部露出象牙白瓷座 -->
  <rect x="8" y="3" width="104" height="143" rx="14" fill="url(#backIvory)" stroke="#a39073" stroke-width="1.3"/>
  <!-- 正面翡翠玉背 -->
  <rect x="2.5" y="10.5" width="100" height="142" rx="12" fill="url(#backJade)" stroke="#07421c" stroke-width="1.8"/>
  <rect x="10" y="18" width="85" height="127" rx="7" fill="none" stroke="#86efac" stroke-width="1.3" opacity="0.48"/>
  <rect x="15" y="23" width="75" height="117" rx="5" fill="none" stroke="#063b19" stroke-width="1" opacity="0.45"/>
  <!-- 中心隐纹金菱 -->
  <g transform="translate(52.5, 81.5)" opacity="0.32" fill="none" stroke="#bbf7d0" stroke-width="1.5">
    <polygon points="0,-24 18,0 0,24 -18,0"/>
    <polygon points="0,-13 10,0 0,13 -10,0" fill="#86efac" opacity="0.45"/>
  </g>
  <path d="M14 12 H90 Q100 12 100 22 V52 Q52 68 4 42 V22 Q4 12 14 12 Z" fill="url(#backGloss)"/>
</svg>`;
}

/** 万子 wan1..wan9 */
function makeWan(n) {
  const inner = `
    <text x="52.5" y="67" text-anchor="middle" font-family="'STKaiti','KaiTi','Songti SC','SimSun',serif" font-size="48" font-weight="900" fill="#1e293b">${CN_NUMS[n]}</text>
    <text x="52.5" y="128" text-anchor="middle" font-family="'STKaiti','KaiTi','Songti SC','SimSun',serif" font-size="47" font-weight="900" fill="url(#cRed)">萬</text>
  `;
  return wrapFrontTile(inner, String(n), '#b91c1c');
}

/** 单个雕花筒子球体 */
function dotCircle(cx, cy, r, color) {
  const fillId = color === 'red' ? 'cRed' : color === 'green' ? 'cGreen' : 'cBlue';
  const ringStroke = color === 'red' ? '#fee2e2' : color === 'green' ? '#dcfce7' : '#dbeafe';
  return `
    <g transform="translate(${cx},${cy})">
      <circle r="${r}" fill="url(#${fillId})" stroke="#0f172a" stroke-opacity="0.22" stroke-width="1"/>
      <circle r="${(r * 0.68).toFixed(1)}" fill="none" stroke="${ringStroke}" stroke-width="${Math.max(1.5, r * 0.16).toFixed(1)}" stroke-dasharray="${(r * 0.42).toFixed(1)} ${(r * 0.22).toFixed(1)}"/>
      <circle r="${(r * 0.34).toFixed(1)}" fill="#ffffff" opacity="0.92"/>
      <circle r="${(r * 0.16).toFixed(1)}" fill="url(#${fillId})"/>
      <ellipse cx="${(-r * 0.26).toFixed(1)}" cy="${(-r * 0.32).toFixed(1)}" rx="${(r * 0.26).toFixed(1)}" ry="${(r * 0.14).toFixed(1)}" fill="#ffffff" opacity="0.45" transform="rotate(-28)"/>
    </g>
  `;
}

/** 筒子 dot1..dot9 */
function makeDot(n) {
  if (n === 1) {
    // 盛莲大饼一筒
    const petals = Array.from({ length: 8 }, (_, i) => {
      const deg = i * 45;
      return `<ellipse cx="0" cy="-21" rx="5.5" ry="10.5" fill="${i % 2 === 0 ? 'url(#cGreen)' : 'url(#cBlue)'}" transform="rotate(${deg})"/>`;
    }).join('');
    const inner = `
      <g transform="translate(52.5, 84)">
        <circle r="37" fill="#fef3c7" stroke="url(#cBlue)" stroke-width="4.5"/>
        <circle r="31.5" fill="none" stroke="url(#cGreen)" stroke-width="2" stroke-dasharray="6 3"/>
        ${petals}
        <circle r="15.5" fill="url(#cRed)" stroke="#fff7ed" stroke-width="2.2"/>
        <circle r="7" fill="#fef08a"/>
        <circle r="3.2" fill="#b91c1c"/>
      </g>
    `;
    return wrapFrontTile(inner, '1', '#1d4ed8');
  }

  const layouts = {
    2: [[52.5, 52, 18.5, 'green'], [52.5, 112, 18.5, 'blue']],
    3: [[31, 43, 15.5, 'blue'], [52.5, 82, 15.5, 'red'], [74, 121, 15.5, 'green']],
    4: [[32, 52, 16, 'blue'], [73, 52, 16, 'green'], [32, 112, 16, 'green'], [73, 112, 16, 'blue']],
    5: [[30, 46, 14.5, 'blue'], [75, 46, 14.5, 'green'], [52.5, 82, 15.5, 'red'], [30, 118, 14.5, 'green'], [75, 118, 14.5, 'blue']],
    6: [[32, 42, 14, 'green'], [73, 42, 14, 'green'], [32, 85, 14, 'red'], [73, 85, 14, 'red'], [32, 120, 14, 'red'], [73, 120, 14, 'red']],
    7: [[27, 40, 12.5, 'green'], [52.5, 49, 12.5, 'green'], [78, 58, 12.5, 'green'], [33, 92, 13.5, 'red'], [72, 92, 13.5, 'red'], [33, 124, 13.5, 'red'], [72, 124, 13.5, 'red']],
    8: [[33, 38, 12.5, 'blue'], [72, 38, 12.5, 'blue'], [33, 67, 12.5, 'blue'], [72, 67, 12.5, 'blue'], [33, 96, 12.5, 'blue'], [72, 96, 12.5, 'blue'], [33, 125, 12.5, 'blue'], [72, 125, 12.5, 'blue']],
    9: [
      [26, 44, 12.5, 'blue'], [52.5, 44, 12.5, 'blue'], [79, 44, 12.5, 'blue'],
      [26, 82, 12.5, 'red'], [52.5, 82, 12.5, 'red'], [79, 82, 12.5, 'red'],
      [26, 120, 12.5, 'green'], [52.5, 120, 12.5, 'green'], [79, 120, 12.5, 'green'],
    ],
  };

  const inner = layouts[n].map(([x, y, r, c]) => dotCircle(x, y, r, c)).join('');
  return wrapFrontTile(inner, String(n), '#1d4ed8');
}

/** 单根立体雕花竹节 */
function bambooStalk(cx, cy, w, h, color, rot = 0) {
  const fill = color === 'red' ? 'url(#bamRed)' : color === 'blue' ? 'url(#bamBlue)' : 'url(#bamGreen)';
  const rx = w / 2;
  const x = -w / 2;
  const y = -h / 2;
  return `
    <g transform="translate(${cx},${cy}) rotate(${rot})">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>
      <ellipse cx="0" cy="${y + 3}" rx="${rx * 0.92}" ry="2.2" fill="#ffffff" opacity="0.45"/>
      <rect x="${x - 1}" y="-1.5" width="${w + 2}" height="3" rx="1.5" fill="#fffdf7" opacity="0.88"/>
      <line x1="${-w * 0.16}" y1="${y + 5}" x2="${-w * 0.16}" y2="${y + h - 5}" stroke="#ffffff" stroke-width="1.3" opacity="0.4"/>
    </g>
  `;
}

/** 条子 bamboo1..bamboo9 */
function makeBamboo(n) {
  if (n === 1) {
    // 精绘国风孔雀/麻雀幺鸡
    const inner = `
      <g transform="translate(52.5, 84)">
        <!-- 尾羽 -->
        <path d="M-2 12 C-24 22 -30 40 -14 48 C-6 42 -2 30 2 20 Z" fill="url(#cGreen)"/>
        <path d="M4 12 C24 22 30 38 14 46 C8 38 4 28 2 20 Z" fill="url(#cBlue)"/>
        <path d="M0 16 C-8 34 0 50 6 52 C12 46 10 30 4 16 Z" fill="url(#cRed)"/>
        <!-- 机身与羽翼 -->
        <ellipse cx="0" cy="4" rx="18" ry="24" fill="url(#cGreen)"/>
        <path d="M-15 -2 C-28 6 -24 24 -8 22 Z" fill="url(#cBlue)"/>
        <path d="M15 -2 C28 6 24 24 8 22 Z" fill="url(#cRed)"/>
        <ellipse cx="0" cy="8" rx="9" ry="13" fill="#fef3c7" opacity="0.92"/>
        <!-- 头部与红冠 -->
        <circle cx="0" cy="-24" r="13" fill="url(#cGreen)"/>
        <path d="M-8 -34 Q0 -48 10 -34 Q2 -39 -8 -34 Z" fill="url(#cRed)"/>
        <polygon points="11,-26 24,-22 11,-18" fill="#d97706"/>
        <circle cx="4" cy="-26" r="3" fill="#ffffff"/>
        <circle cx="5" cy="-26" r="1.6" fill="#0f172a"/>
        <!-- 爪 -->
        <path d="M-7 26 L-12 38 M-7 26 L-4 38 M7 26 L12 38 M7 26 L4 38" stroke="#b45309" stroke-width="2.6" stroke-linecap="round"/>
      </g>
    `;
    return wrapFrontTile(inner, '1', '#15803d');
  }

  const layouts = {
    2: [[52.5, 53, 12, 42, 'blue', 0], [52.5, 111, 12, 42, 'green', 0]],
    3: [[52.5, 50, 11.5, 38, 'blue', 0], [33, 108, 11.5, 38, 'green', 0], [72, 108, 11.5, 38, 'green', 0]],
    4: [[34, 52, 11, 40, 'blue', 0], [71, 52, 11, 40, 'green', 0], [34, 110, 11, 40, 'green', 0], [71, 110, 11, 40, 'blue', 0]],
    5: [[29, 51, 10, 38, 'green', 0], [76, 51, 10, 38, 'blue', 0], [52.5, 81, 10.5, 38, 'red', 0], [29, 112, 10, 38, 'blue', 0], [76, 112, 10, 38, 'green', 0]],
    6: [[29, 52, 10, 40, 'green', 0], [52.5, 52, 10, 40, 'green', 0], [76, 52, 10, 40, 'green', 0], [29, 110, 10, 40, 'blue', 0], [52.5, 110, 10, 40, 'blue', 0], [76, 110, 10, 40, 'blue', 0]],
    7: [[52.5, 40, 9.5, 31, 'red', 0], [29, 81, 9.5, 31, 'blue', 0], [52.5, 81, 9.5, 31, 'green', 0], [76, 81, 9.5, 31, 'blue', 0], [29, 121, 9.5, 31, 'green', 0], [52.5, 121, 9.5, 31, 'blue', 0], [76, 121, 9.5, 31, 'green', 0]],
    8: [
      [27, 46, 9, 32, 'green', 0], [78, 46, 9, 32, 'green', 0],
      [42, 50, 9, 32, 'green', 26], [63, 50, 9, 32, 'green', -26],
      [27, 114, 9, 32, 'blue', 0], [78, 114, 9, 32, 'blue', 0],
      [42, 110, 9, 32, 'blue', -26], [63, 110, 9, 32, 'blue', 26],
    ],
    9: [
      [28, 43, 9.5, 30, 'red', 0], [52.5, 43, 9.5, 30, 'blue', 0], [77, 43, 9.5, 30, 'green', 0],
      [28, 82, 9.5, 30, 'red', 0], [52.5, 82, 9.5, 30, 'blue', 0], [77, 82, 9.5, 30, 'green', 0],
      [28, 121, 9.5, 30, 'red', 0], [52.5, 121, 9.5, 30, 'blue', 0], [77, 121, 9.5, 30, 'green', 0],
    ],
  };

  const inner = layouts[n].map(([x, y, w, h, c, r]) => bambooStalk(x, y, w, h, c, r)).join('');
  return wrapFrontTile(inner, String(n), '#15803d');
}

/** 风牌（東南西北） */
function makeWind(char, code) {
  const inner = `
    <text x="52.5" y="102" text-anchor="middle" font-family="'STKaiti','KaiTi','Songti SC','SimSun',serif" font-size="68" font-weight="900" fill="#111827">${char}</text>
  `;
  return wrapFrontTile(inner, code, '#b91c1c');
}

/** 箭牌（中發白） */
function makeDragon(type) {
  if (type === 'zhong') {
    const inner = `
      <text x="52.5" y="106" text-anchor="middle" font-family="'STKaiti','KaiTi','Songti SC','SimSun',serif" font-size="74" font-weight="900" fill="url(#cRed)">中</text>
    `;
    return wrapFrontTile(inner, '中', '#b91c1c');
  }
  if (type === 'fa') {
    const inner = `
      <text x="52.5" y="104" text-anchor="middle" font-family="'STKaiti','KaiTi','Songti SC','SimSun',serif" font-size="68" font-weight="900" fill="url(#cGreen)">發</text>
    `;
    return wrapFrontTile(inner, '發', '#15803d');
  }
  // 白板（经典双框蓝雕回纹白板）
  const inner = `
    <rect x="21" y="34" width="63" height="96" rx="7" fill="none" stroke="url(#cBlue)" stroke-width="5"/>
    <rect x="28" y="41" width="49" height="82" rx="4" fill="none" stroke="#1d4ed8" stroke-width="1.6" stroke-dasharray="6 3"/>
    <path d="M21 48 H34 V34 M84 48 H71 V34 M21 116 H34 V130 M84 116 H71 V130" fill="none" stroke="#1e3a8a" stroke-width="2.2"/>
  `;
  return wrapFrontTile(inner, '白', '#1d4ed8');
}

// 写出全部 35 张 3D 麻将素材
for (let i = 1; i <= 9; i++) {
  fs.writeFileSync(path.join(OUT_DIR, `wan${i}.svg`), makeWan(i), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, `dot${i}.svg`), makeDot(i), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, `bamboo${i}.svg`), makeBamboo(i), 'utf8');
}

fs.writeFileSync(path.join(OUT_DIR, 'east.svg'), makeWind('東', 'E'), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'south.svg'), makeWind('南', 'S'), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'west.svg'), makeWind('西', 'W'), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'north.svg'), makeWind('北', 'N'), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'zhong.svg'), makeDragon('zhong'), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'fa.svg'), makeDragon('fa'), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'bai.svg'), makeDragon('bai'), 'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'back.svg'), makeBackTile(), 'utf8');

console.log(`✅ Generated 35 3D mahjong SVG tiles in ${OUT_DIR}`);
