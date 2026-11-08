/**
 * 全局合成音效与背景音乐引擎：
 * 基于 Web Audio API 与 HTML5 Audio，确保任何环境下都有优美高级的声音体验。
 */

export type SfxName =
  | 'click'
  | 'deal'
  | 'play'
  | 'pass'
  | 'win'
  | 'lose'
  | 'coin'
  | 'bet'
  | 'join'
  | 'bomb'
  | 'rocket'
  | 'shunzi'
  | 'dice_shake'
  | 'dice_open'
  | 'alert'
  | 'chip_clack'
  | 'jackpot';

const STORAGE_KEY = 'cc.audio';

interface AudioPrefs {
  music: boolean;
  sfx: boolean;
}

/** 可切换的优美高级背景音乐风格 */
const TRACKS: ReadonlyArray<{ id: string; name: string; file: string }> = [
  { id: 'lounge', name: '名流爵士', file: 'assets/music/menu-theme.mp3' },
  { id: 'chill', name: '微醺对决', file: 'assets/music/upbeat-theme.mp3' },
];

/** 优雅温暖的爵士 Lounge 和弦 (Dm9 -> G13 -> Cmaj9 -> Am9) */
const JAZZ_CHORDS: number[][] = [
  [146.83, 220.0, 261.63, 329.63, 392.0],  // Dm9
  [98.0, 196.0, 246.94, 293.66, 349.23],   // G7(9)
  [130.81, 196.0, 246.94, 329.63, 392.0],  // Cmaj9
  [110.0, 164.81, 220.0, 261.63, 329.63],  // Am9
  [174.61, 220.0, 261.63, 329.63, 392.0],  // Fmaj7
  [164.81, 196.0, 246.94, 329.63, 392.0],  // Em7
  [146.83, 220.0, 261.63, 349.23, 440.0],  // Dm11
  [196.0, 246.94, 293.66, 392.0, 493.88],  // G13
];

