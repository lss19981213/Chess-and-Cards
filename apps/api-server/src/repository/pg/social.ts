import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { Announcement } from '@cc/protocol';
import type { FriendRequestStatus, FriendRequestView, PlayerProfile, ProfilePatch } from '../types';
import { avatarUrlSql } from './shared';

export async function listAnnouncements(pool: pg.Pool, limit: number): Promise<Announcement[]> {
  const res = await pool.query<{
    id: string;
    title: string;
    content: string;
    kind: string;
    created_at: Date;
  }>(
    `select id, title, content, kind, created_at
       from announcements
      order by created_at desc
      limit $1`,
    [Math.min(Math.max(1, limit), 50)],
  );
  return res.rows.map((row) => ({
    id: row.id,
    title: row.title,
    content: row.content,
    kind: row.kind as Announcement['kind'],
    createdAt: new Date(row.created_at).getTime(),
  }));
}

export async function createAnnouncement(
  pool: pg.Pool,
  input: { title: string; content: string; kind: Announcement['kind'] },
): Promise<Announcement> {
  const id = randomUUID();
  const res = await pool.query<{ created_at: Date }>(
    `insert into announcements (id, title, content, kind)
     values ($1, $2, $3, $4)
     returning created_at`,
    [id, input.title, input.content, input.kind],
  );
  const created = res.rows[0]?.created_at;
  return { id, ...input, createdAt: created ? new Date(created).getTime() : Date.now() };
}

