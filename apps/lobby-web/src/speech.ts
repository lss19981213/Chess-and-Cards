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

/** 已解码音频 LRU 缓存，重复点击/报牌实现真正的 0ms 瞬时响应 */
const MAX_BUFFER_CACHE = 64;
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
): void {
  if (seq !== speakSeq) return;
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
  src.onended = () => {
    if (activeBufferSource === src) activeBufferSource = null;
  };
  src.start(0);
}

async function fetchAndPlayMp3(
  url: string,
  cacheKey: string,
  seq: number,
  ctx: AudioContext | null,
  assumeNeural: boolean,
): Promise<boolean> {
  if (seq !== speakSeq) return false;

  // 1. 内存缓存命中：0ms 立即播放
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
      playDecodedBuffer(ctx, cached, seq, false);
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
        playDecodedBuffer(ctx, audioBuf, seq, isLegacy);
        return true;
      } catch {
        /* decodeAudioData 异常时降级到 HTMLAudioElement */
      }
    }

    const blobUrl = URL.createObjectURL(new Blob([arrayBuf], { type: 'audio/mpeg' }));
    const el = new Audio(blobUrl);
    el.volume = 0.96;
    el.playbackRate = 1.0;
    el.onended = () => {
      URL.revokeObjectURL(blobUrl);
      if (fallbackAudio === el) fallbackAudio = null;
    };
    el.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      if (fallbackAudio === el) fallbackAudio = null;
    };
    fallbackAudio = el;
    await el.play();
    return true;
  } catch {
    return false;
  }
}

function speakOfflineFallback(cleanText: string, seq: number): void {
  if (seq !== speakSeq) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    return;
  }
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
    // 柔和微调，避免尖锐机器人感
    utter.pitch = 1.06;
    utter.rate = 0.98;
    utter.volume = 0.95;
    utter.onend = () => {
      if (activeUtterance === utter) activeUtterance = null;
    };
    utter.onerror = () => {
      if (activeUtterance === utter) activeUtterance = null;
    };
    activeUtterance = utter;
    (window as unknown as { __ccActiveUtterance?: SpeechSynthesisUtterance }).__ccActiveUtterance = utter;
    synth.speak(utter);
  } catch {
    /* ignore */
  }
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

  const cleanText = normalizeDealerVoiceText(rawText);
  if (!cleanText) return;

  stopDealerSpeech();
  const seq = ++speakSeq;

  void (async () => {
    // 1. 优先命中预置真人级神经语音包（零延迟、原声自然甜美、绝无机械感）
    const staticRelUrl = resolveStaticDealerVoiceUrl(voiceStyleId, cleanText);
    if (staticRelUrl) {
      const staticUrl = `${BASE_PATH}${staticRelUrl}`;
      const ok = await fetchAndPlayMp3(staticUrl, `static:${staticRelUrl}`, seq, ctx, true);
      if (ok || seq !== speakSeq) return;
    }

    // 2. 动态台词走服务端微软 Edge Neural TTS v2
    const apiUrl = `${BASE_PATH}/api/tts?text=${encodeURIComponent(cleanText.slice(0, 100))}&style=${encodeURIComponent(voiceStyleId)}`;
    const ok = await fetchAndPlayMp3(apiUrl, `api:${voiceStyleId}:${cleanText}`, seq, ctx, false);
    if (ok || seq !== speakSeq) return;

    // 3. 最终离线兜底
    speakOfflineFallback(cleanText, seq);
  })();
}
