/**
 * 荷官甜美真人级神经语音合成服务（适配国内与海外服务器，确保流畅自然、甜美无机械感）：
 * 1. 若 .env 配置了官方 AZURE_SPEECH_KEY，优先调用 Azure Speech 神经女声。
 * 2. 主力零配置神经引擎：微软 Edge Neural TTS v2（`zh-TW-HsiaoChenNeural` 台湾晓臻 / `zh-CN-XiaoyiNeural` 甜美晓伊 /
 *    `zh-CN-XiaoxiaoNeural` 温柔晓晓 / `zh-HK-HiuGaaiNeural` 港风粤语晓佳 / `zh-TW-HsiaoYuNeural` 优雅晓雨），
 *    国内与海外均可直连，音色流畅自然、呼吸气口逼真，彻底告别机械感。
 * 3. 若神经语音短暂不可达，自动降级至 Google zh-TW / 百度 / 有道兜底，永不静音。
 */

import { synthesizeEdgeNeuralTts } from './edge-neural-tts';

export interface TaiwanVoiceStylePreset {
  voice: string;
  accent: 'zh-TW' | 'zh-CN' | 'zh-HK';
  pitch: string;
  rate: string;
  baiduSpeed: number;
}

export function resolveTaiwanVoicePreset(styleId?: string): TaiwanVoiceStylePreset {
  switch (styleId) {
    case 'classic':
      return { voice: 'zh-TW-HsiaoChenNeural', accent: 'zh-TW', pitch: '+3Hz', rate: '+2%', baiduSpeed: 5 };
    case 'sweet':
      return { voice: 'zh-CN-XiaoyiNeural', accent: 'zh-CN', pitch: '+4Hz', rate: '+4%', baiduSpeed: 5 };
    case 'catgirl':
    case 'loli':
      return { voice: 'zh-CN-XiaoyiNeural', accent: 'zh-CN', pitch: '+6Hz', rate: '+2%', baiduSpeed: 5 };
    case 'tsundere':
      return { voice: 'zh-CN-XiaoyiNeural', accent: 'zh-CN', pitch: '+2Hz', rate: '+6%', baiduSpeed: 5 };
    case 'gyaru':
    case 'energetic':
      return { voice: 'zh-TW-HsiaoChenNeural', accent: 'zh-TW', pitch: '+4Hz', rate: '+6%', baiduSpeed: 5 };
    case 'maid':
    case 'gentle_wife':
    case 'healing':
      return { voice: 'zh-TW-HsiaoChenNeural', accent: 'zh-TW', pitch: '+2Hz', rate: '+0%', baiduSpeed: 4 };
    case 'royal_sister':
    case 'seductive':
      return { voice: 'zh-CN-XiaoxiaoNeural', accent: 'zh-CN', pitch: '-3Hz', rate: '-3%', baiduSpeed: 4 };
    case 'queen':
    case 'vampire':
      return { voice: 'zh-TW-HsiaoYuNeural', accent: 'zh-TW', pitch: '-4Hz', rate: '-4%', baiduSpeed: 4 };
    case 'whisper':
      return { voice: 'zh-CN-XiaoxiaoNeural', accent: 'zh-CN', pitch: '-5Hz', rate: '-8%', baiduSpeed: 3 };
    case 'yandere':
      return { voice: 'zh-TW-HsiaoChenNeural', accent: 'zh-TW', pitch: '-1Hz', rate: '-6%', baiduSpeed: 4 };
    case 'chuunibyou':
      return { voice: 'zh-CN-XiaoyiNeural', accent: 'zh-CN', pitch: '+1Hz', rate: '+5%', baiduSpeed: 5 };
    case 'classical':
    case 'mystic':
      return { voice: 'zh-CN-XiaoxiaoNeural', accent: 'zh-CN', pitch: '+0Hz', rate: '-5%', baiduSpeed: 4 };
    case 'cyber':
      return { voice: 'zh-TW-HsiaoYuNeural', accent: 'zh-TW', pitch: '+1Hz', rate: '+4%', baiduSpeed: 5 };
    case 'cantonese':
      return { voice: 'zh-HK-HiuGaaiNeural', accent: 'zh-HK', pitch: '-1Hz', rate: '+2%', baiduSpeed: 5 };
    case 'sichuan':
      return { voice: 'zh-CN-XiaoyiNeural', accent: 'zh-CN', pitch: '+3Hz', rate: '+5%', baiduSpeed: 5 };
    default:
      return { voice: 'zh-TW-HsiaoChenNeural', accent: 'zh-TW', pitch: '+3Hz', rate: '+2%', baiduSpeed: 5 };
  }
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 严格校验是否为真实 MP3 音频（ID3 标签或 MPEG 音频同步帧 0xFF 0xE0），过滤网页错误页 */
function isValidMp3(buf: Buffer): boolean {
  if (buf.length < 256) return false;
  if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true; // ID3
  if (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0) return true; // MPEG sync
  return false;
}

/** 国内机房访问 Google 被阻断时的 10 分钟快速熔断时间戳，避免每次请求白等超时 */
let googleBlockedUntil = 0;
let edgeConsecutiveFailures = 0;
let edgeCooldownUntil = 0;

async function synthesizeAzureTaiwanTts(
  text: string,
  preset: TaiwanVoiceStylePreset,
): Promise<Buffer | null> {
  const key = process.env.AZURE_SPEECH_KEY?.trim();
  const region = process.env.AZURE_SPEECH_REGION?.trim() || 'eastasia';
  if (!key) return null;

  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${preset.accent}">` +
    `<voice name="${preset.voice}">` +
    `<prosody pitch="${preset.pitch}" rate="${preset.rate}">${escapeXml(text)}</prosody>` +
    `</voice></speak>`;

  const res = await fetch(
    `https://${encodeURIComponent(region)}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'ChessAndCards-DealerTTS',
      },
      body: ssml,
      signal: AbortSignal.timeout(4500),
    },
  );
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return isValidMp3(buf) ? buf : null;
}

async function synthesizeGoogleTaiwanTts(text: string): Promise<Buffer | null> {
  if (Date.now() < googleBlockedUntil) return null;
  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=zh-TW&client=tw-ob&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(1400),
    });
    if (!res.ok) {
      googleBlockedUntil = Date.now() + 10 * 60_000;
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (isValidMp3(buf)) return buf;
    googleBlockedUntil = Date.now() + 10 * 60_000;
    return null;
  } catch {
    googleBlockedUntil = Date.now() + 10 * 60_000;
    return null;
  }
}

async function synthesizeBaiduSweetTts(text: string, speed: number): Promise<Buffer | null> {
  try {
    const safeSpd = Math.min(6, Math.max(3, Math.round(speed)));
    const url = `https://fanyi.baidu.com/gettts?lan=zh&text=${encodeURIComponent(text)}&spd=${safeSpd}&source=web`;
    const res = await fetch(url, {
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        referer: 'https://fanyi.baidu.com/',
      },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return isValidMp3(buf) ? buf : null;
  } catch {
    return null;
  }
}

export interface SynthesizedSpeech {
  audio: Buffer;
  accent: 'zh-TW' | 'zh-CN' | 'zh-HK';
  engine: 'neural' | 'legacy';
}

export async function synthesizeTaiwanSweetSpeech(
  text: string,
  styleId?: string,
): Promise<SynthesizedSpeech> {
  const preset = resolveTaiwanVoicePreset(styleId);

  // 1. 若配置了官方 Azure Speech 密钥，使用高保真神经女声
  try {
    const azureBuf = await synthesizeAzureTaiwanTts(text, preset);
    if (azureBuf) return { audio: azureBuf, accent: preset.accent, engine: 'neural' };
  } catch {
    /* 降级到下一条线路 */
  }

  // 2. 主力高保真真人级神经语音：微软 Edge Neural TTS v2（甜美流畅、零机械感）
  if (Date.now() >= edgeCooldownUntil) {
    try {
      const edgeBuf = await synthesizeEdgeNeuralTts(text, preset.voice, preset.pitch, preset.rate, 5500);
      if (edgeBuf && isValidMp3(edgeBuf)) {
        edgeConsecutiveFailures = 0;
        return { audio: edgeBuf, accent: preset.accent, engine: 'neural' };
      }
      edgeConsecutiveFailures += 1;
      if (edgeConsecutiveFailures >= 3) {
        edgeCooldownUntil = Date.now() + 3 * 60_000;
        edgeConsecutiveFailures = 0;
      }
    } catch {
      edgeConsecutiveFailures += 1;
      if (edgeConsecutiveFailures >= 3) {
        edgeCooldownUntil = Date.now() + 3 * 60_000;
        edgeConsecutiveFailures = 0;
      }
    }
  }

  // 3. 台湾国语女声 (zh-TW)，1.4s 快速探测 + 不可达时 10 分钟熔断
  const googleBuf = await synthesizeGoogleTaiwanTts(text);
  if (googleBuf) return { audio: googleBuf, accent: 'zh-TW', engine: 'legacy' };

  // 4. 国内兜底：百度女声 MP3
  const baiduBuf = await synthesizeBaiduSweetTts(text, preset.baiduSpeed);
  if (baiduBuf) return { audio: baiduBuf, accent: 'zh-CN', engine: 'legacy' };

  // 5. 最终兜底：有道语音流
  const fallbackUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&le=zh`;
  const res = await fetch(fallbackUrl, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      referer: 'https://dict.youdao.com/',
    },
    signal: AbortSignal.timeout(3500),
  });
  if (!res.ok) throw new Error(`TTS upstream ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!isValidMp3(buf)) throw new Error('TTS invalid audio payload');
  return { audio: buf, accent: 'zh-CN', engine: 'legacy' };
}
