/**
 * 荷官艾莉丝专属「真人级甜美神经女声」语音引擎：
 * 1. 优先零延迟播放预置的微软 Neural 神经女声语音包（`public/assets/voices/` + 内存 AudioBuffer 缓存）：
 *    - 涵盖全部 14 套性格声线（台湾甜心晓臻、甜美偶像晓伊、温柔御姐晓晓、港风粤语晓佳、赌场女王晓雨等）、
 *      全部打赏答谢与麻将报牌语音，原生自然流畅、呼吸气口逼真，彻底告别机械机器人感与变调失真
 *    - 经过轻度棚录级人声润色链路（温暖低中频 + 丝滑高频空气感 + 柔顺动态压缩），甜美细腻不刺耳
 * 2. 动态台词实时调用服务端 `/api/tts`（已升级为微软 Edge Neural TTS v2 真人级神经语音 + 服务端缓存）
 * 3. 仅在完全断网或服务端不可达时，才安全降级到浏览器本地 `speechSynthesis`，绝不让机械本地音覆盖神经女声
 */

import { BASE_PATH } from './api';
import { audio } from './audio';
import { normalizeDealerVoiceText, resolveStaticDealerVoiceUrl } from './voice-manifest';

let cachedVoices: SpeechSynthesisVoice[] = [];
let activeUtterance: SpeechSynthesisUtterance | null = null;
let fallbackAudio: HTMLAudioElement | null = null;
let webAudioCtx: AudioContext | null = null;
let voiceBusInput: AudioNode | null = null;
let activeBufferSource: AudioBufferSourceNode | null = null;
let speakSeq = 0;

/** 已解码音频 LRU 缓存，覆盖全部麻将牌语音、荷官台词与百人场报点语音，实现真正 0ms 瞬时播报 */
const MAX_BUFFER_CACHE = 220;
const decodedAudioCache = new Map<string, AudioBuffer>();

function getCachedBuffer(key: string): AudioBuffer | null {
  const hit = decodedAudioCache.get(key);
  if (!hit) return null;
  // 刷新 LRU 顺序
  decodedAudioCache.delete(key);
  decodedAudioCache.set(key, hit);
  return hit;
}

function setCachedBuffer(key: string, buf: AudioBuffer): void {
  if (decodedAudioCache.has(key)) decodedAudioCache.delete(key);
  if (decodedAudioCache.size >= MAX_BUFFER_CACHE) {
    const oldest = decodedAudioCache.keys().next().value;
    if (oldest !== undefined) decodedAudioCache.delete(oldest);
  }
  decodedAudioCache.set(key, buf);
}

function ensureSpeechAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!webAudioCtx) {
      webAudioCtx = new Ctor();
      voiceBusInput = null;
    }
    if (webAudioCtx.state === 'suspended') {
      void webAudioCtx.resume();
    }
    return webAudioCtx;
  } catch {
    return null;
  }
}

/**
 * 构建轻度棚录级人声润色母线（绝不做破坏共振峰的变调，仅柔化频响与响度）：
 * High-pass 85Hz -> Warmth +1.2dB @250Hz -> Air/Sweetness +1.8dB @4.2kHz -> Soft Compressor -> Master Gain
 */
function getVoiceBus(ctx: AudioContext): AudioNode {
  if (voiceBusInput && voiceBusInput.context === ctx) return voiceBusInput;
  try {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 85;
    hp.Q.value = 0.7;

    const warmth = ctx.createBiquadFilter();
    warmth.type = 'peaking';
    warmth.frequency.value = 250;
    warmth.Q.value = 1.0;
    warmth.gain.value = 1.2;

    const air = ctx.createBiquadFilter();
    air.type = 'highshelf';
    air.frequency.value = 4200;
    air.gain.value = 1.8;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 18;
    comp.ratio.value = 3;
    comp.attack.value = 0.006;
    comp.release.value = 0.14;

    const master = ctx.createGain();
    master.gain.value = 1.08;

    hp.connect(warmth);
    warmth.connect(air);
    air.connect(comp);
    comp.connect(master);
    master.connect(ctx.destination);

    voiceBusInput = hp;
    return hp;
  } catch {
    return ctx.destination;
  }
}

function loadVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return [];
  try {
    const list = window.speechSynthesis.getVoices();
    if (list && list.length > 0) {
      cachedVoices = list;
    }
  } catch {
    /* ignore */
  }
  return cachedVoices;
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  loadVoices();
  try {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      loadVoices();
    });
  } catch {
    window.speechSynthesis.onvoiceschanged = () => {
      loadVoices();
    };
  }
}

