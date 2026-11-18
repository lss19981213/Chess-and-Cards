/**
 * Microsoft Edge Neural TTS (Read Aloud v2) 纯 TypeScript 客户端：
 * - 免费直连微软高保真神经女声（zh-TW-HsiaoChenNeural / zh-CN-XiaoyiNeural / zh-CN-XiaoxiaoNeural / zh-HK-HiuGaaiNeural / zh-TW-HsiaoYuNeural）
 * - 支持 v2 Sec-MS-GEC 签名与 403 服务器时钟偏差自动校准
 * - 国内与海外服务器均可直连，返回真实 24kHz 48kbps MP3 音频流
 */

import crypto from 'node:crypto';
import WebSocket from 'ws';

const BASE_URL = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const WSS_URL = `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0]!;
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const WIN_EPOCH = 11644473600;

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a,
  0x6c006f49, 0x04bd35ab, 0xfeb0a7e4, 0x03effbd2,
] as const;

const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba,
  0xa622ee8c, 0xd1dd9491, 0xc0dd25a0, 0xf9e70ab6,
  0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33,
  0xd258b060, 0x72766564,
] as const;

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const SHA256_ADJUSTMENT = 0xc9dc06a7;
const SHA256_BLOCK_CONSTANTS = [
  ...SHA256_ROUND_CONSTANTS.slice(0, 14),
  SHA256_ADJUSTMENT,
  ...SHA256_ROUND_CONSTANTS.slice(15),
];
const SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

const CS64_COEFFICIENTS: readonly [number, number][] = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];

const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

function u32(v: number): number {
  return v >>> 0;
}

function mul32(a: number, b: number): number {
  return Math.imul(a, b) >>> 0;
}

function rotr32(v: number, n: number): number {
  return ((v >>> n) | (v << (32 - n))) >>> 0;
}

function rol16(v: number): number {
  return ((v << 16) | (v >>> 16)) >>> 0;
}

function sigma0(v: number): number {
  return (rotr32(v, 7) ^ rotr32(v, 18) ^ (v >>> 3)) >>> 0;
}

function sigma1(v: number): number {
  return (rotr32(v, 17) ^ rotr32(v, 19) ^ (v >>> 10)) >>> 0;
}

function bigSigma0(v: number): number {
  return (rotr32(v, 2) ^ rotr32(v, 13) ^ rotr32(v, 22)) >>> 0;
}

function bigSigma1(v: number): number {
  return (rotr32(v, 6) ^ rotr32(v, 11) ^ rotr32(v, 25)) >>> 0;
}

function sha256Rounds(state: readonly number[], words: number[], firstRound = 0): number[] {
  let [a, b, c, d, e, f, g, h] = state as [number, number, number, number, number, number, number, number];
  const constants = firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;
  for (let i = firstRound; i < 64; i++) {
    const ch = (g ^ (e & (f ^ g))) >>> 0;
    const maj = ((a & b) | (c & (a | b))) >>> 0;
    const t1 = u32(h + bigSigma1(e) + ch + constants[i]! + words[i]!);
    const t2 = u32(bigSigma0(a) + maj);
    h = g;
    g = f;
    f = e;
    e = u32(d + t1);
    d = c;
    c = b;
    b = a;
    a = u32(t1 + t2);
  }
  return [a, b, c, d, e, f, g, h];
}

function expandSha256Schedule(words: number[], firstWord = 16): void {
  for (let i = firstWord; i < 64; i++) {
    words.push(u32(sigma1(words[i - 2]!) + words[i - 7]! + sigma0(words[i - 15]!) + words[i - 16]!));
  }
}

function sha256Init(prefix7: Buffer): number[] {
  const words = new Array<number>(14).fill(0);
  words.push(((prefix7[0]! << 16) | (prefix7[1]! << 8) | prefix7[2]!) >>> 0);
  words.push(prefix7.readUInt32BE(3));
  for (let i = 16; i < 30; i++) {
    let val: number = SHA256_SCHEDULE[i - 16]!;
    if (i - 2 >= 14) {
      const s1 = sigma1(words[i - 2]!);
      val = u32(val + (i === 16 ? (s1 ^ SHA256_SIGMA1_ADJUSTMENT) >>> 0 : s1));
    }
    if (i - 7 >= 14) {
      val = u32(val + words[i - 7]!);
    }
    if (i - 15 >= 14) {
      const s0 = sigma0(words[i - 15]!);
      val = u32(val + (i === 29 ? (s0 ^ SHA256_SIGMA0_ADJUSTMENT) >>> 0 : s0));
    }
    words.push(val);
  }
  words.push(
    u32(
      sigma1(words[28]!) +
        words[23]! +
        sigma0(words[15]!) +
        words[14]! +
        SHA256_ADJUSTMENT -
        SHA256_ROUND_CONSTANTS[14]!,
    ),
  );
  expandSha256Schedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((x, idx) => u32(x + working[idx]!));
}

function sha256Digest(data: Buffer): Buffer {
  const totalLen = 57 + data.length;
  const zeroPadLen = (((55 - totalLen) % 64) + 64) % 64;
  const bitLen = BigInt(totalLen) * 8n;
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64BE(bitLen, 0);
  const padded = Buffer.concat([data.subarray(7), Buffer.from([0x80]), Buffer.alloc(zeroPadLen), lenBuf]);

  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let j = 0; j < 16; j++) {
      words.push(padded.readUInt32BE(offset + j * 4));
    }
    expandSha256Schedule(words, 16);
    const working = sha256Rounds(state, words, 0);
    state = state.map((x, idx) => u32(x + working[idx]!));
  }

  const out = Buffer.alloc(32);
  for (let i = 0; i < 8; i++) out.writeUInt32BE(state[i]!, i * 4);
  return out;
}

function wordsLe4Even(data: Buffer): number[] {
  const padLen = (4 - (data.length % 4)) % 4;
  const padded = padLen > 0 ? Buffer.concat([data, Buffer.alloc(padLen)]) : data;
  const words: number[] = [];
  for (let i = 0; i < padded.length; i += 4) {
    words.push(padded.readUInt32LE(i));
  }
  if (words.length % 2 === 1) words.push(0);
  return words;
}

function cs64Digest(data: Buffer, digest: Buffer): [number, number] {
  const keyA = (digest.readUInt32LE(0) | 1) >>> 0;
  const keyB = (digest.readUInt32LE(4) | 1) >>> 0;
  const factors: [number, number] = [mul32(keyA, CS64_FACTOR), mul32(keyB, CS64_FACTOR)];

  const terms: number[] = CS64_COEFFICIENTS.map(([coeff], idx) => mul32(coeff, factors[idx % 2]!));
  const offsets: number[] = CS64_COEFFICIENTS.map(([, off]) => off);

  const prefixed = Buffer.concat([Buffer.from([0]), data]);
  const leWords = wordsLe4Even(prefixed);
  for (let idx = 0; idx < leWords.length; idx++) {
    const w = leWords[idx]!;
    let term = mul32(w, idx % 2 === 0 ? keyA : keyB);
    let offset = mul32(rol16(w), idx % 2 === 0 ? 0xef0569fb : 0xc31713db);
    if (idx === 0) {
      term = u32(term + mul32(CS64_ADJUSTMENT0, factors[0]));
      offset = u32(offset + CS64_ADJUSTMENT1);
    }
    terms.push(term);
    offsets.push(offset);
  }

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;

  for (let i = 0; i < terms.length; i += 2) {
    const x = terms[i]!;
    const y = terms[i + 1]!;

    let t = rol16(u32(offsets[i]! + x));
    let q = mul32(t, 0x76f50f34);
    swapAcc = u32(swapAcc + u32(mul32(rol16(q), 0xc3efea97) + q));

    t = rol16(u32(offsets[i + 1]! + y));
    q = mul32(t, 0x1881ce3c);
    swapLast = u32(mul32(rol16(q), 0x35bd1ec9) + q);
    swapAcc = u32(swapAcc + swapLast);

    state = u32(mul32(state, keyA) + x);
    state = mul32(rol16(state), 0xcf98b111);
    state = mul32(rol16(state), 0x87085b9f);
    state = mul32(rol16(state), 0x12ceb96d);
    state = mul32(rol16(state), 0x257e1d83);
    acc = u32(acc + state);

    t = u32(mul32(state, keyB) + y);
    t = mul32(rol16(t), 0xa27416f5);
    t = mul32(rol16(t), 0xd38396ff);
    state = mul32(rol16(mul32(rol16(t), 0x7c932b89)), 0xbfa49f69);
    acc = u32(acc + state);
  }

  return [(swapLast ^ state) >>> 0, (swapAcc ^ acc) >>> 0];
}

let clockSkewSeconds = 0;

export function generateSecMsGecV2(unixTimestamp?: number): string {
  let ticks = unixTimestamp ?? Date.now() / 1000 + clockSkewSeconds;
  ticks += WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e7;
  const strToHash = `${Math.trunc(ticks)}${TRUSTED_CLIENT_TOKEN}`;
  const data = Buffer.from(strToHash, 'ascii');
  const digest = sha256Digest(data);
  const [c0, c1] = cs64Digest(data, digest);
  const cs64Buf = Buffer.alloc(8);
  cs64Buf.writeUInt32LE(c0, 0);
  cs64Buf.writeUInt32LE(c1, 4);
  return `${cs64Buf.toString('hex').toUpperCase()}-${digest.toString('hex').toUpperCase()}`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function connectOnce(
  text: string,
  voice: string,
  pitch: string,
  rate: string,
  timeoutMs: number,
): Promise<{ audio?: Buffer; retryWithSkew?: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (val: { audio?: Buffer; retryWithSkew?: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(val);
    };

    const connId = crypto.randomUUID().replace(/-/g, '');
    const muid = crypto.randomBytes(16).toString('hex').toUpperCase();
    const url =
      `${WSS_URL}` +
      `&Sec-MS-GEC=${generateSecMsGecV2()}` +
      `&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}` +
      `&ConnectionId=${connId}`;

    const ws = new WebSocket(url, {
      headers: {
        Pragma: 'no-cache',
        'Cache-Control': 'no-cache',
        Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
        Cookie: `muid=${muid};`,
      },
      handshakeTimeout: Math.min(3500, timeoutMs),
    });

    const timer = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      done({});
    }, timeoutMs);

    const chunks: Buffer[] = [];

    ws.on('unexpected-response', (_req, res) => {
      if (res.statusCode === 403 && typeof res.headers.date === 'string') {
        const serverMs = Date.parse(res.headers.date);
        if (Number.isFinite(serverMs)) {
          clockSkewSeconds = serverMs / 1000 - Date.now() / 1000;
          try {
            ws.terminate();
          } catch {
            /* ignore */
          }
          done({ retryWithSkew: true });
          return;
        }
      }
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      done({});
    });

    ws.on('open', () => {
      const ts = new Date().toUTCString();
      ws.send(
        `X-Timestamp:${ts}\r\n` +
          `Content-Type:application/json; charset=utf-8\r\n` +
          `Path:speech.config\r\n\r\n` +
          `{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n`,
      );

      const reqId = crypto.randomUUID().replace(/-/g, '');
      const locale = voice.split('-').slice(0, 2).join('-') || 'zh-TW';
      const ssml =
        `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${locale}'>` +
        `<voice name='${voice}'>` +
        `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escapeXml(text)}</prosody>` +
        `</voice></speak>`;

      ws.send(
        `X-RequestId:${reqId}\r\n` +
          `Content-Type:application/ssml+xml\r\n` +
          `X-Timestamp:${ts}Z\r\n` +
          `Path:ssml\r\n\r\n` +
          ssml,
      );
    });

    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        if (data.length > 2) {
          const headerLen = data.readUInt16BE(0);
          if (2 + headerLen < data.length) {
            const headerStr = data.subarray(2, 2 + headerLen).toString('utf8');
            if (headerStr.includes('Path:audio')) {
              chunks.push(data.subarray(2 + headerLen));
            }
          }
        }
      } else {
        const msg = data.toString('utf8');
        if (msg.includes('Path:turn.end')) {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          const audio = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
          done({ audio });
        }
      }
    });

    ws.on('error', () => {
      done({});
    });

    ws.on('close', () => {
      const audio = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
      done({ audio });
    });
  });
}

/**
 * 调用微软 Edge 神经语音合成 MP3（自动容错 403 时钟偏移重试一次）。
 */
export async function synthesizeEdgeNeuralTts(
  text: string,
  voice: string,
  pitch = '+3Hz',
  rate = '+0%',
  timeoutMs = 5500,
): Promise<Buffer | null> {
  const first = await connectOnce(text, voice, pitch, rate, timeoutMs);
  if (first.audio && first.audio.length >= 256) return first.audio;
  if (first.retryWithSkew) {
    const second = await connectOnce(text, voice, pitch, rate, timeoutMs);
    if (second.audio && second.audio.length >= 256) return second.audio;
  }
  return null;
}
