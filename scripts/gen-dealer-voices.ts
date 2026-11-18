/**
 * 批量预生成荷官真人级神经语音 MP3 语音包：
 * - 覆盖 @cc/protocol 中全部 14 套荷官声线 × 12 句台词 + 7 句打赏答谢 + 7 句麻将报牌（共 182 条）
 * - 使用微软 Edge Neural TTS v2（晓臻/晓伊/晓晓/晓佳/晓雨），自然流畅、甜美逼真、零机械感
 * - 输出静态 MP3 至 apps/lobby-web/public/assets/voices/ 并生成 apps/lobby-web/src/voice-manifest.ts
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEALER_VOICES } from '../packages/protocol/src/frames';
import { synthesizeEdgeNeuralTts } from '../apps/api-server/src/edge-neural-tts';
import { resolveTaiwanVoicePreset } from '../apps/api-server/src/tts-taiwan';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'apps', 'lobby-web', 'public', 'assets', 'voices');
const MANIFEST_PATH = path.join(ROOT, 'apps', 'lobby-web', 'src', 'voice-manifest.ts');

export function normalizeDealerVoiceText(raw: string): string {
  return raw
    .replace(/\([^)]*∇[^)]*\)/g, '')
    .replace(/All-in/gi, '全押')
    .replace(/…+|\.{2,}/g, '，')
    .replace(/[~～]+/g, '，')
    .replace(/[“”"'`♡♥✨💖🎉🎁🎲🃏♠️♣️♥️♦️🎰👑🔥⚡💪🥰💕🤖👁️🪑🀄🌶️🐎🌹🍾🏎️🛥️🚘🎡🎆🌸]/g, '')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9，。！？、：；,.!?\s]/g, '')
    .replace(/，+/g, '，')
    .replace(/\s+/g, ' ')
    .replace(/^，+|，+$/g, '')
    .trim();
}

const SHARED_GIFT_QUOTES = [
  '“哇！谢谢老板的鲜花喔～爱丽丝心里甜甜的呢！🌸”',
  '“收到老板的爱心啦～爱丽丝给你比大大的心心喔！💖”',
  '“嘭！开香槟庆祝啦～祝老板财运通天，把把都大赢喔！🍾✨”',
  '“天呐！豪华超跑耶！老板太帅太阔气了啦～爱丽丝永远陪在你身边喔！🏎️👑”',
  '“哇塞！私人豪华游艇！爱丽丝好感动喔～愿为老板献上最甜蜜的陪伴！🛥️👑💖”',
  '“哇塞！至尊限量跑车耶～老板真的太宠人家了啦，爱丽丝要坐你副驾兜风喔！🚘✨💖”',
  '“天呐！！梦幻至尊嘉年华！！烟花绽放全场沸腾啦～老板就是爱丽丝心中最闪耀的超级男神喔！🎡🎆👑💖”',
];

const SHARED_MAHJONG_QUOTES = [
  '哇，起手胡喜从天降！',
  '吃！',
  '碰！',
  '杠！',
  '下雨啦，杠！',
  '恭喜自摸胡牌！',
  '胡啦，太精彩了！',
];

const SHARED_MAHJONG_TILES = [
  '一万', '二万', '三万', '四万', '五万', '六万', '七万', '八万', '九万',
  '一条', '二条', '三条', '四条', '五条', '六条', '七条', '八条', '九条',
  '一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒',
  '东风', '南风', '西风', '北风', '红中', '发财', '白板',
];

interface Job {
  styleId: string;
  voice: string;
  pitch: string;
  rate: string;
  cleanText: string;
  relPath: string;
  absPath: string;
  manifestKey: string;
}

function sha10(input: string): string {
  return crypto.createHash('sha1').update(input, 'utf8').digest('hex').slice(0, 10);
}

async function isValidExistingMp3(filePath: string): Promise<boolean> {
  try {
    const buf = await fs.readFile(filePath);
    if (buf.length < 512) return false;
    return (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0);
  } catch {
    return false;
  }
}

async function main() {
  const jobs: Job[] = [];
  const seen = new Set<string>();

  const enqueue = (styleId: string, rawText: string, overridePreset?: { voice: string; pitch: string; rate: string }) => {
    const cleanText = normalizeDealerVoiceText(rawText);
    if (!cleanText) return;
    const manifestKey = `${styleId}::${cleanText}`;
    if (seen.has(manifestKey)) return;
    seen.add(manifestKey);

    const preset = overridePreset ?? resolveTaiwanVoicePreset(styleId);
    const fileId = sha10(`${styleId}|${preset.voice}|${preset.pitch}|${preset.rate}|${cleanText}`);
    const relPath = `/assets/voices/${styleId}/${fileId}.mp3`;
    const absPath = path.join(OUT_DIR, styleId, `${fileId}.mp3`);
    jobs.push({
      styleId,
      voice: preset.voice,
      pitch: preset.pitch,
      rate: preset.rate,
      cleanText,
      relPath,
      absPath,
      manifestKey,
    });
  };

  for (const v of DEALER_VOICES) {
    for (const group of [v.quotes.idle, v.quotes.touch, v.quotes.cheer, v.quotes.win]) {
      for (const q of group) {
        enqueue(v.id, q);
      }
    }
  }

  // 打赏答谢与麻将报牌使用台湾晓臻甜美神经女声，作为通用预制语音包
  for (const q of SHARED_GIFT_QUOTES) {
    enqueue('_shared', q, { voice: 'zh-TW-HsiaoChenNeural', pitch: '+4Hz', rate: '+3%' });
  }
  for (const q of SHARED_MAHJONG_QUOTES) {
    enqueue('_shared', q, { voice: 'zh-TW-HsiaoChenNeural', pitch: '+4Hz', rate: '+5%' });
  }
  for (const tile of SHARED_MAHJONG_TILES) {
    enqueue('_shared', tile, { voice: 'zh-TW-HsiaoChenNeural', pitch: '+3Hz', rate: '+6%' });
  }

  console.log(`Preparing ${jobs.length} neural dealer voice clips...`);
  let done = 0;
  let skipped = 0;
  let failed = 0;
  const manifestEntries: Array<[string, string]> = [];

  const CONCURRENCY = 6;
  let cursor = 0;

  async function worker() {
    while (true) {
      const idx = cursor++;
      if (idx >= jobs.length) break;
      const job = jobs[idx]!;
      await fs.mkdir(path.dirname(job.absPath), { recursive: true });

      if (await isValidExistingMp3(job.absPath)) {
        skipped += 1;
        done += 1;
        manifestEntries.push([job.manifestKey, job.relPath]);
        continue;
      }

      let audio: Buffer | null = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        audio = await synthesizeEdgeNeuralTts(job.cleanText, job.voice, job.pitch, job.rate, 8000);
        if (audio && audio.length >= 512) break;
        await new Promise((r) => setTimeout(r, 400 * attempt));
      }

      if (audio && audio.length >= 512) {
        await fs.writeFile(job.absPath, audio);
        manifestEntries.push([job.manifestKey, job.relPath]);
      } else {
        failed += 1;
        console.error(`FAILED [${job.styleId}] ${job.cleanText}`);
      }

      done += 1;
      if (done % 20 === 0 || done === jobs.length) {
        console.log(`Progress: ${done}/${jobs.length} (skipped=${skipped}, failed=${failed})`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  manifestEntries.sort((a, b) => a[0].localeCompare(b[0]));

  const manifestCode = `// Auto-generated by scripts/gen-dealer-voices.ts — DO NOT EDIT MANUALLY
// 预置微软真人级神经女声语音包清单（零延迟、流畅甜美、无机械感）

export function normalizeDealerVoiceText(raw: string): string {
  return raw
    .replace(/\\([^)]*∇[^)]*\\)/g, '')
    .replace(/All-in/gi, '全押')
    .replace(/…+|\\.{2,}/g, '，')
    .replace(/[~～]+/g, '，')
    .replace(/[“”"'\`♡♥✨💖🎉🎁🎲🃏♠️♣️♥️♦️🎰👑🔥⚡💪🥰💕🤖👁️🪑🀄🌶️🐎🌹🍾🏎️🛥️🚘🎡🎆🌸]/g, '')
    .replace(/[^\\u4e00-\\u9fa5a-zA-Z0-9，。！？、：；,.!?\\s]/g, '')
    .replace(/，+/g, '，')
    .replace(/\\s+/g, ' ')
    .replace(/^，+|，+$/g, '')
    .trim();
}

export const DEALER_VOICE_MANIFEST: Record<string, string> = {
${manifestEntries.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')}
};

export function resolveStaticDealerVoiceUrl(styleId: string, cleanText: string): string | null {
  return (
    DEALER_VOICE_MANIFEST[\`\${styleId}::\${cleanText}\`] ??
    DEALER_VOICE_MANIFEST[\`_shared::\${cleanText}\`] ??
    null
  );
}
`;

  await fs.writeFile(MANIFEST_PATH, manifestCode, 'utf8');
  console.log(`Manifest written to ${MANIFEST_PATH} with ${manifestEntries.length} entries (failed=${failed}).`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
