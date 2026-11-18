import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config';
import { recordEvent } from '../events';
import type { createLogger } from '../logger';
import type { Repository } from '../repository/types';
import { httpError } from '../http-utils';

export type MaintenanceMode = 'normal' | 'draining' | 'updating';

interface RoomMaintenancePayload {
  mode?: MaintenanceMode;
  activeHumanGames?: number;
  activeRooms?: Array<{
    roomId: string;
    gameId: string;
    round: number;
    humans: number;
    persistent: boolean;
  }>;
}

const DEFAULT_COMPENSATION_COINS = 1000;

let currentMode: MaintenanceMode = 'normal';
let currentMessage = '';
let currentCompensationCoins = DEFAULT_COMPENSATION_COINS;
let startedAt: number | null = null;
let lastCompletedVersion: string | null = null;
let lastCompletedAt: number | null = null;

/** 防止频繁轮询 /api/system/status 时对 room-server 造成请求风暴 */
let cachedRoomPoll: { at: number; activeHumanGames: number; activeRooms: NonNullable<RoomMaintenancePayload['activeRooms']> } = {
  at: 0,
  activeHumanGames: 0,
  activeRooms: [],
};

const compensatedVersions = new Set<string>();

export function getMaintenanceMode(): MaintenanceMode {
  return currentMode;
}

function requireMaintenanceAuth(req: FastifyRequest): void {
  const internalKey = req.headers['x-internal-key'];
  if (config.internalKey && internalKey === config.internalKey) return;

  const adminHeader = req.headers['x-admin-token'];
  const authHeader = req.headers.authorization;
  const bearer = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (config.adminToken && (adminHeader === config.adminToken || bearer === config.adminToken)) return;

  throw httpError('无权执行维护更新操作', 403);
}

