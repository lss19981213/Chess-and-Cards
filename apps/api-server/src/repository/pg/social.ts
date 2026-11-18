import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { totalClaimableLevelReward, type Announcement } from '@cc/protocol';
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
    equipped_frame: string | null;
    owned_frames: string[] | null;
    worship_count: number | null;
    dealer_skin: string | null;
    dealer_voice: string | null;
    dealer_affection: number | null;
    level: number | null;
    xp: string | null;
    rewarded_level: number | null;
    total_turnover: string | null;
  }>(
    `select u.id, u.nickname, u.username, p.bio, ${avatarUrlSql('p', 'u.id')} as avatar_url, coalesce(u.banned, false) as banned,
            coalesce(p.equipped_frame, 'frame_default') as equipped_frame,
            coalesce(p.owned_frames, array['frame_default']::text[]) as owned_frames,
            coalesce(p.worship_count, 0) as worship_count,
            coalesce(p.dealer_skin, 'classic') as dealer_skin,
            coalesce(p.dealer_voice, 'classic') as dealer_voice,
            coalesce(p.dealer_affection, 0) as dealer_affection,
            coalesce(p.level, 1) as level,
            coalesce(p.xp, 0)::text as xp,
            coalesce(p.rewarded_level, 1) as rewarded_level,
            coalesce(p.total_turnover, 0)::text as total_turnover
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
    equippedFrame: row.equipped_frame ?? 'frame_default',
    ownedFrames: row.owned_frames ?? ['frame_default'],
    worshipCount: Number(row.worship_count ?? 0),
    dealerSkin: row.dealer_skin ?? 'classic',
    dealerVoice: row.dealer_voice ?? 'classic',
    dealerAffection: Number(row.dealer_affection ?? 0),
    level: Number(row.level ?? 1),
    xp: String(row.xp ?? '0'),
    rewardedLevel: Number(row.rewarded_level ?? 1),
    totalTurnover: String(row.total_turnover ?? '0'),
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

  if (
    patch.bio !== undefined ||
    patch.avatar !== undefined ||
    patch.equippedFrame !== undefined ||
    patch.dealerSkin !== undefined ||
    patch.dealerVoice !== undefined ||
    patch.dealerAffection !== undefined
  ) {
    await pool.query(
      `insert into user_profiles (user_id, bio, avatar, equipped_frame, dealer_skin, dealer_voice, dealer_affection, updated_at)
       values ($1, coalesce($2, ''), $3, coalesce($4, 'frame_default'), coalesce($5, 'classic'), coalesce($6, 'classic'), coalesce($8, 0), now())
       on conflict (user_id) do update
          set bio = coalesce($2, user_profiles.bio),
              avatar = case when $7 then $3 else user_profiles.avatar end,
              equipped_frame = coalesce($4, user_profiles.equipped_frame),
              dealer_skin = coalesce($5, user_profiles.dealer_skin),
              dealer_voice = coalesce($6, user_profiles.dealer_voice),
              dealer_affection = coalesce($8, user_profiles.dealer_affection),
              updated_at = now()`,
      [
        userId,
        patch.bio ?? null,
        patch.avatar ?? null,
        patch.equippedFrame ?? null,
        patch.dealerSkin ?? null,
        patch.dealerVoice ?? null,
        patch.avatar !== undefined,
        patch.dealerAffection !== undefined ? Math.max(0, Math.floor(patch.dealerAffection)) : null,
      ],
    );
  }

  return (await getProfile(pool, userId)) as PlayerProfile;
}

export async function buyAvatarFrame(
  pool: pg.Pool,
  userId: string,
  frameId: string,
  price: number,
): Promise<{ ok: boolean; balance: number; equippedFrame: string; ownedFrames: string[] }> {
  await pool.query(
    `insert into user_profiles (user_id, equipped_frame, owned_frames)
     values ($1, 'frame_default', array['frame_default']::text[])
     on conflict (user_id) do nothing`,
    [userId],
  );

  const profile = await getProfile(pool, userId);
  const currentOwned = profile?.ownedFrames ?? ['frame_default'];
  if (currentOwned.includes(frameId)) {
    await pool.query(
      `update user_profiles set equipped_frame = $2, updated_at = now() where user_id = $1`,
      [userId, frameId],
    );
    const bRes = await pool.query<{ balance: string }>(
      `select balance from wallets where user_id = $1 and currency = 'coin'`,
      [userId],
    );
    const balance = Number(bRes.rows[0]?.balance ?? 0);
    return { ok: true, balance, equippedFrame: frameId, ownedFrames: currentOwned };
  }

  const client = await pool.connect();
  try {
    await client.query('begin');
    const wRes = await client.query<{ balance: string }>(
      `select balance from wallets where user_id = $1 and currency = 'coin' for update`,
      [userId],
    );
    const currentBalance = Number(wRes.rows[0]?.balance ?? 0);
    if (currentBalance < price) {
      throw new Error(`筹码不足，购买头像框需要 ${price.toLocaleString()} 筹码`);
    }
    const newBalance = currentBalance - price;
    await client.query(
      `update wallets set balance = $2, version = version + 1 where user_id = $1 and currency = 'coin'`,
      [userId, newBalance],
    );
    await client.query(
      `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
       values ($1, 'coin', $2, $3, 'buy_frame', $4)`,
      [userId, -price, newBalance, `${frameId}:${Date.now()}`],
    );
    const updatedOwned = [...new Set([...currentOwned, frameId])];
    await client.query(
      `update user_profiles
          set equipped_frame = $2, owned_frames = $3, updated_at = now()
        where user_id = $1`,
      [userId, frameId, updatedOwned],
    );
    await client.query('commit');
    return { ok: true, balance: newBalance, equippedFrame: frameId, ownedFrames: updatedOwned };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function equipAvatarFrame(
  pool: pg.Pool,
  userId: string,
  frameId: string,
): Promise<{ ok: boolean; equippedFrame: string }> {
  const profile = await getProfile(pool, userId);
  const currentOwned = profile?.ownedFrames ?? ['frame_default'];
  if (frameId !== 'frame_default' && !currentOwned.includes(frameId)) {
    throw new Error('未拥有该头像框，请先使用筹码购买');
  }
  await pool.query(
    `insert into user_profiles (user_id, equipped_frame, owned_frames)
     values ($1, $2, array['frame_default']::text[])
     on conflict (user_id) do update set equipped_frame = $2, updated_at = now()`,
    [userId, frameId],
  );
  return { ok: true, equippedFrame: frameId };
}

export async function getWorshipRemainingToday(
  pool: pg.Pool,
  worshiperId: string,
  dayKey: string,
): Promise<number> {
  const res = await pool.query<{ count: string }>(
    `select count(*) from worship_records where worshiper_id = $1 and day_key = $2`,
    [worshiperId, dayKey],
  );
  const used = Number(res.rows[0]?.count ?? 0);
  return Math.max(0, 10 - used);
}

export async function worshipUser(
  pool: pg.Pool,
  worshiperId: string,
  targetUserId: string,
  dayKey: string,
): Promise<{ ok: boolean; remainingToday: number; newWorshipCount: number; reward: number; message?: string }> {
  if (worshiperId === targetUserId) {
    throw new Error('不能膜拜自己哦');
  }
  const remaining = await getWorshipRemainingToday(pool, worshiperId, dayKey);
  if (remaining <= 0) {
    throw new Error('今日膜拜次数已达上限（10/10 次），明天再来吧');
  }

  await pool.query(
    `insert into user_profiles (user_id, worship_count)
     values ($1, 0)
     on conflict (user_id) do nothing`,
    [targetUserId],
  );

  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into worship_records (worshiper_id, target_user_id, day_key) values ($1, $2, $3)`,
      [worshiperId, targetUserId, dayKey],
    );
    const tRes = await client.query<{ worship_count: number }>(
      `update user_profiles
          set worship_count = worship_count + 1, updated_at = now()
        where user_id = $1
        returning worship_count`,
      [targetUserId],
    );
    const newWorshipCount = Number(tRes.rows[0]?.worship_count ?? 1);

    const rewardCoins = 188;
    const wRes = await client.query<{ balance: string }>(
      `update wallets
          set balance = balance + $2, version = version + 1
        where user_id = $1 and currency = 'coin'
        returning balance`,
      [worshiperId, rewardCoins],
    );
    const newBal = Number(wRes.rows[0]?.balance ?? 0);
    await client.query(
      `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
       values ($1, 'coin', $2, $3, 'worship_reward', $4)`,
      [worshiperId, rewardCoins, newBal, `${dayKey}:${worshiperId}:${Date.now()}`],
    );

    await client.query('commit');
    return {
      ok: true,
      remainingToday: remaining - 1,
      newWorshipCount,
      reward: rewardCoins,
      message: `膜拜成功！获得赞誉回馈 +${rewardCoins} 筹码！`,
    };
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

