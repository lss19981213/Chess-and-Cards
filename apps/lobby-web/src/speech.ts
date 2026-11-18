/**
 * 荷官艾莉丝专属「台湾甜美女声」语音引擎：
 * 1. 优先匹配浏览器内置台湾甜美神经女声（Microsoft HsiaoChen 晓臻 / HsiaoYu 晓雨 / macOS Meijia 美佳 / Google 國語（臺灣） / Yating / HanHan）
 * 2. 若本机缺失台湾甜美声线（例如仅装了机械音 Huihui），优先拉取服务端 `/api/tts` 台湾国语甜美音频流，并可柔和微提音调呈现清甜软糯感
 * 3. 自动降级与看门狗兜底：任何环境下都确保 100% 流畅发声，永不卡顿或静音
 * 4. 清理颜文字/Emoji，并保留温柔可爱的台湾腔语助词停顿
 */

import { DEALER_VOICES } from '@cc/protocol';
import { BASE_PATH } from './api';
import { audio } from './audio';

let cachedVoices: SpeechSynthesisVoice[] = [];
let activeUtterance: SpeechSynthesisUtterance | null = null;
let fallbackAudio: HTMLAudioElement | null = null;
let speakSeq = 0;
let pendingTimer: number | null = null;
let watchdogTimer: number | null = null;

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

  // 排除男声（YunJhe / Yunxi / Yunyang / Kangkang / Danny 等）
  const isMale = (v: SpeechSynthesisVoice) =>
    /yunjhe|yunxi|yunyang|yunze|kangkang|danny|zhiwei|male|男/i.test(v.name);

  // 1. 顶级台湾甜美女声（Edge Natural 晓臻/晓雨、macOS 美佳、Google 國語臺灣、Windows 雅婷/涵涵）
  const taiwanPatterns = [
    /hsiaochen/i, // Microsoft HsiaoChen Online (Natural) - 台湾超甜少女音
    /hsiaoyu/i, // Microsoft HsiaoYu Online (Natural) - 台湾温柔甜美女声
    /mei-?jia|美佳/i, // Apple macOS/iOS 台湾甜美女声
    /google\s*(國語|国语).*?(臺灣|台湾|taiwan)/i, // Chrome 台湾国语女声
    /yating|雅婷/i, // Windows 台湾女声
    /hanhan|涵涵/i, // Windows 台湾女声
    /zh[-_]tw/i, // 任意 zh-TW 女声
  ];

  for (const pattern of taiwanPatterns) {
    const hit = voices.find(
      (v) => !isMale(v) && (pattern.test(v.name) || pattern.test(v.lang)),
    );
    if (hit) return { voice: hit, isTaiwan: true };
  }

  // 2. 次选自然甜美中文女声（Edge Xiaoxiao / Xiaoyi 晓伊，比机械音甜美得多）
  const sweetNeuralZh = [/xiaoyi/i, /xiaoxiao/i, /ting-?ting/i, /yaoyao/i, /huihui/i, /zh[-_]cn/i];
  for (const pattern of sweetNeuralZh) {
    const hit = voices.find(
      (v) => !isMale(v) && (pattern.test(v.name) || pattern.test(v.lang)),
    );
    if (hit) return { voice: hit, isTaiwan: false };
  }

  return null;
}

