/**
 * 荷官台湾甜美女声合成服务：
 * 1. 若在 .env 配置了官方 AZURE_SPEECH_KEY + AZURE_SPEECH_REGION，优先调用微软官方 Azure Speech REST API，
 *    使用 `zh-TW-HsiaoChenNeural`（台湾晓臻·超甜美少女音）与 `zh-TW-HsiaoYuNeural`（台湾晓雨·温柔清甜女声）。
 * 2. 否则优先使用台湾国语 `zh-TW` 语音流（Google Translate zh-TW 女声）。
 * 3. 若所在机房无法访问 Google，则自动降级到有道中文语音流，确保 100% 有声不报错。
 */

export interface TaiwanVoiceStylePreset {
  voice: string;
  pitch: string;
  rate: string;
}

export function resolveTaiwanVoicePreset(styleId?: string): TaiwanVoiceStylePreset {
  switch (styleId) {
    case 'sweet':
    case 'loli':
    case 'catgirl':
      return { voice: 'zh-TW-HsiaoChenNeural', pitch: '+10%', rate: '+2%' };
    case 'tsundere':
    case 'energetic':
    case 'cyber':
      return { voice: 'zh-TW-HsiaoChenNeural', pitch: '+8%', rate: '+5%' };
    case 'royal_sister':
    case 'queen':
    case 'seductive':
    case 'vampire':
      return { voice: 'zh-TW-HsiaoYuNeural', pitch: '+2%', rate: '-4%' };
    case 'gentle_wife':
    case 'healing':
    case 'maid':
      return { voice: 'zh-TW-HsiaoChenNeural', pitch: '+6%', rate: '-3%' };
    case 'classical':
    case 'mystic':
      return { voice: 'zh-TW-HsiaoYuNeural', pitch: '+4%', rate: '-3%' };
    default:
      // 默认：台湾甜心少女音（甜美软糯、语调轻柔上扬）
      return { voice: 'zh-TW-HsiaoChenNeural', pitch: '+7%', rate: '-1%' };
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

async function synthesizeAzureTaiwanTts(
  text: string,
  preset: TaiwanVoiceStylePreset,
): Promise<Buffer | null> {
  const key = process.env.AZURE_SPEECH_KEY?.trim();
  const region = process.env.AZURE_SPEECH_REGION?.trim() || 'eastasia';
  if (!key) return null;

  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-TW">` +
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
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length >= 256 ? buf : null;
}

export async function synthesizeTaiwanSweetSpeech(
  text: string,
  styleId?: string,
): Promise<{ audio: Buffer; accent: 'zh-TW' | 'zh-CN' }> {
  const preset = resolveTaiwanVoicePreset(styleId);

  // 1. 若配置了官方 Azure Speech 密钥，使用台湾甜美神经女声 HsiaoChenNeural / HsiaoYuNeural
  try {
    const azureBuf = await synthesizeAzureTaiwanTts(text, preset);
    if (azureBuf) return { audio: azureBuf, accent: 'zh-TW' };
  } catch {
    /* 降级到下一条线路 */
  }

  // 2. 台湾国语女声 (zh-TW)
  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=zh-TW&client=tw-ob&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(3500),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length >= 256) return { audio: buf, accent: 'zh-TW' };
    }
  } catch {
    /* 国内机房若无法直连 Google，自动降级 */
  }

  // 3. 国内机房兜底中文语音流
  const fallbackUrl = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&le=zh`;
  const res = await fetch(fallbackUrl, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    signal: AbortSignal.timeout(4500),
  });
  if (!res.ok) throw new Error(`TTS upstream ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 256) throw new Error('TTS empty payload');
  return { audio: buf, accent: 'zh-CN' };
}
