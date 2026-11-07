/**
 * 程序化音频引擎：所有音效与背景音乐均由 Web Audio 实时合成，
 * 不依赖任何音频文件，避免额外资源与加载失败。
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

/** 可切换的背景音乐（CC0 1.0，来源 OpenGameArt） */
const TRACKS: ReadonlyArray<{ id: string; name: string; file: string }> = [
  { id: 'menu', name: '大厅氛围', file: 'assets/music/menu-theme.mp3' },
  { id: 'upbeat', name: '轻快节奏', file: 'assets/music/upbeat-theme.mp3' },
];

const CHORDS: number[][] = [
  [220.0, 261.63, 329.63],
  [174.61, 220.0, 261.63],
  [261.63, 329.63, 392.0],
  [196.0, 246.94, 293.66],
];

const MELODY = [659.25, 783.99, 880.0, 659.25, 587.33, 523.25, 587.33, 659.25, 880.0, 783.99, 659.25, 523.25];

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
      /* 忽略损坏的偏好 */
    }
  }

  get musicOn(): boolean {
    return this.prefs.music;
  }

  get sfxOn(): boolean {
    return this.prefs.sfx;
  }

  /** 首次用户交互时调用：创建音频上下文并开始背景音乐 */
  unlock(): void {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);

      const musicGain = ctx.createGain();
      musicGain.gain.value = this.prefs.music ? 0.5 : 0;
      musicGain.connect(master);

      const sfxGain = ctx.createGain();
      sfxGain.gain.value = this.prefs.sfx ? 0.8 : 0;
      sfxGain.connect(master);

      this.ctx = ctx;
      this.master = master;
      this.musicGain = musicGain;
      this.sfxGain = sfxGain;
    }

    if (this.ctx.state === 'suspended') void this.ctx.resume();
    this.unlocked = true;
    this.startMusic();
  }

  toggleMusic(): boolean {
    this.prefs.music = !this.prefs.music;
    this.persist();
    if (this.musicGain && this.ctx) {
      this.musicGain.gain.setTargetAtTime(this.prefs.music ? 0.5 : 0, this.ctx.currentTime, 0.2);
    }
    if (this.prefs.music) this.startMusic();
    else this.stopMusic();
    return this.prefs.music;
  }

  toggleSfx(): boolean {
    this.prefs.sfx = !this.prefs.sfx;
    this.persist();
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.value = this.prefs.sfx ? 0.8 : 0;
    }
    return this.prefs.sfx;
  }

  play(name: SfxName): void {
    if (!this.unlocked || !this.prefs.sfx) return;
    const ctx = this.ctx;
    const out = this.sfxGain;
    if (!ctx || !out) return;

    switch (name) {
      case 'click':
        this.tone(880, 0.05, 'square', 0.12, out);
        break;
      case 'join':
        this.tone(523.25, 0.1, 'sine', 0.18, out);
        this.tone(783.99, 0.12, 'sine', 0.14, out, 0.08);
        break;
      case 'deal':
        this.noise(0.16, 0.16, out);
        break;
      case 'play':
        this.tone(392, 0.09, 'triangle', 0.24, out);
        this.tone(261.63, 0.14, 'triangle', 0.2, out, 0.07);
        break;
      case 'pass':
        this.tone(261.63, 0.1, 'sine', 0.14, out);
        this.tone(196, 0.14, 'sine', 0.12, out, 0.09);
        break;
      case 'bet':
        this.tone(659.25, 0.06, 'square', 0.14, out);
        this.tone(987.77, 0.1, 'square', 0.12, out, 0.05);
        break;
      case 'coin':
        this.tone(1318.51, 0.09, 'sine', 0.16, out);
        this.tone(1760, 0.14, 'sine', 0.12, out, 0.06);
        break;
      case 'win': {
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, index) => {
          this.tone(freq, 0.28, 'sine', 0.22, out, index * 0.1);
        });
        break;
      }
      case 'lose': {
        const notes = [392, 329.63, 261.63, 196];
        notes.forEach((freq, index) => {
          this.tone(freq, 0.3, 'sine', 0.18, out, index * 0.11);
        });
        break;
      }
      case 'bomb': {
        this.tone(90, 0.45, 'triangle', 0.45, out);
        this.noise(0.4, 0.35, out);
        this.tone(45, 0.6, 'sine', 0.5, out, 0.05);
        break;
      }
      case 'rocket': {
        const start = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(150, start);
        osc.frequency.exponentialRampToValueAtTime(1600, start + 0.35);
        gain.gain.setValueAtTime(0.01, start);
        gain.gain.linearRampToValueAtTime(0.25, start + 0.2);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
        osc.connect(gain);
        gain.connect(out);
        osc.start(start);
        osc.stop(start + 0.42);
        this.noise(0.5, 0.4, out);
        this.tone(55, 0.6, 'sine', 0.4, out, 0.3);
        break;
      }
      case 'shunzi': {
        const scale = [523.25, 659.25, 783.99, 1046.5, 1318.51];
        scale.forEach((freq, idx) => {
          this.tone(freq, 0.14, 'triangle', 0.16, out, idx * 0.06);
        });
        break;
      }
      case 'dice_shake': {
        for (let i = 0; i < 4; i++) {
          this.noise(0.08, 0.22, out);
          this.tone(280 + Math.random() * 200, 0.05, 'square', 0.1, out, i * 0.09);
        }
        break;
      }
      case 'dice_open': {
        this.tone(880, 0.18, 'sine', 0.2, out);
        this.tone(1320, 0.22, 'triangle', 0.16, out, 0.05);
        break;
      }
      case 'alert': {
        this.tone(880, 0.06, 'sine', 0.25, out);
        this.tone(1174.66, 0.08, 'sine', 0.2, out, 0.08);
        break;
      }
      case 'chip_clack': {
        this.tone(1400, 0.04, 'triangle', 0.2, out);
        this.tone(1800, 0.05, 'sine', 0.15, out, 0.02);
        break;
      }
      case 'jackpot': {
        const notes = [659.25, 783.99, 987.77, 1318.51, 1567.98, 1975.53];
        for (let round = 0; round < 3; round++) {
          notes.forEach((freq, idx) => {
            this.tone(freq, 0.12, 'sine', 0.14, out, round * 0.2 + idx * 0.04);
          });
        }
        break;
      }
      default:
        break;
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.prefs));
    } catch {
      /* 忽略存储失败 */
    }
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    out: GainNode,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(out);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }

  private noise(duration: number, volume: number, out: GainNode): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 2;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 1200;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start();
  }

  /** 当前曲名，供界面提示 */
  get trackName(): string {
    return TRACKS[this.trackIndex]?.name ?? '合成音';
  }

  /** 切换到下一首 */
  nextTrack(): string {
    this.trackIndex = (this.trackIndex + 1) % TRACKS.length;
    this.stopMusic();
    if (this.el) {
      this.el.pause();
      this.el = null;
    }
    this.usingSynth = false;
    if (this.prefs.music && this.unlocked) this.startMusic();
    return this.trackName;
  }

  private startMusic(): void {
    if (!this.prefs.music || !this.unlocked) return;

    // 优先播放真实音乐，加载失败再回退到程序化合成
    const el = this.ensureAudioEl();
    if (el) {
      el.volume = 0.42;
      void el
        .play()
        .then(() => {
          this.usingSynth = false;
        })
        .catch(() => this.startSynth());
      return;
    }
    this.startSynth();
  }

  private ensureAudioEl(): HTMLAudioElement | null {
    if (this.el) return this.el;
    const track = TRACKS[this.trackIndex];
    if (!track) return null;
    try {
      const el = new Audio(`${import.meta.env.BASE_URL}${track.file}`);
      el.loop = true;
      el.preload = 'auto';
      el.volume = 0.42;
      el.addEventListener('error', () => {
        console.warn('[audio] 音乐加载失败，改用合成音');
        this.el = null;
        this.startSynth();
      });
      this.el = el;
      return el;
    } catch {
      return null;
    }
  }

  private startSynth(): void {
    if (!this.prefs.music || !this.ctx || this.timer !== null) return;
    this.usingSynth = true;
    this.bar = 0;
    this.scheduleBar();
    this.timer = window.setInterval(() => this.scheduleBar(), 4000);
  }

  private stopMusic(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    if (this.el && !this.el.paused) this.el.pause();
  }

  get isSynthFallback(): boolean {
    return this.usingSynth;
  }

  private scheduleBar(): void {
    const ctx = this.ctx;
    const out = this.musicGain;
    if (!ctx || !out) return;

    const t = ctx.currentTime + 0.05;
    const chord = CHORDS[this.bar % CHORDS.length] ?? CHORDS[0]!;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    filter.connect(out);

    // 铺底和弦
    chord.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = index === 0 ? 'sine' : 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.linearRampToValueAtTime(0.055, t + 0.8);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 3.9);
      osc.connect(gain);
      gain.connect(filter);
      osc.start(t);
      osc.stop(t + 4);
    });

    // 低音
    const bass = ctx.createOscillator();
    const bassGain = ctx.createGain();
    bass.type = 'sine';
    bass.frequency.value = (chord[0] ?? 220) / 2;
    bassGain.gain.setValueAtTime(0.0001, t);
    bassGain.gain.linearRampToValueAtTime(0.05, t + 0.4);
    bassGain.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
    bass.connect(bassGain);
    bassGain.connect(out);
    bass.start(t);
    bass.stop(t + 4);

    // 稀疏琶音，营造节奏感
    for (let i = 0; i < 2; i += 1) {
      const note = MELODY[(this.bar * 2 + i) % MELODY.length] ?? 659.25;
      const start = t + i * 2;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = note;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.03, start + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
      osc.connect(gain);
      gain.connect(out);
      osc.start(start);
      osc.stop(start + 1);
    }

    this.bar += 1;
  }
}

export const audio = new AudioEngine();
