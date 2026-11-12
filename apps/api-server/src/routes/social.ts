import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { assertValidAvatar, authHeader, decodeAvatarDataUrl, httpError } from '../http-utils';
import type { Repository } from '../repository/types';
import { buildTasks } from './lobby';

/** 房间邀请短时效缓存（30 分钟），进程内存储，重启即清空 */
interface RoomInviteRecord {
  id: string;
  fromId: string;
  fromNickname: string;
  fromAvatar: string | null;
  toId: string;
  roomId: string;
  gameId: string;
  roomName: string;
  createdAt: number;
}

const INVITE_TTL_MS = 30 * 60_000;

export function registerSocialRoutes(app: FastifyInstance, repo: Repository): () => void {
  const roomInvites: RoomInviteRecord[] = [];

  const pruneInvites = (): void => {
    const deadline = Date.now() - INVITE_TTL_MS;
    for (let i = roomInvites.length - 1; i >= 0; i -= 1) {
      if (roomInvites[i]!.createdAt < deadline) roomInvites.splice(i, 1);
    }
  };

  // ---------- 独立头像读取 ----------
  app.get('/api/avatar/:userId', async (req, reply) => {
    const { userId } = req.params as { userId: string };
    const raw = await repo.getAvatar(userId);
    const decoded = raw ? decodeAvatarDataUrl(raw) : null;
    if (!decoded) {
      return reply.status(404).send({ error: '头像不存在' });
    }

    const hasVersion = Boolean((req.query as { v?: string })?.v);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('etag', decoded.etag);
    reply.header('cache-control', hasVersion ? 'public, max-age=86400' : 'public, max-age=300');

    if (req.headers['if-none-match'] === decoded.etag) {
      return reply.status(304).send();
    }
    return reply.type(decoded.contentType).send(decoded.bytes);
  });

  // ---------- 个人资料 ----------

  app.get('/api/profile', async (req) => {
    const claims = authHeader(req);
    const [profile, balance, friends, rank] = await Promise.all([
      repo.getProfile(claims.sub),
      repo.getBalance(claims.sub, 'coin'),
      repo.listFriends(claims.sub),
      repo.leaderboardRank(claims.sub),
    ]);
    if (!profile) throw httpError('用户不存在', 404);
    const tasks = await buildTasks(repo, claims.sub, balance);
    const achieved = tasks.filter((task) => task.claimed).length;
    return { profile, balance, friendsCount: friends.length, rank, achievements: achieved };
  });

  app.patch('/api/profile', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: { nickname?: string; bio?: string; avatar?: string | null } = {};

    if (body.nickname !== undefined) {
      const nickname = String(body.nickname).trim();
      if (nickname.length < 2 || nickname.length > 16) throw httpError('昵称需 2-16 个字符', 400);
      patch.nickname = nickname;
    }
    if (body.bio !== undefined) patch.bio = String(body.bio).slice(0, 60);
    if (body.avatar !== undefined) {
      const avatar = body.avatar === null ? null : String(body.avatar);
      // 前端未更换头像时可能回传 `/api/avatar/...` URL，这种情况视为未修改
      if (avatar === null) {
        patch.avatar = null;
      } else if (!/^(\/lobby)?\/api\/avatar\//.test(avatar)) {
        assertValidAvatar(avatar);
        patch.avatar = avatar;
      }
    }
    if (Object.keys(patch).length === 0) throw httpError('没有需要更新的内容', 400);

    try {
      const profile = await repo.updateProfile(claims.sub, patch);
      return { profile };
    } catch (error) {
      throw httpError((error as Error).message, 400);
    }
  });

  app.get('/api/users/search', async (req) => {
    const claims = authHeader(req);
    const query = req.query as { q?: string };
    const keyword = (query.q ?? '').trim();
    const users = await repo.searchUsers(keyword, claims.sub, 20);
    return { users };
  });

  // ---------- 好友 ----------

  app.get('/api/friends', async (req) => {
    const claims = authHeader(req);
    const [friends, requests] = await Promise.all([
      repo.listFriends(claims.sub),
      repo.listFriendRequests(claims.sub),
    ]);
    return { friends, incoming: requests.incoming, outgoing: requests.outgoing };
  });

  app.post('/api/friends/request', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const message = typeof body.message === 'string' ? body.message.slice(0, 40) : null;
    if (!userId) throw httpError('缺少目标玩家', 400);

    try {
      const created = await repo.createFriendRequest(claims.sub, userId, message);
      return { ok: true, request: created };
    } catch (error) {
      throw httpError((error as Error).message, 400);
    }
  });

  app.post('/api/friends/accept', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const ok = await repo.acceptFriendRequest(requestId, claims.sub);
    if (!ok) throw httpError('申请不存在或已处理', 404);
    const friends = await repo.listFriends(claims.sub);
    return { ok: true, friends };
  });

  app.post('/api/friends/reject', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const requestId = typeof body.requestId === 'string' ? body.requestId : '';
    const ok = await repo.rejectFriendRequest(requestId, claims.sub);
    if (!ok) throw httpError('申请不存在或已处理', 404);
    return { ok: true };
  });

  app.delete('/api/friends/:userId', async (req) => {
    const claims = authHeader(req);
    const { userId } = req.params as { userId: string };
    const ok = await repo.removeFriend(claims.sub, userId);
    if (!ok) throw httpError('你们还不是好友', 404);
    return { ok: true };
  });

  // ---------- 房间邀请 ----------

  app.post('/api/rooms/invite', async (req) => {
    const claims = authHeader(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const roomId = typeof body.roomId === 'string' ? body.roomId : '';
    const gameId = typeof body.gameId === 'string' ? body.gameId : '';
    const roomName = typeof body.roomName === 'string' ? body.roomName.slice(0, 30) : '牌桌';
    const targets = Array.isArray(body.friendIds)
      ? (body.friendIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : [];

    if (!roomId || !gameId) throw httpError('缺少房间信息', 400);
    if (targets.length === 0) throw httpError('请先选择好友', 400);

    const me = await repo.getProfile(claims.sub);
    let sent = 0;
    for (const toId of targets.slice(0, 20)) {
      if (!(await repo.areFriends(claims.sub, toId))) continue;
      roomInvites.push({
        id: randomUUID(),
        fromId: claims.sub,
        fromNickname: me?.nickname ?? '牌友',
        fromAvatar: me?.avatar ?? null,
        toId,
        roomId,
        gameId,
        roomName,
        createdAt: Date.now(),
      });
      sent += 1;
    }
    pruneInvites();
    if (sent === 0) throw httpError('只能邀请好友，非好友请复制邀请链接', 400);
    return { ok: true, sent };
  });

  app.get('/api/rooms/invites', async (req) => {
    const claims = authHeader(req);
    pruneInvites();
    const mine = roomInvites
      .filter((invite) => invite.toId === claims.sub)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 20);
    return { invites: mine };
  });

  app.delete('/api/rooms/invites/:id', async (req) => {
    const claims = authHeader(req);
    const { id } = req.params as { id: string };
    const index = roomInvites.findIndex((invite) => invite.id === id && invite.toId === claims.sub);
    if (index >= 0) roomInvites.splice(index, 1);
    return { ok: index >= 0 };
  });

  return pruneInvites;
}