export async function customizeDealer(
  pool: pg.Pool,
  userId: string,
  skin: string,
  voice: string,
): Promise<{ ok: boolean; dealerSkin: string; dealerVoice: string }> {
  await pool.query(
    `insert into user_profiles (user_id, dealer_skin, dealer_voice)
     values ($1, $2, $3)
     on conflict (user_id) do update
        set dealer_skin = $2, dealer_voice = $3, updated_at = now()`,
    [userId, skin, voice],
  );
  return { ok: true, dealerSkin: skin, dealerVoice: voice };
}

export async function addDealerAffection(
  pool: pg.Pool,
  userId: string,
  amount: number,
): Promise<number> {
  const safeAmount = Math.max(0, Math.floor(amount));
  const res = await pool.query<{ dealer_affection: number }>(
    `insert into user_profiles (user_id, dealer_affection)
     values ($1, $2)
     on conflict (user_id) do update
        set dealer_affection = user_profiles.dealer_affection + $2, updated_at = now()
     returning dealer_affection`,
    [userId, safeAmount],
  );
  return res.rows[0]?.dealer_affection ?? safeAmount;
}

export async function claimLevelReward(
  pool: pg.Pool,
  userId: string,
): Promise<{
  ok: boolean;
  claimedLevels: number;
  reward: number;
  balance: number;
  level: number;
  rewardedLevel: number;
}> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `insert into user_profiles (user_id) values ($1) on conflict (user_id) do nothing`,
      [userId],
    );
    const profRes = await client.query<{ level: number; rewarded_level: number }>(
      `select coalesce(level, 1) as level, coalesce(rewarded_level, 1) as rewarded_level
         from user_profiles
        where user_id = $1
        for update`,
      [userId],
    );
    const level = Number(profRes.rows[0]?.level ?? 1);
    const rewardedLevel = Number(profRes.rows[0]?.rewarded_level ?? 1);
    const reward = totalClaimableLevelReward(level, rewardedLevel);
    const claimedLevels = Math.max(0, level - rewardedLevel);
    if (claimedLevels <= 0 || reward <= 0) {
      throw new Error('暂无可领取的升级筹码奖励，快去对局积累流水升级吧！');
    }

    const wRes = await client.query<{ balance: string }>(
      `select balance from wallets where user_id = $1 and currency = 'coin' for update`,
      [userId],
    );
    const curBalance = Number(wRes.rows[0]?.balance ?? 0);
    const newBalance = curBalance + reward;

    await client.query(
      `update wallets set balance = $2, version = version + 1 where user_id = $1 and currency = 'coin'`,
      [userId, newBalance],
    );
    await client.query(
      `insert into ledger (user_id, currency, delta, balance_after, biz_type, biz_id)
       values ($1, 'coin', $2, $3, 'level_reward', $4)
       on conflict (biz_type, biz_id, user_id) do nothing`,
      [userId, reward, newBalance, `level:${userId}:${rewardedLevel}->${level}`],
    );
    await client.query(
      `update user_profiles set rewarded_level = $2, updated_at = now() where user_id = $1`,
      [userId, level],
    );

    await client.query('COMMIT');
    return {
      ok: true,
      claimedLevels,
      reward,
      balance: newBalance,
      level,
      rewardedLevel: level,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
