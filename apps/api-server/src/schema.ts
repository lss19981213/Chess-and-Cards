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
alter table users add column if not exists email text;
alter table users add column if not exists invited_by text;
alter table users add column if not exists oauth_provider text;
alter table users add column if not exists oauth_sub text;
create index if not exists users_email_lower_idx on users (lower(email)) where email is not null;

-- 一个邮箱只能创建一个账号（大小写不敏感唯一；老库若有历史脏数据则跳过建索引，由应用层查询兜底）
do $$
begin
  create unique index if not exists users_email_lower_uniq
    on users (lower(email)) where email is not null;
exception when unique_violation then
  raise notice 'users 表存在重复邮箱，跳过唯一索引创建';
end
$$;

-- 第三方 OAuth 账号唯一绑定（如奇幻维度 fantasyclaw）
create unique index if not exists users_oauth_provider_sub_uniq
  on users (oauth_provider, oauth_sub) where oauth_provider is not null and oauth_sub is not null;

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
  equipped_frame text not null default 'frame_default',
  owned_frames   text[] not null default '{"frame_default"}',
  worship_count  integer not null default 0,
  dealer_skin    text not null default 'classic',
  dealer_voice   text not null default 'classic',
  dealer_affection integer not null default 0,
  level          integer not null default 1,
  xp             numeric(40, 0) not null default 0,
  rewarded_level integer not null default 1,
  total_turnover numeric(40, 0) not null default 0,
  updated_at timestamptz not null default now()
);

-- 兼容老数据库：补齐头像框、膜拜数、荷官装扮与好感度、账号等级经验字段
alter table user_profiles add column if not exists equipped_frame text not null default 'frame_default';
alter table user_profiles add column if not exists owned_frames text[] not null default '{"frame_default"}';
alter table user_profiles add column if not exists worship_count integer not null default 0;
alter table user_profiles add column if not exists dealer_skin text not null default 'classic';
alter table user_profiles add column if not exists dealer_voice text not null default 'classic';
alter table user_profiles add column if not exists dealer_affection integer not null default 0;
alter table user_profiles add column if not exists level integer not null default 1;
alter table user_profiles add column if not exists xp numeric(40, 0) not null default 0;
alter table user_profiles add column if not exists rewarded_level integer not null default 1;
alter table user_profiles add column if not exists total_turnover numeric(40, 0) not null default 0;

-- 排行榜每日膜拜记录表（每人每天最多膜拜 10 次）
create table if not exists worship_records (
  id             bigserial primary key,
  worshiper_id   text not null references users(id) on delete cascade,
  target_user_id text not null references users(id) on delete cascade,
  day_key        text not null,
  created_at     timestamptz not null default now()
);

create index if not exists worship_records_user_day_idx
  on worship_records (worshiper_id, day_key);

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

-- 系统与运营邮件
create table if not exists mails (
  id             text primary key,
  target_type    text not null,
  target_user_id text references users(id) on delete cascade,
  sender         text not null default '系统管理员',
  title          text not null,
  content        text not null,
  reward_coins   bigint not null default 0,
  created_at     timestamptz not null default now(),
  expire_at      timestamptz not null default (now() + interval '30 days')
);

create index if not exists mails_target_idx on mails (target_type, target_user_id, created_at desc);

-- 玩家邮件读取与领奖状态
create table if not exists mail_user_status (
  mail_id        text not null references mails(id) on delete cascade,
  user_id        text not null references users(id) on delete cascade,
  is_read        boolean not null default false,
  is_claimed     boolean not null default false,
  claimed_at     timestamptz,
  deleted        boolean not null default false,
  primary key (mail_id, user_id)
);

-- 疯狂老虎机服务端权威摇奖与经营统计流水表
create table if not exists slots_spins (
  id            text primary key,
  user_id       text not null references users(id) on delete cascade,
  bet_per_line  integer not null,
  lines         integer not null,
  total_bet     bigint not null,
  win_amount    bigint not null,
  net_delta     bigint not null,
  is_jackpot    boolean not null default false,
  winning_lines integer not null default 0,
  reels         jsonb not null,
  created_at    timestamptz not null default now()
);

create index if not exists slots_spins_created_idx on slots_spins (created_at desc);
create index if not exists slots_spins_user_idx on slots_spins (user_id, created_at desc);

-- 全局动态运营配置表（如游戏分类配置、老虎机中奖概率配置等，GM 端实时修改即时生效）
create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- 玩家问题反馈工单表
create table if not exists feedback_tickets (
  id               text primary key,
  user_id          text not null references users(id) on delete cascade,
  username         text not null default '',
  nickname         text not null default '玩家',
  category         text not null default 'bug',
  priority         text not null default 'normal',
  status           text not null default 'open',
  title            text not null,
  content          text not null,
  contact          text not null default '',
  attachment       text,
  client_info      text not null default '',
  admin_note       text not null default '',
  has_unread_reply boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists feedback_tickets_user_idx on feedback_tickets (user_id, updated_at desc);
create index if not exists feedback_tickets_status_idx on feedback_tickets (status, updated_at desc);

-- 工单回复会话记录表（玩家追加 / GM 官方回复）
create table if not exists feedback_ticket_replies (
  id          text primary key,
  ticket_id   text not null references feedback_tickets(id) on delete cascade,
  sender_role text not null,
  sender_name text not null,
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists feedback_ticket_replies_ticket_idx on feedback_ticket_replies (ticket_id, created_at asc);
`;
