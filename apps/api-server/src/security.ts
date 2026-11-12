import { randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const KEY_LEN = 64;

/** scrypt 口令散列，格式：scrypt:<salt>:<hash> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, KEY_LEN);
  return `scrypt:${salt}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, salt, hash] = stored.split(':');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  if (expected.length !== KEY_LEN) return false;
  const actual = await scryptAsync(password, salt, KEY_LEN);
  return timingSafeEqual(actual, expected);
}

const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CAPTCHA_TTL_MS = 5 * 60_000;
const CAPTCHA_MAX_ENTRIES = 5000;

interface CaptchaEntry {
  answer: string;
  expiresAt: number;
}

const captchaStore = new Map<string, CaptchaEntry>();

const CAPTCHA_COLORS = ['#f0b429', '#7b9dff', '#3ecf8e', '#e57ad1', '#ff9f5c'];

/**
 * 5×7 点阵字形。验证码以路径绘制而不是 <text>，
 * 避免答案可以从 SVG 源码里直接读出来。
 */
const CAPTCHA_GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
};

const GLYPH_COLS = 5;
const GLYPH_ROWS = 7;

/** 把一个字形摊成若干带抖动的方块子路径 */
function glyphPath(char: string, originX: number, originY: number, cell: number): string {
  const rows = CAPTCHA_GLYPHS[char];
  if (!rows) return '';
  let d = '';
  for (let r = 0; r < GLYPH_ROWS; r += 1) {
    const row = rows[r] ?? '';
    for (let c = 0; c < GLYPH_COLS; c += 1) {
      if (row[c] !== '#') continue;
      const jx = (Math.random() - 0.5) * 0.4;
      const jy = (Math.random() - 0.5) * 0.4;
      const x = originX + c * cell + jx;
      const y = originY + r * cell + jy;
      d += `M${x.toFixed(2)} ${y.toFixed(2)}h${cell}v${cell}h-${cell}z`;
    }
  }
  return d;
}

function renderCaptchaSvg(answer: string): string {
  const width = 120;
  const height = 40;
  const parts: string[] = [];

  for (let i = 0; i < 3; i += 1) {
    const y1 = (Math.random() * height).toFixed(1);
    const cy = (Math.random() * height).toFixed(1);
    const y2 = (Math.random() * height).toFixed(1);
    parts.push(
      `<path d="M0 ${y1} Q ${width / 2} ${cy} ${width} ${y2}" stroke="rgba(255,255,255,0.16)" fill="none" stroke-width="1.4"/>`,
    );
  }

  const cell = 3;
  const charW = GLYPH_COLS * cell;
  const spacing = Math.min(30, (width - 16 - charW) / Math.max(1, answer.length - 1));
  for (let i = 0; i < answer.length; i += 1) {
    const originX = 8 + i * spacing;
    const originY = 8 + (Math.random() * 5 - 2.5);
    const rotate = (Math.random() * 24 - 12).toFixed(1);
    const cx = originX + charW / 2;
    const cy = originY + (GLYPH_ROWS * cell) / 2;
    parts.push(
      `<path d="${glyphPath(answer[i] ?? '', originX, originY, cell)}" ` +
        `fill="${CAPTCHA_COLORS[i % CAPTCHA_COLORS.length]}" ` +
        `transform="rotate(${rotate} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`,
    );
  }

  for (let i = 0; i < 14; i += 1) {
    parts.push(
      `<circle cx="${(Math.random() * width).toFixed(1)}" cy="${(Math.random() * height).toFixed(1)}" ` +
        `r="${(Math.random() * 1.6).toFixed(1)}" fill="rgba(255,255,255,0.22)"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#101528"/>${parts.join('')}</svg>`
  );
}

export interface CaptchaChallenge {
  id: string;
  svg: string;
  expiresIn: number;
}

export function createCaptcha(): CaptchaChallenge {
  const now = Date.now();
  if (captchaStore.size > CAPTCHA_MAX_ENTRIES) {
    for (const [key, entry] of captchaStore) {
      if (entry.expiresAt <= now) captchaStore.delete(key);
    }
  }

  let answer = '';
  for (let i = 0; i < 4; i += 1) {
    answer += CAPTCHA_CHARS[randomInt(CAPTCHA_CHARS.length)] ?? 'A';
  }

  const id = randomUUID();
  captchaStore.set(id, { answer, expiresAt: now + CAPTCHA_TTL_MS });
  return { id, svg: renderCaptchaSvg(answer), expiresIn: CAPTCHA_TTL_MS };
}

/** 一次性消费验证码：无论对错都失效，避免穷举 */
export function consumeCaptcha(id: string, input: string): boolean {
  const entry = captchaStore.get(id);
  if (!entry) return false;
  captchaStore.delete(id);
  if (entry.expiresAt < Date.now()) return false;
  return entry.answer.toLowerCase() === input.trim().toLowerCase();
}

export interface AttemptState {
  allowed: boolean;
  remainingMs: number;
}

/** 固定窗口内的失败次数限制，用于登录防爆破 */
export class AttemptLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  check(key: string): AttemptState {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) return { allowed: true, remainingMs: 0 };
    return {
      allowed: entry.count < this.max,
      remainingMs: Math.max(0, entry.resetAt - now),
    };
  }

  fail(key: string): void {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count += 1;
    }
    if (this.hits.size > 20_000) {
      for (const [k, v] of this.hits) {
        if (v.resetAt <= now) this.hits.delete(k);
      }
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

export const USERNAME_PATTERN = /^[A-Za-z0-9_]{4,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 32;

/** 防止账号枚举：用户不存在时也跑一次同等开销的散列 */
const DUMMY_HASH = await hashPassword(randomBytes(8).toString('hex'));

export async function burnPasswordCheck(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_HASH);
}
