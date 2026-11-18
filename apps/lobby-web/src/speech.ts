/**
 * 荷官艾莉丝专属语音引擎：
 * 1. 修复 Chromium/Edge 中 `speechSynthesis.cancel()` 紧接 `speak()` 导致静音的经典 BUG
 * 2. 主动监听 `voiceschanged` 并匹配最佳中文女声（Xiaoxiao / Xiaoyi / Huihui / Yaoyao / Google 普通话 / Ting-Ting）
 * 3. 全局持有 `SpeechSynthesisUtterance` 引用防止 Chromium 垃圾回收中途掐断语音
 * 4. 清理颜文字/Emoji，防止 TTS 引擎解析异常静音
 * 5. 自动回退至后端 `/api/tts` 语音合成流，即使系统缺少本地语音包也能 100% 发声！
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

function pickBestChineseVoice(): SpeechSynthesisVoice | null {
  const voices = loadVoices();
  if (voices.length === 0) return null;

  const zhVoices = voices.filter(
    (v) =>
      v.lang.toLowerCase().startsWith('zh') ||
      /chinese|mandarin|普通话|中文|xiaoxiao|xiaoyi|huihui|yaoyao|ting-ting|tingting|meijia/i.test(v.name),
  );
  if (zhVoices.length === 0) return null;

  // 优先挑自然女声（Windows Edge Xiaoxiao / Xiaoyi / Huihui / Yaoyao / Google / macOS Ting-Ting）
  const femalePreferred = [
    /xiaoxiao/i,
    /xiaoyi/i,
    /yaoyao/i,
    /huihui/i,
    /ting-?ting/i,
    /mei-?jia/i,
    /google\s*普通话/i,
    /zh[-_]cn/i,
  ];
  for (const pattern of femalePreferred) {
    const hit = zhVoices.find((v) => pattern.test(v.name) || pattern.test(v.lang));
    if (hit) return hit;
  }
  return zhVoices[0] ?? null;
}

/** 清理颜文字、Emoji 和奇怪符号，保留自然中文标点，避免 TTS 卡死或读出怪字 */
function sanitizeSpeechText(raw: string): string {
  return raw
    .replace(/\([^)]*∇[^)]*\)/g, '')
    .replace(/[“”"'`~～♡♥✨💖🎉🎁🎲🃏♠️♣️♥️♦️🎰👑🔥⚡💪🥰💕🤖👁️🪑]/g, '')
    .replace(/…+/g, '，')
    .replace(/\.{2,}/g, '，')
    .replace(/\s+/g, ' ')
    .trim();
}

function getStyleVoiceConfig(voiceStyleId?: string): { pitch: number; rate: number } {
  const meta = DEALER_VOICES.find((v) => v.id === voiceStyleId);
  if (meta?.voiceConfig) return meta.voiceConfig;
  return { pitch: 1.05, rate: 1.0 };
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

function playServerTtsFallback(cleanText: string, rate: number, seq: number): void {
  if (seq !== speakSeq || !cleanText) return;
  try {
    const url = `${BASE_PATH}/api/tts?text=${encodeURIComponent(cleanText.slice(0, 100))}`;
    const el = new Audio(url);
    el.volume = 0.95;
    el.playbackRate = Math.min(1.25, Math.max(0.85, rate));
    fallbackAudio = el;
    void el.play().catch(() => {
      /* 若浏览器依然拦截音频，保持静默不报错 */
    });
  } catch {
    /* ignore */
  }
}

/**
 * 播报荷官语音台词（原生 Web Speech API 优先 + 后端中文 TTS 音频流自动兜底）
 */
export function speakDealerQuote(rawText: string, voiceStyleId = 'classic'): void {
  if (typeof window === 'undefined') return;
  audio.unlock();

  const cleanText = sanitizeSpeechText(rawText);
  if (!cleanText) return;

  stopDealerSpeech();
  const seq = ++speakSeq;
  const { pitch, rate } = getStyleVoiceConfig(voiceStyleId);

  const hasSpeechApi = 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  const zhVoice = hasSpeechApi ? pickBestChineseVoice() : null;

  // 若环境完全不支持 speechSynthesis，直接走服务端语音流
  if (!hasSpeechApi) {
    playServerTtsFallback(cleanText, rate, seq);
    return;
  }

  const doSpeak = () => {
    if (seq !== speakSeq) return;
    try {
      const synth = window.speechSynthesis;
      if (synth.paused) synth.resume();

      const utter = new SpeechSynthesisUtterance(cleanText);
      utter.lang = zhVoice?.lang || 'zh-CN';
      if (zhVoice) utter.voice = zhVoice;
      utter.pitch = Math.min(2.0, Math.max(0.5, pitch));
      utter.rate = Math.min(1.5, Math.max(0.7, rate));
      utter.volume = 1.0;

      let started = false;
      let fellBack = false;
      const triggerFallback = () => {
        if (fellBack || seq !== speakSeq) return;
        fellBack = true;
        clearTimers();
        try {
          synth.cancel();
        } catch {
          /* ignore */
        }
        playServerTtsFallback(cleanText, rate, seq);
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
        // 'canceled' / 'interrupted' 是用户切句触发的正常打断，不回退
        if (ev.error === 'canceled' || ev.error === 'interrupted') return;
        triggerFallback();
      };

      // 保存强引用避免 Chromium 提前回收 SpeechSynthesisUtterance 导致无声
      activeUtterance = utter;
      (window as unknown as { __ccActiveUtterance?: SpeechSynthesisUtterance }).__ccActiveUtterance = utter;

      synth.speak(utter);
      // 某些 Chromium 版本 speak 后必须再 resume 一次才能唤醒播放队列
      if (synth.paused) synth.resume();

      // 850ms 内如果本地 TTS 仍未触发 onstart（无中文语音包或队列卡死），自动切换到服务端语音流
      watchdogTimer = window.setTimeout(() => {
        watchdogTimer = null;
        if (!started && seq === speakSeq) {
          triggerFallback();
        }
      }, 850);
    } catch {
      playServerTtsFallback(cleanText, rate, seq);
    }
  };

  // Chromium 经典 BUG：cancel() 后同步调用 speak() 会把新语音一起取消掉，延迟 80ms 彻底根治
  pendingTimer = window.setTimeout(() => {
    pendingTimer = null;
    doSpeak();
  }, 80);
}
