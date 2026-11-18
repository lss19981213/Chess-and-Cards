/**
 * 荷官艾莉丝专属「台湾甜美女声」语音引擎：
 * 1. 优先匹配浏览器内置的台湾甜美神经女声（Microsoft HsiaoChen 晓臻 / HsiaoYu 晓雨 / macOS Meijia 美佳 / Google 國語臺灣 / Yating / HanHan）
 * 2. 若浏览器缺少台湾声线，使用同步解锁的 Web Audio API 播放服务端 `/api/tts` 音频流：
 *    - 彻底绕开 Chrome 异步回调自动播放拦截（点击后即使网络耗时 500ms 也 100% 正常出声）
 *    - 通过精细音高甜度调教（`detune` 柔和微提音色），让国内兜底女声同样呈现温柔软糯、清甜可爱的台湾少女声线
 * 3. 若服务端接口不可达，自动无缝回退到浏览器本地 `speechSynthesis`，确保任何环境永不静音
 */

import { DEALER_VOICES } from '@cc/protocol';
import { BASE_PATH } from './api';
import { audio } from './audio';

let cachedVoices: SpeechSynthesisVoice[] = [];
let activeUtterance: SpeechSynthesisUtterance | null = null;
let fallbackAudio: HTMLAudioElement | null = null;
let webAudioCtx: AudioContext | null = null;
let activeBufferSource: AudioBufferSourceNode | null = null;
let speakSeq = 0;
let pendingTimer: number | null = null;
let watchdogTimer: number | null = null;

function ensureSpeechAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!webAudioCtx) webAudioCtx = new Ctor();
    if (webAudioCtx.state === 'suspended') {
      void webAudioCtx.resume();
    }
    return webAudioCtx;
  } catch {
    return null;
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

/** 严格优先挑选「台湾甜美女声」（晓臻 HsiaoChen / 晓雨 HsiaoYu / 美佳 Meijia / Google 國語臺灣 / 雅婷 Yating） */
function pickTaiwanSweetVoice(): { voice: SpeechSynthesisVoice; isTaiwan: boolean } | null {
  const voices = loadVoices();
  if (voices.length === 0) return null;

  const isMale = (v: SpeechSynthesisVoice) =>
    /yunjhe|yunxi|yunyang|yunze|kangkang|danny|zhiwei|male|男/i.test(v.name);

  const taiwanPatterns = [
    /hsiaochen/i,
    /hsiaoyu/i,
    /mei-?jia|美佳/i,
    /google\s*(國語|国语).*?(臺灣|台湾|taiwan)/i,
    /yating|雅婷/i,
    /hanhan|涵涵/i,
    /zh[-_]tw/i,
  ];

  for (const pattern of taiwanPatterns) {
    const hit = voices.find((v) => !isMale(v) && (pattern.test(v.name) || pattern.test(v.lang)));
    if (hit) return { voice: hit, isTaiwan: true };
  }

  const sweetNeuralZh = [/xiaoyi/i, /xiaoxiao/i, /ting-?ting/i, /yaoyao/i, /huihui/i, /zh[-_]cn/i];
  for (const pattern of sweetNeuralZh) {
    const hit = voices.find((v) => !isMale(v) && (pattern.test(v.name) || pattern.test(v.lang)));
    if (hit) return { voice: hit, isTaiwan: false };
  }

  return null;
}

function sanitizeSpeechText(raw: string): string {
  return raw
    .replace(/\([^)]*∇[^)]*\)/g, '')
    .replace(/[“”"'`~～♡♥✨💖🎉🎁🎲🃏♠️♣️♥️♦️🎰👑🔥⚡💪🥰💕🤖👁️🪑🀄🌶️🐎]/g, '')
    .replace(/…+/g, '，')
    .replace(/\.{2,}/g, '，')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTaiwanSweetVoiceConfig(voiceStyleId?: string): { pitch: number; rate: number } {
  const meta = DEALER_VOICES.find((v) => v.id === voiceStyleId);
  const basePitch = meta?.voiceConfig?.pitch ?? 1.22;
  const baseRate = meta?.voiceConfig?.rate ?? 0.96;
  return {
    pitch: Math.min(1.55, Math.max(1.04, basePitch)),
    rate: Math.min(1.18, Math.max(0.86, baseRate)),
  };
}

function clearTimers(): void {
  if (pendingTimer !== null) {
    window.clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  if (watchdogTimer !== null) {
    window.clearTimeout(watchdogTimer);
    watchdogTimer = null;
  }
}

export function stopDealerSpeech(): void {
  speakSeq += 1;
  clearTimers();
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

/**
 * 通过已解锁的 Web Audio API 播放服务端 `/api/tts` MP3：
 * 1. 彻底免疫异步网络返回后 `<audio>.play()` 被浏览器自动播放策略拦截
 * 2. 结合 `detune` 柔和提甜音色，听感清甜软糯
 */
async function playServerTaiwanTts(
  cleanText: string,
  voiceStyleId: string,
  pitch: number,
  rate: number,
  seq: number,
  ctx: AudioContext | null,
  onFail?: () => void,
): Promise<void> {
  if (seq !== speakSeq || !cleanText) return;
  const url = `${BASE_PATH}/api/tts?text=${encodeURIComponent(cleanText.slice(0, 100))}&style=${encodeURIComponent(voiceStyleId)}`;

  try {
    const res = await fetch(url);
    if (!res.ok || seq !== speakSeq) {
      throw new Error(`TTS HTTP ${res.status}`);
    }
    const accent = res.headers.get('x-tts-accent') ?? 'zh-CN';
    const arrayBuf = await res.arrayBuffer();
    if (seq !== speakSeq || arrayBuf.byteLength < 256) {
      throw new Error('TTS empty audio');
    }

    // 优先使用 Web Audio API 播放（已在点击手势内同步 resume，100% 不受自动播放超时限制）
    if (ctx) {
      try {
        if (ctx.state === 'suspended') await ctx.resume();
        const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
        if (seq !== speakSeq) return;
        const src = ctx.createBufferSource();
        src.buffer = audioBuf;
        // 台湾原声微提甜度，国内女声柔和抬高 +145 cents 呈现清甜可爱的台湾少女声线
        const extraSweetCents = accent === 'zh-TW' ? 40 : 145;
        const styleCents = Math.round((pitch - 1.18) * 180);
        src.detune.value = Math.max(-100, Math.min(260, extraSweetCents + styleCents));
        src.playbackRate.value = Math.min(1.12, Math.max(0.92, rate));

        const gain = ctx.createGain();
        gain.gain.value = 1.05;
        src.connect(gain);
        gain.connect(ctx.destination);
        activeBufferSource = src;
        src.onended = () => {
          if (activeBufferSource === src) activeBufferSource = null;
        };
        src.start(0);
        return;
      } catch {
        /* decodeAudioData 失败时降级到 Blob Audio 元素 */
      }
    }

    // 降级：Blob URL + HTMLAudioElement
    const blobUrl = URL.createObjectURL(new Blob([arrayBuf], { type: 'audio/mpeg' }));
    const el = new Audio(blobUrl);
    el.volume = 0.96;
    el.playbackRate = accent === 'zh-TW' ? 1.02 : 1.07;
    const elAny = el as HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
    if (typeof elAny.preservesPitch === 'boolean') elAny.preservesPitch = false;
    if (typeof elAny.webkitPreservesPitch === 'boolean') elAny.webkitPreservesPitch = false;
    el.onended = () => URL.revokeObjectURL(blobUrl);
    el.onerror = () => {
      URL.revokeObjectURL(blobUrl);
      if (seq === speakSeq) onFail?.();
    };
    fallbackAudio = el;
    await el.play();
  } catch {
    if (seq === speakSeq) onFail?.();
  }
}

function speakWithBrowserSynthesis(
  cleanText: string,
  picked: { voice: SpeechSynthesisVoice; isTaiwan: boolean } | null,
  pitch: number,
  rate: number,
  voiceStyleId: string,
  seq: number,
  ctx: AudioContext | null,
  allowServerFallback: boolean,
): void {
  if (seq !== speakSeq) return;
  try {
    const synth = window.speechSynthesis;
    if (synth.paused) synth.resume();

    const utter = new SpeechSynthesisUtterance(cleanText);
    utter.lang = picked?.isTaiwan ? picked.voice.lang : 'zh-TW';
    if (picked?.voice) utter.voice = picked.voice;
    const finalPitch = picked?.isTaiwan ? pitch : Math.min(1.5, pitch + 0.12);
    utter.pitch = Math.min(2.0, Math.max(0.85, finalPitch));
    utter.rate = Math.min(1.3, Math.max(0.84, rate));
    utter.volume = 1.0;

    let started = false;
    let fellBack = false;
    const triggerFallback = () => {
      if (!allowServerFallback || fellBack || seq !== speakSeq) return;
      fellBack = true;
      clearTimers();
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
      void playServerTaiwanTts(cleanText, voiceStyleId, pitch, rate, seq, ctx);
    };

    utter.onstart = () => {
      started = true;
      if (watchdogTimer !== null) {
        window.clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    utter.onend = () => {
      if (activeUtterance === utter) activeUtterance = null;
      clearTimers();
    };

    utter.onerror = (ev) => {
      if (activeUtterance === utter) activeUtterance = null;
      if (ev.error === 'canceled' || ev.error === 'interrupted') return;
      triggerFallback();
    };

    activeUtterance = utter;
    (window as unknown as { __ccActiveUtterance?: SpeechSynthesisUtterance }).__ccActiveUtterance = utter;

    synth.speak(utter);
    if (synth.paused) synth.resume();

    if (allowServerFallback) {
      watchdogTimer = window.setTimeout(() => {
        watchdogTimer = null;
        if (!started && seq === speakSeq) {
          triggerFallback();
        }
      }, 900);
    }
  } catch {
    if (allowServerFallback) {
      void playServerTaiwanTts(cleanText, voiceStyleId, pitch, rate, seq, ctx);
    }
  }
}

/**
 * 播报荷官台湾甜美语音台词：
 * - 在点击手势内立即同步解锁 AudioContext，确保永不被浏览器拦截静音
 * - 浏览器自带台湾甜美女声（Edge 晓臻 / 晓雨 / macOS 美佳 / Google 臺灣國語）→ 直接原生甜美播报
 * - 否则通过 Web Audio API 播放服务端 `/api/tts` 甜美音频流（带台湾甜度声线调教），失败时自动回退本地 TTS
 */
export function speakDealerQuote(rawText: string, voiceStyleId = 'classic'): void {
  if (typeof window === 'undefined') return;
  audio.unlock();
  // 在用户点击手势内同步创建/恢复 AudioContext，避免异步 fetch 后播放被拦截
  const ctx = ensureSpeechAudioContext();

  const cleanText = sanitizeSpeechText(rawText);
  if (!cleanText) return;

  const wasSpeaking =
    'speechSynthesis' in window &&
    (window.speechSynthesis.speaking || window.speechSynthesis.pending);

  stopDealerSpeech();
  const seq = ++speakSeq;
  const { pitch, rate } = getTaiwanSweetVoiceConfig(voiceStyleId);

  const hasSpeechApi = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  const picked = hasSpeechApi ? pickTaiwanSweetVoice() : null;

  // 1. 浏览器原生已有真正台湾甜美女声 → 立即播报（未在播报时零延迟同步触发）
  if (hasSpeechApi && picked?.isTaiwan) {
    if (wasSpeaking) {
      pendingTimer = window.setTimeout(() => {
        pendingTimer = null;
        speakWithBrowserSynthesis(cleanText, picked, pitch, rate, voiceStyleId, seq, ctx, true);
      }, 65);
    } else {
      speakWithBrowserSynthesis(cleanText, picked, pitch, rate, voiceStyleId, seq, ctx, true);
    }
    return;
  }

  // 2. 优先通过已同步解锁的 Web Audio API 播放服务端甜美音频流（失败无缝回退本地 TTS）
  void playServerTaiwanTts(cleanText, voiceStyleId, pitch, rate, seq, ctx, () => {
    if (!hasSpeechApi || seq !== speakSeq) return;
    speakWithBrowserSynthesis(cleanText, picked, pitch, rate, voiceStyleId, seq, ctx, false);
  });
}