/** 清理颜文字、Emoji 和奇怪符号，保留自然中文标点，避免 TTS 卡死或读出怪字 */
function sanitizeSpeechText(raw: string): string {
  return raw
    .replace(/\([^)]*∇[^)]*\)/g, '')
    .replace(/[“”"'`~～♡♥✨💖🎉🎁🎲🃏♠️♣️♥️♦️🎰👑🔥⚡💪🥰💕🤖👁️🪑🀄🌶️🐎]/g, '')
    .replace(/…+/g, '，')
    .replace(/\.{2,}/g, '，')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 将各风格语音调教为更软糯、偏高、清甜的台湾女生声线参数 */
function getTaiwanSweetVoiceConfig(voiceStyleId?: string): { pitch: number; rate: number } {
  const meta = DEALER_VOICES.find((v) => v.id === voiceStyleId);
  const basePitch = meta?.voiceConfig?.pitch ?? 1.18;
  const baseRate = meta?.voiceConfig?.rate ?? 0.98;
  return {
    // 适度抬高甜度音高并放缓一点语速，听起来更软糯甜美
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

function playServerTaiwanTts(
  cleanText: string,
  voiceStyleId: string,
  rate: number,
  seq: number,
  onFail?: () => void,
): void {
  if (seq !== speakSeq || !cleanText) return;
  try {
    const url = `${BASE_PATH}/api/tts?text=${encodeURIComponent(cleanText.slice(0, 100))}&style=${encodeURIComponent(voiceStyleId)}`;
    const el = new Audio(url);
    el.volume = 0.96;
    // 柔和提亮音色与语速，听感更加清甜温柔
    el.playbackRate = Math.min(1.14, Math.max(0.95, rate * 1.04));
    const elAny = el as HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
    if (typeof elAny.preservesPitch === 'boolean') elAny.preservesPitch = false;
    if (typeof elAny.webkitPreservesPitch === 'boolean') elAny.webkitPreservesPitch = false;

    let handledFail = false;
    const failOnce = () => {
      if (handledFail || seq !== speakSeq) return;
      handledFail = true;
      if (fallbackAudio === el) fallbackAudio = null;
      onFail?.();
    };

    el.onerror = failOnce;
    fallbackAudio = el;
    void el.play().catch(failOnce);
  } catch {
    onFail?.();
  }
}

function speakWithBrowserSynthesis(
  cleanText: string,
  picked: { voice: SpeechSynthesisVoice; isTaiwan: boolean } | null,
  pitch: number,
  rate: number,
  voiceStyleId: string,
  seq: number,
  allowServerFallback: boolean,
): void {
  if (seq !== speakSeq) return;
  try {
    const synth = window.speechSynthesis;
    if (synth.paused) synth.resume();

    const utter = new SpeechSynthesisUtterance(cleanText);
    utter.lang = picked?.isTaiwan ? picked.voice.lang : 'zh-TW';
    if (picked?.voice) utter.voice = picked.voice;
    // 如果是原生台湾声线用柔和甜美音高，否则略微提甜
    const finalPitch = picked?.isTaiwan ? pitch : Math.min(1.5, pitch + 0.1);
    utter.pitch = Math.min(2.0, Math.max(0.8, finalPitch));
    utter.rate = Math.min(1.3, Math.max(0.82, rate));
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
      playServerTaiwanTts(cleanText, voiceStyleId, rate, seq);
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
      }, 850);
    }
  } catch {
    if (allowServerFallback) {
      playServerTaiwanTts(cleanText, voiceStyleId, rate, seq);
    }
  }
}

/**
 * 播报荷官台湾甜美语音台词：
 * - 若浏览器自带台湾甜美神经女声（如 Edge 晓臻 HsiaoChen / 晓雨 HsiaoYu / macOS 美佳 / Google 臺灣國語），直接零延迟甜美播报
 * - 若浏览器仅有大陆机械音（如 Huihui），优先播放服务端 `/api/tts` 台湾国语甜美音频流，失败时自动兜底本地 TTS
 */
export function speakDealerQuote(rawText: string, voiceStyleId = 'classic'): void {
  if (typeof window === 'undefined') return;
  audio.unlock();

  const cleanText = sanitizeSpeechText(rawText);
  if (!cleanText) return;

  stopDealerSpeech();
  const seq = ++speakSeq;
  const { pitch, rate } = getTaiwanSweetVoiceConfig(voiceStyleId);

  const hasSpeechApi = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  const picked = hasSpeechApi ? pickTaiwanSweetVoice() : null;

  // 1. 浏览器原生已有真正台湾甜美女声（Edge HsiaoChen / HsiaoYu / macOS Meijia / Google 臺灣）→ 优先使用
  if (hasSpeechApi && picked?.isTaiwan) {
    pendingTimer = window.setTimeout(() => {
      pendingTimer = null;
      speakWithBrowserSynthesis(cleanText, picked, pitch, rate, voiceStyleId, seq, true);
    }, 60);
    return;
  }

  // 2. 否则优先走服务端台湾甜美语音流（失败时无缝兜底本地语音合成）
  playServerTaiwanTts(cleanText, voiceStyleId, rate, seq, () => {
    if (!hasSpeechApi || seq !== speakSeq) return;
    pendingTimer = window.setTimeout(() => {
      pendingTimer = null;
      speakWithBrowserSynthesis(cleanText, picked, pitch, rate, voiceStyleId, seq, false);
    }, 60);
  });
}
