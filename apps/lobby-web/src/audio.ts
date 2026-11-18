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
  | 'jackpot'
  | 'god_login'
  | 'worship'
  | 'slot_spin'
  | 'slot_stop'
  | 'slot_win'
  | 'slot_jackpot'
  | 'mahjong_clack'
  | 'coin_stream'
  | 'card_shuffle'
  | 'xiangqi_move'
  | 'xiangqi_capture'
  | 'mahjong_tile_click'
  | 'mahjong_draw'
  | 'mahjong_discard'
  | 'mahjong_peng'
  | 'mahjong_gang'
  | 'mahjong_hu'
  | 'poker_chip_bet'
  | 'poker_raise'
  | 'poker_check'
  | 'poker_fold'
  | 'poker_allin'
  | 'poker_deal';

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
  /** 播放代次：切歌/关音乐后，旧的 play() Promise 不再影响状态 */
  private musicToken = 0;
  /** 是否已进入游戏牌桌（进入游戏后自动静音背景音乐，返回大厅再恢复） */
  private inGame = false;

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

      // 页面隐藏/卸载时停止播放，避免后台持续出声与音频节点常驻
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.stopMusic();
        } else if (this.prefs.music) {
          this.startMusic();
        }
      });
      window.addEventListener('pagehide', () => this.stopMusic());
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
    if (this.prefs.music && !this.inGame) {
      this.startMusic();
    }
  }

  /** 进入游戏房间后停播背景音乐；退出回到大厅后若开启了音乐则自动恢复 */
  setInGame(active: boolean): void {
    if (this.inGame === active) return;
    this.inGame = active;
    if (active) {
      this.stopMusic();
    } else if (this.prefs.music && this.unlocked && !document.hidden) {
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
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

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
        this.winFanfareSound(out);
        break;
      case 'lose':
        this.loseMelancholySound(out);
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
      case 'god_login':
        this.godLoginSound(out);
        break;
      case 'worship':
        this.worshipSound(out);
        break;
      case 'slot_spin':
        this.slotSpinSound(out);
        break;
      case 'slot_stop':
        this.slotStopSound(out);
        break;
      case 'slot_win':
        this.slotWinSound(out);
        break;
      case 'slot_jackpot':
        this.slotJackpotSound(out);
        break;
      case 'mahjong_clack':
        this.mahjongClack(out);
        break;
      case 'coin_stream':
        this.coinStream(out);
        break;
      case 'card_shuffle':
        this.cardShuffle(out);
        break;
      case 'xiangqi_move':
        this.xiangqiMoveSound(out);
        break;
      case 'xiangqi_capture':
        this.xiangqiCaptureSound(out);
        break;
      case 'mahjong_tile_click':
        this.mahjongTileClickSound(out);
        break;
      case 'mahjong_draw':
        this.mahjongDrawSound(out);
        break;
      case 'mahjong_discard':
        this.mahjongDiscardSound(out);
        break;
      case 'mahjong_peng':
        this.mahjongPengSound(out);
        break;
      case 'mahjong_gang':
        this.mahjongGangSound(out);
        break;
      case 'mahjong_hu':
        this.mahjongHuSound(out);
        break;
      case 'poker_chip_bet':
        this.pokerChipBetSound(out);
        break;
      case 'poker_raise':
        this.pokerRaiseSound(out);
        break;
      case 'poker_check':
        this.pokerCheckSound(out);
        break;
      case 'poker_fold':
        this.pokerFoldSound(out);
        break;
      case 'poker_allin':
        this.pokerAllInSound(out);
        break;
      case 'poker_deal':
        this.pokerDealSound(out);
        break;
    }
  }

  private godLoginSound(out: AudioNode): void {
    if (!this.ctx) return;
    // 赌神登场：辉煌三段式金色号角和弦
    const chords = [
      [523.25, 659.25, 783.99], // C
      [659.25, 783.99, 1046.5], // Em/C
      [783.99, 987.77, 1174.66, 1567.98], // G7 / C-High
    ];
    chords.forEach((chord, i) => {
      window.setTimeout(() => {
        chord.forEach((freq) => {
          this.tone(freq, i === 2 ? 0.65 : 0.22, 'sawtooth', 0.12, out);
          this.tone(freq / 2, i === 2 ? 0.65 : 0.22, 'triangle', 0.18, out);
        });
      }, i * 220);
    });
  }

  private worshipSound(out: AudioNode): void {
    if (!this.ctx) return;
    // 膜拜：清脆竖琴祈福琶音 + 柔和心跳泛音
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
    this.arpeggio(notes, 0.07, 'sine', 0.22, out);
    window.setTimeout(() => {
      this.tone(1046.5, 0.4, 'triangle', 0.15, out);
    }, 280);
  }

  private slotSpinSound(out: AudioNode): void {
    if (!this.ctx) return;
    // 机械滚轮转动：轻快棘轮咔哒声
    this.noise(0.015, 0.08, out);
    this.tone(1600, 0.015, 'sawtooth', 0.08, out);
  }

  private slotStopSound(out: AudioNode): void {
    if (!this.ctx) return;
    // 滚轮锁定机械撞击声
    this.noise(0.025, 0.2, out);
    this.tone(480, 0.04, 'triangle', 0.25, out);
    this.tone(180, 0.06, 'sine', 0.3, out);
  }

  private slotWinSound(out: AudioNode): void {
    if (!this.ctx) return;
    // 老虎机连线中奖：欢快金属铃铛
    const bellNotes = [659.25, 783.99, 1046.5, 1318.51];
    bellNotes.forEach((f, i) => {
      window.setTimeout(() => {
        this.tone(f, 0.15, 'triangle', 0.2, out);
        this.tone(f * 2, 0.08, 'sine', 0.1, out);
      }, i * 70);
    });
  }

  private slotJackpotSound(out: AudioNode): void {
    if (!this.ctx) return;
    // 777 巨额大奖：警报双音循环 + 金币爆裂
    for (let i = 0; i < 8; i++) {
      window.setTimeout(() => {
        const freq = i % 2 === 0 ? 880 : 1320;
        this.tone(freq, 0.1, 'sawtooth', 0.25, out);
      }, i * 110);
    }
    window.setTimeout(() => this.jackpotSound(out), 400);
  }

  private mahjongClack(out: AudioNode): void {
    if (!this.ctx) return;
    // 麻将骨质撞击：厚实沉闷的敲击 + 脆响
    this.noise(0.018, 0.25, out);
    this.tone(1350, 0.02, 'triangle', 0.2, out);
    this.tone(550, 0.04, 'sine', 0.3, out);
  }

  private coinStream(out: AudioNode): void {
    if (!this.ctx) return;
    // 瀑布金币流雨
    for (let i = 0; i < 9; i++) {
      window.setTimeout(() => {
        const f = 1900 + Math.random() * 800;
        this.tone(f, 0.035, 'sine', 0.12, out);
      }, i * 45 + Math.random() * 20);
    }
  }

  private cardShuffle(out: AudioNode): void {
    if (!this.ctx) return;
    // 纸牌洗牌沙沙摩擦声
    for (let i = 0; i < 6; i++) {
      window.setTimeout(() => {
        this.noise(0.03, 0.06, out);
      }, i * 35);
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

  private winFanfareSound(out: AudioNode): void {
    // 胜利华丽凯旋号角 + 倾泻金币清脆回响
    const fanfare = [
      { f: 523.25, d: 0.12, t: 0 },    // C5
      { f: 659.25, d: 0.12, t: 90 },   // E5
      { f: 783.99, d: 0.14, t: 180 },  // G5
      { f: 1046.50, d: 0.35, t: 280 }, // C6 (长高音)
      { f: 1318.51, d: 0.40, t: 360 }, // E6 华彩
    ];
    fanfare.forEach(({ f, d, t }) => {
      window.setTimeout(() => this.tone(f, d, 'triangle', 0.35, out), t);
    });

    // 随后金币倾泻清脆撞击声
    [1567.98, 2093.00, 2637.02, 3135.96].forEach((f, idx) => {
      window.setTimeout(() => {
        this.tone(f, 0.08, 'sine', 0.15, out);
      }, 450 + idx * 60);
    });
  }

  private loseMelancholySound(out: AudioNode): void {
    // 惜败低沉旋律 + 柔和低音落幕
    const notes = [
      { f: 392.00, d: 0.16, t: 0 },   // G4
      { f: 349.23, d: 0.16, t: 120 }, // F4
      { f: 311.13, d: 0.18, t: 240 }, // Eb4
      { f: 261.63, d: 0.35, t: 380 }, // C4 (低音回落)
    ];
    notes.forEach(({ f, d, t }) => {
      window.setTimeout(() => this.tone(f, d, 'sawtooth', 0.16, out), t);
    });
    // 沉闷底鼓
    window.setTimeout(() => {
      this.tone(90, 0.25, 'sine', 0.22, out);
    }, 390);
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
    if (!this.prefs.music || this.inGame) return;
    this.stopMusic();
    const token = ++this.musicToken;

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
              // 期间用户可能已经关掉音乐或切了歌，迟到的 resolve 不能再把音频接回来
              if (token !== this.musicToken) {
                el.pause();
                return;
              }
              this.el = el;
              this.usingSynth = false;
            })
            .catch(() => {
              // 自动播放被阻拦或文件无法解析，启动高音质合成和弦
              if (token === this.musicToken) this.startSynth();
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
    // 让所有在途的 play() Promise 失效
    this.musicToken += 1;
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

  /** 中国象棋落子清脆紫檀木声 */
  private xiangqiMoveSound(out: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // 1. 瞬态木质清脆撞击（带通滤波白噪）
    const bufLen = Math.floor(ctx.sampleRate * 0.035);
    const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.008));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1650, t);
    bp.Q.setValueAtTime(2.6, t);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.45, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(out);
    noise.start(t);

    // 2. 棋盘木箱共鸣（沉稳厚实低中频）
    const body = ctx.createOscillator();
    const bGain = ctx.createGain();
    body.type = 'triangle';
    body.frequency.setValueAtTime(310, t);
    body.frequency.exponentialRampToValueAtTime(135, t + 0.065);
    bGain.gain.setValueAtTime(0.36, t);
    bGain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    body.connect(bGain);
    bGain.connect(out);
    body.start(t);
    body.stop(t + 0.09);

    // 3. 高频清亮泛音点缀
    const ping = ctx.createOscillator();
    const pGain = ctx.createGain();
    ping.type = 'sine';
    ping.frequency.setValueAtTime(960, t);
    ping.frequency.exponentialRampToValueAtTime(520, t + 0.04);
    pGain.gain.setValueAtTime(0.14, t);
    pGain.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    ping.connect(pGain);
    pGain.connect(out);
    ping.start(t);
    ping.stop(t + 0.05);
  }

  /** 中国象棋吃子重击 + 金戈回响音效 */
  private xiangqiCaptureSound(out: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // 1. 强力重拍木板冲击
    const sub = ctx.createOscillator();
    const sGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(210, t);
    sub.frequency.exponentialRampToValueAtTime(48, t + 0.16);
    sGain.gain.setValueAtTime(0.55, t);
    sGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    sub.connect(sGain);
    sGain.connect(out);
    sub.start(t);
    sub.stop(t + 0.19);

    // 2. 双木碰撞脆响
    const bufLen = Math.floor(ctx.sampleRate * 0.06);
    const buffer = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.014));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1950, t);
    bp.Q.setValueAtTime(1.8, t);
    const nGain = ctx.createGain();
    nGain.gain.setValueAtTime(0.6, t);
    nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    noise.connect(bp);
    bp.connect(nGain);
    nGain.connect(out);
    noise.start(t);

    // 3. 金戈战意余韵（古风青铜微鸣）
    [660, 990, 1480].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t + 0.015);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.94, t + 0.24);
      g.gain.setValueAtTime(0.14 / (idx + 1), t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.26);
      osc.connect(g);
      g.connect(out);
      osc.start(t + 0.015);
      osc.stop(t + 0.28);
    });
  }

  /** 麻将选牌清脆骨牌轻磕声 */
  private mahjongTileClickSound(out: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(2450, t);
    osc.frequency.exponentialRampToValueAtTime(1180, t + 0.025);
    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + 0.032);
  }

  /** 麻将摸牌绒布轻滑声 */
  private mahjongDrawSound(out: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * 0.06);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const env = Math.sin((i / len) * Math.PI);
      ch[i] = (Math.random() * 2 - 1) * env * 0.6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1400, t);
    bp.frequency.linearRampToValueAtTime(2300, t + 0.055);
    bp.Q.setValueAtTime(2.0, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(t);
  }

  /** 麻将出牌玉石骨牌清脆拍桌声 */
  private mahjongDiscardSound(out: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // 1. 骨牌表面清脆咔哒
    const len = Math.floor(ctx.sampleRate * 0.032);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.006));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2850, t);
    bp.Q.setValueAtTime(3.2, t);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.032);
    noise.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    noise.start(t);

    // 2. 玉牌本体高频共鸣
    const click = ctx.createOscillator();
    const cg = ctx.createGain();
    click.type = 'sine';
    click.frequency.setValueAtTime(1920, t);
    click.frequency.exponentialRampToValueAtTime(760, t + 0.042);
    cg.gain.setValueAtTime(0.26, t);
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.048);
    click.connect(cg);
    cg.connect(out);
    click.start(t);
    click.stop(t + 0.052);

    // 3. 绒布牌桌闷沉低音托底
    const thud = ctx.createOscillator();
    const tg = ctx.createGain();
    thud.type = 'triangle';
    thud.frequency.setValueAtTime(240, t);
    thud.frequency.exponentialRampToValueAtTime(92, t + 0.065);
    tg.gain.setValueAtTime(0.32, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.072);
    thud.connect(tg);
    tg.connect(out);
    thud.start(t);
    thud.stop(t + 0.08);
  }

  /** 麻将「碰」重拍双响 + 翠玉清鸣 */
  private mahjongPengSound(out: AudioNode): void {
    if (!this.ctx) return;
    this.mahjongDiscardSound(out);
    window.setTimeout(() => this.mahjongDiscardSound(out), 75);
    // 翠玉五声音阶清鸣
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      window.setTimeout(() => {
        this.tone(freq, 0.16, 'triangle', 0.2, out);
      }, 45 + idx * 42);
    });
  }

  /** 麻将「杠」震撼连拍 + 金雷鸣响 */
  private mahjongGangSound(out: AudioNode): void {
    if (!this.ctx) return;
    this.mahjongDiscardSound(out);
    window.setTimeout(() => this.mahjongDiscardSound(out), 65);
    window.setTimeout(() => this.mahjongDiscardSound(out), 130);
    // 震撼低音冲击 + 华丽金鸣
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(195, t);
    sub.frequency.exponentialRampToValueAtTime(46, t + 0.28);
    sg.gain.setValueAtTime(0.52, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    sub.connect(sg);
    sg.connect(out);
    sub.start(t);
    sub.stop(t + 0.32);

    [587.33, 880, 1174.66, 1567.98].forEach((freq, idx) => {
      window.setTimeout(() => {
        this.tone(freq, 0.22, 'triangle', 0.22, out);
      }, 60 + idx * 50);
    });
  }

  /** 麻将「胡牌 / 自摸」盛大礼乐 + 喜庆金钟 + 金币倾泻 */
  private mahjongHuSound(out: AudioNode): void {
    if (!this.ctx) return;
    // 国风五声喜庆上行凯旋（宫商角徵羽高音）
    const notes = [
      { f: 523.25, d: 0.14, t: 0 },     // C5
      { f: 587.33, d: 0.12, t: 85 },    // D5
      { f: 659.25, d: 0.14, t: 165 },   // E5
      { f: 783.99, d: 0.18, t: 250 },   // G5
      { f: 1046.5, d: 0.42, t: 345 },   // C6
      { f: 1318.51, d: 0.48, t: 430 },  // E6
      { f: 1567.98, d: 0.55, t: 520 },  // G6
    ];
    notes.forEach(({ f, d, t }) => {
      window.setTimeout(() => this.tone(f, d, 'triangle', 0.3, out), t);
    });
    // 伴随清脆金币流响
    window.setTimeout(() => this.coinStream(out), 420);
  }

  /** 德州扑克：单枚/小摞陶瓷筹码清脆落桌碰撞声 */
  private pokerChipSingleClink(out: AudioNode, gainScale = 1, pitchOffset = 0): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // 1. 陶瓷筹码双谐波清脆高频敲击
    const f1 = 2950 + pitchOffset;
    const f2 = 4380 + pitchOffset * 1.25;
    [f1, f2].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = idx === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freq, t);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.88, t + 0.048);
      g.gain.setValueAtTime((idx === 0 ? 0.28 : 0.16) * gainScale, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.055);
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.06);
    });

    // 2. 筹码触碰绒布的轻微瞬态质感
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.022));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.005));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3400 + pitchOffset, t);
    bp.Q.setValueAtTime(2.6, t);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.32 * gainScale, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.022);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    src.start(t);
  }

  /** 德州扑克：放筹码 / 跟注音效（清脆两连响 + 落桌轻颤） */
  private pokerChipBetSound(out: AudioNode): void {
    this.pokerChipSingleClink(out, 1.0, 0);
    window.setTimeout(() => this.pokerChipSingleClink(out, 0.78, 220), 62);
    window.setTimeout(() => this.pokerChipSingleClink(out, 0.55, -140), 118);
  }

  /** 德州扑克：加注音效（密集筹码推进连响 + 铿锵上扬金属音） */
  private pokerRaiseSound(out: AudioNode): void {
    const delays = [0, 48, 92, 134, 175];
    const pitches = [-180, 90, 260, 420, 560];
    delays.forEach((ms, i) => {
      window.setTimeout(() => this.pokerChipSingleClink(out, 0.92 + i * 0.06, pitches[i]!), ms);
    });
    window.setTimeout(() => {
      this.tone(783.99, 0.14, 'triangle', 0.16, out);
    }, 110);
    window.setTimeout(() => {
      this.tone(1046.5, 0.2, 'triangle', 0.18, out);
    }, 185);
  }

  /** 德州扑克：过牌音效（真实赌场指节双敲牌桌「咚-咚」） */
  private pokerCheckSound(out: AudioNode): void {
    if (!this.ctx) return;
    const knock = (delayMs: number, vol: number) => {
      window.setTimeout(() => {
        if (!this.ctx) return;
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(165, t);
        osc.frequency.exponentialRampToValueAtTime(68, t + 0.075);
        g.gain.setValueAtTime(0.45 * vol, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
        osc.connect(g);
        g.connect(out);
        osc.start(t);
        osc.stop(t + 0.09);

        // 木桌表面闷敲瞬态
        const len = Math.max(1, Math.floor(ctx.sampleRate * 0.025));
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < len; i++) {
          ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.006));
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(620, t);
        const ng = ctx.createGain();
        ng.gain.setValueAtTime(0.32 * vol, t);
        ng.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
        src.connect(lp);
        lp.connect(ng);
        ng.connect(out);
        src.start(t);
      }, delayMs);
    };
    knock(0, 1.0);
    knock(125, 0.85);
  }

  /** 德州扑克：弃牌音效（卡牌利落推入弃牌堆的刷滑风声） */
  private pokerFoldSound(out: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.16;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const p = i / len;
      ch[i] = (Math.random() * 2 - 1) * Math.sin(p * Math.PI) * 0.9;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2200, t);
    bp.frequency.exponentialRampToValueAtTime(480, t + dur);
    bp.Q.setValueAtTime(1.5, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(t);

    // 轻微低落尾音暗示退出本手
    this.tone(240, 0.14, 'sine', 0.12, out);
  }

  /** 德州扑克：全压 ALL-IN 震撼音效（成堆筹码推入洪流 + 重低音冲击 + 热血铜管和弦） */
  private pokerAllInSound(out: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // 1. 震撼低音冲击
    const sub = ctx.createOscillator();
    const sg = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(175, t);
    sub.frequency.exponentialRampToValueAtTime(42, t + 0.36);
    sg.gain.setValueAtTime(0.62, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    sub.connect(sg);
    sg.connect(out);
    sub.start(t);
    sub.stop(t + 0.4);

    // 2. 8连枚密集筹码倾泻推进声
    for (let i = 0; i < 8; i++) {
      window.setTimeout(() => {
        this.pokerChipSingleClink(out, 0.85 + (i % 3) * 0.12, -260 + i * 110);
      }, i * 38);
    }

    // 3. 紧张辉煌铜管和弦（D5 + F#5 + A5 + D6）
    window.setTimeout(() => {
      [587.33, 739.99, 880, 1174.66].forEach((freq) => {
        this.tone(freq, 0.42, 'sawtooth', 0.085, out);
        this.tone(freq * 0.5, 0.42, 'triangle', 0.12, out);
      });
    }, 120);
  }

  /** 德州扑克：清脆发牌拂桌声 */
  private pokerDealSound(out: AudioNode): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.065;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.015));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.setValueAtTime(3100, t);
    hp.Q.setValueAtTime(1.8, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(hp);
    hp.connect(g);
    g.connect(out);
    src.start(t);
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