function pickBestFallbackBrowserVoice(): SpeechSynthesisVoice | null {
  const voices = loadVoices();
  if (voices.length === 0) return null;
  const isMale = (v: SpeechSynthesisVoice) =>
    /yunjhe|yunxi|yunyang|yunze|kangkang|danny|zhiwei|male|男/i.test(v.name);
  const patterns = [
    /hsiaochen/i,
    /xiaoyi/i,
    /xiaoxiao/i,
    /hsiaoyu/i,
    /mei-?jia|美佳/i,
    /ting-?ting/i,
    /zh[-_]tw/i,
    /zh[-_]cn/i,
  ];
  for (const p of patterns) {
    const hit = voices.find((v) => !isMale(v) && (p.test(v.name) || p.test(v.lang)));
    if (hit) return hit;
  }
  return null;
}

export function stopDealerSpeech(): void {
  speakSeq += 1;
  if (activeBufferSource) {
    try {
      activeBufferSource.stop();
      activeBufferSource.disconnect();
    } catch {
      /* ignore */
    }
    activeBufferSource = null;
  }
  if (fallbackAudio) {
    try {
      fallbackAudio.pause();
      fallbackAudio.currentTime = 0;
    } catch {
      /* ignore */
    }
    fallbackAudio = null;
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
  }
  activeUtterance = null;
}

function playDecodedBuffer(
  ctx: AudioContext,
  audioBuf: AudioBuffer,
  seq: number,
  isLegacyEngine: boolean,
): Promise<void> {
  if (seq !== speakSeq) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;
    // 神经语音保持 100% 原生音高与语速（零变调失真）；仅兜底旧引擎微调 +45 cents
    if (isLegacyEngine) {
      src.detune.value = 45;
      src.playbackRate.value = 1.01;
    } else {
      src.detune.value = 0;
      src.playbackRate.value = 1.0;
    }

    const bus = getVoiceBus(ctx);
    src.connect(bus);
    activeBufferSource = src;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (activeBufferSource === src) activeBufferSource = null;
      resolve();
    };
    const safetyMs = Math.max(900, Math.ceil((audioBuf.duration || 2) * 1000) + 500);
    const guard = window.setTimeout(finish, safetyMs);
    src.onended = () => {
      window.clearTimeout(guard);
      finish();
    };
    try {
      src.start(0);
    } catch {
      window.clearTimeout(guard);
      finish();
    }
  });
}

async function fetchAndPlayMp3(
  url: string,
  cacheKey: string,
  seq: number,
  ctx: AudioContext | null,
  assumeNeural: boolean,
): Promise<boolean> {
  if (seq !== speakSeq) return false;

  // 1. 内存缓存命中：0ms 立即播放并等待播完
  if (ctx) {
    const cached = getCachedBuffer(cacheKey);
    if (cached) {
      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch {
          /* ignore */
        }
      }
      if (seq !== speakSeq) return true;
      await playDecodedBuffer(ctx, cached, seq, false);
      return true;
    }
  }

  try {
    const res = await fetch(url);
    if (!res.ok || seq !== speakSeq) return false;

    const engineHeader = res.headers.get('x-tts-engine');
    const isLegacy = !assumeNeural && engineHeader === 'legacy';
    const arrayBuf = await res.arrayBuffer();
    if (seq !== speakSeq || arrayBuf.byteLength < 256) return false;

    if (ctx) {
      try {
        if (ctx.state === 'suspended') await ctx.resume();
        const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
        if (seq !== speakSeq) return true;
        if (!isLegacy) setCachedBuffer(cacheKey, audioBuf);
        await playDecodedBuffer(ctx, audioBuf, seq, isLegacy);
        return true;
      } catch {
        /* decodeAudioData 异常时降级到 HTMLAudioElement */
      }
    }

    const blobUrl = URL.createObjectURL(new Blob([arrayBuf], { type: 'audio/mpeg' }));
    const el = new Audio(blobUrl);
    el.volume = 0.96;
    el.playbackRate = 1.0;
    fallbackAudio = el;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        URL.revokeObjectURL(blobUrl);
        if (fallbackAudio === el) fallbackAudio = null;
      };
      el.onended = () => {
        cleanup();
        resolve();
      };
      el.onerror = () => {
        cleanup();
        reject(new Error('audio element error'));
      };
      void el.play().catch((err) => {
        cleanup();
        reject(err);
      });
    });
    return true;
  } catch {
    return false;
  }
}

