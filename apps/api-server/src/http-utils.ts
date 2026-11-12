import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { verifyToken, type TokenPayload } from '@cc/auth';
import { config } from './config';

// 头像以独立 URL 异步加载，单张上限 64KB，兼顾清晰度与数据库开销
export const AVATAR_MAX_BYTES = 64 * 1024;

export interface DecodedAvatar {
  bytes: Buffer;
  contentType: string;
  etag: string;
}

export function httpError(message: string, statusCode: number): Error {
  const error = new Error(message);
  (error as Error & { statusCode?: number }).statusCode = statusCode;
  return error;
}

export function authHeader(req: FastifyRequest): TokenPayload {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : '';
  const claims = token ? verifyToken(config.jwtSecret, token) : null;
  if (!claims) throw httpError('未登录或登录已过期', 401);
  return claims;
}

/**
 * 只在 Fastify 按 trustProxy 配置解析后取 IP。
 * 直接读 X-Forwarded-For 首段会被客户端伪造，导致限流形同虚设。
 */
export function clientIp(req: FastifyRequest): string {
  return req.ip || 'unknown';
}

/** 恒定时间比较，避免按响应时间逐位猜口令 */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** 解析 data URL 格式头像，校验体积与真实文件头 */
export function decodeAvatarDataUrl(raw: string): DecodedAvatar | null {
  const match = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!match?.[1] || !match?.[2]) return null;
  const subtype = match[1] === 'jpg' ? 'jpeg' : match[1];
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) return null;

  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isWebp =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP';

  if (!isPng && !isJpeg && !isWebp) return null;
  const matchesMime =
    (subtype === 'png' && isPng) ||
    (subtype === 'jpeg' && isJpeg) ||
    (subtype === 'webp' && isWebp);
  if (!matchesMime) return null;

  const etag = `"${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}"`;
  return { bytes, contentType: `image/${subtype}`, etag };
}

/** 头像以 data URL 入库，写入前严格校验声明 MIME、体积与文件头魔数 */
export function assertValidAvatar(raw: string): void {
  const formatOk = /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(raw);
  if (!formatOk?.[1]) throw httpError('头像格式不支持，请使用 PNG / JPG / WebP', 400);
  const bytes = Buffer.from(formatOk[1], 'base64');
  if (bytes.length === 0 || bytes.length > AVATAR_MAX_BYTES) {
    throw httpError('头像文件过大，请重新选择', 400);
  }
  if (!decodeAvatarDataUrl(raw)) {
    throw httpError('头像内容与声明的格式不符', 400);
  }
}