const JAZZ_MELODY = [
  523.25, 587.33, 659.25, 783.99, 880.0, 987.77, 1046.5,
  880.0, 783.99, 659.25, 587.33, 523.25, 440.0, 392.0,
];

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private timer: number | null = null;
  private bar = 0;
  private unlocked = false;
  private prefs: AudioPrefs = { music: true, sfx: true };
  private el: HTMLAudioElement | null = null;
  private trackIndex = 0;
  private usingSynth = false;

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AudioPrefs>;
        this.prefs = { music: parsed.music !== false, sfx: parsed.sfx !== false };
      }
    } catch {
      /* 忽略 */
    }

    // 全局手势监听：用户在页面任意位置点击/按键即刻激活音效系统与背景音乐
    if (typeof window !== 'undefined') {
      const unlockEvents = ['pointerdown', 'touchstart', 'click', 'keydown'];
      const onUserGesture = () => {
        this.unlock();
        if (this.unlocked) {
          unlockEvents.forEach((evt) => window.removeEventListener(evt, onUserGesture));
        }
      };
      unlockEvents.forEach((evt) => window.addEventListener(evt, onUserGesture, { passive: true }));
    }
  }

  /** 用户首次手势交互时唤醒 AudioContext */
  unlock(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = 0.85;
      master.connect(ctx.destination);
      this.master = master;

      const musicGain = ctx.createGain();
      musicGain.gain.value = 0.22;
      musicGain.connect(master);
      this.musicGain = musicGain;

      const sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.45;
      sfxGain.connect(master);
      this.sfxGain = sfxGain;
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }

    this.unlocked = true;
    if (this.prefs.music) {
      this.startMusic();
    }
  }

  get musicOn(): boolean {
    return this.prefs.music;
  }

  get sfxOn(): boolean {
    return this.prefs.sfx;
  }

  toggleMusic(): boolean {
    this.unlock();
    this.prefs.music = !this.prefs.music;
    this.savePrefs();
    if (this.prefs.music) {
      this.startMusic();
    } else {
      this.stopMusic();
    }
    return this.prefs.music;
  }

  toggleSfx(): boolean {
    this.unlock();
    this.prefs.sfx = !this.prefs.sfx;
    this.savePrefs();
    return this.prefs.sfx;
  }

  play(name: SfxName): void {
    if (!this.unlocked) {
      this.unlock();
    }
    if (!this.prefs.sfx) return;
    const ctx = this.ctx;
    const out = this.sfxGain;
    if (!ctx || !out) return;

    switch (name) {
      case 'click':
        this.tone(880, 0.04, 'sine', 0.1, out);
        break;
      case 'join':
        this.arpeggio([523.25, 659.25, 783.99], 0.08, 'sine', 0.18, out);
        break;
      case 'deal':
        this.noise(0.04, 0.06, out);
        break;
      case 'play':
        this.tone(329.63, 0.09, 'triangle', 0.22, out);
        break;
      case 'pass':
        this.tone(196.0, 0.14, 'sine', 0.15, out);
        break;
      case 'coin':
      case 'bet':
        this.arpeggio([987.77, 1318.51], 0.06, 'triangle', 0.18, out);
        break;
      case 'win':
        this.arpeggio([523.25, 659.25, 783.99, 1046.5], 0.14, 'triangle', 0.32, out);
        break;
      case 'lose':
        this.arpeggio([392.0, 369.99, 349.23, 311.13], 0.18, 'sawtooth', 0.18, out);
        break;
      case 'bomb':
        this.bombSound(out);
        break;
      case 'rocket':
        this.rocketSound(out);
        break;
      case 'shunzi':
        this.arpeggio([440, 493.88, 554.37, 659.25, 739.99, 880], 0.05, 'triangle', 0.22, out);
        break;
      case 'dice_shake':
        this.shakeSound(out);
        break;
      case 'dice_open':
        this.arpeggio([659.25, 880.0, 1174.66], 0.08, 'triangle', 0.25, out);
        break;
      case 'alert':
        this.tone(880, 0.08, 'sawtooth', 0.18, out);
        window.setTimeout(() => this.tone(880, 0.08, 'sawtooth', 0.18, out), 120);
        break;
      case 'chip_clack':
        this.chipClack(out);
        break;
      case 'jackpot':
        this.jackpotSound(out);
        break;
    }
  }

  private chipClack(out: AudioNode): void {
    if (!this.ctx) return;
    this.noise(0.02, 0.2, out);
    this.tone(1480, 0.03, 'sine', 0.15, out);
    window.setTimeout(() => {
      this.noise(0.015, 0.15, out);
      this.tone(1220, 0.025, 'sine', 0.12, out);
    }, 35);
  }

  private bombSound(out: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const bufferSize = ctx.sampleRate * 0.45;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, t);
    filter.frequency.exponentialRampToValueAtTime(40, t + 0.45);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    noise.start(t);

    const sub = ctx.createOscillator();
    const subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, t);
    sub.frequency.exponentialRampToValueAtTime(30, t + 0.4);
    subGain.gain.setValueAtTime(0.5, t);
    subGain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    sub.connect(subGain);
    subGain.connect(out);
    sub.start(t);
    sub.stop(t + 0.42);
  }

  private rocketSound(out: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(1200, t + 0.6);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, t);
    filter.frequency.exponentialRampToValueAtTime(3000, t + 0.6);
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.linearRampToValueAtTime(0.35, t + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + 0.72);
    window.setTimeout(() => this.bombSound(out), 550);
  }

  private shakeSound(out: AudioNode): void {
    if (!this.ctx) return;
    for (let i = 0; i < 4; i++) {
      window.setTimeout(() => {
        this.noise(0.04, 0.12, out);
        this.tone(700 + Math.random() * 300, 0.03, 'sine', 0.08, out);
      }, i * 70);
    }
  }

  private jackpotSound(out: AudioNode): void {
    const fanfare = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.51];
    fanfare.forEach((freq, idx) => {
      window.setTimeout(() => {
        this.tone(freq, 0.15, 'triangle', 0.28, out);
      }, idx * 90);
    });
  }

  private tone(freq: number, duration: number, type: OscillatorType, gainVal: number, out: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(gainVal, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + duration);
  }

  private arpeggio(freqs: number[], step: number, type: OscillatorType, gainVal: number, out: AudioNode): void {
    freqs.forEach((freq, index) => {
      window.setTimeout(() => this.tone(freq, step * 1.8, type, gainVal, out), index * step * 1000);
    });
  }

  private noise(duration: number, gainVal: number, out: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) data[i] = Math.random() * 2 - 1;
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1600;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(gainVal, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    node.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    node.start(t);
  }

  get trackName(): string {
    return TRACKS[this.trackIndex]?.name ?? '名流爵士';
  }

  nextTrack(): string {
    this.unlock();
    this.trackIndex = (this.trackIndex + 1) % TRACKS.length;
    this.stopMusic();
    if (this.el) {
      this.el.pause();
      this.el = null;
    }
    this.usingSynth = false;
    if (this.prefs.music) {
      this.startMusic();
    }
    return this.trackName;
  }

  private startMusic(): void {
    if (!this.prefs.music) return;
    this.stopMusic();

    // 优先尝试使用标准音频元素播放高质量音乐文件
    const track = TRACKS[this.trackIndex];
    if (track && typeof Audio !== 'undefined') {
      try {
        const url = `${import.meta.env.BASE_URL}${track.file}`;
        const el = new Audio(url);
        el.loop = true;
        el.volume = 0.35;
        const playPromise = el.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              this.el = el;
              this.usingSynth = false;
            })
            .catch(() => {
              // 自动播放被阻拦或文件无法解析，启动高音质合成和弦
              this.startSynth();
            });
          return;
        }
      } catch {
        /* 回退到合成器 */
      }
    }

    this.startSynth();
  }

  private stopMusic(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.el) {
      try {
        this.el.pause();
      } catch {
        /* 忽略 */
      }
      this.el = null;
    }
  }

  get isSynthFallback(): boolean {
    return this.usingSynth;
  }

  /** 打造高雅温暖的夜总会爵士钢琴 Lounge 背景音乐 */
  private startSynth(): void {
    if (!this.prefs.music || !this.ctx || this.timer !== null) return;
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    this.usingSynth = true;
    this.bar = 0;
    this.scheduleBar();
    this.timer = window.setInterval(() => this.scheduleBar(), 3600);
  }

  private scheduleBar(): void {
    const ctx = this.ctx;
    const out = this.musicGain;
    if (!ctx || !out) return;

    const t = ctx.currentTime + 0.05;
    const chord = JAZZ_CHORDS[this.bar % JAZZ_CHORDS.length] ?? JAZZ_CHORDS[0]!;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    filter.connect(out);

    // 铺底温暖和弦 (柔美三角波 Rhodes 电钢琴音色)
    chord.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = index === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.04, t + 0.6);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.5);
      osc.connect(gain);
      gain.connect(filter);
      osc.start(t);
      osc.stop(t + 3.6);
    });

    // 优雅低音大提琴 (Walking Bass)
    const bass = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bass.type = 'sine';
    bass.frequency.value = (chord[0] ?? 146.83) / 2;
    bassGain.gain.setValueAtTime(0.0001, t);
    bassGain.gain.linearRampToValueAtTime(0.055, t + 0.3);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, t + 3.4);
    bass.connect(bassGain);
    bassGain.connect(out);
    bass.start(t);
    bass.stop(t + 3.5);

    // 晶莹高音点缀音
    const note1 = JAZZ_MELODY[(this.bar * 3) % JAZZ_MELODY.length] ?? 523.25;
    const note2 = JAZZ_MELODY[(this.bar * 3 + 2) % JAZZ_MELODY.length] ?? 659.25;

    [
      { n: note1, offset: 0.8 },
      { n: note2, offset: 2.2 },
    ].forEach(({ n, offset }) => {
      const start = t + offset;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.02, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
      osc.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(start + 1.0);
    });

    this.bar += 1;
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      /* 忽略写入失败 */
    }
  }
}

export const audio = new AudioEngine();