function speakOfflineFallback(cleanText: string, seq: number): Promise<void> {
  if (seq !== speakSeq) return Promise.resolve();
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    try {
      const synth = window.speechSynthesis;
      if (synth.paused) synth.resume();
      const utter = new SpeechSynthesisUtterance(cleanText);
      const voice = pickBestFallbackBrowserVoice();
      if (voice) {
        utter.voice = voice;
        utter.lang = voice.lang;
      } else {
        utter.lang = 'zh-TW';
      }
      utter.pitch = 1.06;
      utter.rate = 0.98;
      utter.volume = 0.95;
      const done = () => {
        if (activeUtterance === utter) activeUtterance = null;
        resolve();
      };
      utter.onend = done;
      utter.onerror = done;
      activeUtterance = utter;
      (window as unknown as { __ccActiveUtterance?: SpeechSynthesisUtterance }).__ccActiveUtterance = utter;
      synth.speak(utter);
    } catch {
      resolve();
    }
  });
}

async function playSingleText(
  rawText: string,
  voiceStyleId: string,
  seq: number,
  ctx: AudioContext | null,
): Promise<void> {
  const cleanText = normalizeDealerVoiceText(rawText);
  if (!cleanText || seq !== speakSeq) return;

  const staticRelUrl = resolveStaticDealerVoiceUrl(voiceStyleId, cleanText);
  if (staticRelUrl) {
    const staticUrl = `${BASE_PATH}${staticRelUrl}`;
    const ok = await fetchAndPlayMp3(staticUrl, `static:${staticRelUrl}`, seq, ctx, true);
    if (ok || seq !== speakSeq) return;
  }

  const apiUrl = `${BASE_PATH}/api/tts?text=${encodeURIComponent(cleanText.slice(0, 100))}&style=${encodeURIComponent(voiceStyleId)}`;
  const ok = await fetchAndPlayMp3(apiUrl, `api:${voiceStyleId}:${cleanText}`, seq, ctx, false);
  if (ok || seq !== speakSeq) return;

  await speakOfflineFallback(cleanText, seq);
}

/**
 * 播报荷官真人级甜美神经语音：
 * - 优先零延迟播放预置微软 Neural 神经女声静态语音包
 * - 未命中预置包时无缝请求服务端 `/api/tts` 实时微软 Neural 神经合成
 * - 仅完全断网/服务端异常时兜底浏览器本地朗读
 */
export function speakDealerQuote(rawText: string, voiceStyleId = 'classic'): void {
  if (typeof window === 'undefined') return;
  audio.unlock();
  const ctx = ensureSpeechAudioContext();
  if (!normalizeDealerVoiceText(rawText)) return;

  stopDealerSpeech();
  const seq = ++speakSeq;
  void playSingleText(rawText, voiceStyleId, seq, ctx);
}

export interface SpeechSequenceStep {
  text?: string;
  onStart?: () => void;
  delayAfterMs?: number;
}

/**
 * 依次串行播报多条荷官语音并同步触发画面翻牌/开盅回调（前一句播完再播下一句，绝不重叠卡断）：
 * - 返回 cancel() 清理函数，切局或离桌时立即中止
 * - 静音模式下自动按节奏推进 onStart，确保视觉开牌动画不受影响
 */
export function speakDealerSequence(
  steps: SpeechSequenceStep[],
  options: { voiceStyleId?: string; gapMs?: number; mutedStepMs?: number } = {},
): () => void {
  if (typeof window === 'undefined' || steps.length === 0) return () => {};
  const { voiceStyleId = 'classic', gapMs = 200, mutedStepMs = 850 } = options;
  audio.unlock();
  const ctx = ensureSpeechAudioContext();

  stopDealerSpeech();
  const seq = ++speakSeq;
  let cancelled = false;
  let waitTimer: number | null = null;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (ms <= 0 || cancelled || seq !== speakSeq) {
        resolve();
        return;
      }
      waitTimer = window.setTimeout(() => {
        waitTimer = null;
        resolve();
      }, ms);
    });

  void (async () => {
    for (let i = 0; i < steps.length; i += 1) {
      if (cancelled || seq !== speakSeq) return;
      const step = steps[i]!;
      step.onStart?.();
      if (step.text && audio.sfxOn) {
        await playSingleText(step.text, voiceStyleId, seq, ctx);
      } else if (step.text) {
        await sleep(mutedStepMs);
      }
      if (cancelled || seq !== speakSeq) return;
      const pause = step.delayAfterMs ?? (i < steps.length - 1 ? gapMs : 0);
      if (pause > 0) await sleep(pause);
    }
  })();

  return () => {
    cancelled = true;
    if (waitTimer !== null) {
      window.clearTimeout(waitTimer);
      waitTimer = null;
    }
    if (seq === speakSeq) stopDealerSpeech();
  };
}

const CN_DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
export function cnPointText(n: number): string {
  if (n <= 9) return CN_DIGIT[n] ?? String(n);
  if (n === 10) return '十';
  if (n < 20) return `十${CN_DIGIT[n - 10] ?? ''}`;
  if (n === 20) return '二十';
  return `二十${CN_DIGIT[n - 20] ?? ''}`;
}
