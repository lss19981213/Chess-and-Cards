export const SCHEMA_SQL = `
create table if not exists users (
  id            text primary key,
  nickname      text not null,
  username      text,
  password_hash text,
  created_at    timestamptz not null default now()
);

-- 老库升级：补齐账号体系字段
alter table users add column if not exists username text;
alter table users add column if not exists password_hash text;
alter table users add column if not exists banned boolean not null default false;

-- 账号体系：用户名大小写不敏感唯一（历史游客数据 username 为空，不参与唯一约束）
-- 登录按 lower(username) 匹配，索引也必须按 lower 建，否则 Alice 与 alice 可并存。
create unique index if not exists users_username_lower_uniq
  on users (lower(username)) where username is not null;
drop index if exists users_username_uniq;
alter table users drop constraint if exists users_nickname_key;

-- 昵称大小写不敏感唯一，防止冒名。老库若已有重名，索引创建失败但不阻断启动，
-- 由应用层查询兜底拒绝新的重名。
do $$
begin
  create unique index if not exists users_nickname_lower_uniq on users (lower(nickname));
exception when unique_violation then
  raise notice 'users 表存在重复昵称，跳过唯一索引创建';
end
$$;

create table if not exists wallets (
  user_id  text primary key references users(id),
  currency text not null default 'coin',
  balance  bigint not null default 0,
  version  integer not null default 0
);

create index if not exists wallets_balance_idx on wallets (balance desc);

create table if not exists ledger (
  id            bigserial primary key,
  user_id       text not null,
  currency      text not null,
  delta         bigint not null,
  balance_after bigint not null,
  biz_type      text not null,
  biz_id        text not null,
  created_at    timestamptz not null default now()
);

-- 账本幂等：同一业务单据对同一用户只能入账一次
create unique index if not exists ledger_idempotent
  on ledger (biz_type, biz_id, user_id);

-- 后台按业务类型回看流水（对账、日榜查询）用
create index if not exists ledger_biz_created_idx on ledger (biz_type, created_at desc);
create index if not exists ledger_user_created_idx on ledger (user_id, created_at desc);

create table if not exists game_records (
  settlement_id text primary key,
  room_id       text not null,
  game_id       text not null,
  round         integer not null,
  seed          text not null,
  winners       text[] not null default '{}',
  participants  text[] not null default '{}',
  detail        jsonb not null,
  created_at    timestamptz not null default now()
);

alter table game_records add column if not exists participants text[] not null default '{}';

create index if not exists game_records_game_idx on game_records (game_id, created_at desc);
create index if not exists game_records_participants_gin on game_records using gin (participants);

-- 老库回填 participants：只在字段为空但 detail 里有玩家记录时补齐，避免重复扫描
update game_records
   set participants = coalesce(
     (select array_agg(distinct e->>'playerId') from jsonb_array_elements(detail->'entries') e),
     '{}'
   )
 where cardinality(participants) = 0
   and jsonb_array_length(coalesce(detail->'entries', '[]'::jsonb)) > 0;

create table if not exists task_progress (
  user_id    text not null,
  task_key   text not null,
  period_key text not null,
  progress   integer not null default 0,
  claimed_at timestamptz,
  primary key (user_id, task_key, period_key)
);

create table if not exists announcements (
  id         text primary key,
  title      text not null,
  content    text not null,
  kind       text not null default 'notice',
  created_at timestamptz not null default now()
);

create index if not exists announcements_created_idx on announcements (created_at desc);

-- 筹码永远不允许为负：先修正历史脏数据，再加数据库兜底约束。
-- 老库的表已存在，CREATE TABLE IF NOT EXISTS 不会补约束，所以这里显式 ALTER。
update wallets set balance = 0 where balance < 0;
alter table wallets drop constraint if exists wallets_balance_nonneg;
alter table wallets add constraint wallets_balance_nonneg check (balance >= 0);

-- 每日排行榜结算快照：0 点按当天排名发奖后留档，用于展示上期榜单与奖励
create table if not exists leaderboard_daily_snapshots (
  period_key text    not null,
  user_id    text    not null,
  nickname   text    not null,
  rank       integer not null,
  balance    bigint  not null,
  reward     integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (period_key, user_id)
);

create index if not exists leaderboard_daily_snapshots_idx
  on leaderboard_daily_snapshots (period_key, rank);

-- 玩家扩展资料：个性签名与头像（头像为压缩后的 data URL）
create table if not exists user_profiles (
  user_id    text primary key references users(id) on delete cascade,
  bio        text not null default '',
  avatar     text,
  updated_at timestamptz not null default now()
);

-- 好友申请
create table if not exists friend_requests (
  id         text primary key,
  from_id    text not null references users(id) on delete cascade,
  to_id      text not null references users(id) on delete cascade,
  message    text,
  status     text not null default 'pending',
  created_at timestamptz not null default now()
);

create index if not exists friend_requests_to_idx on friend_requests (to_id, status);
create index if not exists friend_requests_from_idx on friend_requests (from_id, status);

-- 同一对用户只保留一条待处理申请，避免刷屏
create unique index if not exists friend_requests_pending_uniq
  on friend_requests (from_id, to_id) where status = 'pending';

-- 好友关系：双向各存一条，查询各自好友列表时只需单边索引
create table if not exists friendships (
  user_id    text not null references users(id) on delete cascade,
  friend_id  text not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id)
);
`;