async function fetchRoomMaintenanceStatus(force = false): Promise<{
  activeHumanGames: number;
  activeRooms: NonNullable<RoomMaintenancePayload['activeRooms']>;
}> {
  if (!force && Date.now() - cachedRoomPoll.at < 1500) {
    return { activeHumanGames: cachedRoomPoll.activeHumanGames, activeRooms: cachedRoomPoll.activeRooms };
  }
  try {
    const res = await fetch(`${config.roomServerUrl}/internal/maintenance/status`, {
      headers: { 'x-internal-key': config.internalKey },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      return { activeHumanGames: cachedRoomPoll.activeHumanGames, activeRooms: cachedRoomPoll.activeRooms };
    }
    const data = (await res.json()) as RoomMaintenancePayload;
    cachedRoomPoll = {
      at: Date.now(),
      activeHumanGames: Number(data.activeHumanGames ?? 0) || 0,
      activeRooms: Array.isArray(data.activeRooms) ? data.activeRooms : [],
    };
  } catch {
    /* room-server 正在重启时默认认为已排水完毕 */
    cachedRoomPoll = { at: Date.now(), activeHumanGames: 0, activeRooms: [] };
  }
  return { activeHumanGames: cachedRoomPoll.activeHumanGames, activeRooms: cachedRoomPoll.activeRooms };
}

async function pushRoomMaintenanceMode(mode: MaintenanceMode, message: string): Promise<RoomMaintenancePayload | null> {
  try {
    const res = await fetch(`${config.roomServerUrl}/internal/maintenance/mode`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-key': config.internalKey,
      },
      body: JSON.stringify({ mode, message }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as RoomMaintenancePayload;
    cachedRoomPoll = {
      at: Date.now(),
      activeHumanGames: Number(data.activeHumanGames ?? 0) || 0,
      activeRooms: Array.isArray(data.activeRooms) ? data.activeRooms : [],
    };
    return data;
  } catch {
    return null;
  }
}

export function registerMaintenanceRoutes(
  app: FastifyInstance,
  repo: Repository,
  apiLog: ReturnType<typeof createLogger>,
): void {
  /** 公开系统状态接口：供前端大厅与 maintenance.html 轮询，永不缓存 */
  app.get('/api/system/status', async (_req, reply) => {
    reply.header('cache-control', 'no-store, no-cache, must-revalidate');
    const roomInfo =
      currentMode === 'draining'
        ? await fetchRoomMaintenanceStatus(false)
        : { activeHumanGames: 0, activeRooms: [] };

    return {
      ok: true,
      mode: currentMode,
      message: currentMessage,
      compensationCoins: currentCompensationCoins,
      activeHumanGames: roomInfo.activeHumanGames,
      startedAt,
      lastCompletedVersion,
      lastCompletedAt,
    };
  });

  const handleDrain = async (req: FastifyRequest) => {
    requireMaintenanceAuth(req);
    const body = (req.body ?? {}) as { message?: string; compensationCoins?: number };
    const coins = Math.max(0, Math.floor(Number(body.compensationCoins ?? DEFAULT_COMPENSATION_COINS)));
    currentCompensationCoins = Number.isFinite(coins) ? coins : DEFAULT_COMPENSATION_COINS;
    currentMode = 'draining';
    currentMessage =
      body.message?.trim() ||
      `平台即将进行紧急升级更新，当前暂停开启新游戏，正在等待进行中的对局完成！更新完成后将自动补偿每位玩家 ${currentCompensationCoins.toLocaleString()} 欢乐豆。`;
    if (startedAt === null) startedAt = Date.now();

    await pushRoomMaintenanceMode('draining', currentMessage);
    const roomInfo = await fetchRoomMaintenanceStatus(true);
    apiLog.info('平台进入维护排水期（禁止开新局，等待在局玩家打完）', {
      activeHumanGames: roomInfo.activeHumanGames,
      compensationCoins: currentCompensationCoins,
    });
    recordEvent('warn', 'system', `平台进入更新排水期，剩余进行中对局 ${roomInfo.activeHumanGames} 桌`);

    return {
      ok: true,
      mode: currentMode,
      message: currentMessage,
      compensationCoins: currentCompensationCoins,
      activeHumanGames: roomInfo.activeHumanGames,
      activeRooms: roomInfo.activeRooms,
      startedAt,
    };
  };

  const handleStatus = async (req: FastifyRequest) => {
    requireMaintenanceAuth(req);
    const roomInfo = await fetchRoomMaintenanceStatus(true);
    return {
      ok: true,
      mode: currentMode,
      message: currentMessage,
      compensationCoins: currentCompensationCoins,
      activeHumanGames: roomInfo.activeHumanGames,
      activeRooms: roomInfo.activeRooms,
      startedAt,
      lastCompletedVersion,
      lastCompletedAt,
    };
  };

  const handleUpdating = async (req: FastifyRequest) => {
    requireMaintenanceAuth(req);
    const body = (req.body ?? {}) as { message?: string; compensationCoins?: number };
    if (body.compensationCoins !== undefined) {
      const coins = Math.max(0, Math.floor(Number(body.compensationCoins)));
      if (Number.isFinite(coins)) currentCompensationCoins = coins;
    }
    currentMode = 'updating';
    currentMessage =
      body.message?.trim() ||
      `平台正在紧急更新中，请耐心等待。更新完成后将自动为每位玩家发放 ${currentCompensationCoins.toLocaleString()} 欢乐豆补偿！`;
    if (startedAt === null) startedAt = Date.now();

    await pushRoomMaintenanceMode('updating', currentMessage);
    apiLog.info('平台进入正式更新中状态', { message: currentMessage });
    return {
      ok: true,
      mode: currentMode,
      message: currentMessage,
      compensationCoins: currentCompensationCoins,
      startedAt,
    };
  };

  const handleComplete = async (req: FastifyRequest) => {
    requireMaintenanceAuth(req);
    const body = (req.body ?? {}) as {
      version?: string;
      compensationCoins?: number;
      title?: string;
      content?: string;
      skipCompensation?: boolean;
    };

    const version = String(body.version ?? '').trim() || `upd-${Date.now()}`;
    const coins = Math.max(0, Math.floor(Number(body.compensationCoins ?? DEFAULT_COMPENSATION_COINS)));
    const grantCoins = Number.isFinite(coins) ? coins : DEFAULT_COMPENSATION_COINS;

    currentMode = 'normal';
    currentMessage = '';
    startedAt = null;
    lastCompletedVersion = version;
    lastCompletedAt = Date.now();
    await pushRoomMaintenanceMode('normal', '');

    let compensated = false;
    let mailId: string | null = null;

    if (!body.skipCompensation && grantCoins > 0) {
      const versionTag = `[版本 ${version}]`;
      let alreadySent = compensatedVersions.has(version);
      if (!alreadySent) {
        try {
          const recentMails = await repo.listAdminMails(30);
          alreadySent = recentMails.some((m) => m.content.includes(versionTag));
        } catch {
          /* ignore */
        }
      }

      if (!alreadySent) {
        const title = body.title?.trim() || `🎁 平台更新维护补偿 · ${grantCoins.toLocaleString()} 欢乐豆`;
        const content =
          body.content?.trim() ||
          `亲爱的牌友，平台已完成本次版本升级与体验优化！感谢您的耐心等待，特为您奉上 ${grantCoins.toLocaleString()} 欢乐豆更新补偿，点击下方即可领取到账，祝您把把好运！${versionTag}`;
        const mail = await repo.sendMail({
          targetType: 'all',
          sender: '系统运维中心',
          title: title.slice(0, 40),
          content: content.slice(0, 500),
          rewardCoins: grantCoins,
        });
        compensatedVersions.add(version);
        compensated = true;
        mailId = mail.id;
        apiLog.info('平台更新完成，已自动发放全服更新补偿邮件', { version, grantCoins, mailId });
        recordEvent('info', 'system', `平台升级完成 (${version})，已自动向全体玩家发放 ${grantCoins} 欢乐豆更新补偿邮件`);
      } else {
        compensatedVersions.add(version);
      }
    }

    return {
      ok: true,
      mode: currentMode,
      version,
      compensated,
      compensationCoins: grantCoins,
      mailId,
    };
  };

  // 同时支持部署脚本 (/internal/maintenance/*) 与 GM 运营端 (/api/admin/maintenance/*)
  app.post('/internal/maintenance/drain', handleDrain);
  app.get('/internal/maintenance/status', handleStatus);
  app.post('/internal/maintenance/updating', handleUpdating);
  app.post('/internal/maintenance/complete', handleComplete);

  app.post('/api/admin/maintenance/drain', handleDrain);
  app.get('/api/admin/maintenance/status', handleStatus);
  app.post('/api/admin/maintenance/updating', handleUpdating);
  app.post('/api/admin/maintenance/complete', handleComplete);
}