export async function deleteAnnouncement(pool: pg.Pool, id: string): Promise<boolean> {
  const res = await pool.query('delete from announcements where id = $1', [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function getAvatar(pool: pg.Pool, userId: string): Promise<string | null> {
  const res = await pool.query<{ avatar: string | null }>(
    'select avatar from user_profiles where user_id = $1',
    [userId],
  );
  return res.rows[0]?.avatar ?? null;
}

export async function getProfile(pool: pg.Pool, userId: string): Promise<PlayerProfile | null> {
  const res = await pool.query<{
    id: string;
    nickname: string;
    username: string | null;
    bio: string | null;
    avatar_url: string | null;
    banned: boolean;
  }>(
    `select u.id, u.nickname, u.username, p.bio, ${avatarUrlSql('p', 'u.id')} as avatar_url, coalesce(u.banned, false) as banned
       from users u
       left join user_profiles p on p.user_id = u.id
      where u.id = $1`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    userId: row.id,
    nickname: row.nickname,
    username: row.username,
    bio: row.bio ?? '',
    avatar: row.avatar_url ?? null,
    banned: Boolean(row.banned),
  };
}

export async function updateProfile(
  pool: pg.Pool,
  userId: string,
  patch: ProfilePatch,
): Promise<PlayerProfile> {
  if (patch.nickname !== undefined) {
    const nickname = patch.nickname.trim();
    if (nickname.length < 2 || nickname.length > 16) throw new Error('昵称需 2-16 个字符');
    try {
      await pool.query('update users set nickname = $2 where id = $1', [userId, nickname]);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new Error('该昵称已被其他玩家使用', { cause: error });
      }
      throw error;
    }
  }

  if (patch.bio !== undefined || patch.avatar !== undefined) {
    await pool.query(
      `insert into user_profiles (user_id, bio, avatar, updated_at)
       values ($1, coalesce($2, ''), $3, now())
       on conflict (user_id) do update
          set bio = coalesce($2, user_profiles.bio),
              avatar = case when $4 then $3 else user_profiles.avatar end,
              updated_at = now()`,
      [userId, patch.bio ?? null, patch.avatar ?? null, patch.avatar !== undefined],
    );
  }

  return (await getProfile(pool, userId)) as PlayerProfile;
}

export async function searchUsers(
  pool: pg.Pool,
  keyword: string,
  excludeUserId: string,
  limit: number,
): Promise<PlayerProfile[]> {
  const q = `%${keyword.trim()}%`;
  const res = await pool.query<{
    id: string;
    nickname: string;
    username: string | null;
    bio: string | null;
    avatar_url: string | null;
    banned: boolean;
    is_friend: boolean;
    request_pending: boolean;
  }>(
    `select u.id, u.nickname, u.username, p.bio, ${avatarUrlSql('p', 'u.id')} as avatar_url,
            coalesce(u.banned, false) as banned,
            exists (select 1 from friendships f
                     where f.user_id = $2 and f.friend_id = u.id) as is_friend,
            exists (select 1 from friend_requests r
                     where r.from_id = $2 and r.to_id = u.id and r.status = 'pending') as request_pending
       from users u
       left join user_profiles p on p.user_id = u.id
      where u.id <> $2
        and ($1 = '%%' or u.nickname ilike $1 or coalesce(u.username, '') ilike $1)
      order by u.created_at desc
      limit $3`,
    [q, excludeUserId, limit],
  );
  return res.rows.map((row) => ({
    userId: row.id,
    nickname: row.nickname,
    username: row.username,
    bio: row.bio ?? '',
    avatar: row.avatar_url ?? null,
    banned: Boolean(row.banned),
    isFriend: row.is_friend,
    requestPending: row.request_pending,
  }));
}

async function linkFriends(pool: pg.Pool, a: string, b: string): Promise<void> {
  await pool.query(
    `insert into friendships (user_id, friend_id)
     values ($1, $2), ($2, $1)
     on conflict do nothing`,
    [a, b],
  );
}

export async function areFriends(pool: pg.Pool, userId: string, friendId: string): Promise<boolean> {
  const res = await pool.query(
    'select 1 from friendships where user_id = $1 and friend_id = $2',
    [userId, friendId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listFriends(pool: pg.Pool, userId: string): Promise<PlayerProfile[]> {
  const res = await pool.query<{
    id: string;
    nickname: string;
    username: string | null;
    bio: string | null;
    avatar_url: string | null;
  }>(
    `select u.id, u.nickname, u.username, p.bio, ${avatarUrlSql('p', 'u.id')} as avatar_url
       from friendships f
       join users u on u.id = f.friend_id
       left join user_profiles p on p.user_id = u.id
      where f.user_id = $1
      order by u.nickname asc`,
    [userId],
  );
  return res.rows.map((row) => ({
    userId: row.id,
    nickname: row.nickname,
    username: row.username,
    bio: row.bio ?? '',
    avatar: row.avatar_url ?? null,
    isFriend: true,
  }));
}

export async function createFriendRequest(
  pool: pg.Pool,
  fromId: string,
  toId: string,
  message: string | null,
): Promise<FriendRequestView> {
  if (fromId === toId) throw new Error('不能添加自己为好友');
  const target = await getProfile(pool, toId);
  if (!target) throw new Error('该玩家不存在');
  if (await areFriends(pool, fromId, toId)) throw new Error('你们已经是好友了');

  const pending = await pool.query<{ id: string }>(
    `select id from friend_requests
      where from_id = $1 and to_id = $2 and status = 'pending'`,
    [fromId, toId],
  );
  if (pending.rowCount && pending.rowCount > 0) throw new Error('已发送过申请，请等待对方处理');

  const reverse = await pool.query<{ id: string }>(
    `update friend_requests set status = 'accepted'
      where from_id = $2 and to_id = $1 and status = 'pending'
      returning id`,
    [fromId, toId],
  );
  if (reverse.rowCount && reverse.rowCount > 0) {
    await linkFriends(pool, fromId, toId);
  }

  const status: FriendRequestStatus = reverse.rowCount && reverse.rowCount > 0 ? 'accepted' : 'pending';
  const id = randomUUID();
  if (status === 'pending') {
    await pool.query(
      `insert into friend_requests (id, from_id, to_id, message, status)
       values ($1, $2, $3, $4, 'pending')`,
      [id, fromId, toId, message],
    );
  }

  const from = (await getProfile(pool, fromId)) as PlayerProfile;
  return {
    id,
    fromId,
    fromNickname: from.nickname,
    fromAvatar: from.avatar,
    toId,
    toNickname: target.nickname,
    toAvatar: target.avatar,
    message,
    status,
    createdAt: Date.now(),
  };
}

export async function listFriendRequests(
  pool: pg.Pool,
  userId: string,
): Promise<{ incoming: FriendRequestView[]; outgoing: FriendRequestView[] }> {
  const res = await pool.query<{
    id: string;
    from_id: string;
    from_nickname: string;
    from_avatar: string | null;
    to_id: string;
    to_nickname: string;
    to_avatar: string | null;
    message: string | null;
    status: FriendRequestStatus;
    created_at: Date;
  }>(
    `select r.id, r.from_id, fu.nickname as from_nickname, ${avatarUrlSql('fp', 'r.from_id')} as from_avatar,
            r.to_id, tu.nickname as to_nickname, ${avatarUrlSql('tp', 'r.to_id')} as to_avatar,
            r.message, r.status, r.created_at
       from friend_requests r
       join users fu on fu.id = r.from_id
       join users tu on tu.id = r.to_id
       left join user_profiles fp on fp.user_id = r.from_id
       left join user_profiles tp on tp.user_id = r.to_id
      where r.status = 'pending' and (r.from_id = $1 or r.to_id = $1)
      order by r.created_at desc`,
    [userId],
  );

  const rows = res.rows.map<FriendRequestView>((row) => ({
    id: row.id,
    fromId: row.from_id,
    fromNickname: row.from_nickname,
    fromAvatar: row.from_avatar,
    toId: row.to_id,
    toNickname: row.to_nickname,
    toAvatar: row.to_avatar,
    message: row.message,
    status: row.status,
    createdAt: new Date(row.created_at).getTime(),
  }));

  return {
    incoming: rows.filter((row) => row.toId === userId),
    outgoing: rows.filter((row) => row.fromId === userId),
  };
}

export async function acceptFriendRequest(
  pool: pg.Pool,
  requestId: string,
  userId: string,
): Promise<boolean> {
  const res = await pool.query<{ from_id: string }>(
    `update friend_requests set status = 'accepted'
      where id = $1 and to_id = $2 and status = 'pending'
      returning from_id`,
    [requestId, userId],
  );
  const fromId = res.rows[0]?.from_id;
  if (!fromId) return false;
  await linkFriends(pool, fromId, userId);
  return true;
}

export async function rejectFriendRequest(
  pool: pg.Pool,
  requestId: string,
  userId: string,
): Promise<boolean> {
  const res = await pool.query(
    `update friend_requests set status = 'rejected'
      where id = $1 and to_id = $2 and status = 'pending'`,
    [requestId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function removeFriend(
  pool: pg.Pool,
  userId: string,
  friendId: string,
): Promise<boolean> {
  const res = await pool.query(
    `delete from friendships
      where (user_id = $1 and friend_id = $2) or (user_id = $2 and friend_id = $1)`,
    [userId, friendId],
  );
  return (res.rowCount ?? 0) > 0;
}
